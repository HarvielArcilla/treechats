import { caps } from './models.ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { streamSSE, type SSEStreamingApi } from 'hono/streaming';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config, modelLabel, root } from './config.ts';
import { openBrowser } from './proc.ts';
import { provider, streamReply, type SampleRequest } from './claude.ts';
import { cliStatus } from './cli.ts';
import { decryptAll, encryptAll, getValue, putValue, resetToken, saveVaultRecord, snapshot, snapshots, token, vaultRecord } from './store.ts';
import * as vault from './vault.ts';
import { keyStatus, loadKeyFromKeychain, removeKey, saveKey, SecretError } from './secrets.ts';
import { handleMcp } from './mcp.ts';
import { attachPage, settle } from './relay.ts';
import { loadState } from './context.ts';
import { FolderError, listFolder, readFolderFiles, writeFolderFile } from './folders.ts';
import { listSessions, parseSession, readSession, SessionError } from './sessions.ts';
import { gitDiff, gitStatus, runCommand } from './run.ts';

const app = new Hono();
loadKeyFromKeychain();
const STATE_KEY = 'treechats-v1';
const MAX_STATE_BYTES = 200 * 1024 * 1024;

/* Who may use Treechats. Three checks, each for a different way in:
   - Host: only names for this computer, so a website can't reach it through DNS rebinding
   - Origin: requests from other websites are refused, so a page you visit can't spend your key or read your chats
   - the token: proves the request comes from you and not another account or program on this computer. The page
     gets it as a cookie from the link Treechats opens (or by pasting it, or by entering the lock password); MCP
     clients send it as "Authorization: Bearer <token>".
   With the password lock on and locked, only unlocking works until the password is entered. */
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const okOrigin = (origin: string) => {
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && localHosts.has(u.hostname) && (Number(u.port) === config.port || (config.dev && Number(u.port) === config.port + 1));
  } catch { return false; }
};
const COOKIE = `treechats_${config.port}`;
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function authed(c: Context) {
  const h = c.req.header('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(h)?.[1]?.trim();
  if (bearer && same(bearer, token)) return true;
  const ck = getCookie(c, COOKIE);
  return !!ck && same(ck, token);
}
/* The cookie lasts as long as browsers allow (400 days). Browsers send it with requests to any port on localhost (cookies
   don't separate ports), so another local server you open in this browser could see it: one more reason the token
   can be reset in Settings › Privacy & security. */
const grant = (c: Context) => setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 400 * 86400 });
const OPEN_PATHS = new Set(['/api/auth', '/api/auth/login', '/api/vault/unlock']);
const locked = () => !!vaultRecord() && !vault.isUnlocked();
/* The browser is opened with a one-time code rather than the token, because a command line (the browser's, here) can
   be read by other accounts. The code works once, for 10 minutes. */
const loginCodes = new Map<string, number>();
export function oneTimeLink() {
  const code = randomBytes(24).toString('base64url');
  loginCodes.set(code, Date.now() + 10 * 60_000);
  return `http://localhost:${config.port}/?login=${code}`;
}
const useCode = (code: string) => { const exp = loginCodes.get(code); loginCodes.delete(code); return !!exp && exp > Date.now(); };

