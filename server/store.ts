import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

/* Everything the app saves lives in one SQLite file, data/treechats.db.
   The app state is stored as one document for now (the same JSON the browser version kept in
   localStorage), plus a rolling set of snapshots so a bad change can be recovered from. */
mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(join(config.dataDir, 'treechats.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, value TEXT NOT NULL, saved INTEGER NOT NULL);
`);

const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const SNAPSHOTS_KEPT = 50;

const getStmt = db.prepare('SELECT value, updated FROM kv WHERE key = ?');
const putStmt = db.prepare('INSERT INTO kv (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated');
const lastSnap = db.prepare('SELECT saved FROM snapshots WHERE key = ? ORDER BY id DESC LIMIT 1');
const addSnap = db.prepare('INSERT INTO snapshots (key, value, saved) VALUES (?, ?, ?)');
const trimSnaps = db.prepare('DELETE FROM snapshots WHERE key = ? AND id NOT IN (SELECT id FROM snapshots WHERE key = ? ORDER BY id DESC LIMIT ?)');
const listSnaps = db.prepare('SELECT id, saved, length(value) AS bytes FROM snapshots WHERE key = ? ORDER BY id DESC');
const getSnap = db.prepare('SELECT value FROM snapshots WHERE key = ? AND id = ?');

export function getValue(key: string): string | null {
  const row = getStmt.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function putValue(key: string, value: string): void {
  const now = Date.now();
  putStmt.run(key, value, now);
  const last = lastSnap.get(key) as { saved: number } | undefined;
  if (!last || now - last.saved > SNAPSHOT_EVERY_MS) {
    addSnap.run(key, value, now);
    trimSnaps.run(key, key, SNAPSHOTS_KEPT);
  }
}

export function snapshots(key: string) {
  return listSnaps.all(key) as { id: number; saved: number; bytes: number }[];
}

export function snapshot(key: string, id: number): string | null {
  const row = getSnap.get(key, id) as { value: string } | undefined;
  return row ? row.value : null;
}
