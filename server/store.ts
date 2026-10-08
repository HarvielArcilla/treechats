import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, oldDataDir } from './config.ts';
import * as vault from './vault.ts';

/* Everything the app saves lives in one SQLite file, treechats.db, in your account's app data folder
   (see appDataDir in config.ts). The app state is stored as one document (the same JSON the browser version kept
   in localStorage), plus a rolling set of snapshots so a bad change can be recovered from. With the password lock
   on, both are encrypted (see server/vault.ts). */
const posix = process.platform !== 'win32';
const DB_FILES = ['treechats.db', 'treechats.db-wal', 'treechats.db-shm', 'token'];

/* data used to live in the data/ folder next to the code; it moves once, the first time this version starts */
function migrate() {
  if (config.dataDirSet || !existsSync(join(oldDataDir, 'treechats.db')) || existsSync(join(config.dataDir, 'treechats.db'))) return;
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  for (const f of DB_FILES) {
    const from = join(oldDataDir, f), to = join(config.dataDir, f);
    if (!existsSync(from)) continue;
    try { renameSync(from, to); } catch { copyFileSync(from, to); unlinkSync(from); }
  }
  try { if (!readdirSync(oldDataDir).length) rmdirSync(oldDataDir); } catch { /* other files are left alone */ }
  console.log(`  Moved your Treechats data from ${oldDataDir} to ${config.dataDir}.`);
}
migrate();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
/* only your account can open the folder or the files in it (files moved here keep the permissions they had) */
const ownerOnly = () => {
  if (!posix) return;
  try { chmodSync(config.dataDir, 0o700); } catch { /* not ours */ }
  for (const f of DB_FILES) try { if (existsSync(join(config.dataDir, f))) chmodSync(join(config.dataDir, f), 0o600); } catch { /* not ours */ }
};
ownerOnly();

