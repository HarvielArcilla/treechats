/* Every tree operation, from the page and from agents, against the results recorded when they were last checked
   (tests/e2e/fixtures). The page and agents share one definition of each operation (web/public/treeops.js), and
   agent operations run on the server with no page open. After a change meant to alter results:
   UPDATE_FIXTURES=1 npm run test:e2e */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, mcp, openPage, pageErrors, startServer } from './helpers.ts';

test('page operations: each one changes the tree as recorded', { timeout: 180_000 }, async () => {
  const s = await startServer();
  const p = await openPage(s);
  /* no replies, so trees are the same every run */
  await p.evaluate(() => { const w: any = (window as any).__g; w.wantReplies = () => {}; /* generate goes through it too */ });
  const cases: [string, string][] = [
    ['branch', `run('branch',5)`], ['promote', `run('promote',7)`], ['promote-main', `run('promote',16)`], ['skip', `run('skip',4)`],
    ['reroot', `opts.summary=true; opts.cow=false; opts.rerootBy='template'; run('reroot',12)`], ['reroot-copy', `opts.summary=false; opts.cow=true; run('reroot',12)`],
    ['splice', `run('splice',4)`], ['prune', `run('prune',6)`], ['unmerge', `run('unmerge',14)`],
    ['graft', `pick={op:'graft', src:9}; finishPick(3)`], ['merge', `pick={op:'merge', src:7}; finishPick(16)`], ['cherry', `S.nodes[3].files=[{id:'fx',name:'a.txt',kind:'text'}]; pick={op:'cherry', src:3}; finishPick(16)`],
    ['squash', `opts.squashBy='join'; pick={op:'squash', src:17}; finishPick(15)`],
    ['regen', `regenerate(16)`], ['edit', `regenerate(16, 'An edited prompt')`], ['regen-kind', `S.nodes[16].kind='summary'; regenerate(16)`],
    ['add', `addPrompt(17, 'A follow-up')`], ['add-multi', `alsoTargets.add(9); addPrompt(17, 'To both')`], ['add-root', `addPrompt(null, 'New chat')`],
    ['rename', `renameRef(Object.keys(S.refs).find(r=>S.refs[r].name==='gcra'), 'gcra2')`],
  ];
  const out: Record<string, unknown> = {};
  for (const [name, code] of cases) {
    await p.evaluate(() => { const w: any = (window as any).__g; const sid = w.addSpace('Case', w.exampleTree()); w.enterSpace(sid); w.select(17); });
    await p.waitForTimeout(100);
    await p.evaluate(code);
    await p.waitForTimeout(150);
    out[name] = await p.evaluate(() => { const w: any = (window as any).__g, S = w.S; const strip = (o: unknown) => JSON.parse(JSON.stringify(o, (k, v) => ['ts', 'rt', 'usage', 'ctx', 't'].includes(k) ? undefined : v)); return { nodes: strip(S.nodes), refs: S.refs, head: S.head, active: S.active, convs: strip(S.convs), nextId: S.nextId, sel: w.sel }; });
  }
  assert.deepEqual(pageErrors(p), []);
  const was = fixture('page-operations', out);
  if (was) for (const k of Object.keys(was as object)) assert.deepEqual(out[k], (was as any)[k], `page operation "${k}" changed the tree differently`);
});

