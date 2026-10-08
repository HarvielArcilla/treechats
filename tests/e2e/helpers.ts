/* End-to-end helpers: a real Treechats server (test replies, a fresh data folder) and real browser tabs (Chromium,
   through Playwright), so the page, the server and agents are tested together the way they're used.

   Run with `npm run test:e2e`. The first time on a new machine: `npx playwright install chromium`. */
import { after } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

export const root = resolve(import.meta.dirname, '..', '..');
export const TOKEN = 'e2e-token-0123456789abcdefghijklmnopqrstuvwxyz';
const children: ChildProcess[] = [];
let browser: Browser | null = null;
after(async () => { for (const c of children) c.kill(); if (browser) await browser.close(); });

export type Server = { base: string; data: string; env: Record<string, string>; child: ChildProcess };
/* a server with test replies on a fresh (or given) data folder */
export async function startServer(env: Record<string, string> = {}, data = mkdtempSync(join(tmpdir(), 'treechats-e2e-')), attempts = 4, fixedPort?: number): Promise<Server> {
  const port = fixedPort ?? 6400 + Math.floor(Math.random() * 2000);
  const all = { TREECHATS_FAKE: '1', ...env };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/start.ts'], {
    cwd: root, env: { ...process.env, TREECHATS_PORT: String(port), TREECHATS_DATA_DIR: data, TREECHATS_OPEN: '0', ANTHROPIC_API_KEY: '', TREECHATS_TOKEN: TOKEN, ...all }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let log = '', exited = false;
  child.stdout!.on('data', (d) => { log += d; }); child.stderr!.on('data', (d) => { log += d; });
  child.on('exit', () => { exited = true; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150 && !exited; i++) {
    try { const r = await api(base, '/api/config'); if (r.ok) return { base, data, env: all, child }; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  if (attempts > 1) return startServer(env, data, attempts - 1, fixedPort);
  throw new Error('server did not start:\n' + log);
}
/* the same data folder, after the server stops and starts again */
export async function restart(s: Server): Promise<Server> {
  const exited = new Promise((r) => s.child.once('exit', r));
  s.child.kill(); await exited; await new Promise((r) => setTimeout(r, 300));
  return startServer(s.env, s.data, 6, Number(new URL(s.base).port));
}
export const api = (base: string, path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> || {}) } });
export const state = async (s: Server) => (await (await api(s.base, '/api/state')).json()) as any;

/* a new browser tab (its own storage, like another browser) signed in to the server, once Claude is connected */
export async function openPage(s: Server): Promise<Page> {
  if (!browser) browser = await chromium.launch(process.env.TREECHATS_CHROMIUM ? { executablePath: process.env.TREECHATS_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  /* the page keeps its state in top-level variables (let, const), which aren't properties of window: window.__g
     reads and sets any of them by name, from code run in the page */
  await ctx.addInitScript(`(() => {
    const g = globalThis.eval; /* called like this, eval works in the page's global scope */
    window.__name = (f) => f; /* tsx wraps named functions in test code with this helper */
    window.__g = new Proxy({}, { get: (_t, k) => g(String(k)), set: (_t, k, v) => { window.__gv = v; g(String(k) + ' = window.__gv'); return true; } });
  })();`); /* a string, so tsx adds nothing to it */
  const page = await ctx.newPage();
  const errors: string[] = []; (page as any).errors = errors;
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${s.base}/?token=${TOKEN}`);
  await page.waitForFunction(() => { try { return (window as any).__g.sampleState === 'ready'; } catch { return false; } });
  await page.waitForTimeout(600);
  return page;
}
export const pageErrors = (p: Page): string[] => (p as any).errors;

/* an MCP client, as a coding agent connects */
export async function mcp(s: Server) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(s.base + '/mcp'), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
  const call = async (name: string, args: Record<string, unknown>) => { const r: any = await client.callTool({ name, arguments: args }); return (r.isError ? 'ERROR: ' : '') + r.content.map((c: any) => c.text).join('\n'); };
  return { client, call };
}

/* Recorded results: what an operation gave last time it was checked. With UPDATE_FIXTURES=1 the fixture is written
   from this run instead (after a change that is meant to alter results). */
export function fixture<T>(name: string, now: T): T | null {
  const file = join(root, 'tests', 'e2e', 'fixtures', name + '.json');
  if (process.env.UPDATE_FIXTURES === '1' || !existsSync(file)) { writeFileSync(file, JSON.stringify(now, null, 1) + '\n'); return null; }
  return JSON.parse(readFileSync(file, 'utf8'));
}
