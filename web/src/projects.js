/* Changes across projects: creating, renaming, deleting and combining them, moving chats between them, cloning. */

/* changes that span spaces: create, rename, delete, combine, move a conversation */
function storeCommit(msg, fn, action){
  if(choosing!=null) finishChoosing(true);
  save();
  const before=snapshotDB();
  fn();
  if(snapshotDB()===before) return false;
  pushUndo({kind:'store', s:before});
  enterSpace(DB.spaces[DB.current] ? DB.current : spaceIds()[0]);
  reconcileReplies();
  save(); render(true); Motion.swap(treeEl);
  toast(msg, true, action);
  return true;
}
function switchSpace(sid){
  if(choosing!=null) finishChoosing(true);
  closeSide();
  if(!DB.spaces[sid] || sid===DB.current) return;
  save(); enterSpace(sid); save();
  render(true); Motion.swap(treeEl);
}
function createSpace(){
  storeCommit('Created a new project. Rename it any time.', ()=>{ DB.current=addSpace(uniqueSpaceName('New project'), null); });
}
function renameSpace(sid, name){
  renamingSpace=null;
  name=(name||'').trim().slice(0,60);
  if(!DB.spaces[sid] || !name || name===DB.spaces[sid].name){ renderSpaces(); return; }
  storeCommit(`Renamed project to ${name}`, ()=>{ DB.spaces[sid].name=name; });
}
function deleteSpace(sid){
  if(spaceIds().length<2){ toast('Keep at least one project. Create another before deleting this one.'); return; }
  const name=DB.spaces[sid].name;
  storeCommit(`Deleted ${name}`, ()=>{
    delete DB.spaces[sid]; DB.order=DB.order.filter(x=>x!==sid);
    if(DB.current===sid) DB.current=spaceIds()[0];
  });
}
function combineSpaces(from, into){
  const a=DB.spaces[from].name, b=DB.spaces[into].name;
  storeCommit(`Combined ${a} into ${b}`, ()=>{
    const t=DB.spaces[from].tree;
    DB.spaces[into].tree.files=[...(DB.spaces[into].tree.files||[]), ...(t.files||[])];
    transplant(t, Object.keys(t.nodes).map(Number), DB.spaces[into].tree);
    delete DB.spaces[from]; DB.order=DB.order.filter(x=>x!==from);
    DB.current=into;
  });
}
/* every prompt linked to this one, including conversations joined to it by a merge */
function component(id){
  const out=new Set([id]), st=[id];
  while(st.length){ const c=st.pop(); for(const x of [...S.nodes[c].parents, ...kids(c).map(k=>k.id)]) if(S.nodes[x] && !out.has(x)){ out.add(x); st.push(x); } }
  return out;
}
function moveConversation(rootId, to){
  const comp=component(rootId), title=convTitle(S.nodes[rootId]);
  let target=to;
  const ok=storeCommit(to==='new' ? `Split “${clip(title,40)}” into a new project` : `Moved “${clip(title,40)}” to ${DB.spaces[to].name}`, ()=>{
    if(to==='new') target=addSpace(uniqueSpaceName(clip(title,40)), null);
    if(comp.has(sel)) delete DB.spaces[DB.current].sel;
    transplant(S, [...comp], DB.spaces[target].tree);
  }, {label:'Open', fn:()=>switchSpace(target)});
  return ok;
}
function moveConversations(rootIds, to){
  const comp=new Set(); for(const r of rootIds) for(const x of component(r)) comp.add(x);
  let target=to;
  storeCommit(to==='new' ? `Moved ${rootIds.length} chats into a new project` : `Moved ${rootIds.length} chats to ${DB.spaces[to].name}`, ()=>{
    if(to==='new') target=addSpace(uniqueSpaceName('New project'), null);
    if(comp.has(sel)) delete DB.spaces[DB.current].sel;
    transplant(S, [...comp], DB.spaces[target].tree);
  }, {label:'Open', fn:()=>switchSpace(target)});
}
/* Clone from a prompt. Three scopes, all including the prompt itself:
   upto    - everything up to it: its ancestors, i.e. the context it was written in (no side branches)
   from    - everything after it: the prompt and all that grew from it, starting a conversation with no earlier context
   through - everything that goes through it: up to plus after
   (the whole conversation is cloned from the conversation's own menu) */