test('agent operations: every MCP operation, with no page open, answers as recorded', { timeout: 300_000 }, async () => {
  const s = await startServer();
  const { call: raw, client } = await mcp(s);
  const res: [string, unknown, string][] = [];
  const norm = (t: string) => t.replace(/\$\d+\.\d+|<\$0\.01/g, '$X').replace(/\d+ request(s)? left/, 'N requests left');
  const call = async (name: string, args: Record<string, any>) => { const t = await raw(name, args); res.push([name, args, norm(t)]); return t; };
  const R='all';
  await call('spawn', {run:R, prompt:'Plan a cache.', context:'We run Postgres.', title:'Cache plan', system:'Be brief.', temperature:0.2});
  await call('ask', {run:R, after:1, prompt:'Which eviction policy?'});
  await call('ask', {run:R, branch:'main', prompt:'What about TTLs?'});
  await call('fork', {run:R, at:1, prompt:'Try Redis instead.', name:'redis', effort:'high'});
  await call('regenerate', {run:R, prompt:2});
  await call('edit_prompt', {run:R, prompt:3, text:'What about TTL jitter?'});
  await call('leave_out', {run:R, prompt:2});
  await call('leave_out', {run:R, prompt:2, left_out:false});
  await call('include_as', {run:R, prompt:1, mode:'summary', summary:'Planned a cache in front of Postgres.'});
  await call('include_as', {run:R, prompt:1, mode:'summary'});
  await call('include_as', {run:R, prompt:2, mode:'prompt_only'});
  await call('include_as', {run:R, prompt:2, mode:'excerpt', excerpt:{reply:['This is a test reply']}});
  await call('include_as', {run:R, prompt:2, mode:'excerpt', excerpt:{reply_text:'My own words.'}});
  await call('include_as', {run:R, prompt:2, mode:'excerpt', excerpt:{reply:['not there']}});
  await call('include_as', {run:R, prompt:1, until:2, mode:'full'});
  await call('edit_reply', {run:R, prompt:1, reply:'Corrected: use a write-through cache.'});
  await call('get_prompt', {project:'Run: '+R, prompt:2});
  const rp=await call('replay', {run:R, prompt:2}); const last=+(rp.match(/–#(\d+)\)/)||[0,8])[1];
  const mm=await call('ask', {run:R, after:last, prompt:'MISMATCH follow-up'}); const mid=+(mm.match(/prompt #(\d+)/)||[0,9])[1];
  await call('replay', {run:R, prompt:last, until:mid});
  await call('replay', {run:R, prompt:last, until:mid, on_mismatch:'rewrite'});
  await call('replay', {run:R, prompt:last, until:mid, on_mismatch:'ignore'});
  await call('replay', {run:R, prompt:mid, onto:last, first_prompt:'My fixed follow-up'});
  await call('replay', {run:R, prompt:2, until:999});
  await call('loop', {run:R, after:1, prompt:'Tighten it', times:2});
  await call('loop', {run:R, after:1, prompt:'Again', times:3, until:'always'});
  await call('fan_out', {run:R, prompt:1, options:[{title:'LRU', prompt:'Go with LRU.'},{title:'LFU', prompt:'Go with LFU.'}]});
  await call('fan_out', {run:R, prompt:1});
  await call('fan_out', {run:R, prompt:1, options:[{title:'ARC', prompt:'ARC?'}], replies:false});
  await call('review', {run:R, prompt:1});
  await call('review', {run:R, prompt:1, include_conversation:true, instructions:'Check facts. {material}'});
  await call('judge', {run:R, after:1, criteria:'Simplest'});
  await call('combine', {run:R, after:1});
  await call('distill', {run:R, prompt:2});
  await call('distill', {run:R, branch:'main', save_as_note:true});
  for(const op of [
    {op:'star', prompt:1}, {op:'star', prompt:1, value:false}, {op:'note', prompt:1, text:'remember'}, {op:'note', prompt:1, text:'more', append:true},
    {op:'branch', prompt:2, name:'side'}, {op:'rename_branch', branch:'side', name:'side2'}, {op:'make_mainline', prompt:4},
    {op:'merge', prompt:4, onto:2}, {op:'model_settings', prompt:2, thinking:true, max_tokens:500}, {op:'model_settings', prompt:2, value:false},
    {op:'rename_chat', prompt:1, name:'Cache plan v2'}, {op:'cherry_pick', prompt:3, onto:4}, {op:'rebase', prompt:5, onto:2},
    {op:'squash', prompt:2, until:5}, {op:'splice', prompt:4}, {op:'reroot', prompt:6, text:'Summary so far'}, {op:'delete', prompt:7}, {op:'unmerge', prompt:9999}, {op:'nonsense', prompt:1},
  ]) await call('operate', {run:R, ...op});
  await call('btw', {project:'Run: '+R, prompt:1, question:'One line?'});
  await call('ask', {run:'nope', after:1, prompt:'x'});
  await call('get_tree', { project: 'Run: ' + R });
  for (let i = 1; i <= 80; i++) { const g = await call('get_prompt', { project: 'Run: ' + R, prompt: i }); if (/^ERROR/.test(g)) res.pop(); }
  await client.close();
  const was = fixture('agent-operations', res) as typeof res | null;
  if (was) { assert.equal(res.length, was.length, 'a different number of calls'); res.forEach((r, i) => assert.deepEqual(r, was[i], `call ${i + 1}: ${r[0]} ${JSON.stringify(r[1])}`)); }
});
