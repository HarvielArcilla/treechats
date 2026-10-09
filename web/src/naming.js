/* Names Claude suggests: for new branches, chats and projects. */

/* ---- Naming by Claude ----
   Small requests, one at a time, only while no reply is being written. Each checks that the name it would
   replace is still the automatic one, so a name you typed in the meantime is never overwritten. */
const nameJobs=[], titling=new Set(); let naming=false;
const AUTO_BRANCH=/^branch-\d+$/, AUTO_SPACE=/^(New space|New project|Imported space|Imported project|Imported chats)( \d+)?$/;
const seenRefs=new Set();
function noteExistingRefs(){ for(const rid of Object.keys(S.refs||{})) seenRefs.add(DB.current+':'+rid); }
const numberedBranches = () => Object.keys(S.refs).filter(rid=>AUTO_BRANCH.test(S.refs[rid].name) && S.nodes[S.refs[rid].tip] && S.nodes[S.refs[rid].tip].kind!=='merge');
function queueName(job){ nameJobs.push(job); pumpNames(); }
async function pumpNames(){
  if(naming || busyCount() || sumGen || sampleState!=='ready' || !sampleFn || !sampleFn.json || !nameJobs.length) return;
  naming=true; const job=nameJobs.shift();
  try{ await job(); }catch(e){}
  naming=false; setTimeout(pumpNames, 0);
}
function queueBranchName(rid, force){
  const key=DB.current+':'+rid; if(seenRefs.has(key) && !force) return; seenRefs.add(key);
  const sid=DB.current;
  queueName(async ()=>{
    if(DB.current!==sid || !S.refs[rid] || !AUTO_BRANCH.test(S.refs[rid].name)) return;
    const tip=S.refs[rid].tip, n=S.nodes[tip]; if(!n || n.kind==='merge' || !n.text) return;
    const p=S.nodes[n.parents[0]], c=convOf(tip);
    const d=await sampleFn.json(fillPrompt('nameBranch', {branch:`${p&&p.text?`The prompt it follows:\n${clip(p.text,400)}\n\n`:''}The branch's prompt:\n${clip(n.text,800)}${n.reply?`\n\nThe reply so far begins:\n${clip(n.reply,400)}`:''}`, used:[...namesIn(c)].join(', ')||'none'}), {modelTier:'quick', cache:false});
    const raw=d && typeof d.name==='string' ? d.name : '';
    if(!raw || DB.current!==sid || !S.refs[rid] || !AUTO_BRANCH.test(S.refs[rid].name)) return;
    const name=slugName(raw, c); if(!NAME_RE.test(name)) return;
    S.refs[rid].name=name; save(); renderTree(); renderBranches();
  });
}
function scanNewBranches(){ if(!set('nameBranches') || sampleState!=='ready') return; for(const rid of numberedBranches()) queueBranchName(rid); }
function queueConvTitle(rootId){
  const sid=DB.current, k=convKey(S.nodes[rootId]);
  const tk=sid+':'+k; if(convMeta(k).title || titling.has(tk)) return;
  titling.add(tk);
  queueName(async ()=>{
    try{
      if(DB.current!==sid || !S.nodes[rootId] || convMeta(k).title) return;
      const n=S.nodes[rootId];
      const d=await sampleFn.json(fillPrompt('nameConv', {conversation:`First message:\n${clip(n.text||'',800)}${n.reply?`\n\nFirst reply begins:\n${clip(n.reply,600)}`:''}`}), {modelTier:'quick', cache:false});
      const t=d && typeof d.title==='string' ? d.title.trim().replace(/^["'“]|["'”.]$/g,'').slice(0,80) : '';
      if(t && DB.current===sid && S.nodes[rootId] && !convMeta(k).title){ S.convs[k].title=t; save(); renderTree(); Motion.run(convListEl, renderConvs); renderBranches(); }
    } finally { titling.delete(tk); }
  });
}
function queueSpaceName(){
  const sid=DB.current, sp=DB.spaces[sid]; if(!AUTO_SPACE.test(sp.name) || titling.has(sid)) return;
  titling.add(sid);
  queueName(async ()=>{
    try{
      if(!DB.spaces[sid] || !AUTO_SPACE.test(DB.spaces[sid].name)) return;
      const titles=withTree(DB.spaces[sid].tree, ()=>orderedRoots().slice(0,6).map(r=>convTitle(r)));
      if(!titles.length) return;
      const d=await sampleFn.json(fillPrompt('nameSpace', {titles:titles.map(t=>'- '+clip(t,120)).join('\n')}), {modelTier:'quick', cache:false});
      const nm=d && typeof d.name==='string' ? d.name.trim().replace(/^["'“]|["'”.]$/g,'').slice(0,60) : '';
      if(nm && DB.spaces[sid] && AUTO_SPACE.test(DB.spaces[sid].name)){ DB.spaces[sid].name=uniqueSpaceName(nm); save(); renderSpaces(); renderHeader(); }
    } finally { titling.delete(sid); }
  });
}
/* after a reply lands: title the conversation and name the space if those are on */
function afterReplyNaming(id){
  if(sampleState!=='ready' || !S.nodes[id]) return;
  const root=S.nodes[chain(id)[0]];
  if(set('nameConvs') && root && root.reply) queueConvTitle(root.id);
  if(set('nameSpaces')) queueSpaceName();
}