app.use('*', async (c, next) => {
  const host = (c.req.header('host') || '').replace(/:\d+$/, '');
  if (!localHosts.has(host)) return c.text('Treechats only answers requests from this computer.', 403);
  const path = c.req.path;
  if (path.startsWith('/api/') || path === '/mcp') {
    const origin = c.req.header('origin');
    const site = c.req.header('sec-fetch-site');
    if (origin ? !okOrigin(origin) : site && site !== 'same-origin' && site !== 'none') return c.json({ code: 'forbidden', message: 'Requests must come from the Treechats page.' }, 403);
    /* changes must be sent as JSON: a browser can't send that from another site without asking first (a CORS
       preflight, which Treechats doesn't answer), so a page elsewhere can't post a form or a plain-text body here */
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && path.startsWith('/api/') && !/^application\/json\b/i.test(c.req.header('content-type') || '')) return c.json({ code: 'bad_request', message: 'Send JSON.' }, 415);
    if (!OPEN_PATHS.has(path)) {
      if (!authed(c)) return c.json({ code: 'unauthorized', message: path === '/mcp' ? `Treechats needs its token. Add the header "Authorization: Bearer <token>"; Settings › System in Treechats shows the full command.` : 'Open Treechats from the link it printed when it started.' }, 401);
      if (locked() && path !== '/mcp') return c.json({ code: 'locked', message: vault.LOCKED_MSG }, 423);
      if (path !== '/api/agent/events') vault.touch();
    }
  } else if (c.req.method === 'GET' && (c.req.query('token') || c.req.query('login'))) {
    /* a sign-in link: the token (printed in the terminal) or a one-time code; it becomes a cookie and leaves the address bar */
    const t = c.req.query('token'), l = c.req.query('login');
    if ((t && same(t, token)) || (l && useCode(l))) grant(c);
    return c.redirect('/', 302);
  }
  await next();
});
app.onError((e, c) => {
  if (e instanceof vault.VaultError) return c.json({ code: e.code, message: e.message }, e.code === 'locked' ? 423 : 400);
  console.error(e);
  return c.json({ code: 'failed', message: (e as Error).message }, 500);
});

/* ---- signing in and the password lock (see server/vault.ts) ---- */
const lockListeners = new Set<SSEStreamingApi>();
function lockNow() {
  vault.forget();
  for (const s of lockListeners) s.writeSSE({ event: 'lock', data: '' }).catch(() => {});
}
/* locks by itself after the chosen number of idle minutes (no requests from the page or MCP clients) */
setInterval(() => {
  const r = vaultRecord();
  if (r && r.autoLock > 0 && vault.isUnlocked() && vault.idleMs() > r.autoLock * 60_000) lockNow();
}, 15_000).unref();
const lockInfo = () => { const r = vaultRecord(); return { on: !!r, unlocked: vault.isUnlocked(), autoLock: r ? r.autoLock : 15 }; };
const body = async (c: Context): Promise<any> => { try { return await c.req.json(); } catch { return {}; } };
const autoLockOf = (v: unknown) => { const n = Number(v); return [0, 5, 15, 60, 240, 1440].includes(n) ? n : 15; };
/* checks the password before a change, without counting as a sign-in */
async function confirm(password: unknown) {
  const r = vaultRecord(); if (!r) throw new vault.VaultError('not_on', 'The password lock is off.');
  await vault.guarded(() => vault.unlock(r, { password: String(password ?? '') }));
  return r;
}
/* tells the other open tabs the lock changed, so they reload with or without it; the tab that made the change says
   who it is, and ignores its own notice */
function lockChanged(c: Context) {
  const from = c.req.header('x-treechats-tab') || '';
  for (const s of lockListeners) s.writeSSE({ event: 'vault', data: from }).catch(() => {});
}

