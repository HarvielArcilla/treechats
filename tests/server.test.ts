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
