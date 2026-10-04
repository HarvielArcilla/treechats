import { chmodSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Everything is relative to the project folder, wherever Treechats is started from. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Settings come from a .env file next to package.json (copy .env.example), or from the environment. */
export const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  /* .env holds your API key, so only your account should be able to read it, as with an SSH key */
  try { if (process.platform !== 'win32' && (statSync(envFile).mode & 0o077)) { chmodSync(envFile, 0o600); console.log('  Made .env readable only by you, since it can hold your API key.'); } } catch { /* not ours to change */ }
  process.loadEnvFile(envFile);
}
/* where each system keeps an app's own data: only your account can read it, and it isn't inside the code folder,
   so it doesn't get copied, zipped or synced along with the code */
export function appDataDir() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Treechats');
  if (process.platform === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Treechats');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'treechats');
}
/* where data lived before it moved to the app data folder */
export const oldDataDir = resolve(root, 'data');

export type Tier = 'quick' | 'default' | 'complex';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  /* from .env or the environment; otherwise server/secrets.ts fills it from the system keychain */
  apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  apiKeySource: ((process.env.ANTHROPIC_API_KEY || '').trim() ? 'env' : null) as 'env' | 'keychain' | null,
  models: {
    quick: process.env.TREECHATS_MODEL_QUICK || 'claude-haiku-4-5-20251001',
    default: process.env.TREECHATS_MODEL_DEFAULT || 'claude-sonnet-5-5',
    complex: process.env.TREECHATS_MODEL_COMPLEX || 'claude-opus-5-5',
  } satisfies Record<Tier, string>,
  maxTokens: num(process.env.TREECHATS_MAX_TOKENS, 16000),
  port: num(process.env.TREECHATS_PORT, 5178),
  dataDir: process.env.TREECHATS_DATA_DIR ? resolve(root, process.env.TREECHATS_DATA_DIR) : appDataDir(),
  dataDirSet: !!process.env.TREECHATS_DATA_DIR,
  /* the key that lets the page and MCP clients use the server; made once and kept in the data folder */
  token: (process.env.TREECHATS_TOKEN || '').trim(),
  /* where replies come from: 'api' (your API key), 'claude-code' (your installed Claude Code CLI and
     whatever it is signed in with, such as a Claude subscription), or 'auto': the API key if there is
     one, otherwise Claude Code */
  provider: (['api', 'claude-code'].includes(process.env.TREECHATS_PROVIDER || '') ? process.env.TREECHATS_PROVIDER : 'auto') as 'api' | 'claude-code' | 'auto',
  cliPath: (process.env.TREECHATS_CLAUDE_PATH || 'claude').trim().replace(/^"(.*)"$/, '$1'),
  cliPathSet: !!process.env.TREECHATS_CLAUDE_PATH,
  /* open the page in your browser when Treechats starts (npm start); TREECHATS_OPEN=0 turns it off */
  open: process.env.TREECHATS_OPEN !== '0',
  /* TREECHATS_FAKE=1 answers with canned text instead of calling Claude: for tests and offline work */
  fake: process.env.TREECHATS_FAKE === '1',
  /* npm run dev: the page is served by Vite on the next port, so requests from there are accepted too */
  dev: process.argv.includes('--dev'),
  /* how many model requests one agent run may spend through MCP (spawn, ask, fork, regenerate, distill) */
  agentMaxRequests: num(process.env.TREECHATS_AGENT_MAX_REQUESTS, 60),
  /* milliseconds between pieces of a test reply, to watch streaming */
  fakeDelay: num(process.env.TREECHATS_FAKE_DELAY, 8),
};

/* "claude-haiku-4-5-20251001" → "Haiku 4.5", for labels in the app */
export function modelLabel(id: string): string {
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?/);
  if (!m) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  return `${family} ${m[2]}${m[3] && m[3].length < 4 ? '.' + m[3] : ''}`;
}
