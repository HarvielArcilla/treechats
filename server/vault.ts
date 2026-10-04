/* Encryption at rest, and the password lock. With encryption on, everything Treechats saves on the server (your
   conversations, settings and their snapshots) is encrypted, and the page encrypts attachments in the browser with a
   key it gets from here. It is off by default, and comes in two modes:
   - "keychain": the data key is kept in the system keychain, so Treechats opens without asking. This protects copies
     of the data folder (backups, sync, a copied disk) but not someone using your account.
   - "password": the password lock. The data key is wrapped by a key made from your password, and Treechats asks for
     it whenever it starts or locks. Turning the lock on turns encryption on.

   How: a random 256-bit data key encrypts the data with AES-256-GCM. The data key is saved wrapped by your recovery
   key (a random code shown when encryption is turned on), and in password mode also wrapped with a key made from your
   password by scrypt (slow on purpose, so guessing is expensive). Changing the password only re-wraps the data key.
   While unlocked, the data key is kept in memory only; locking forgets it.

   Nothing here can get the data back without the password, the keychain entry or the recovery key. That is the
   point, and the risk. */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string | Buffer, salt: Buffer, len: number, o: object) => Promise<Buffer>;
export const SEALED = 'tcv1:';
export const LOCKED_MSG = 'Treechats is locked. Open it in your browser and enter your password, then try again.';
const WRAP_AAD = Buffer.from('treechats-vault-v1');
/* OWASP's recommended scrypt cost: 128 MB of memory and a few hundred milliseconds per try */
const KDF = { N: 2 ** 17, r: 8, p: 1 };

/* mode is missing on records made before the keychain mode existed: those are password records */
export type VaultRecord = { v: 1; mode?: 'password' | 'keychain'; kdf?: { N: number; r: number; p: number; salt: string }; pw?: string; rk: string; autoLock: number; check: string };
export const modeOf = (r: VaultRecord) => r.mode || 'password';
export class VaultError extends Error { constructor(public code: string, message: string) { super(message); } }

const b64 = (b: Buffer) => b.toString('base64');
const unb64 = (s: string) => Buffer.from(s, 'base64');

function gcm(key: Buffer, data: Buffer, aad?: Buffer) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(aad);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function ungcm(key: Buffer, blob: Buffer, aad?: Buffer) {
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  if (aad) d.setAAD(aad);
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

const passwordKey = (password: string, kdf: NonNullable<VaultRecord['kdf']>) =>
  scrypt(password.normalize('NFKC'), unb64(kdf.salt), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 });
/* the recovery key is 160 random bits already, so it needs no slow stretching */
const recoveryKeyBytes = (code: string) => Buffer.from(hkdfSync('sha256', Buffer.from(normRecovery(code)), Buffer.alloc(0), 'treechats-recovery', 32));
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const normRecovery = (code: string) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function newRecoveryCode() {
  const bytes = randomBytes(20); let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return out.match(/.{4}/g)!.join('-');
}

let dataKey: Buffer | null = null;
let lastActive = 0;

export const isUnlocked = () => !!dataKey;
export const touch = () => { lastActive = Date.now(); };
export const idleMs = () => Date.now() - lastActive;
export function forget() { if (dataKey) dataKey.fill(0); dataKey = null; }

export function seal(text: string): string {
  if (!dataKey) throw new VaultError('locked', LOCKED_MSG);
  return SEALED + b64(gcm(dataKey, Buffer.from(text, 'utf8')));
}
export function open(value: string): string {
  if (!value.startsWith(SEALED)) return value;
  if (!dataKey) throw new VaultError('locked', LOCKED_MSG);
  return ungcm(dataKey, unb64(value.slice(SEALED.length))).toString('utf8');
}
/* the key the page uses for attachments in the browser; a different key from the data key, derived from it */
export function filesKey(): string {
  if (!dataKey) throw new VaultError('locked', LOCKED_MSG);
  return b64(Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), 'treechats-files', 32)));
}

export function checkPassword(pw: string) {
  if (typeof pw !== 'string' || [...pw].length < 8) throw new VaultError('weak_password', 'Use a password of at least 8 characters. A few unrelated words make a strong one.');
  if (pw.length > 1024) throw new VaultError('weak_password', 'That password is too long.');
}

/* turns encryption on: a new data key, wrapped by a new recovery key, and by the password when one is given (without
   one, the caller keeps the key in the keychain: see rawKey) */
