import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Everything is relative to the project folder, wherever Treechats is started from. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Settings come from a .env file next to package.json (copy .env.example), or from the environment. */
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export type Tier = 'quick' | 'default' | 'complex';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const config = {
  apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(),
  models: {
    quick: process.env.TREECHATS_MODEL_QUICK || 'claude-haiku-4-5-20251001',
    default: process.env.TREECHATS_MODEL_DEFAULT || 'claude-sonnet-5-5',
    complex: process.env.TREECHATS_MODEL_COMPLEX || 'claude-opus-5-5',
  } satisfies Record<Tier, string>,
  maxTokens: num(process.env.TREECHATS_MAX_TOKENS, 16000),
  port: num(process.env.TREECHATS_PORT, 5178),
  dataDir: resolve(root, process.env.TREECHATS_DATA_DIR || 'data'),
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
