import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* The tree and the context a prompt sends are defined once, in web/public/treecore.js, for the page and the server.
   These tests pin down what a request contains, so a change to it is a deliberate one. */
process.env.TREECHATS_DATA_DIR = process.env.TREECHATS_DATA_DIR || 'data/test';
const { Core } = await import('../server/context.ts');

type N = { id: number; parents: number[]; text: string; reply?: string; [k: string]: unknown };
const tree = (nodes: N[], extra: Record<string, unknown> = {}) => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), refs: {}, ...extra }) as any;
const env = (prompts: Record<string, string> = {}) => ({ tpl: Core.tplFrom(prompts), file: (f: { name: string }) => `<file name="${f.name}"/>` });

test('core: path, merge notes, left-out turns, and whether the prompt\'s own reply goes', () => {
  /* 1 → 2 → 4 (merge of 3) → 5, with 3 branching from 1 */
  const t = tree([
    { id: 1, parents: [], text: 'a', reply: 'A' },
    { id: 2, parents: [1], text: 'b', reply: 'B' },
    { id: 3, parents: [1], text: 'c', reply: 'C' },
    { id: 4, parents: [2, 3], text: '', kind: 'merge' },
    { id: 5, parents: [4], text: 'e', reply: 'E' },
  ]);
  assert.deepEqual(Core.path(t, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(Core.chain(t, 5), [1, 2, 4, 5]);
  const e = Core.entries(t, 5, env({ seam: 'MERGED:' }));
  assert.deepEqual(e.map((x: any) => x.seam ? 'seam' : x.id), [1, 2, 'seam', 3, 4, 5]);
  const turns = (o?: boolean) => Core.turnsFor(t, 5, env({ seam: 'MERGED:' }), o).map((x) => `${x.role}:${x.content}`);
  assert.deepEqual(turns(), ['user:a', 'assistant:A', 'user:b', 'assistant:B', 'user:MERGED:\n\nc', 'assistant:C', 'user:e']);
  assert.deepEqual(turns(true).slice(-1), ['assistant:E']);
  t.nodes[2].skip = true;
  assert.ok(!turns().includes('user:b'), 'a left-out turn is not sent');
  t.nodes[5].skip = true;
  assert.ok(turns().includes('user:e'), 'the prompt being answered is always sent');
});

test('core: instructions, project files and Include as; a mode applies once the turn is history', () => {
  const t = tree([
    { id: 1, parents: [], text: 'q1', reply: 'long reply', send: 'summary', sum: { text: 'short' } },
    { id: 2, parents: [1], text: 'q2', reply: 'r2', send: 'prompt' },
  ], { files: [{ id: 'f1', name: 'a.ts' }] });
  const out = Core.turnsFor(t, 2, env({ instructions: 'Be brief.' }));
  assert.equal(out[0].content.split('\n\n')[0], 'Be brief.');
  assert.match(out[0].content, /Files shared in this project:\n\n<file name="a.ts"\/>/);
  assert.match(out[0].content, /q1$/);
  assert.match(out[1].content, /short/);
  assert.ok(!out.some((x) => x.content.includes('long reply')));
  assert.equal(out[out.length - 1].content, 'q2', 'its own mode doesn\'t apply to the prompt being sent');
  const withReply = Core.turnsFor(t, 2, env(), true);
  assert.ok(!withReply.some((x) => x.content === 'r2'), 'with its reply, the turn is history: prompt only drops the reply');
});

test('core: model settings are inherited field by field, and null goes back to the default', () => {
  const t = tree([
    { id: 1, parents: [], text: 'a', set: { system: 'S1', temperature: 0.2 } },
    { id: 2, parents: [1], text: 'b', set: { temperature: null } },
    { id: 3, parents: [2], text: 'c' },
  ]);
  assert.deepEqual(Core.settingsFor(t, 3), { values: { system: 'S1' }, from: { temperature: 2, system: 1 } });
});

test('core: a new prompt\'s request, and Copy as a prompt', () => {
  const t = tree([{ id: 1, parents: [], text: 'a', reply: 'A', set: { system: 'Sys' } }]);
  assert.deepEqual(Core.turnsForNew(t, 1, 'next', env()).map((x) => x.content), ['a', 'A', 'next']);
  assert.deepEqual(Core.turnsForNew(t, null, 'first', env({ instructions: 'I' })), [{ role: 'user', content: 'I\n\nfirst' }]);
  assert.match(Core.contextPrompt(t, 1, env()), /<system>\nSys\n<\/system>[\s\S]*<assistant>\nA\n<\/assistant>/);
});

test('core: context changed lists changes in send order, names files, and ignores files saved from the reply itself', () => {
  const t = tree([
    { id: 1, parents: [], text: 'a', reply: 'A' },
    { id: 2, parents: [1], text: 'b', reply: 'B' },
  ], { files: [{ id: 'v1', name: 'x.ts' }, { id: 'w1', name: 'y.ts' }] });
  const E = env();
  t.nodes[2].ctx = Core.ctxSig(t, 2, E);
  assert.equal(Core.ctxChanges(t, 2, E), null);
  /* the reply proposed a change to x.ts and it was saved (a new file id); y.ts was edited by hand */
  t.files = [{ id: 'v2', name: 'x.ts' }, { id: 'w2', name: 'y.ts' }];
  t.nodes[2].applied = { 'x.ts': Core.h5('v2') };
  t.nodes[1].reply = 'A2';
  assert.deepEqual(Core.ctxChanges(t, 2, E)!.map((c) => c.label), ['y.ts changed', '#1 reply edited']);
});

test('the page builds context with the shared core, loaded before its own script', () => {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const at = (s: string) => html.indexOf(s);
  assert.ok(at('<script src="/sendmodes.js">') < at('<script src="/treecore.js">') && at('<script src="/treecore.js">') < at('\n<script>\n'));
  for (const call of ['Core.turnsFor(', 'Core.entries(', 'Core.ctxSig(', 'Core.ctxChanges(', 'Core.settingsFor(', 'Core.contextPrompt(', 'Core.path(', 'Core.chain('])
    assert.ok(html.includes(call), `the page uses ${call}`);
});
