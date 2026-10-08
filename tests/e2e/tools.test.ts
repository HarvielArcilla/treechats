/* The ✦ tools in the page (Replay, Judge, Combine, Review, Fan out, /loop) run on the engines they share with agents
   (web/public/treeops.js), with replies written by the server. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, pageErrors, startServer } from './helpers.ts';

test('Replay, Judge, Combine, Review, Fan out and /loop in the page', { timeout: 180_000 }, async () => {
  const s = await startServer();
  const p = await openPage(s);
  const idle = () => p.waitForFunction(() => { const w: any = (window as any).__g; return !w.busyCount() && !(w.replayRun && !w.replayRun.done); }, null, { timeout: 30_000 });
  await p.evaluate(() => { const w: any = (window as any).__g; w.setView(false); w.select(16); });

  /* Replay #16 and the prompt below it as new versions */
  const before = await p.evaluate(() => (window as any).__g.S.nextId);
  await p.evaluate(() => (window as any).__g.replay(16)); await idle(); await p.waitForTimeout(300);
  assert.equal(await p.evaluate((b) => Object.keys((window as any).__g.S.nodes).filter((k) => +k >= b).length, before), 2);
  assert.ok(await p.evaluate(() => !!(window as any).__g.S.nodes[(window as any).__g.S.nextId - 1].reply));

  /* a replay pauses before a prompt that no longer fits; sending the suggested rewrite marks it as rewritten */
  const mid = await p.evaluate(() => { const w: any = (window as any).__g; let n; w.commit('x', () => { n = w.S.nextId++; w.S.nodes[n] = { id: n, parents: [17], text: 'MISMATCH next' }; }); w.wantReplies([n]); return n; });
  await idle();
  p.evaluate((m) => (window as any).__g.replay(17, null, [17, m]), mid);
  await p.waitForFunction(() => { const r = (window as any).__g.replayRun; return r && r.status && r.status.what === 'paused'; }, null, { timeout: 20_000 });
  await p.click('[data-replayfitgo="edited"]'); await idle(); await p.waitForTimeout(300);
  assert.deepEqual(await p.evaluate(() => { const n = (window as any).__g.S.nodes[(window as any).__g.S.nextId - 1]; return [n.text, !!n.rewritten]; }), ['A rewritten follow-up that fits.', true]);

  /* Judge and Combine the follow-ups of a prompt that has two answered ones */
  const j = await p.evaluate(async () => { const w: any = (window as any).__g; const par = Object.keys(w.S.nodes).map(Number).find((x) => w.cmpKids(x).filter((k: any) => k.reply).length >= 2); w.__par = par; const r = await w.judgeCore(w.DB.current, par, w.cmpKids(par).map((k: any) => k.id), 'Simplest'); return { best: r.best, n: r.ids.length }; });
  assert.ok(j.best != null && j.n >= 2);
  const c = await p.evaluate(async () => { const w: any = (window as any).__g; const r = await w.combineCore(w.DB.current, w.__par, w.cmpKids(w.__par).map((k: any) => k.id)); let nid: any; w.commit('c', () => { nid = w.addCombined(w.__par, r); }); return { combined: !!w.S.nodes[nid].combined, ctx: !!w.S.nodes[nid].ctx, branch: w.refsAt(nid).map(w.refName)[0] }; });
  assert.deepEqual(c, { combined: true, ctx: true, branch: 'combined' });

  /* Review: a new chat, answered */
  await p.evaluate(() => (window as any).__g.openReview(17)); await p.waitForTimeout(200); await p.click('[data-rvgo]'); await idle(); await p.waitForTimeout(300);
  assert.deepEqual(await p.evaluate(() => { const w: any = (window as any).__g; const n = w.reviewsOf(17)[0]; return n && { title: w.S.convs[n.id].title, reply: !!n.reply }; }), { title: 'Review of #17', reply: true });

  /* Fan out reads the options with the quick model */
  await p.evaluate(() => { const w: any = (window as any).__g; w.select(1); w.openFan(1); });
  await p.waitForFunction(() => { const f = (window as any).__g.fan; return f && f.status !== 'loading'; }, null, { timeout: 15_000 });
  assert.deepEqual(await p.evaluate(() => (window as any).__g.fan.options.map((o: any) => o.title)), ['First way', 'Second way']);

  /* /loop with a condition: the check's verdict is noted */
  await p.evaluate(() => { const w: any = (window as any).__g; w.fan = null; w.select(17); w.runCommand('loop', '2 Tighten it until: always', 17); });
  await p.waitForTimeout(3000); await idle();
  assert.deepEqual(await p.evaluate(() => (window as any).__g.all().filter((n: any) => n.loopCheck).map((n: any) => n.loopCheck.met)), [true]);
  assert.deepEqual(pageErrors(p), []);
});
