/* Starts the real server as a separate process and talks to it over HTTP, the way the page does.
   Runs on Windows, macOS and Linux (see .github/workflows/ci.yml). */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const isWin = process.platform === 'win32';
const servers: ChildProcess[] = [];
after(() => { for (const s of servers) s.kill(); });

/* Starts the server on a random free-looking port; if that port turns out to be taken (or the process dies
   for any other reason before it answers), it tries again on another one. */
async function startServer(env: Record<string, string>, attempts = 4): Promise<{ base: string; child: ChildProcess; data: string }> {
  const port = 5400 + Math.floor(Math.random() * 2000);
  const data = mkdtempSync(join(tmpdir(), 'treechats-data-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/start.ts'], {
    cwd: root, env: { ...process.env, TREECHATS_PORT: String(port), TREECHATS_DATA_DIR: data, TREECHATS_OPEN: '0', ANTHROPIC_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(child);
  let log = '', exited = false;
  child.stdout!.on('data', (d) => { log += d; }); child.stderr!.on('data', (d) => { log += d; });
  child.on('exit', () => { exited = true; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150 && !exited; i++) {
    try { const r = await fetch(base + '/api/config'); if (r.ok) return { base, child, data }; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  if (attempts > 1) return startServer(env, attempts - 1);
  throw new Error('server did not start:\n' + log);
}

const post = (base: string, body: object, signal?: AbortSignal) => fetch(base + '/api/sample', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body), signal,
});
async function events(res: Response) {
  const text = await res.text();
  return text.trim().split('\n').map((l) => JSON.parse(l));
}

test('test-reply mode: config, saving, streaming, and outside pages are refused', async () => {
  const { base } = await startServer({ TREECHATS_FAKE: '1' });
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.provider, 'fake');
  assert.equal(cfg.hasKey, true);

  assert.equal((await fetch(base + '/api/state')).status, 204);
  const doc = JSON.stringify({ db: { spaces: {} }, opts: { x: 1 } });
  assert.equal((await fetch(base + '/api/state', { method: 'PUT', body: doc, headers: { origin: base } })).status, 204);
  assert.equal(await (await fetch(base + '/api/state')).text(), doc);

  const evs = await events(await post(base, { input: 'hello there', modelTier: 'quick' }));
  assert.ok(evs.filter((e) => e.t === 'text').length > 1, 'streams in pieces');
  const done = evs.at(-1);
  assert.equal(done.t, 'done');
  assert.match(done.text, /hello there/);

  const bad = await fetch(base + '/api/sample', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.com' }, body: '{}' });
  assert.equal(bad.status, 403);
});

/* A stand-in for the `claude` CLI: records how it was called, then streams a reply the way
   `claude -p --output-format stream-json --include-partial-messages` does. With SLOW in the message it
   waits, so stopping can be tested. On Windows it is a .cmd file, like an npm-installed claude. */
function fakeClaude(dir: string) {
  const js = join(dir, 'fake-claude.mjs');
  writeFileSync(js, `
import { writeFileSync } from 'node:fs';
const dir = ${JSON.stringify(dir)};
if (process.argv[2] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
writeFileSync(dir + '/args.json', JSON.stringify(process.argv.slice(2)));
writeFileSync(dir + '/pid', String(process.pid));
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', async () => {
  writeFileSync(dir + '/stdin.json', input);
  const text = JSON.parse(input.trim()).message.content.find((b) => b.type === 'text').text;
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  out({ type: 'system', subtype: 'init' });
  const reply = 'CLI says hi to: ' + text.slice(-30);
  for (const p of reply.match(/.{1,8}/gs)) out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: p } } });
  if (text.includes('SLOW')) await new Promise((r) => setTimeout(r, 60000));
  out({ type: 'result', subtype: 'success', is_error: false, result: reply });
});
`);
  if (isWin) {
    const cmd = join(dir, 'claude.cmd');
    writeFileSync(cmd, `@"${process.execPath}" "%~dp0fake-claude.mjs" %*\r\n`);
    return cmd;
  }
  const sh = join(dir, 'claude');
  writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-claude.mjs" "$@"\n`);
  chmodSync(sh, 0o755);
  return sh;
}

test('Claude Code mode: runs the CLI with tools off, streams its reply, and Stop ends it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'treechats-cli-'));
  const { base } = await startServer({ TREECHATS_PROVIDER: 'claude-code', TREECHATS_CLAUDE_PATH: fakeClaude(dir) });
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.provider, 'claude-code');
  assert.equal(cfg.hasKey, true, JSON.stringify(cfg.cli));

  const evs = await events(await post(base, { input: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: 'Tell me a joke' }], modelTier: 'complex' }));
  const done = evs.at(-1);
  assert.equal(done.t, 'done', JSON.stringify(evs));
  assert.match(done.text, /Tell me a joke/);
  assert.equal(done.model, 'claude-opus-5-5');

  const args: string[] = JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'));
  assert.equal(args[args.indexOf('--tools') + 1], '', 'tools are turned off with an empty list');
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.ok(args.includes('--no-session-persistence'));
  const sent = JSON.parse(readFileSync(join(dir, 'stdin.json'), 'utf8'));
  assert.match(sent.message.content.at(-1).text, /<assistant>\nHello!\n<\/assistant>/);

  /* Stop: the reply is cut off and the CLI process is ended, not left running */
  const pidFile = join(dir, 'pid');
  rmSync(pidFile, { force: true }); /* so the pid read below is the slow run's, not the first run's */
  const ctl = new AbortController();
  const res = await post(base, { input: 'SLOW please' }, ctl.signal);
  const reader = res.body!.getReader();
  await reader.read();
  ctl.abort();
  for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { process.kill(pid, 0); } catch { alive = false; }
  }
  assert.equal(alive, false, 'the CLI process was stopped');
});

test('Claude Code mode: a missing CLI is reported, not a crash', async () => {
  const { base } = await startServer({ TREECHATS_PROVIDER: 'claude-code', TREECHATS_CLAUDE_PATH: join(tmpdir(), 'no-such-claude', isWin ? 'claude.exe' : 'claude') });
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.hasKey, false);
  assert.equal(cfg.cli.found, false);
  const evs = await events(await post(base, { input: 'hi' }));
  assert.equal(evs.at(-1).code, 'cli_missing');
});
