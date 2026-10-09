/* The tree: walking it (paths, chains, children), versions of a prompt, the per-redraw graph cache, and keeping a
   tree tidy after a change. */

function valid(t){ return t && typeof t.nextId==='number' && t.nodes && Object.values(t.nodes).every(n=>typeof n.id==='number' && Array.isArray(n.parents) && typeof n.text==='string'); }

/* graph helpers */
/* Graph index for one redraw. Nothing changes the tree's shape while drawing, so the parent/child lists,
   version groups, chains and paths are worked out once per redraw instead of once per row. Outside a
   redraw (while an operation edits the tree) the helpers compute directly. */
let G=null;
function buildGraph(){
  const list=Object.values(S.nodes).sort((a,b)=>a.id-b.id), kidsM=new Map(), prim=new Map(), secM=new Map(), alt=new Map(), tips=new Map();
  for(const n of list){
    n.parents.forEach((p,i)=>{ (kidsM.get(p)||kidsM.set(p,[]).get(p)).push(n); ((i===0?prim:secM).get(p)||(i===0?prim:secM).set(p,[]).get(p)).push(n); });
    if(n.alt!=null) (alt.get(n.alt)||alt.set(n.alt,[]).get(n.alt)).push(n);
  }
  for(const [rid,r] of Object.entries(S.refs||{})) (tips.get(r.tip)||tips.set(r.tip,[]).get(r.tip)).push(rid);
  return {all:list, kids:kidsM, prim, sec:secM, alt, tips, chain:new Map(), path:new Map(), desc:new Map()};
}
function withGraph(fn){ if(G) return fn(); G=buildGraph(); try{ return fn(); } finally{ G=null; } }
const all = () => Ops.all(S, G);
const roots = () => all().filter(n=>!n.parents.length);
const kids = id => Ops.kids(S, id, G);
const primaryKids = id => Ops.primaryKids(S, id, G);
const secondaryKids = id => G ? (G.sec.get(id)||[]) : all().filter(n=>n.parents.indexOf(id)>0);
function desc(id){ return Ops.desc(S, id, G); }
/* every prompt a prompt sends, oldest first: its first parent's path, then what each other parent adds, then itself.
   A post-order walk that skips what it has seen gives exactly that, in time linear in the ancestors (and without
   recursion, so very long chats are fine) */
function path(id){
  if(G && G.path.has(id)) return G.path.get(id);
  const res=Core.path(S, id);
  if(G) G.path.set(id, res);
  return res;
}
function chain(id){
  if(G && G.chain.has(id)) return G.chain.get(id).slice();
  const c=Core.chain(S, id);
  if(G) G.chain.set(id, c.slice()); return c;
}
const convOf = id => chain(id)[0];

