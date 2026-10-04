/* Your API key in the system's own secret store, instead of a plain file:
   - macOS: the login Keychain (the `security` tool)
   - Windows: a file encrypted for your Windows account with DPAPI (through PowerShell), in the data folder
   - Linux: the desktop keyring through libsecret (`secret-tool`), when it is installed and a keyring is running

   A key in .env or the environment still wins, so nothing changes for people who keep it there. The key is never
   put on a command line (other programs can see those); it is passed on stdin. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, envFile } from './config.ts';

const SERVICE = 'Treechats', ACCOUNT = 'anthropic-api-key';
const winFile = () => join(config.dataDir, 'api-key.dpapi');

export class SecretError extends Error { constructor(public code: string, message: string) { super(message); } }

type Backend = { name: string; read(): string | null; write(key: string): void; remove(): void };

const run = (cmd: string, args: string[], input?: string) => spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 20000, windowsHide: true });
const has = (cmd: string) => { const r = run(process.platform === 'win32' ? 'where' : 'which', [cmd]); return r.status === 0; };

const mac: Backend = {
  name: 'macOS Keychain',
  read() { const r = run('security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']); return r.status === 0 ? r.stdout.trim() || null : null; },
  /* `security -i` reads its commands from stdin, which keeps the key off the command line */
  write(key) {
    const r = run('security', ['-i'], `add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -l "Treechats API key" -w "${key}"\n`);
    if (r.status !== 0 || /error/i.test(r.stderr || '')) throw new SecretError('keychain_failed', 'The Keychain didn’t take the key: ' + (r.stderr || '').trim());
  },
  remove() { run('security', ['delete-generic-password', '-s', SERVICE, '-a', ACCOUNT]); },
};

const PS_UNPROTECT = '$s = ConvertTo-SecureString ([Console]::In.ReadToEnd().Trim()); [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))';
const PS_PROTECT = 'ConvertTo-SecureString ([Console]::In.ReadToEnd().Trim()) -AsPlainText -Force | ConvertFrom-SecureString';
const ps = (script: string, input: string) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], input);
const win: Backend = {
  name: 'Windows (encrypted for your account)',
  read() {
    if (!existsSync(winFile())) return null;
    const r = ps(PS_UNPROTECT, readFileSync(winFile(), 'utf8'));
    return r.status === 0 ? r.stdout.trim() || null : null;
  },
  write(key) {
    const r = ps(PS_PROTECT, key);
    if (r.status !== 0 || !r.stdout.trim()) throw new SecretError('keychain_failed', 'Windows couldn’t encrypt the key: ' + (r.stderr || '').trim());
    writeFileSync(winFile(), r.stdout.trim(), { mode: 0o600 });
  },
  remove() { try { unlinkSync(winFile()); } catch { /* none */ } },
};

const linux: Backend = {
  name: 'your system keyring',
  read() { const r = run('secret-tool', ['lookup', 'service', SERVICE, 'account', ACCOUNT]); return r.status === 0 ? r.stdout.trim() || null : null; },
  write(key) {
    const r = run('secret-tool', ['store', '--label=Treechats API key', 'service', SERVICE, 'account', ACCOUNT], key);
    if (r.status !== 0) throw new SecretError('keychain_failed', 'The keyring didn’t take the key' + (r.stderr ? ': ' + r.stderr.trim() : '. Is a keyring (such as GNOME Keyring or KWallet) running?'));
  },
  remove() { run('secret-tool', ['clear', 'service', SERVICE, 'account', ACCOUNT]); },
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
  try { key = k ? k.read() : null; } catch { key = null; }
  if (key) { config.apiKey = key; config.apiKeySource = 'keychain'; }
}

const looksLikeKey = (k: string) => /^[A-Za-z0-9_\-]{20,300}$/.test(k);

export function saveKey(key: string) {
  key = String(key || '').trim();
  if (!looksLikeKey(key)) throw new SecretError('bad_key', 'That doesn’t look like an API key. Copy it again from the Claude Console.');
  const k = keychain();
  if (!k) throw new SecretError('no_keychain', process.platform === 'linux' ? 'There is no keyring to save it in. Install libsecret-tools (for secret-tool) and run a keyring such as GNOME Keyring, or keep the key in .env.' : 'There is no keychain to save it in on this computer. Keep the key in .env.');
  k.write(key);
  if (k.read() !== key) throw new SecretError('keychain_failed', `The key didn’t read back from ${k.name}.`);
  /* a key in .env would still win, so it comes out of there: the line is kept, empty, with a note */
  if (config.apiKeySource === 'env') clearEnvKey();
  config.apiKey = key; config.apiKeySource = 'keychain';
}

export function removeKey() {
  const k = keychain();
  if (k) k.remove();
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