app.get('/api/auth', (c) => c.json({ authed: authed(c), lock: lockInfo() }));
app.post('/api/auth/login', async (c) => {
  const b = await body(c);
  if (!same(String(b.token || '').trim(), token)) return c.json({ code: 'wrong_token', message: 'That isn’t the token. Copy it from the link Treechats printed when it started.' }, 400);
  grant(c); return c.json({ ok: true });
});
app.post('/api/vault/unlock', async (c) => {
  const b = await body(c);
  await vault.exclusive(async () => {
    const r = vaultRecord(); if (!r) throw new vault.VaultError('not_on', 'The password lock is off.');
    if (b.recovery != null) {
      vault.checkPassword(String(b.newPassword ?? ''));
      await vault.guarded(() => vault.unlock(r, { recovery: String(b.recovery) }));
      saveVaultRecord(await vault.rewrap(r, String(b.newPassword)));
    } else await vault.guarded(() => vault.unlock(r, { password: String(b.password ?? '') }));
  });
  /* knowing the password proves this is you, so it signs this browser in too */
  grant(c); return c.json({ ok: true });
});
app.post('/api/vault/lock', (c) => { lockNow(); return c.json({ ok: true }); });
app.post('/api/vault/alive', (c) => c.json({ ok: true }));
app.post('/api/vault/enable', async (c) => {
  const b = await body(c);
  const out = await vault.exclusive(async () => {
    if (vaultRecord()) throw new vault.VaultError('already_on', 'The password lock is already on.');
    const { record, recovery } = await vault.create(String(b.password ?? ''), autoLockOf(b.autoLock));
    try { encryptAll(record); } catch (e) { vault.forget(); throw e; }
    return { recovery, filesKey: vault.filesKey() };
  });
  lockChanged(c);
  return c.json(out);
});
app.post('/api/vault/disable', async (c) => {
  const b = await body(c);
  await vault.exclusive(async () => { await confirm(b.password); decryptAll(); vault.forget(); });
  lockChanged(c);
  return c.json({ ok: true });
});
app.post('/api/vault/password', async (c) => {
  const b = await body(c);
  await vault.exclusive(async () => { const r = await confirm(b.password); saveVaultRecord(await vault.rewrap(r, String(b.next ?? ''))); });
  return c.json({ ok: true });
});
app.post('/api/vault/recovery', async (c) => {
  const b = await body(c);
  return c.json(await vault.exclusive(async () => { const n = vault.newRecovery(await confirm(b.password)); saveVaultRecord(n.record); return { recovery: n.recovery }; }));
});
app.post('/api/vault/settings', async (c) => {
  const b = await body(c);
  return c.json(await vault.exclusive(async () => {
    const r = vaultRecord(); if (!r) throw new vault.VaultError('not_on', 'The password lock is off.');
    saveVaultRecord({ ...r, autoLock: autoLockOf(b.autoLock) });
    return { lock: lockInfo() };
  }));
});
/* a new token: other browsers and coding tools are signed out; this browser gets the new one */
app.post('/api/auth/reset', (c) => {
  try { resetToken(); } catch (e) { return c.json({ code: 'fixed_token', message: (e as Error).message }, 400); }
  grant(c);
  for (const s of lockListeners) s.writeSSE({ event: 'vault', data: c.req.header('x-treechats-tab') || '' }).catch(() => {});
  return c.json({ mcp: { url: `http://localhost:${config.port}/mcp`, token } });
});
/* the key the page encrypts attachments with in the browser, while unlocked */
app.get('/api/vault/fileskey', (c) => c.json({ key: vaultRecord() ? vault.filesKey() : null }));

/* ---- the API key in the system keychain (see server/secrets.ts) ---- */
app.post('/api/key/save', async (c) => {
  try { saveKey(String((await body(c)).key || '')); return c.json(keyStatus()); }
  catch (e) { return c.json({ code: e instanceof SecretError ? e.code : 'failed', message: (e as Error).message }, 400); }
});
app.post('/api/key/move', (c) => {
  if (config.apiKeySource !== 'env') return c.json({ code: 'no_key', message: 'There’s no key in .env to move.' }, 400);
  try { saveKey(config.apiKey); return c.json(keyStatus()); }
  catch (e) { return c.json({ code: e instanceof SecretError ? e.code : 'failed', message: (e as Error).message }, 400); }
});
app.post('/api/key/remove', (c) => { removeKey(); return c.json(keyStatus()); });

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
    key: keyStatus(),
    dataDir: config.dataDir,
    lock: lockInfo(),
    /* for the MCP setup commands in Settings › System */
    mcp: { url: `http://localhost:${config.port}/mcp`, token },
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
  lockListeners.add(stream);
  const ping = setInterval(() => { stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}); }, 20000);
  await new Promise<void>((resolve) => { stream.onAbort(() => resolve()); c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true }); });
  clearInterval(ping); detach(); lockListeners.delete(stream);
}));
app.post('/api/agent/result', async (c) => {
  let body; try { body = await c.req.json(); } catch { return c.json({ code: 'bad_request' }, 400); }
  return settle(body) ? c.body(null, 204) : c.json({ code: 'unknown_command' }, 404);
});

