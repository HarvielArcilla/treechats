/* What a prompt sends is built by one piece of code (web/public/treecore.js) for the page and the server. Here, for
   every prompt of a project using every way of including a turn, what agents get (get_context, get_prompt) is checked
   against what the page itself would send. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcp, openPage, pageErrors, startServer } from './helpers.ts';

test('agents get exactly the context the page sends, for every prompt', { timeout: 120_000 }, async () => {
  const s = await startServer();
  const page = await openPage(s);
  /* every way a turn can be included, model settings, standing instructions, a merge note and a project file */
  await page.evaluate(() => {
    const w: any = (window as any).__g, S = w.S, h5 = w.h5;
    const N = S.nodes;
    w.commit('setup', () => {
      N[2].send = 'summary'; N[2].sum = { text: 'Summary of #2.', of: h5(N[2].reply) };
      const i = N[4].reply.indexOf('```lua'), j = N[4].reply.indexOf('```', i + 6) + 3;
      N[4].send = 'excerpt'; N[4].ex = { p: [], r: [{ s: i, e: j, t: N[4].reply.slice(i, j) }] };
      N[3].send = 'excerpt'; N[3].ex = { p: [], r: [], ed: { p: 'My own wording of #3.' }, edOf: { p: h5(N[3].text) } };
      N[8].send = 'prompt'; N[9].send = 'reply';
      N[12].set = { system: 'Be terse.', temperature: 0.3 };
      N[5].reply = N[5].reply + ' (edited)'; N[5].replyEdited = true;
      S.files = [...(S.files || []), { id: 'e2efile', name: 'src/x.ts', kind: 'text' }];
    });
    w.Files.put('e2efile', { name: 'src/x.ts', type: 'text/plain', size: 20, kind: 'text', text: 'export const x = 1;\n' });
    w.opts.prompts.instructions = 'Standing: answer as a staff engineer.'; w.opts.prompts.seam = 'Custom merge note.';
    w.save();
  });
  await page.evaluate(() => (window as any).__g.flushState());
  await page.waitForTimeout(800);
  const { call, client } = await mcp(s);
  const project = await page.evaluate(() => (window as any).__g.DB.spaces[(window as any).__g.DB.current].name);
  const ids: number[] = await page.evaluate(() => Object.keys((window as any).__g.S.nodes).map(Number).filter((x) => (window as any).__g.S.nodes[x].kind !== 'merge'));
  assert.ok(ids.length > 15);
  for (const id of ids) {
    const fromPage = await page.evaluate((id) => (window as any).__g.contextPrompt(id), id);
    const fromAgent = await call('get_context', { project, prompt: id });
    assert.ok(fromAgent.endsWith(fromPage), `#${id}: get_context differs from the page's Copy as a prompt`);
    const changes = await page.evaluate((id) => ((window as any).__g.ctxChanges(id) || []).map((c: any) => c.label), id);
    const prompt = await call('get_prompt', { project, prompt: id });
    if (changes.length) assert.ok(prompt.includes(`Context changed since this reply was written: ${changes.join('; ')}.`), `#${id}: ${changes.join('; ')}\n${prompt}`);
    else assert.ok(!prompt.includes('Context changed'), `#${id} reports a change the page doesn't`);
  }
  assert.ok((await call('get_context', { project, prompt: 17 })).includes('export const x = 1;'), 'project file contents are included');
  assert.deepEqual(pageErrors(page), []);
  await client.close();
});
