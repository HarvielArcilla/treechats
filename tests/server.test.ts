import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.TREECHATS_DATA_DIR = process.env.TREECHATS_DATA_DIR || 'data/test';
const { toMessages, buildParams } = await import('../server/claude.ts');
const { modelLabel } = await import('../server/config.ts');

test('turns of one role in a row are joined, and the list starts and ends with the person', () => {
  const out = toMessages([
    { role: 'user', content: 'instructions' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);
  assert.deepEqual(out.map((t) => t.role), ['user', 'assistant', 'user']);
  assert.equal(out[0].content, 'instructions\n\nhi');
});

test('empty turns are dropped', () => {
  assert.equal(toMessages([{ role: 'user', content: '  ' }, { role: 'user', content: 'x' }]).length, 1);
});

test('long prompts are marked for caching on their last block; short ones are not', () => {
  const short = buildParams({ input: 'hi' });
  const last = (p: typeof short) => (p.params.messages.at(-1)!.content as any[]).at(-1);
  assert.equal(last(short).cache_control, undefined);
  const long = buildParams({ input: [{ role: 'user', content: 'x'.repeat(7000) }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'more' }] });
  assert.deepEqual(last(long).cache_control, { type: 'ephemeral' });
});

test('tiers map to models, with Default when unknown', () => {
  assert.equal(buildParams({ input: 'a', modelTier: 'quick' }).tier, 'quick');
  assert.equal(buildParams({ input: 'a', modelTier: 'nope' as any }).tier, 'default');
});

test('model labels', () => {
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
});

test('context fingerprint: a reply notices edits, left-out turns and new instructions above it, never its own reply', async () => {
  const { ctxSig, ctxChanges } = await import('../server/context.ts');
  const tree: any = { nodes: {
    1: { id: 1, parents: [], text: 'One', reply: 'A' },
    2: { id: 2, parents: [1], text: 'Two', reply: 'B' },
    3: { id: 3, parents: [2], text: 'Three', reply: 'C' },
  }, refs: {} };
  const state: any = { db: { spaces: {}, order: [], current: '' }, opts: { prompts: {} } };
  tree.nodes[3].ctx = ctxSig(state, tree, 3);
  assert.equal(ctxChanges(state, tree, 3), null);
  tree.nodes[3].reply = 'C, edited';
  assert.equal(ctxChanges(state, tree, 3), null, 'its own reply is not part of what it was sent');
  tree.nodes[1].reply = 'A, corrected';
  tree.nodes[2].skip = true;
  state.opts.prompts.instructions = 'Be brief.';
  assert.deepEqual(ctxChanges(state, tree, 3), ['standing instructions added', '#1 reply edited', '#2 left out']);
  tree.nodes[1].reply = 'A'; delete tree.nodes[2].skip; state.opts.prompts.instructions = '';
  assert.equal(ctxChanges(state, tree, 3), null, 'undoing the changes clears the marker');
});

test('send modes: what a turn sends as a summary, an excerpt, its prompt or its reply only, and the marker notices', async () => {
  const { turnsFor, ctxSig, ctxChanges, Send } = await import('../server/context.ts');
  const tree: any = { nodes: {
    1: { id: 1, parents: [], text: 'Compare A and B', reply: 'A is fast. B is exact. Pick A for most cases.' },
    2: { id: 2, parents: [1], text: 'And for 4k req/s?', reply: 'A.' },
  }, refs: {} };
  const state: any = { db: { spaces: {}, order: [], current: '' }, opts: { prompts: {} } };
  const sent = () => turnsFor(state, tree, 2).map((t: any) => `${t.role}: ${t.content}`);
  tree.nodes[2].ctx = ctxSig(state, tree, 2);
  const n = tree.nodes[1];
  n.send = 'summary';
  assert.equal(sent()[1], 'assistant: A is fast. B is exact. Pick A for most cases.', 'no summary yet: the full reply is still sent');
  assert.equal(ctxChanges(state, tree, 2), null);
  n.sum = { text: 'I recommended A.', of: 'x' };
  assert.equal(sent()[1], 'assistant: ' + Send.DEFAULTS.sendSummary.replace('{summary}', 'I recommended A.'));
  assert.deepEqual(ctxChanges(state, tree, 2), ['#1 now included as summary']);
  n.send = 'excerpt'; n.ex = { p: [], r: [{ s: 0, e: 10, t: 'A is fast.' }, { s: 22, e: 46, t: 'Pick A for most cases.' }] };
  assert.equal(sent()[0], 'user: Compare A and B', 'a side with nothing highlighted goes whole');
  assert.ok(sent()[1].endsWith('A is fast.' + Send.JOIN + 'Pick A for most cases.'));
  n.send = 'prompt';
  assert.equal(sent()[1], 'assistant: ' + Send.DEFAULTS.sendNoReply);
  state.opts.prompts.sendNoReply = '';
  assert.deepEqual(sent(), ['user: Compare A and B\n\nAnd for 4k req/s?', 'assistant: A.'], 'empty wording sends nothing, and the turns join');
  n.send = 'reply';
  assert.equal(sent()[0], 'user: ' + Send.DEFAULTS.sendNoPrompt);
  delete n.send;
  assert.equal(ctxChanges(state, tree, 2), null, 'back to full: nothing changed');
  assert.deepEqual(Send.piecesFromText(n.reply, ['B is exact.', 'nope']).missing, ['nope']);
  n.send = 'excerpt'; n.reply = 'Rewritten.';
  assert.deepEqual(Send.stale(n, (s: string) => s), ['reply'], 'an excerpt notices the reply changed');
});

test('branch settings: each model gets only the parameters it accepts', async () => {
  const { caps, prices, costOf } = await import('../server/models.ts');
  assert.deepEqual(caps('claude-haiku-4-5-20251001'), { temperature: true, effort: false, thinking: 'budget' });
  assert.deepEqual(caps('claude-opus-5-5'), { temperature: false, effort: true, thinking: 'adaptive' });
  assert.deepEqual(caps('claude-sonnet-5-5'), { temperature: false, effort: true, thinking: 'adaptive' });
  assert.equal(costOf({ input: 1e6, output: 1e6, cacheWrite: 0, cacheRead: 0 }, prices('claude-haiku-4-5-20251001')), 6);
  assert.deepEqual(prices('claude-opus-5-5', '1,2,3,4'), [1, 2, 3, 4]);
  const turns = [{ role: 'user' as const, content: 'hi' }];
  const quick = buildParams({ input: turns, modelTier: 'quick', settings: { system: 'Be brief.', temperature: 0.2, effort: 'low' } });
  assert.equal((quick.params as any).system, 'Be brief.');
  assert.equal((quick.params as any).temperature, 0.2);
  assert.deepEqual(quick.notes, ['effort']);
  const complex = buildParams({ input: turns, modelTier: 'complex', settings: { temperature: 0.2, effort: 'high', thinking: true } });
  assert.equal((complex.params as any).temperature, undefined);
  assert.deepEqual((complex.params as any).thinking, { type: 'adaptive' });
  assert.deepEqual((complex.params as any).output_config, { effort: 'high' });
  assert.deepEqual(complex.notes, ['temperature']);
  const budget = buildParams({ input: turns, modelTier: 'quick', settings: { thinking: true, maxTokens: 1000 } });
  assert.equal((budget.params as any).thinking.type, 'enabled');
  assert.ok((budget.params as any).max_tokens > (budget.params as any).thinking.budget_tokens);
});

test('folders: listing skips ignored and dependency files, reads stay inside the folder, writes refuse a changed disk copy', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { listFolder, readFolderFiles, writeFolderFile } = await import('../server/folders.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tc-folder-'));
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'node_modules')); mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'node_modules', 'x.js'), 'x');
  writeFileSync(join(dir, 'dist', 'out.js'), 'built');
  writeFileSync(join(dir, 'debug.log'), 'log');
  writeFileSync(join(dir, 'bin.dat'), Buffer.from([1, 0, 2]));
  writeFileSync(join(dir, '.gitignore'), '*.log\n');
  const l = await listFolder(dir);
  assert.deepEqual(l.files.map((f) => f.path).sort(), ['.gitignore', 'bin.dat', 'src/a.ts']);
  const r = await readFolderFiles(dir, ['src/a.ts', '../escape.txt', 'bin.dat']);
  assert.equal(r[0].text, 'export const a = 1;\n');
  assert.match(r[1].error!, /outside/);
  assert.match(r[2].error!, /binary/);
  const { realpathSync } = await import('node:fs');
  await assert.rejects(writeFolderFile(null, dir, 'src/a.ts', 'x', null, false), /isn’t linked/, 'writes need the folder linked to a project');
  const st: any = { db: { spaces: { s1: { tree: { files: [{ src: { root: realpathSync(dir) } }] } } } } };
  const w = await writeFolderFile(st, dir, 'src/a.ts', 'export const a = 2;\n', r[0].mtime!, false);
  assert.equal(readFileSync(join(dir, 'src', 'a.ts'), 'utf8'), 'export const a = 2;\n');
  utimesSync(join(dir, 'src', 'a.ts'), new Date(), new Date(Date.now() + 60_000));
  await assert.rejects(writeFolderFile(st, dir, 'src/a.ts', 'stale', w.mtime, false), /changed on disk/);
  await assert.rejects(writeFolderFile(st, dir, '../x.txt', 'no', null, false), /outside/);
  await assert.rejects(writeFolderFile(st, dir, '.git/config', 'no', null, false), /\.git/);
  await assert.rejects(writeFolderFile(st, dir, '.GIT/hooks/pre-commit', 'no', null, false), /\.git/, 'any case, as macOS and Windows treat it');
  await assert.rejects(writeFolderFile(st, dir, 'sub/.git./x', 'no', null, false), /\.git/);
});