export async function create(password: string | null, autoLock: number): Promise<{ record: VaultRecord; recovery: string }> {
  if (password != null) checkPassword(password);
  const key = randomBytes(32), recovery = newRecoveryCode();
  let record: VaultRecord = {
    v: 1, mode: 'keychain', autoLock,
    rk: b64(gcm(recoveryKeyBytes(recovery), key, WRAP_AAD)),
    check: b64(gcm(key, Buffer.from('treechats'), WRAP_AAD)),
  };
  forget(); dataKey = key; touch();
  if (password != null) record = await rewrap(record, password);
  return { record, recovery };
}
/* the data key as text, for the keychain; and unlocking with it */
export function rawKey(): string {
  if (!dataKey) throw new VaultError('locked', LOCKED_MSG);
  return dataKey.toString('base64url');
}
export function unlockWithRaw(record: VaultRecord, raw: string) {
  const key = Buffer.from(String(raw || ''), 'base64url');
  try { if (key.length !== 32 || !timingSafeEqual(ungcm(key, unb64(record.check), WRAP_AAD), Buffer.from('treechats'))) throw 0; }
  catch { throw new VaultError('wrong_key', 'The key in the keychain doesn’t open this data.'); }
  forget(); dataKey = key; touch();
}
/* password mode back to keychain mode: the password wrap is dropped (the caller puts rawKey in the keychain) */
export const withoutPassword = (record: VaultRecord): VaultRecord => { const { kdf, pw, ...rest } = record; return { ...rest, mode: 'keychain' }; };

/* unlocks with the password or the recovery key; a wrong one throws */
export async function unlock(record: VaultRecord, secret: { password?: string; recovery?: string }) {
  let key: Buffer;
  try {
    if (secret.recovery != null) key = ungcm(recoveryKeyBytes(secret.recovery), unb64(record.rk), WRAP_AAD);
    else { if (!record.kdf || !record.pw) throw 0; key = ungcm(await passwordKey(String(secret.password ?? ''), record.kdf), unb64(record.pw), WRAP_AAD); }
  } catch { throw new VaultError('wrong_password', secret.recovery != null ? 'That recovery key isn’t right.' : 'That password isn’t right.'); }
  const ok = ungcm(key, unb64(record.check), WRAP_AAD);
  if (!timingSafeEqual(ok, Buffer.from('treechats'))) throw new VaultError('wrong_password', 'That password isn’t right.');
  forget(); dataKey = key; touch();
}

/* a new password for the data key that is unlocked now (after a password check, or a recovery key); this is also how
   keychain mode becomes password mode */
export async function rewrap(record: VaultRecord, password: string): Promise<VaultRecord> {
  checkPassword(password);
  if (!dataKey) throw new VaultError('locked', LOCKED_MSG);
  const kdf = { ...KDF, salt: b64(randomBytes(16)) };
  return { ...record, mode: 'password', kdf, pw: b64(gcm(await passwordKey(password, kdf), dataKey, WRAP_AAD)) };
}
/* a new recovery key, replacing the old one */
export function newRecovery(record: VaultRecord): { record: VaultRecord; recovery: string } {
  if (!dataKey) throw new VaultError('locked', LOCKED_MSG);
  const recovery = newRecoveryCode();
  return { record: { ...record, rk: b64(gcm(recoveryKeyBytes(recovery), dataKey, WRAP_AAD)) }, recovery };
}

/* Slows down guessing: one password check at a time (others are turned away, not queued), and after a few wrong tries
   in a row each one doubles the wait before the next is allowed, up to 5 minutes. */
let fails = 0, nextTry = 0, checking = false;
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  const wait = nextTry - Date.now();
  if (wait > 0) throw new VaultError('too_many_tries', `Too many wrong tries. Wait ${Math.ceil(wait / 1000)} seconds.`);
  if (checking) throw new VaultError('too_many_tries', 'Another password check is running. Try again in a moment.');
  checking = true;
  try {
    const out = await fn();
    fails = 0; nextTry = 0;
    return out;
  } catch (e) {
    if (e instanceof VaultError && e.code === 'wrong_password') { fails++; nextTry = Date.now() + Math.min(300_000, fails < 3 ? 0 : 1000 * 2 ** (fails - 3)); }
    throw e;
  } finally { checking = false; }
}
/* changes to the lock (turning it on or off, a new password or recovery key) run one at a time */
let chain: Promise<unknown> = Promise.resolve();
export function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
