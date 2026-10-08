/* The server owns the document (server/doc.ts): tabs send changes, the server merges them per unit and pushes every
   change to every open tab. Files are kept by the server too. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, openPage, pageErrors, restart, startServer, state } from './helpers.ts';

const example = (p: any) => p.evaluate(() => { const w: any = (window as any).__g; return w.DB.current; });
const flush = (p: any) => p.evaluate(() => (window as any).__g.flushState());

test('two tabs: changes reach each other, nothing is overwritten, Undo takes back only your own', { timeout: 120_000 }, async () => {
  const s = await startServer();
  const A = await openPage(s); const sid = await example(A); await flush(A);
  const B = await openPage(s);
  await A.evaluate(() => { const w: any = (window as any).__g; w.commit('note', () => { w.S.nodes[3].note = 'from A'; }); }); await flush(A); await A.waitForTimeout(600);
  assert.equal((await state(s)).db.spaces[sid].tree.nodes[3].note, 'from A');
  assert.equal(await B.evaluate(() => (window as any).__g.S.nodes[3].note), 'from A', 'B sees A’s change without reloading');

  /* both tabs make a new prompt at the same moment, with the same number: both are kept */
  const ids = await Promise.all([A, B].map((p, i) => p.evaluate((i) => { const w: any = (window as any).__g; let nid; w.commit('add', () => { nid = w.S.nextId++; w.S.nodes[nid] = { id: nid, parents: [17], text: 'made in tab ' + (i ? 'B' : 'A') }; }); return nid; }, i)));
  assert.equal(ids[0], ids[1]);
  for (let i = 0; i < 2; i++) { await Promise.all([A, B].map(flush)); await A.waitForTimeout(800); }
  const made = Object.values((await state(s)).db.spaces[sid].tree.nodes).filter((n: any) => /made in tab/.test(n.text)).map((n: any) => n.id).sort();
  assert.equal(made.length, 2, 'both prompts kept'); assert.notEqual(made[0], made[1]);
  for (const p of [A, B]) assert.equal(await p.evaluate(() => (window as any).__g.all().filter((n: any) => /made in tab/.test(n.text)).length), 2);

  /* Undo in A takes back A’s change, and keeps B’s */
  await A.evaluate(() => { const w: any = (window as any).__g; w.commit('A', () => { w.S.nodes[5].note = 'A note'; }); }); await flush(A); await A.waitForTimeout(400);
  await B.evaluate(() => { const w: any = (window as any).__g; w.commit('B', () => { w.S.nodes[12].note = 'B note'; }); }); await flush(B); await A.waitForTimeout(800);
  await A.evaluate(() => (window as any).__g.undo()); await flush(A); await A.waitForTimeout(800);
  const t = (await state(s)).db.spaces[sid].tree;
  assert.equal(t.nodes[5].note, undefined); assert.equal(t.nodes[12].note, 'B note');

  /* a scheduled task's run (written by the server) appears in both tabs */
  await A.evaluate((sid) => { const w: any = (window as any).__g; w.opts.schedules = [{ id: 'tk1', name: 'Daily check', text: 'Anything new?', sid, ref: null, after: 17, when: { every: 'day', time: '09:00' }, created: Date.now() }]; w.save(); }, sid);
  await flush(A); await A.waitForTimeout(400);
  await api(s.base, '/api/schedule/run', { method: 'POST', body: JSON.stringify({ id: 'tk1' }) }); await A.waitForTimeout(1500);
  for (const p of [A, B]) assert.ok(await p.evaluate(() => !!(window as any).__g.all().find((n: any) => n.sched)));

  /* the whole document replaced elsewhere (a restore): open tabs load it, and keep saving */
  const doc = await state(s); doc.db.spaces[sid].tree.nodes[3].note = 'restored';
  await api(s.base, '/api/state', { method: 'PUT', body: JSON.stringify(doc) }); await A.waitForTimeout(1500);
  for (const p of [A, B]) assert.equal(await p.evaluate(() => (window as any).__g.S.nodes[3].note), 'restored');
  await B.evaluate(() => { const w: any = (window as any).__g; w.commit('after', () => { w.S.nodes[4].note = 'after'; }); }); await flush(B); await A.waitForTimeout(800);
  assert.equal(await A.evaluate(() => (window as any).__g.S.nodes[4].note), 'after');
  assert.deepEqual([...pageErrors(A), ...pageErrors(B)], []);
});

test('a page open across a server restart keeps saving and receiving', { timeout: 120_000 }, async () => {
  let s = await startServer();
  const p = await openPage(s); const sid = await example(p);
  await p.evaluate(() => { const w: any = (window as any).__g; w.commit('n', () => { w.S.nodes[1].note = 'before'; }); }); await flush(p);
  s = await restart(s); await p.waitForTimeout(4000); /* the page's event stream reconnects by itself */
  await p.evaluate(() => { const w: any = (window as any).__g; w.commit('n', () => { w.S.nodes[2].note = 'after'; }); }); await flush(p); await p.waitForTimeout(800);
  const t = (await state(s)).db.spaces[sid].tree;
  assert.equal(t.nodes[1].note, 'before'); assert.equal(t.nodes[2].note, 'after');
  /* and a change made by the server after the restart is pushed to it */
  await p.evaluate((sid) => { const w: any = (window as any).__g; w.opts.schedules = [{ id: 'tk2', name: 'Ping', text: 'ping', sid, ref: null, after: 1, when: { every: 'day', time: '09:00' }, created: Date.now() }]; w.save(); }, sid);
  await flush(p);
  await api(s.base, '/api/schedule/run', { method: 'POST', body: JSON.stringify({ id: 'tk2' }) }); await p.waitForTimeout(2500);
  assert.ok(await p.evaluate(() => !!(window as any).__g.all().find((n: any) => n.sched)));
});

test('files are kept by the server: a new browser gets them, and older browser-only files move over', { timeout: 120_000 }, async () => {
  const s = await startServer();
  const A = await openPage(s);
  await A.evaluate(async () => {
    const w: any = (window as any).__g;
    w.Files.put('ptext1', { name: 'notes.md', type: 'text/markdown', size: 12, kind: 'text', text: '# Shared notes' });
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    w.Files.put('pimg1', { name: 'dot.png', type: 'image/png', size: png.length, kind: 'image', blob: new Blob([png], { type: 'image/png' }) });
    await new Promise((res) => { const r = indexedDB.open('treechats-files', 1); r.onsuccess = () => { const tx = r.result.transaction('f', 'readwrite'); tx.objectStore('f').put({ name: 'old.txt', type: 'text/plain', size: 3, kind: 'text', text: 'old' }, 'oldonly1'); tx.oncomplete = res; }; });
  });
  await A.waitForTimeout(1000);
  await A.reload(); await A.waitForFunction(() => { try { return (window as any).__g.sampleState === 'ready'; } catch { return false; } }); await A.waitForTimeout(1200);
  assert.deepEqual((await (await api(s.base, '/api/files')).json()).sort(), ['oldonly1', 'pimg1', 'ptext1']);
  const B = await openPage(s); await B.waitForTimeout(800);
  assert.deepEqual(await B.evaluate(() => { const F = (window as any).__g.Files; return { t: F.get('ptext1')?.text, img: F.get('pimg1')?.blob?.size, old: F.get('oldonly1')?.text }; }), { t: '# Shared notes', img: 70, old: 'old' });
});
