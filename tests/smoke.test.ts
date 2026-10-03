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

test('MCP: Claude Code can list, search and read the context of a saved chat', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { base } = await startServer({ TREECHATS_FAKE: '1' });
  /* a chat with a branch merged back in, a left-out prompt and standing instructions */
  const tree = {
    nextId: 7, nextRef: 3, head: 'r1', active: {}, convs: {}, files: [], views: [], fold: {},
    nodes: {
      1: { id: 1, parents: [], text: 'Plan a trip', reply: 'Where to?' },
      2: { id: 2, parents: [1], text: 'Lisbon', reply: 'Great choice.' },
      3: { id: 3, parents: [1], text: 'What about food?', reply: 'Try pastel de nata.' },
      4: { id: 4, parents: [2], text: 'Skip this one', reply: 'Skipped.', skip: true },
      5: { id: 5, kind: 'merge', parents: [4, 3], text: '', from: 'food', into: 'main' },
      6: { id: 6, parents: [5], text: 'Make an itinerary', reply: 'Day 1…', note: 'keep it short' },
    },
    refs: { r1: { name: 'main', tip: 6 }, r2: { name: 'food', tip: 3 } },
  };
  const state = { db: { spaces: { s1: { id: 's1', name: 'Travel', tree, sel: 6 } }, order: ['s1'], current: 's1', nextSpace: 2 }, opts: { prompts: { instructions: 'Be brief.' } } };
  const put = await fetch(base + '/api/state', { method: 'PUT', headers: { origin: base }, body: JSON.stringify(state) });
  assert.equal(put.status, 204);

  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['ask', 'distill', 'edit_reply', 'fork', 'get_context', 'get_prompt', 'leave_out', 'list_chats', 'list_projects', 'regenerate', 'replay', 'search', 'spawn', 'combine', 'judge', 'list_saved_prompts', 'review', 'describe', 'edit_prompt', 'fan_out', 'get_tree', 'operate'].sort());
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };

  const full = (await call('get_context', { branch: 'main' })).content[0].text, ctx = full.slice(full.indexOf('<conversation>'));
  const order = ['Be brief.', 'Plan a trip', 'Where to?', 'Lisbon', 'parallel thread', 'What about food?', 'pastel de nata', 'Make an itinerary', 'Day 1'];
  let at = -1;
  for (const s of order) { const i = ctx.indexOf(s); assert.ok(i > at, `"${s}" in order in:\n${ctx}`); at = i; }
  assert.ok(!ctx.includes('Skip this one'), 'left-out prompts are not included');
  assert.ok(!ctx.includes('keep it short'), 'notes are never sent');

  assert.match((await call('list_chats', {})).content[0].text, /main → #6 \(checked out\)/);
  assert.match((await call('search', { query: 'nata' })).content[0].text, /#3 \(reply\)/);
  assert.match((await call('get_prompt', { prompt: 6 })).content[0].text, /keep it short/);
  assert.equal((await call('get_context', { prompt: 99 })).isError, true);
  await client.close();

  /* other websites can't reach it */
  const r = await fetch(base + '/mcp', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('MCP subagents: commands go to the open page, results come back, and each run has a request budget', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { base } = await startServer({ TREECHATS_FAKE: '1', TREECHATS_AGENT_MAX_REQUESTS: '2' });
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };

  /* without the page open, agent tools say so and spend nothing */
  const closed = await call('spawn', { run: 'r', prompt: 'hi' });
  assert.equal(closed.isError, true);
  assert.match(closed.content[0].text, /isn’t open in a browser/);

  /* a stand-in for the page: reads commands from the event stream and answers them */
  const seen: { op: string; args: Record<string, unknown> }[] = [];
  const ctl = new AbortController();
  const events = await fetch(base + '/api/agent/events', { signal: ctl.signal });
  (async () => {
    const reader = events.body!.getReader(), dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
          if (!data) continue;
          const cmd = JSON.parse(data); seen.push(cmd);
          const body = cmd.args.prompt === 'fail' ? { id: cmd.id, ok: false, error: 'There is no prompt #9 in this run.' } : { id: cmd.id, ok: true, result: { project: 'Run: r', chat: 1, prompt: 1, branch: 'main', reply: 'Atomic, yes.' } };
          await fetch(base + '/api/agent/result', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        }
      }
    } catch {}
  })();
  await new Promise((r) => setTimeout(r, 300));

  const ok = await call('spawn', { run: 'r', prompt: 'Is it atomic?', context: 'redis.call("INCR")', agent: 'tester' });
  assert.equal(ok.isError, undefined, ok.content[0].text);
  assert.match(ok.content[0].text, /Atomic, yes\./);
  assert.match(ok.content[0].text, /1 request left in this run/);
  assert.equal(seen[0].op, 'spawn');
  assert.equal(seen[0].args.context, 'redis.call("INCR")');

  /* a failure from the page comes back as an error and refunds the request */
  const bad = await call('ask', { run: 'r', after: 1, prompt: 'fail' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /no prompt #9/);
  await call('ask', { run: 'r', after: 1, prompt: 'again' });
  const over = await call('ask', { run: 'r', after: 1, prompt: 'one too many' });
  assert.equal(over.isError, true);
  assert.match(over.content[0].text, /has used its 2 requests/);

  /* copying context from a branch that doesn't exist is caught before anything is spent */
  const missing = await call('spawn', { run: 'other', prompt: 'x', from: { branch: 'nope' } });
  assert.equal(missing.isError, true);

  ctl.abort();
  await client.close();
});
