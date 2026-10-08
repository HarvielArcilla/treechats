/* Every reply is written by the server (server/replies.ts): one queue for yours and agents', shown in every tab,
   carrying on when a tab closes. Test replies are slowed down here so the queue can be seen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, pageErrors, startServer, state } from './helpers.ts';

const slow = { TREECHATS_FAKE_DELAY: '250' };
const where = (p: any, ids: number[]) => p.evaluate((ids: number[]) => ids.map((i) => (window as any).__g.liveGen(i) ? 'live' : (window as any).__g.queuedGen(i) ? 'waiting' : '-'), ids);
const idle = (p: any) => p.waitForFunction(() => (window as any).__g.busyCount() === 0, null, { timeout: 90_000 });
/* three prompts in a chain, each asked at once: each waits for the one above */
const chain = (p: any): Promise<number[]> => p.evaluate(() => { const w: any = (window as any).__g; w.setView(false); w.select(17); const out: number[] = []; w.commit('chain', () => { let q = 17; for (let i = 0; i < 3; i++) { const n = w.Ops.addTurn(w.S, q, 'Step ' + (i + 1)); out.push(n); q = n; } }); w.wantReplies(out); return out; });

test('a reply carries on when its tab closes', { timeout: 120_000 }, async () => {
  const s = await startServer(slow);
  const A = await openPage(s), sid = await A.evaluate(() => (window as any).__g.DB.current);
  const id = await A.evaluate(() => { const w: any = (window as any).__g; w.setView(false); w.select(17); w.addPrompt(17, 'Close the tab while you answer'); return w.sel; });
  await A.waitForFunction((id) => !!(window as any).__g.liveGen(id), id, { timeout: 15_000 });
  await A.close();
  let n: any; for (let i = 0; i < 60 && !(n = (await state(s)).db.spaces[sid].tree.nodes[id]).reply; i++) await new Promise((r) => setTimeout(r, 500));
  assert.ok(n.reply, 'the reply was written'); assert.ok(n.ctx, 'with what was sent to get it');
});

test('the queue: prompts wait their turn, every tab sees it, and Stop cancels what waits below', { timeout: 180_000 }, async () => {
  const s = await startServer(slow);
  const A = await openPage(s), B = await openPage(s);
  const sid = await A.evaluate(() => (window as any).__g.DB.current);
  let ids = await chain(A);
  await A.waitForTimeout(1200);
  assert.deepEqual(await where(A, ids), ['live', 'waiting', 'waiting']);
  assert.deepEqual(await where(B, ids), ['live', 'waiting', 'waiting'], 'another tab sees the same queue');
  /* Stop on a waiting prompt: it and the one below are cancelled; the first finishes */
  await A.evaluate((id) => (window as any).__g.stopReply(id), ids[1]); await idle(A);
  let t = (await state(s)).db.spaces[sid].tree;
  assert.deepEqual(ids.map((i) => !!t.nodes[i].reply), [true, false, false]);
  /* Stop on a reply being written: what came is kept, marked, and the prompts waiting below are cancelled */
  ids = await chain(A);
  await A.waitForFunction((id) => !!(window as any).__g.liveGen(id) && (window as any).__g.liveGen(id).text.length > 10, ids[0], { timeout: 20_000 });
  await A.evaluate((id) => (window as any).__g.stopReply(id), ids[0]); await idle(A); await A.waitForTimeout(400);
  t = (await state(s)).db.spaces[sid].tree;
  assert.ok(t.nodes[ids[0]].reply, 'the part that came is kept');
  assert.deepEqual(ids.slice(1).map((i) => !!t.nodes[i].reply), [false, false]);
  assert.equal(await A.evaluate((id) => (window as any).__g.genNotes[(window as any).__g.gkey((window as any).__g.DB.current, id)], ids[0]), 'Stopped early.');
  /* deleting a prompt while its reply is being written stops the reply */
  const k = await A.evaluate(() => { const w: any = (window as any).__g; w.addPrompt(17, 'About to be deleted'); return w.sel; });
  await A.waitForFunction((id) => !!(window as any).__g.liveGen(id), k, { timeout: 15_000 });
  await A.evaluate((id) => (window as any).__g.run('prune', id), k); await idle(A);
  assert.equal((await state(s)).db.spaces[sid].tree.nodes[k], undefined);
  assert.deepEqual([...pageErrors(A), ...pageErrors(B)], []);
});

test('Include as › Summary: the server writes it, with your own wording if you give one', { timeout: 120_000 }, async () => {
  const s = await startServer();
  const p = await openPage(s);
  await p.evaluate(() => { const w: any = (window as any).__g; w.setView(false); w.select(3); });
  await p.click('[data-sendmenu="3"]'); await p.waitForTimeout(200); await p.click('.menu button:has-text("Summary")');
  await p.waitForFunction(() => { const n = (window as any).__g.S.nodes[3]; return n.sum && n.sum.text && !n.sum.pending; }, null, { timeout: 15_000 });
  assert.deepEqual(await p.evaluate(() => { const n = (window as any).__g.S.nodes[3]; return { mode: n.send, by: n.sum.by, of: !!n.sum.of }; }), { mode: 'summary', by: 'claude', of: true });
  const r = await p.evaluate(async () => await (window as any).__g.summarizeTurn((window as any).__g.DB.current, 4, 'Summarize in one word: {reply}'));
  assert.ok(r.summary.includes('Summarize in one word'));
  assert.ok((await p.evaluate(() => ((window as any).__g.ctxChanges(17) || []).map((c: any) => c.label))).includes('#3 now included as summary'));
  assert.deepEqual(pageErrors(p), []);
});