test('coding sessions: Claude Code logs become a tree of turns with tool steps; Codex rollouts become a line', async () => {
  const { fromClaudeCode, fromCodex, parseSession } = await import('../server/sessions.ts');
  const L = (o: object) => JSON.stringify(o);
  const cc = [
    L({ type: 'summary', summary: 'Fix the parser' }),
    L({ type: 'user', uuid: 'u1', parentUuid: null, timestamp: '1', cwd: '/w', message: { role: 'user', content: '<system-reminder>time</system-reminder>Fix the parser' } }),
    L({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2', message: { id: 'm1', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/p.ts' } }], usage: { input_tokens: 10, output_tokens: 5 } } }),
    L({ type: 'attachment', uuid: 'x1', parentUuid: 'a1' }),
    L({ type: 'user', uuid: 'r1', parentUuid: 'x1', timestamp: '3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'const x = 1;' }] } }),
    L({ type: 'assistant', uuid: 'a2', parentUuid: 'r1', timestamp: '4', message: { id: 'm2', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Fixed.' }] } }),
    L({ type: 'user', uuid: 'u2', parentUuid: 'a2', timestamp: '5', message: { role: 'user', content: 'Now add tests' } }),
    L({ type: 'user', uuid: 'u3', parentUuid: 'a2', timestamp: '6', message: { role: 'user', content: 'Actually, add docs' } }),
    L({ type: 'user', uuid: 'u4', parentUuid: 'u3', timestamp: '7', isCompactSummary: true, message: { role: 'user', content: 'Summary of the session' } }),
    'not json',
  ].join('\n');
  const s = parseSession(cc);
  assert.equal(s.source, 'Claude Code');
  assert.equal(s.title, 'Fix the parser');
  assert.deepEqual(s.turns.map((t) => [t.text, t.parent]), [['Fix the parser', null], ['Now add tests', 0], ['Actually, add docs', 0], ['Summary of the session', 2]]);
  assert.match(s.turns[0].reply!, /⚙ Read\*\* `src\/p.ts`[\s\S]*const x = 1;[\s\S]*Fixed\./);
  assert.equal(s.turns[0].notes, 1);
  assert.equal(s.turns[0].usage!.input, 10);
  assert.equal(s.turns[3].tag, 'compaction summary');
  assert.equal(s.mainLeaf, 3);
  const cx = fromCodex([
    { type: 'session_meta', payload: { cwd: '/r' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Run the tests' }] } },
    { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["npm","test"]}', call_id: 'c1' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: '{"output":"1 failing"}' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'One test fails.' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'Run the tests' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix it' }] } },
  ]);
  assert.deepEqual(cx.turns.map((t) => [t.text, t.parent]), [['Run the tests', null], ['Fix it', 0]]);
  assert.match(cx.turns[0].reply!, /⚙ shell\*\* `npm test`[\s\S]*1 failing[\s\S]*One test fails\./);
  assert.equal(fromClaudeCode([]).turns.length, 0);
});

