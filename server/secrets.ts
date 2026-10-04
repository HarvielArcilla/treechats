/* Secrets in the system's own secret store, instead of a plain file: your API key, and the encryption key when data
   is encrypted without a password (see server/vault.ts). Where they go:
   - macOS: the login Keychain (the `security` tool)
   - Windows: a file encrypted for your Windows account with DPAPI (through PowerShell), in the data folder
   - Linux: the desktop keyring through libsecret (`secret-tool`), when it is installed and a keyring is running

   A key in .env or the environment still wins, so nothing changes for people who keep it there. The key is never
   put on a command line (other programs can see those); it is passed on stdin. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { config, envFile } from './config.ts';

const SERVICE = 'Treechats', API_KEY = 'anthropic-api-key';
export const DATA_KEY = 'data-key';
/* outside the data folder, and in the local (not roaming) profile, so backups and synced copies of the data don't
   carry the key */
const winDir = () => join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Treechats', 'keys');
const winFile = (account: string) => join(winDir(), `${account}.dpapi`);
/* older versions kept the API key's DPAPI file under this name */
const winLegacy = () => join(config.dataDir, 'api-key.dpapi');

export class SecretError extends Error { constructor(public code: string, message: string) { super(message); } }

type Backend = { name: string; read(account: string): string | null; write(account: string, value: string): void; remove(account: string): void };

const run = (cmd: string, args: string[], input?: string) => spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 20000, windowsHide: true });
const has = (cmd: string) => { const r = run(process.platform === 'win32' ? 'where' : 'which', [cmd]); return r.status === 0; };

const mac: Backend = {
  name: 'macOS Keychain',
  read(account) { const r = run('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']); return r.status === 0 ? r.stdout.trim() || null : null; },
  /* `security -i` reads its commands from stdin, which keeps the secret off the command line. Values are checked to
     be plain letters, digits, - and _ (safeValue), so they can't break out of the quotes. */
  write(account, value) {
    const r = run('security', ['-i'], `add-generic-password -U -s ${SERVICE} -a ${account} -l "Treechats ${account}" -w "${value}"\n`);
    if (r.status !== 0 || /error/i.test(r.stderr || '')) throw new SecretError('keychain_failed', 'The Keychain didn’t take it: ' + (r.stderr || '').trim());
  },
  remove(account) { run('security', ['delete-generic-password', '-s', SERVICE, '-a', account]); },
};

const PS_UNPROTECT = '$s = ConvertTo-SecureString ([Console]::In.ReadToEnd().Trim()); [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))';
const PS_PROTECT = 'ConvertTo-SecureString ([Console]::In.ReadToEnd().Trim()) -AsPlainText -Force | ConvertFrom-SecureString';
const ps = (script: string, input: string) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], input);
const win: Backend = {
  name: 'Windows (encrypted for your account)',
  read(account) {
    const f = existsSync(winFile(account)) ? winFile(account) : account === API_KEY && existsSync(winLegacy()) ? winLegacy() : null;
    if (!f) return null;
    const r = ps(PS_UNPROTECT, readFileSync(f, 'utf8'));
    return r.status === 0 ? r.stdout.trim() || null : null;
  },
  write(account, value) {
    const r = ps(PS_PROTECT, value);
    if (r.status !== 0 || !r.stdout.trim()) throw new SecretError('keychain_failed', 'Windows couldn’t encrypt it: ' + (r.stderr || '').trim());
    mkdirSync(winDir(), { recursive: true });
    writeFileSync(winFile(account), r.stdout.trim(), { mode: 0o600 });
  },
  remove(account) { for (const f of [winFile(account), ...(account === API_KEY ? [winLegacy()] : [])]) try { unlinkSync(f); } catch { /* none */ } },
};

const linux: Backend = {
  name: 'your system keyring',
  read(account) { const r = run('secret-tool', ['lookup', 'service', SERVICE, 'account', account]); return r.status === 0 ? r.stdout.trim() || null : null; },
  write(account, value) {
    const r = run('secret-tool', ['store', `--label=Treechats ${account}`, 'service', SERVICE, 'account', account], value);
    if (r.status !== 0) throw new SecretError('keychain_failed', 'The keyring didn’t take it' + (r.stderr ? ': ' + r.stderr.trim() : '. Is a keyring (such as GNOME Keyring or KWallet) running?'));
  },
  remove(account) { run('secret-tool', ['clear', 'service', SERVICE, 'account', account]); },
};

let backend: Backend | null | undefined;
export function keychain(): Backend | null {
  if (backend !== undefined) return backend;
  if (config.fake && !process.env.TREECHATS_TEST_KEYCHAIN) return (backend = null);
  if (process.platform === 'darwin') backend = has('security') ? mac : null;
  else if (process.platform === 'win32') backend = win;
  else backend = has('secret-tool') ? linux : null;
  return backend;
}

/* at startup: a key from the keychain, when there isn't one in .env or the environment */
export function loadKeyFromKeychain() {
  if (config.apiKey) return;
  const k = keychain();
  let key: string | null = null;
  try { key = k ? k.read(API_KEY) : null; } catch { key = null; }
  if (key) { config.apiKey = key; config.apiKeySource = 'keychain'; }
}

const looksLikeKey = (k: string) => /^[A-Za-z0-9_\-]{20,300}$/.test(k);

/* any secret: stored, then read back to be sure it is really there */
export function saveSecret(account: string, value: string) {
  if (!looksLikeKey(value)) throw new SecretError('bad_value', 'That can’t be stored safely.');
  const k = keychain();
  if (!k) throw new SecretError('no_keychain', noKeychainMessage());
  k.write(account, value);
  if (k.read(account) !== value) throw new SecretError('keychain_failed', `It didn’t read back from ${k.name}.`);
}
export function readSecret(account: string): string | null { const k = keychain(); try { return k ? k.read(account) : null; } catch { return null; } }
export function removeSecret(account: string) { const k = keychain(); if (k) k.remove(account); }
const noKeychainMessage = () => process.platform === 'linux' ? 'There is no keyring to keep it in. Install libsecret-tools (for secret-tool) and run a keyring such as GNOME Keyring.' : 'There is no keychain to keep it in on this computer.';

export function saveKey(key: string) {
  key = String(key || '').trim();
  if (!looksLikeKey(key)) throw new SecretError('bad_key', 'That doesn’t look like an API key. Copy it again from the Claude Console.');
  try { saveSecret(API_KEY, key); }
  catch (e) { if (e instanceof SecretError && e.code === 'no_keychain') throw new SecretError('no_keychain', noKeychainMessage() + ' Keep the key in .env.'); throw e; }
  /* a key in .env would still win, so it comes out of there: the line is kept, empty, with a note */
  if (config.apiKeySource === 'env') clearEnvKey();
  config.apiKey = key; config.apiKeySource = 'keychain';
}

export function removeKey() {
  removeSecret(API_KEY);
  if (config.apiKeySource === 'keychain') { config.apiKey = ''; config.apiKeySource = null; }
}

/* empties ANTHROPIC_API_KEY= in .env, keeping everything else in the file as it was */
function clearEnvKey() {
  if (!existsSync(envFile)) return;
  const text = readFileSync(envFile, 'utf8');
  const next = text.replace(/^(\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=).*$/m, '# The key is in the system keychain now (Settings › System in Treechats).\n$1');
  if (next !== text) writeFileSync(envFile, next, { mode: 0o600 });
  delete process.env.ANTHROPIC_API_KEY;
}

export function keyStatus() {
  const k = keychain();
  return { source: config.apiKeySource, keychain: k ? k.name : null, envFile: existsSync(envFile) };
}
