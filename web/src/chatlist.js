/* What you can do with a chat in the list: sort, pin, archive, rename, delete, mark read or unread. */

function startNewConversation(){
  closeDrawers(); pick=null; composeFor='root';
  animRender([]);
  window.scrollTo({top:0, behavior: Motion.reduced() ? 'auto' : 'smooth'});
}
function renameConv(rootId, name){
  renamingConv=null;
  const r=S.nodes[rootId]; if(!r){ Motion.run(convListEl, renderConvs); return; }
  const k=convKey(r); name=(name||'').trim().slice(0,120);
  if(!name || name===convTitle(r)){ Motion.run(convListEl, renderConvs); return; }
  commit(`Renamed chat to ${clip(name,40)}`, ()=>{ S.convs[k]=Object.assign(S.convs[k]||{}, {title:name}); });
}
function deleteConv(rootId){
  const title=convTitle(S.nodes[rootId]);
  const del=new Set([rootId]), d=[...desc(rootId)];
  let grew=true; while(grew){ grew=false; for(const x of d) if(!del.has(x) && S.nodes[x].parents.every(p=>del.has(p))){ del.add(x); grew=true; } }
  commit(`Deleted “${clip(title,40)}”`, ()=>{
    for(const x of del) delete S.nodes[x];
    for(const m of all()) m.parents=m.parents.filter(p=>!del.has(p));
    if(del.has(sel)) sel=undefined;
  });
}
/* results from the server: each becomes a prompt with its reply, at the end of its branch, or a new chat */
function sortMenu(anchor){
  const cur=convSort(), mark=(on, l)=>(on?'✓ ':'  ')+l;
  openMenu(anchor, [
    {heading:'Sort chats by'},
    ...Object.entries(CONV_SORTS).map(([k,l])=>({label:mark(cur===k, l), run:()=>setConvSort(k)})),
    {sep:true},
    {label:mark(convGrouped(), 'Group by date'), disabled:cur==='name'||cur==='custom', run:()=>{ opts.convGroup = opts.convGroup===false; save(); Motion.run(convListEl, renderConvs); }},
    ...(cur==='custom' ? [{label:'  Forget your order', run:()=>{ commit('Forgot your chat order', ()=>{ delete S.convOrder; }, {touch:false}); }}] : []),
  ]);
}
function setConvSort(k){
  if(convSort()===k) return;
  /* switching to your own order starts from the order the list is in now */
  if(k==='custom' && !(S.convOrder||[]).length) S.convOrder=sortRoots(vRoots(), convSort()).map(convKey);
  opts.convSort=k; save();
  Motion.run(treeEl, ()=>render(true), []);
  toast(`Sorted by ${CONV_SORTS[k].toLowerCase()}${k==='custom'?'. Drag chats in the list to reorder them.':''}`);
}
/* archive: off the list and the page, kept under Archived; nothing is deleted */
function setArchived(k, on){
  const r=vRoots().find(x=>convKey(x)===k); if(!r) return;
  const wasCur = convKeyOf(sel)===k;
  commit(`${on?'Archived':'Unarchived'} “${clip(convTitle(r),40)}”`, ()=>{
    S.convs[k]=Object.assign(S.convs[k]||{});
    if(on){ S.convs[k].archived=true; delete S.convs[k].unread; } else delete S.convs[k].archived;
    if(on && wasCur && !opts.simple) sel=null;
  }, {touch:false, hidden:true});
}
const PIN='<svg class="pin" viewBox="0 0 24 24" aria-label="Pinned"><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" fill="currentColor"/></svg>';
function setPinned(k, on){ S.convs[k]=Object.assign(S.convs[k]||{}); if(on) S.convs[k].pinned=true; else delete S.convs[k].pinned; save(); Motion.run(treeEl, ()=>render(true), []); toast(on?'Pinned to the top of the list':'Unpinned'); }
function setSpacePinned(sid, on){ const sp=DB.spaces[sid]; if(!sp) return; if(on) sp.pinned=true; else delete sp.pinned; save(); renderSpaces(); toast(on?'Pinned to the top of your projects':'Unpinned'); }
function setUnread(k, on){ S.convs[k]=Object.assign(S.convs[k]||{}); if(on) S.convs[k].unread=true; else delete S.convs[k].unread; if(on && convKeyOf(sel)===k) readKey=DB.current+':'+k; save(); Motion.run(convListEl, renderConvs); renderSpaces(); }
/* a reply that lands while you're somewhere else marks its chat unread; opening the chat reads it */
function markUnreadFor(sid, id){
  const t=treeOf(sid); if(!t || !t.nodes[id]) return;
  const k=withTree(t, ()=>convKeyOf(id)); if(k==null) return;
  const here = sid===DB.current && convKeyOf(sel)===k && document.visibilityState==='visible';
  if(here) return;
  t.convs=t.convs||{}; t.convs[k]=Object.assign(t.convs[k]||{}, {unread:true});
}
/* a chat is read when you arrive in it (or come back to the tab), not on every change while you're there, so Mark as
   unread on the chat you're in stays until you leave it and come back */