/* reply versions: regenerating adds a sibling with the same prompt; only the active one is drawn */
function activeOf(gid){ return Ops.activeOf(S, gid, G); }
const visible = n => Ops.visible(S, n, G);
const vKids = id => Ops.vKids(S, id, G);
const vSec = id => secondaryKids(id).filter(visible);
const vRoots = () => roots().filter(visible);
/* conversations: a visible root and everything under it. Keyed by version group so regenerating the first prompt keeps its identity. */
const convKey = r => Ops.convKey(r);
const convKeyOf = id => id!=null && S.nodes[id] ? convKey(S.nodes[chain(id)[0]]) : null;
const rootOfSel = () => sel!=null && S.nodes[sel] ? vRoots().find(r=>convKey(r)===convKeyOf(sel)) || null : null;
const convMeta = k => (S.convs && S.convs[k]) || {};
function versions(id){ const n=S.nodes[id]; return n.alt==null ? [id] : (G ? (G.alt.get(n.alt)||[]) : all().filter(m=>m.alt===n.alt)).map(m=>m.id); }
function setActivePath(id){ Ops.setActivePath(S, id, path); }
function leafOf(id){ return Ops.leafOf(S, id, G); }
/* older saves used a flat name→tip map */
function migrate(){
  /* prompts made from now on get a time (see stampNew); earlier ones have none, rather than a made-up one */
  if(S.tsFrom==null) S.tsFrom=S.nextId;
  if(!S.refs){
    S.refs={}; S.nextRef=1;
    if(S.branches && typeof S.branches==='object') for(const [name,tip] of Object.entries(S.branches)){ const rid=newRef(name,tip); if(S.head===name) S.head=rid; }
    if(S.head && !S.refs[S.head]) S.head=null;
    delete S.branches;
  }
  if(!S.active) S.active={};
  if(!S.convs) S.convs={};
  if(S.vis && S.vis!=='focus') S.vis='select';
  if(!Array.isArray(S.files)) S.files=[];
  if(!Array.isArray(S.views)) S.views=[];
  if(!S.fold || typeof S.fold!=='object') S.fold={};
  if(!S.nextRef) S.nextRef=Object.keys(S.refs).length+1;
  tidy();
}
function tidy(){
  /* a prompt with several parents becomes a merge point followed by that prompt */
  for(const n of all()){
    if(n.kind==='merge' || n.parents.length<2) continue;
    let m = all().find(x=>x.kind==='merge' && x.parents.length===n.parents.length && x.parents.every((q,i)=>q===n.parents[i]));
    if(!m){ const mid=S.nextId++; m=S.nodes[mid]={id:mid, kind:'merge', parents:[...n.parents], text:''}; }
    n.parents=[m.id];
  }
  /* a merge point that lost a parent has nothing left to merge: drop it and keep what follows */
  for(const m of all()){
    if(m.kind!=='merge' || m.parents.length>1) continue;
    const p0=m.parents[0];
    for(const k of kids(m.id)) k.parents=[...new Set(k.parents.map(q=>q===m.id?p0:q))].filter(q=>q!=null);
    if(p0!=null) for(const r of Object.values(S.refs)) if(r.tip===m.id) r.tip=p0;
    if(!foreignTree && sel===m.id) sel=p0 ?? null;
    delete S.nodes[m.id];
  }
  for(const rid of Object.keys(S.refs)) if(!S.nodes[S.refs[rid].tip]){ delete S.refs[rid]; if(S.head===rid) S.head=null; }
  const groups={}; for(const n of all()) if(n.alt!=null) (groups[n.alt]=groups[n.alt]||[]).push(n);
  for(const g of Object.values(groups)) if(g.length<2) delete g[0].alt;
  for(const gid of Object.keys(S.active)) if(!groups[gid] || groups[gid].length<2) delete S.active[gid];
  if(S.fold) for(const k of Object.keys(S.fold)) if(!S.nodes[k] || !kids(+k).length) delete S.fold[k];
  if(S.convs){ const keys=new Set(vRoots().map(convKey)); for(const k of Object.keys(S.convs)) if(!keys.has(+k)) delete S.convs[k]; }
  if(Array.isArray(S.views)){ const keys=new Set(vRoots().map(convKey)); for(const v of S.views) v.keys=v.keys.filter(k=>keys.has(k)); S.views=S.views.filter(v=>v.keys.length); }
  /* every conversation keeps at least one branch; a fresh one is called main */
  for(const r of vRoots()){
    const has=Object.values(S.refs).some(x=>convOf(x.tip)===r.id);
    if(!has) newRef(namesIn(r.id).has('main') ? autoName(r.id) : 'main', leafOf(r.id));
  }
  /* names are unique within a conversation (grafts can bring in a duplicate) */
  const seen={};
  for(const rid of Object.keys(S.refs).sort((a,b)=>+a.slice(1)-+b.slice(1))){
    const r=S.refs[rid], c=convOf(r.tip), key=c+'\u0000'+r.name;
    if(seen[key]){ let k=2; while(namesIn(c).has(`${r.name}-${k}`)) k++; r.name=`${r.name}-${k}`; }
    seen[c+'\u0000'+r.name]=true;
  }
}
