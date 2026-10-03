import { caps } from './models.ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { config, modelLabel, root } from './config.ts';
import { openBrowser } from './proc.ts';
import { provider, streamReply, type SampleRequest } from './claude.ts';
import { cliStatus } from './cli.ts';
import { getValue, putValue, snapshot, snapshots } from './store.ts';
import { handleMcp } from './mcp.ts';
import { attachPage, settle } from './relay.ts';
import { loadState } from './context.ts';

const app = new Hono();
const STATE_KEY = 'treechats-v1';
const MAX_STATE_BYTES = 200 * 1024 * 1024;

/* Treechats only answers this computer, and only pages it served itself. Without these checks any website
   you visit could ask the local server to spend your API key, or read your conversations. */
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const okOrigin = (origin: string) => {
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && localHosts.has(u.hostname) && [config.port, config.port + 1].includes(Number(u.port));
  } catch { return false; }
};
app.use('*', async (c, next) => {
  const host = (c.req.header('host') || '').replace(/:\d+$/, '');
  if (!localHosts.has(host)) return c.text('Treechats only answers requests from this computer.', 403);
  if (c.req.path.startsWith('/api/') || c.req.path === '/mcp') {
    const origin = c.req.header('origin');
    const site = c.req.header('sec-fetch-site');
    if (origin ? !okOrigin(origin) : site && site !== 'same-origin' && site !== 'none') return c.json({ code: 'forbidden', message: 'Requests must come from the Treechats page.' }, 403);
  }
  await next();
});

/* Claude Code's sign-in is checked when Treechats starts, and again whenever the page loads while it isn't ready */
let cli: Promise<{ found: boolean; authMethod?: string; error?: string }> | null = null;
const checkCli = () => (cli = cliStatus());
if (!config.fake && provider() === 'claude-code') checkCli();

app.get('/api/config', async (c) => {
  const p = config.fake ? 'fake' : provider();
  let status = p === 'claude-code' ? await (cli || checkCli()) : null;
  if (status && (!status.found || status.authMethod === 'none')) status = await checkCli();
  const ready = p === 'fake' || (p === 'api' ? !!config.apiKey : !!status && status.found && status.authMethod !== 'none');
  const via = p === 'claude-code' ? ' · Claude Code' : '';
  return c.json({
    hasKey: ready,
    provider: p,
    cli: status,
    tiers: (['quick', 'default', 'complex'] as const).map((t) => [t, `${t[0].toUpperCase() + t.slice(1)} · ${p === 'fake' ? 'test replies' : modelLabel(config.models[t]) + via}`]),
    models: config.models,
    /* which model settings each tier's model uses (Claude Code takes only the system prompt) */
    caps: Object.fromEntries((['quick', 'default', 'complex'] as const).map((t) => [t, p === 'claude-code' ? { temperature: false, effort: false, thinking: 'none', systemOnly: true } : caps(config.models[t])])),
    limits: { maxPromptBytes: 3_000_000 },
  });
});

app.get('/api/state', (c) => {
  const v = getValue(STATE_KEY);
  return v == null ? c.body(null, 204) : c.body(v, 200, { 'content-type': 'application/json; charset=utf-8' });
});
app.put('/api/state', async (c) => {
  const body = await c.req.text();
  if (body.length > MAX_STATE_BYTES) return c.json({ code: 'too_large' }, 413);
  try { JSON.parse(body); } catch { return c.json({ code: 'bad_json' }, 400); }
  putValue(STATE_KEY, body);
  return c.body(null, 204);
});
app.get('/api/snapshots', (c) => c.json(snapshots(STATE_KEY)));
app.get('/api/snapshots/:id', (c) => {
  const v = snapshot(STATE_KEY, Number(c.req.param('id')));
  return v == null ? c.notFound() : c.body(v, 200, { 'content-type': 'application/json; charset=utf-8' });
});

app.post('/api/sample', async (c) => {
  let req: SampleRequest;
  try { req = await c.req.json(); } catch { return c.json({ code: 'bad_request', message: 'Expected JSON.' }, 400); }
  return c.body(streamReply(req, c.req.raw.signal), 200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
});

/* the open page carries out agent commands (see server/relay.ts) */
app.get('/api/agent/events', (c) => streamSSE(c, async (stream) => {
  const detach = attachPage((data) => { stream.writeSSE({ data }).catch(() => {}); });
  const ping = setInterval(() => { stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}); }, 20000);
  await new Promise<void>((resolve) => { stream.onAbort(() => resolve()); c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true }); });
  clearInterval(ping); detach();
}));
app.post('/api/agent/result', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ code: 'bad_request' }, 400); }
  return settle(body) ? c.body(null, 204) : c.json({ code: 'unknown_command' }, 404);
});

/* MCP: lets Claude Code and other MCP clients read your spaces, conversations and context (see server/mcp.ts) */
app.all('/mcp', (c) => handleMcp(c.req.raw, () => loadState()));

/* the page itself: the built app in dist/ (npm start builds it first) */
const dist = resolve(root, 'dist');
app.use('/*', serveStatic({ root: './dist' }));
app.get('*', (c) => {
  const index = resolve(dist, 'index.html');
  if (!existsSync(index)) return c.text('The app has not been built yet. Run "npm start" (or "npm run build").', 503);
  return c.html(readFileSync(index, 'utf8'));
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  const url = `http://localhost:${info.port}`;
  console.log(`\n  Treechats is running at ${url}\n`);
  if (config.fake) console.log('  Test mode: replies are canned (TREECHATS_FAKE=1).\n');
  else if (provider() === 'claude-code') console.log('  Replies come from your Claude Code CLI and whatever it is signed in with.\n  To use an API key instead, add ANTHROPIC_API_KEY to .env and restart.\n');
  else console.log('  Replies use your API key (ANTHROPIC_API_KEY).\n');
  console.log(`  For Claude Code: claude mcp add --transport http --scope user treechats ${url}/mcp\n`);
  console.log('  Press Ctrl+C to stop.\n');
  if (config.open && process.argv.includes('--open')) openBrowser(url);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${config.port} is already in use. Treechats may already be running: open http://localhost:${config.port}`);
    console.error('  Or pick another port with TREECHATS_PORT in .env.\n');
    process.exit(1);
  }
  throw e;
});
const quit = () => { server.close(); process.exit(0); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