let readKey=null;
function readCurrent(force){
  if(document.visibilityState!=='visible' || !S || !S.convs) return;
  const k=convKeyOf(sel), id=DB.current+':'+k;
  if(!force && id===readKey) return;
  readKey=id;
  if(k!=null && S.convs[k] && S.convs[k].unread){ delete S.convs[k].unread; if(typeof renderConvs==='function') renderConvs(); renderSpaces(); }
}
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible'){ readCurrent(true); save(); } });
const spaceUnread = sid => { const t=treeOf(sid); return !!t && Object.values(t.convs||{}).some(m=>m && m.unread && !m.archived); };
function convMenu(anchor, rootId, full){
  const others=spaceIds().filter(x=>x!==DB.current);
  const linked=[...component(rootId)].filter(x=>!S.nodes[x].parents.length).length-1;
  const r=S.nodes[rootId], k=convKey(r), here=()=>convKeyOf(sel)===k ? (opts.simple?composeParent():sel) : convTip(r);
  const onPage = !opts.simple && !isArchived(r);
  openMenu(anchor, [
    isPinned(r) ? {label:'Unpin', run:()=>setPinned(k, false)} : {label:'Pin to the top', run:()=>setPinned(k, true)},
    {label:'Rename', run:()=>{ renamingConv=k; if(narrow()) openDrawer('convs'); else if(opts.collapsed.convs){ opts.collapsed.convs=false; applyLayout(); save(); } Motion.run(convListEl, renderConvs); }},
    convMeta(k).unread ? {label:'Mark as read', run:()=>setUnread(k, false)} : {label:'Mark as unread', run:()=>setUnread(k, true)},
    ...(onPage ? [
      {heading:'On the page'},
      ...(visMode()==='select' ? [isHidden(r) ? {label:'Show', run:()=>pickToggle(k)} : {label:'Hide', run:()=>pickToggle(k)}] : []),
      {label:'Focus on this one', run:()=>{ if(visMode()==='focus' && convKeyOf(sel)===k) return; sel=convMeta(k).sel!=null && S.nodes[convMeta(k).sel] ? convMeta(k).sel : convTip(r); lastConv=k; setVisMode('focus'); }},
    ] : []),
    {heading:'Use'},
    {label:'Schedule a prompt here…', run:()=>openSchedules(schedFormFor(here(), ''))},
    {label:AI+'Distill into a brief…', disabled: sampleState!=='ready', run:()=>openDistill(convKeyOf(sel)===k ? sel : convTip(r))},
    {label:'Copy as Markdown', run:()=>copyText(treeMarkdown(rootId))},
    {label:'Copy context as a prompt', run:()=>copyContextPrompt(convKeyOf(sel)===k ? sel : convTip(r))},
    {heading:'Organize'},
    {label:'Clone', run:()=>duplicateConversation(rootId, DB.current)},
    {label:'Clone into', sub:()=>[...others.map(o=>({label:DB.spaces[o].name, run:()=>duplicateConversation(rootId, o)})), {label:'A new project', run:()=>duplicateConversation(rootId, 'new')}]},
    {label:linked>0 ? `Move to (with ${linked} linked by a merge)` : 'Move to', sub:()=>[...others.map(o=>({label:DB.spaces[o].name, run:()=>moveConversation(rootId, o)})), {label:'A new project', run:()=>moveConversation(rootId, 'new')}]},
    {label:'Move along with others…', disabled: orderedRoots().length<2, run:()=>{ selecting=true; checked.clear(); checked.add(k); if(narrow()) openDrawer('convs'); else if(opts.collapsed.convs){ opts.collapsed.convs=false; applyLayout(); save(); } morphTools(renderConvs); }},
    {sep:true},
    isArchived(r) ? {label:'Unarchive', run:()=>setArchived(k, false)} : {label:'Archive', run:()=>setArchived(k, true)},
    {label:'Delete chat', danger:true, run:()=>deleteConv(rootId)},
  ]);
}
