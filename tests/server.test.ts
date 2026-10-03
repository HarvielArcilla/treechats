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
  const w = await writeFolderFile(dir, 'src/a.ts', 'export const a = 2;\n', r[0].mtime!, false);
  assert.equal(readFileSync(join(dir, 'src', 'a.ts'), 'utf8'), 'export const a = 2;\n');
  utimesSync(join(dir, 'src', 'a.ts'), new Date(), new Date(Date.now() + 60_000));
  await assert.rejects(writeFolderFile(dir, 'src/a.ts', 'stale', w.mtime, false), /changed on disk/);
  await assert.rejects(writeFolderFile(dir, '../x.txt', 'no', null, false), /outside/);
});