function cloneIds(id, scope){
  if(scope==='all') return component(chain(id)[0]);
  const ids=new Set(scope==='from' ? [id] : path(id));
  if(scope!=='upto') for(const x of desc(id)) ids.add(x);
  return ids;
}
function cloneMenu(id){
  const anchor = treeEl.querySelector('[data-act="clone"]') || treeEl.querySelector(`.row[data-id="${id}"]`);
  const count = sc => [...cloneIds(id, sc)].filter(x=>S.nodes[x].kind!=='merge').length;
  const pl = sc => { const c=count(sc); return `${c} prompt${c===1?'':'s'}`; };
  openMenu(anchor, [
    {heading:'Clone into a new chat'},
    {label:`Up to here · ${pl('upto')}`, run:()=>cloneFrom(id,'upto')},
    {label:`From here on · ${pl('from')}`, run:()=>cloneFrom(id,'from')},
    {label:`Through here · ${pl('through')}`, run:()=>cloneFrom(id,'through')}
  ]);
}
function cloneFrom(id, scope){
  const ids=cloneIds(id, scope), titles={};
  for(const x of ids){ const n=S.nodes[x]; if(!n.parents.length && visible(n)) titles[convKey(n)] = 'Clone of '+clip(convTitle(n),70); }
  /* cloning from a prompt makes it the new conversation's start, so it gets that prompt's title */
  if(scope==='from' && S.nodes[id].parents.length) titles[S.nodes[id].alt ?? id] = 'Clone from #'+id+': '+clip(S.nodes[id].text||'',60);
  const what={upto:'everything up to', from:'everything from', through:'everything through', all:'the whole chat of'}[scope];
  commit(`Cloned ${what} #${id} into a new chat`, ()=>{
    const map=transplant(S, [...ids], S, {copy:true, titles});
    const t=map.get(id); if(t!=null && S.nodes[t]){ sel=t; setActivePath(sel); S.head=refsAt(sel)[0] ?? null; }
  });
  const k=convKeyOf(sel), sec=k!=null && treeEl.querySelector(`.conv[data-key="cv${k}"]`);
  if(sec) sec.scrollIntoView({block:'start', behavior: Motion.reduced() ? 'auto' : 'smooth'});
}
/* Duplicate a conversation with everything in it: branches, reply versions, files, merges, its name.
   Conversations joined to it by a merge come along, since the copy wouldn't make sense without them. */