test('commands and git: off until allowed, only in linked folders', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const { runCommand, gitStatus, gitDiff } = await import('../server/run.ts');
  const dir = mkdtempSync(join(tmpdir(), 'tc-run-'));
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  execFileSync('git', ['init', '-q'], { cwd: dir }); execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: dir });
  const { realpathSync } = await import('node:fs');
  const root = realpathSync(dir);
  const state = (allow: boolean) => ({ db: { spaces: { s1: { tree: { files: [{ src: { root } }] } } } }, opts: { allowCommands: allow } });
  const sig = new AbortController().signal;
  await assert.rejects(runCommand(state(false), root, 'echo hi', 10, sig), /off/);
  await assert.rejects(runCommand(state(true), tmpdir(), 'echo hi', 10, sig), /isn’t linked/);
  const r = await runCommand(state(true), root, 'echo hi && echo err >&2 && exit 2', 10, sig);
  assert.equal(r.code, 2); assert.match(r.output, /hi\s+err/);
  writeFileSync(join(dir, 'a.txt'), 'two\n'); writeFileSync(join(dir, 'b.txt'), 'new\n');
  const st = await gitStatus(state(false), root);
  assert.equal(st.git, true); assert.equal(st.changed!.length, 2);
  const d = await gitDiff(state(false), root, 'working');
  assert.match(d.text, /-one\n\+two/); assert.deepEqual(d.untracked, ['b.txt']);
  await assert.rejects(gitDiff(state(false), root, '--output=/tmp/x'), /Name a commit/);
});