const db = new DatabaseSync(join(config.dataDir, 'treechats.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA secure_delete = ON;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT NOT NULL, saved INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);
`);
ownerOnly();

/* ---- the token ----
   Anything on this computer can connect to localhost, including other people's accounts. The token is what proves a
   request comes from you: the page keeps it in its own storage after signing in, MCP clients send it as a
   bearer token. It is kept in the data folder, readable only by you, so it survives restarts. */
const tokenFile = join(config.dataDir, 'token');
export let token = (() => {
  if (config.token) return config.token;
  try { const t = readFileSync(tokenFile, 'utf8').trim(); if (t.length >= 32) return t; } catch { /* first run */ }
  const t = randomBytes(32).toString('base64url');
  writeFileSync(tokenFile, t + '\n', { mode: 0o600 });
  return t;
})();
/* a new token: every browser and coding tool that had the old one is signed out */
export function resetToken() {
  if (config.token) throw new Error('The token is set by TREECHATS_TOKEN; change it there.');
  token = randomBytes(32).toString('base64url');
  writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
  return token;
}

const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const SNAPSHOTS_KEPT = 50;

const getStmt = db.prepare('SELECT value, updated FROM kv WHERE key = ?');
const putStmt = db.prepare('INSERT INTO kv (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated');
const lastSnap = db.prepare('SELECT saved FROM snapshots WHERE key = ? ORDER BY id DESC LIMIT 1');
const addSnap = db.prepare('INSERT INTO snapshots (key, value, saved) VALUES (?, ?, ?)');
const trimSnaps = db.prepare('DELETE FROM snapshots WHERE key = ? AND id NOT IN (SELECT id FROM snapshots WHERE key = ? ORDER BY id DESC LIMIT ?)');
const listSnaps = db.prepare('SELECT id, saved, length(value) AS bytes FROM snapshots WHERE key = ? ORDER BY id DESC');
const getSnap = db.prepare('SELECT value FROM snapshots WHERE key = ? AND id = ?');
const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const putMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const delMeta = db.prepare('DELETE FROM meta WHERE key = ?');

export function getValue(key: string): string | null {
  const row = getStmt.get(key) as { value: string } | undefined;
  return row ? vault.open(row.value) : null;
}

export function putValue(key: string, value: string): void {
  const now = Date.now(), stored = vaultRecord() ? vault.seal(value) : value;
  putStmt.run(key, stored, now);
  const last = lastSnap.get(key) as { saved: number } | undefined;
  if (!last || now - last.saved > SNAPSHOT_EVERY_MS) {
    addSnap.run(key, stored, now);
    trimSnaps.run(key, key, SNAPSHOTS_KEPT);
  }
}

/* a value with no snapshots, for the server's own bookkeeping (scheduled runs); encrypted like the rest */
export function putPlainValue(key: string, value: string): void {
  putStmt.run(key, vaultRecord() ? vault.seal(value) : value, Date.now());
}

export function snapshots(key: string) {
  if (vaultRecord() && !vault.isUnlocked()) throw new vault.VaultError('locked', vault.LOCKED_MSG);
  return listSnaps.all(key) as { id: number; saved: number; bytes: number }[];
}

export function snapshot(key: string, id: number): string | null {
  const row = getSnap.get(key, id) as { value: string } | undefined;
  return row ? vault.open(row.value) : null;
}

/* ---- files ----
   Attached and project files, one row each: their details and contents as JSON (an image's bytes as base64). A
   file's id changes when it's edited, so rows are never rewritten in place. Encrypted like the rest with the lock on.
   The browser keeps a copy too, as a cache. */
export type FileRecord = { name: string; type?: string; size?: number; kind: 'text' | 'image'; text?: string; data?: string };
const putFileStmt = db.prepare('INSERT INTO files (id, value, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated = excluded.updated');
const getFileStmt = db.prepare('SELECT value FROM files WHERE id = ?');
const fileIdsStmt = db.prepare('SELECT id FROM files');
export function putFile(id: string, rec: FileRecord): void {
  const v = JSON.stringify(rec);
  putFileStmt.run(id, vaultRecord() ? vault.seal(v) : v, Date.now());
}
export function getFile(id: string): FileRecord | null {
  const row = getFileStmt.get(id) as { value: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(vault.open(row.value)); } catch { return null; }
}
export const fileIds = () => (fileIdsStmt.all() as { id: string }[]).map((r) => r.id);

/* ---- the password lock's record, and re-encrypting everything when it is turned on or off ---- */
export function vaultRecord(): vault.VaultRecord | null {
  const row = getMeta.get('vault') as { value: string } | undefined;
  return row ? JSON.parse(row.value) : null;
}
export function saveVaultRecord(r: vault.VaultRecord) { putMeta.run('vault', JSON.stringify(r)); }
/* small bookkeeping values that aren't secret (the document's revision number) */
export const metaValue = (k: string) => (getMeta.get(k) as { value: string } | undefined)?.value ?? null;
export const setMetaValue = (k: string, v: string) => { putMeta.run(k, v); };

/* rewrites every saved value with fn, in one transaction, then compacts the file so no old copy is left in free
   pages or the journal */
function rewriteAll(fn: (v: string) => string, after: () => void) {
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[]) db.prepare('UPDATE kv SET value = ? WHERE key = ?').run(fn(r.value), r.key);
    for (const r of db.prepare('SELECT id, value FROM snapshots').all() as { id: number; value: string }[]) db.prepare('UPDATE snapshots SET value = ? WHERE id = ?').run(fn(r.value), r.id);
    for (const r of db.prepare('SELECT id, value FROM files').all() as { id: string; value: string }[]) db.prepare('UPDATE files SET value = ? WHERE id = ?').run(fn(r.value), r.id);
    after();
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  db.exec('VACUUM');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
}
/* turn the lock on: the vault must already hold the new data key (vault.create) */
export function encryptAll(record: vault.VaultRecord) {
  rewriteAll((v) => v.startsWith(vault.SEALED) ? v : vault.seal(v), () => saveVaultRecord(record));
}
/* turn the lock off: needs it unlocked */
export function decryptAll() {
  rewriteAll((v) => vault.open(v), () => delMeta.run('vault'));
}