function duplicateConversation(rootId, to){
  const comp=component(rootId), titles={};
  for(const x of comp){ const n=S.nodes[x]; if(!n.parents.length && visible(n)) titles[convKey(n)] = 'Clone of '+clip(convTitle(n),70); }
  const name=clip(convTitle(S.nodes[rootId]),40), selIn = comp.has(sel) ? sel : null;
  if(to===DB.current){
    let map;
    commit(`Cloned “${name}”`, ()=>{
      map=transplant(S, [...comp], S, {copy:true, titles});
      const target = selIn!=null ? map.get(selIn) : map.get(rootId);
      if(target!=null && S.nodes[target]){ sel=target; setActivePath(sel); S.head = refsAt(sel)[0] ?? null; }
    });
    const k=convKeyOf(sel), sec=k!=null && treeEl.querySelector(`.conv[data-key="cv${k}"]`);
    if(sec){ sec.scrollIntoView({block:'start', behavior: Motion.reduced() ? 'auto' : 'smooth'}); }
    return;
  }
  let target=to;
  storeCommit(to==='new' ? `Cloned “${name}” into a new project` : `Cloned “${name}” into ${DB.spaces[to].name}`, ()=>{
    if(to==='new') target=addSpace(uniqueSpaceName(name), null);
    const t=DB.spaces[target].tree; if(!t.files) t.files=[];
    transplant(S, [...comp], t, {copy:true, titles: to==='new' ? {} : titles});
  }, {label:'Open', fn:()=>switchSpace(target)});
}
/* move nodes, with their branches and reply versions, from one tree to another under fresh ids */
function transplant(fromT, ids, toT, o={}){
  const set=new Set(ids), map=new Map(), copy=!!o.copy;
  const nid = old => { if(!map.has(old)) map.set(old, toT.nextId++); return map.get(old); };
  for(const id of ids){
    const o=fromT.nodes[id], n=clone(o);
    n.id=nid(id); n.parents=o.parents.filter(p=>set.has(p)).map(nid);
    if(o.alt!=null) n.alt=nid(o.alt);
    toT.nodes[n.id]=n;
  }
  for(const [gid,a] of Object.entries(fromT.active||{})) if(set.has(a)){ toT.active[nid(+gid)]=nid(a); if(!copy) delete fromT.active[gid]; }
  for(const [rid,r] of Object.entries({...fromT.refs})){
    if(!set.has(r.tip)) continue;
    toT.refs['r'+(toT.nextRef++)]={name:r.name, tip:nid(r.tip)};
    if(!copy){ delete fromT.refs[rid]; if(fromT.head===rid) fromT.head=null; }
  }
  if(!toT.convs) toT.convs={};
  for(const [k,v] of Object.entries(fromT.convs||{})){
    if(!map.has(+k)) continue;
    const c=clone(v); if(c.sel!=null) c.sel = map.has(c.sel) ? map.get(c.sel) : undefined; delete c.hidden; delete c.t;
    toT.convs[map.get(+k)]=c; if(!copy) delete fromT.convs[k];
  }
  /* a copy gets its own name, so the two are easy to tell apart */
  if(copy && o.titles) for(const [k,title] of Object.entries(o.titles)){ const nk=map.get(+k); if(nk!=null){ toT.convs[nk]=Object.assign(toT.convs[nk]||{}, {title}); } }
  if(!copy) for(const id of ids) delete fromT.nodes[id];
  withTree(toT, tidy); if(fromT!==toT) withTree(fromT, tidy);
  return map;
}

function fix(){
  const prevSel=sel;
  migrate();
  if(sel!=null && !S.nodes[sel]) sel = defaultSel();
  else if(sel!=null && headTip()!=null && headTip()!==sel) sel = headTip();
  if(sel!=null){ setActivePath(sel); syncHead(); }
  pick=null; composeFor=null; renaming=false; range=null; pruneAlso(); save();
  showSelection(prevSel);
}
function spaceMenu(anchor, sid){
  const others=spaceIds().filter(x=>x!==sid);
  openMenu(anchor, [
    DB.spaces[sid].pinned ? {label:'Unpin', run:()=>setSpacePinned(sid, false)} : {label:'Pin to the top', run:()=>setSpacePinned(sid, true)},
    {label:'Rename', run:()=>{ renamingSpace=sid; if(narrow()) openDrawer('spaces'); else if(opts.collapsed.spaces){ opts.collapsed.spaces=false; applyLayout(); save(); } renderSpaces(); }},
    {label:'Project files…', run:()=>{ if(sid!==DB.current) switchSpace(sid); openSpaceFiles(); }},
    {label:'Import / export JSON…', run:()=>{ if(sid!==DB.current) switchSpace(sid); openIo(); }},
    {heading:'Combine into'},
    ...(others.length ? others.map(o=>({label:DB.spaces[o].name, run:()=>combineSpaces(sid, o)})) : [{label:'No other projects yet', disabled:true}]),
    {sep:true},
    {label:'Delete project', danger:true, disabled:!others.length, run:()=>deleteSpace(sid)}
  ]);
}