/* folders on this computer, for project files (see server/folders.ts) */
const folderRoute = (fn: (b: any) => Promise<unknown>) => async (c: any) => {
  let b; try { b = await c.req.json(); } catch { return c.json({ code: 'bad_request', message: 'Expected JSON.' }, 400); }
  try { return c.json(await fn(b)); }
  catch (e) { return e instanceof FolderError ? c.json({ code: e.code, message: e.message }, e.code === 'changed_on_disk' ? 409 : 400) : c.json({ code: 'failed', message: (e as Error).message }, 500); }
};
app.post('/api/folder/list', folderRoute((b) => listFolder(b.root)));
app.post('/api/folder/read', folderRoute((b) => readFolderFiles(b.root, Array.isArray(b.paths) ? b.paths.map(String) : [])));
app.post('/api/folder/git', folderRoute((b) => gitStatus(loadState() as any, b.root)));
app.post('/api/folder/diff', folderRoute((b) => gitDiff(loadState() as any, b.root, String(b.what || 'working'))));
app.post('/api/folder/run', async (c) => {
  let b: any; try { b = await c.req.json(); } catch { return c.json({ code: 'bad_request', message: 'Expected JSON.' }, 400); }
  try { return c.json(await runCommand(loadState() as any, b.root, String(b.command || ''), Number(b.timeout) || 120, c.req.raw.signal)); }
  catch (e) { return c.json({ code: e instanceof FolderError ? e.code : 'failed', message: (e as Error).message }, e instanceof FolderError && e.code === 'commands_off' ? 403 : 400); }
});
app.post('/api/folder/write', folderRoute((b) => writeFolderFile(loadState() as any, b.root, String(b.path || ''), String(b.text ?? ''), typeof b.mtime === 'number' ? b.mtime : null, !!b.force)));

/* coding sessions from Claude Code and Codex, for the import dialog (see server/sessions.ts) */
const sessionRoute = (fn: (b: any) => Promise<unknown> | unknown) => async (c: any) => {
  let b: any = {}; try { b = await c.req.json(); } catch { /* no body */ }
  try { return c.json(await fn(b)); }
  catch (e) { return c.json({ code: e instanceof SessionError ? e.code : 'failed', message: (e as Error).message }, 400); }
};
app.post('/api/sessions/list', sessionRoute(() => listSessions()));
app.post('/api/sessions/read', sessionRoute((b) => readSession(b.source === 'codex' ? 'codex' : 'claude-code', String(b.file || ''))));
app.post('/api/sessions/parse', sessionRoute((b) => parseSession(String(b.text || ''))));

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
  const url = `http://localhost:${info.port}`, link = `${url}/?token=${token}`;
  console.log(`\n  Treechats is running at ${link}\n`);
  console.log(`  Data: ${config.dataDir}${vaultRecord() ? ' (password lock on)' : ''}\n`);
  if (config.fake) console.log('  Test mode: replies are canned (TREECHATS_FAKE=1).\n');
  else if (provider() === 'claude-code') console.log('  Replies come from your Claude Code CLI and whatever it is signed in with.\n  To use an API key instead, add ANTHROPIC_API_KEY to .env and restart.\n');
  else console.log('  Replies use your API key (ANTHROPIC_API_KEY).\n');
  console.log(`  For Claude Code: claude mcp add --transport http --scope user treechats ${url}/mcp --header "Authorization: Bearer ${token}"\n`);
  console.log('  Press Ctrl+C to stop.\n');
  if (config.open && process.argv.includes('--open')) openBrowser(oneTimeLink());
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    const link = `http://localhost:${config.port}/?token=${token}`;
    console.error(`\n  Port ${config.port} is already in use. Treechats may already be running: open ${link}`);
    if (config.open && process.argv.includes('--open')) openBrowser(`http://localhost:${config.port}/`);
    console.error('  Or pick another port with TREECHATS_PORT in .env.\n');
    process.exit(1);
  }
  throw e;
});
const quit = () => { server.close(); process.exit(0); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