test('secrets in command output and diffs are hidden; code that names them is not', async () => {
  const { redact } = await import('../server/redact.ts');
  const r = redact(['ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123',
    'export DB_PASSWORD="hunter2hunter2"', '+const API_KEY = process.env.API_KEY;', 'postgres://admin:s3cretpass@db/x',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB', 'max_tokens: 16000', 'const tokenizer = new Tokenizer(opts);'].join('\n'));
  assert.equal(r.hidden, 4);
  assert.ok(!/sk-ant|hunter2|s3cret|ghp_/.test(r.text), r.text);
  assert.ok(r.text.includes('process.env.API_KEY') && r.text.includes('16000') && r.text.includes('new Tokenizer'));
});

test('password lock: data is encrypted at rest, opens with the password or the recovery key, and not otherwise', async () => {
  const vault = await import('../server/vault.ts');
  const { record, recovery } = await vault.create('correct horse battery', 15);
  const sealed = vault.seal('{"secret":"chat"}');
  assert.ok(sealed.startsWith(vault.SEALED) && !sealed.includes('chat'));
  const files = vault.filesKey();
  vault.forget();
  assert.throws(() => vault.open(sealed), /locked/);
  await assert.rejects(vault.unlock(record, { password: 'wrong password' }), /isn’t right/);
  await vault.unlock(record, { password: 'correct horse battery' });
  assert.equal(vault.open(sealed), '{"secret":"chat"}');
  assert.equal(vault.filesKey(), files, 'the files key stays the same across unlocks');
  const next = await vault.rewrap(record, 'a new password here');
  vault.forget();
  await assert.rejects(vault.unlock(next, { password: 'correct horse battery' }), /isn’t right/);
  await vault.unlock(next, { recovery: recovery.toLowerCase().replace(/-/g, ' ') });
  assert.equal(vault.open(sealed), '{"secret":"chat"}');
  assert.throws(() => vault.checkPassword('short'), /at least 8/);
  vault.forget();
});

test('files are kept by the server, and encrypted with the rest when the lock is turned on', async () => {
  const vault = await import('../server/vault.ts');
  const store = await import('../server/store.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const { join } = await import('node:path');
  const { config } = await import('../server/config.ts');
  store.putFile('t-file-1', { name: 'a.md', kind: 'text', text: 'secret notes' });
  assert.equal(store.getFile('t-file-1')!.text, 'secret notes');
  assert.ok(store.fileIds().includes('t-file-1'));
  const raw = () => (new DatabaseSync(join(config.dataDir, 'treechats.db')).prepare('SELECT value FROM files WHERE id = ?').get('t-file-1') as { value: string }).value;
  assert.match(raw(), /secret notes/);
  const { record } = await vault.create('correct horse battery', 15);
  store.encryptAll(record);
  assert.ok(!raw().includes('secret notes') && raw().startsWith(vault.SEALED), 'sealed at rest');
  assert.equal(store.getFile('t-file-1')!.text, 'secret notes', 'and readable while unlocked');
  store.decryptAll();
  assert.match(raw(), /secret notes/);
  vault.forget();
});

test('API key in the keyring: saved through stdin, read back at start, removed (Linux, with a stand-in secret-tool)', { skip: process.platform !== 'linux' }, async () => {
  const { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const bin = mkdtempSync(join(tmpdir(), 'tc-bin-')), store = join(bin, 'secret');
  /* stores what comes on stdin for `store`, prints it for `lookup`, deletes it for `clear`; logs its arguments */
  writeFileSync(join(bin, 'secret-tool'), `#!/bin/sh\necho "$@" >> "${bin}/args"\ncase "$1" in store) cat > "${store}";; lookup) [ -f "${store}" ] && cat "${store}" || exit 1;; clear) rm -f "${store}";; esac\n`);
  chmodSync(join(bin, 'secret-tool'), 0o755);
  const path = process.env.PATH; process.env.PATH = `${bin}:${path}`;
  try {
    const s = await import('../server/secrets.ts'), { config } = await import('../server/config.ts');
    const was = { key: config.apiKey, src: config.apiKeySource }; config.apiKey = ''; config.apiKeySource = null;
    assert.equal(s.keyStatus().keychain, 'your system keyring');
    assert.throws(() => s.saveKey('not a key'), /doesn’t look like/);
    s.saveKey('sk-ant-test-0123456789abcdefghijklmnop');
    assert.equal(readFileSync(store, 'utf8'), 'sk-ant-test-0123456789abcdefghijklmnop');
    assert.ok(!readFileSync(join(bin, 'args'), 'utf8').includes('sk-ant'), 'the key never goes on a command line');
    config.apiKey = ''; config.apiKeySource = null; s.loadKeyFromKeychain();
    assert.equal(config.apiKeySource, 'keychain'); assert.equal(config.apiKey, 'sk-ant-test-0123456789abcdefghijklmnop');
    s.removeKey();
    assert.equal(config.apiKey, ''); s.loadKeyFromKeychain(); assert.equal(config.apiKeySource, null);
    config.apiKey = was.key; config.apiKeySource = was.src;
  } finally { process.env.PATH = path; }
});

test('scheduled tasks: when each kind runs next', async () => {
  const { nextRun } = await import('../server/schedule.ts');
  const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const sat = at(2026, 10, 3, 22, 30); /* a Saturday evening */
  assert.equal(nextRun({ once: at(2026, 10, 4, 9) }, sat), at(2026, 10, 4, 9));
  assert.equal(nextRun({ once: at(2026, 10, 4, 9) }, at(2026, 10, 4, 9)), null, 'a one-time task runs once');
  assert.equal(nextRun({ every: 'hour', minute: 15 }, sat), at(2026, 10, 3, 23, 15));
  assert.equal(nextRun({ every: 'hour', minute: 45 }, sat), at(2026, 10, 3, 22, 45));
  assert.equal(nextRun({ every: 'day', time: '09:00' }, sat), at(2026, 10, 4, 9));
  assert.equal(nextRun({ every: 'day', time: '23:00' }, sat), at(2026, 10, 3, 23));
  assert.equal(nextRun({ every: 'weekday', time: '09:00' }, sat), at(2026, 10, 5, 9), 'skips the weekend');
  assert.equal(nextRun({ every: 'week', day: 3, time: '08:30' }, sat), at(2026, 10, 7, 8, 30), 'the next Wednesday');
  assert.equal(nextRun({ every: 'week', day: 6, time: '22:00' }, sat), at(2026, 10, 10, 22), 'today’s time has passed, so next week');
});

test('tools: chosen tools become Anthropic server tools; unknown ones are ignored', () => {
  const p = buildParams({ input: 'hi', settings: { tools: ['search', 'fetch', 'code', 'shell'] } }).params as any;
  assert.deepEqual(p.tools.map((t: any) => t.name), ['web_search', 'web_fetch', 'code_execution']);
  assert.ok(p.tools.every((t: any) => /_\d{8}$/.test(t.type)));
  assert.equal((buildParams({ input: 'hi' }).params as any).tools, undefined, 'no tools unless asked');
});
