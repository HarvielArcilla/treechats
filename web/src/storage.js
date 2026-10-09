/* Projects (called spaces in the code) and saving: loading the document, the current project, and writing changes
   out (to the server through Sync, or to the browser when opened on its own). */

/* ---- Spaces ----
   DB holds every space; S is always the current space's tree, so tree code works on S unchanged. */
let DB = null, renamingSpace = null, foreignTree = false, saveWarned = false;
const spaceIds = () => DB.order.filter(id=>DB.spaces[id]);
const emptyTree = () => Ops.emptyTree();
function withTree(tree, fn){ const prevS=S, prevF=foreignTree, prevG=G; S=tree; foreignTree=true; G=null; try{ return fn(); } finally{ S=prevS; foreignTree=prevF; G=prevG; } }
function addSpace(name, tree){ const id='s'+(DB.nextSpace++); DB.spaces[id]={id, name, tree: tree || emptyTree()}; DB.order.unshift(id); return id; }
function uniqueSpaceName(base){ return Ops.uniqueSpaceName(DB, base); }
function spaceStats(tree){ return withTree(tree, ()=>({convs:vRoots().length, prompts:all().filter(n=>n.kind!=='merge').length})); }
function enterSpace(sid){
  DB.current=sid; S=DB.spaces[sid].tree; lastConv=null; pickingRows=false;
  /* a stretch or picks belong to the project they were made in */
  try{ range=null; alsoTargets.clear(); }catch(e){ /* not declared yet during first load */ }
  if(!S.fold) S.fold={}; if(!S.convs) S.convs={}; if(!S.active) S.active={};
  if(typeof noteExistingRefs==='function') noteExistingRefs();
  const want=DB.spaces[sid].sel;
  sel = want===null ? null : want!=null && S.nodes[want] ? want : defaultSel();
  setActivePath(sel); syncHead(); pick=null; composeFor=null; renaming=false;
}
function load(){
  try{ const raw=localStorage.getItem(KEY); if(raw){ const d=JSON.parse(raw); if(d && d.db && d.db.spaces){ DB=d.db; opts=Object.assign(opts, d.opts||{}); } } }catch(e){ DB=null; }
  if(!DB){
    DB={spaces:{}, order:[], current:null, nextSpace:1};
    let old=null;
    try{ const raw=localStorage.getItem(OLD_KEY); if(raw){ const d=JSON.parse(raw); if(valid(d.tree)){ old=d.tree; opts=Object.assign(opts, d.opts||{}); } } }catch(e){}
    /* saves from before replies existed: fill sample replies for untouched sample prompts */
    if(old) for(const n of Object.values(old.nodes)){ const e=EXAMPLE.nodes[n.id]; if(e && e.reply && !('reply' in n) && e.text===n.text) n.reply=e.reply; }
    DB.current = addSpace(old ? 'My project' : 'Example: rate limiter', old || exampleTree());
  }
  for(const id of Object.keys(DB.spaces)){ const sp=DB.spaces[id]; if(!valid(sp.tree)) sp.tree=emptyTree(); withTree(sp.tree, migrate); }
  /* an example project from before prompts had times gets them once */
  for(const sp of Object.values(DB.spaces)){ const t=sp.tree, n1=t.nodes[1]; if(n1 && !n1.ts && n1.text===EXAMPLE.nodes[1].text) exampleTimes(t); }
  /* a summary that was being written when the page closed: keep the old one if there was one */
  for(const sp of Object.values(DB.spaces)) for(const n of Object.values(sp.tree.nodes||{})) if(n.sum && n.sum.pending){ delete n.sum.pending; if(!n.sum.text) delete n.sum; }
  DB.order=DB.order.filter(id=>DB.spaces[id]);
  for(const id of Object.keys(DB.spaces)) if(!DB.order.includes(id)) DB.order.push(id);
  if(!DB.order.length) DB.current=addSpace('My project', null);
  if(!DB.spaces[DB.current]) DB.current=DB.order[0];
  opts.prompts=Object.assign({}, opts.prompts);
  if(!Array.isArray(opts.saved)) opts.saved=clone(SAVED_STARTERS);
  opts.open=Object.assign({ops:true}, opts.open);
  opts.collapsed=Object.assign({spaces:false, convs:false}, opts.collapsed);
  enterSpace(DB.current);
}
/* Every new prompt, reply box or merge gets the time it was made, whichever operation made it: anything numbered since
   the last save that has no time yet. Ids only grow, so this looks at the new ones only. */
function stampNew(){
  const now=Date.now();
  for(const sp of Object.values(DB.spaces)){
    const t=sp.tree; if(!t || !t.nodes) continue;
    if(t.tsFrom==null) t.tsFrom=t.nextId;
    for(let id=Math.max(t.tsFrom, t.tsDone||0); id<t.nextId; id++) if(t.nodes[id] && !t.nodes[id].ts) t.nodes[id].ts=now;
    t.tsDone=t.nextId;
  }
}
function save(){
  if(sel!=null && S && S.nodes && S.nodes[sel]) lastConv=convKeyOf(sel);
  if(DB) stampNew();
  if(DB && S) readCurrent();
  if(DB && DB.spaces[DB.current]){
    DB.spaces[DB.current].tree=S; DB.spaces[DB.current].sel=sel;
    const k=convKeyOf(sel); if(k!=null) S.convs[k]=Object.assign(S.convs[k]||{}, {sel});
  }
  clearTimeout(saveTimer); saveTimer=setTimeout(writeStore, 350);
}
/* writing everything to storage is the slow part, so quick runs of changes are written once */
let saveTimer=null;
function writeStore(){
  clearTimeout(saveTimer); saveTimer=null;
  if(Sync.active()){ Sync.push(); return; }
  try{ localStorage.setItem(KEY, JSON.stringify({db:DB, opts})); }
  catch(e){ if(!saveWarned){ saveWarned=true; toast('Your browser didn\u2019t allow saving, so changes last only until you close this page.'); } }
}
window.addEventListener('pagehide', ()=>{ if(saveTimer) writeStore(); });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden' && saveTimer) writeStore(); });
