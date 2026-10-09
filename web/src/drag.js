/* Dragging: chats into your own order, prompts onto a new parent, chats onto another project. */

/* drag a chat in the list to put it in your own order */
let dropAt=null;
convListEl.addEventListener('dragover', e=>{
  if(dragConv==null || listView().show!=='active' || convFilterEl.value.trim() || filters.size) return;
  const li=e.target.closest('.cv[data-key]'); for(const x of convListEl.querySelectorAll('.dropabove,.dropbelow')) x.classList.remove('dropabove','dropbelow');
  if(!li) return;
  const k=+li.dataset.key.slice(2); if(k===convKey(S.nodes[dragConv])) return;
  const r=li.getBoundingClientRect(), after=e.clientY>r.top+r.height/2;
  e.preventDefault(); e.dataTransfer.dropEffect='move'; li.classList.add(after?'dropbelow':'dropabove'); dropAt={k, after};
});
convListEl.addEventListener('dragleave', e=>{ if(!convListEl.contains(e.relatedTarget)){ for(const x of convListEl.querySelectorAll('.dropabove,.dropbelow')) x.classList.remove('dropabove','dropbelow'); dropAt=null; } });
convListEl.addEventListener('drop', e=>{
  if(dragConv==null || !dropAt) return;
  e.preventDefault();
  const moving=convKey(S.nodes[dragConv]), at=dropAt; dropAt=null; dragConv=null;
  const order=sortRoots(orderedRoots().slice(), convSort()).map(convKey).filter(k=>k!==moving);
  order.splice(order.indexOf(at.k)+(at.after?1:0), 0, moving);
  const archived=vRoots().filter(isArchived).map(convKey), was=convSort();
  commit('Moved a chat in your order', ()=>{ S.convOrder=[...order, ...archived]; }, {touch:false});
  if(was!=='custom'){ opts.convSort='custom'; save(); Motion.run(treeEl, ()=>render(true), []); toast('Sorted by your order now. Change it with the sort button above the list.'); }
});
convListEl.addEventListener('change', e=>{ const c=e.target.closest('[data-check]'); if(!c) return; const k=+c.dataset.check; c.checked ? checked.add(k) : checked.delete(k); renderConvs(); });
convListEl.addEventListener('dblclick', e=>{ const o=e.target.closest('[data-openconv]'); if(o){ renamingConv=+o.dataset.openconv; renderConvs(); } });
document.getElementById('cvTools').addEventListener('click', e=>{
  const vm=e.target.closest('[data-vismode]'); if(vm){ if(vm.dataset.vismode!==visMode()) setVisMode(vm.dataset.vismode); return; }
  const pk=e.target.closest('[data-pick]');
  if(pk && pk.dataset.pick==='toggle'){ setPickingRows(!pickingRows); return; }
  const vw=e.target.closest('[data-view]');
  if(vw){
    if(vw.dataset.view==='save'){ saveView(); return; }
    const v=(S.views||[]).find(x=>x.id===vw.dataset.view); if(!v) return;
    if(viewIsActive(v)) viewMenu(vw, v); else applyView(v);
    return;
  }
  if(pk){
    const a=pk.dataset.pick, q=convFilterEl.value.trim().toLowerCase(), roots=orderedRoots();
    const label={all:'Showing all chats', invert:'Inverted which chats are shown', none:'Hid all chats', matches:'Showing only the matching chats'}[a];
    const before=JSON.stringify([S.convs, S.vis||null]), leavingFocus=visMode()==='focus';
    /* these work from either mode: in Focus they leave focus and apply in the same step */
    const go=()=>commit(label, ()=>{ if(leavingFocus) S.vis='select'; for(const r of roots){ const k=convKey(r); setOff(k, a==='all' ? false : a==='invert' ? !isHidden(r) : a==='none' ? true : !convTitle(r).toLowerCase().includes(q)); } }, {touch:false, hidden:true});
    if(leavingFocus) morphTools(go, {fade:false}); else go();
    const nb=document.querySelector(`#cvTools [data-pick="${a}"]`);
    if(nb){
      nb.blur();
      if(!Motion.reduced()){ const cs=getComputedStyle(document.documentElement); nb.animate([{backgroundColor:cs.getPropertyValue('--accent-soft').trim(), borderColor:cs.getPropertyValue('--accent').trim()},{backgroundColor:cs.getPropertyValue('--surface').trim(), borderColor:cs.getPropertyValue('--line').trim()}], {duration:450, easing:'ease-out'}); }
    }
    if(JSON.stringify([S.convs, S.vis||null])===before) toast('Already that way');
    return;
  }
  const ch=e.target.closest('[data-choose]'); if(ch){ chooseAction(ch.dataset.choose); return; }
  if(e.target.closest('[data-showall]')){ showAll(); return; }
  const b=e.target.closest('[data-bulk]'); if(!b) return;
  const a=b.dataset.bulk, keys=[...checked];
  if(a==='select'){ selecting=true; checked.clear(); morphTools(renderConvs); return; }
  if(a==='onlycur'){ const k=lastConvKey(); if(k==null){ toast('Select a prompt in a chat first'); return; } showOnly([k]); return; }
  if(a==='done'){ selecting=false; checked.clear(); morphTools(renderConvs); return; }
  if(a==='all'){ for(const r of orderedRoots()) checked.add(convKey(r)); renderConvs(); return; }
  if(a==='none'){ checked.clear(); renderConvs(); return; }
  if(!keys.length) return;
  if(a==='only'){ showOnly(keys); return; }
  if(a==='hide'){ setHidden(keys, true); return; }
  if(a==='show'){ setHidden(keys, false); return; }
  if(a==='move'){
    const others=spaceIds().filter(x=>x!==DB.current), roots=keys.map(rootForKey).filter(x=>x!=null);
    openMenu(b, [{heading:`Move ${keys.length} to project`}, ...others.map(o=>({label:DB.spaces[o].name, run:()=>{ selecting=false; checked.clear(); moveConversations(roots, o); }})), {label:'New project from these', run:()=>{ selecting=false; checked.clear(); moveConversations(roots, 'new'); }}]);
  }
});
document.querySelector('[data-gospaces]').onclick=()=>openDrawer('spaces');
const cvToolsEl=document.getElementById('cvTools');
cvToolsEl.addEventListener('keydown', e=>{
  const inp=e.target.closest('[data-viewname]'); if(!inp) return;
  if(e.key==='Enter'){ e.preventDefault(); renameView(inp.dataset.viewname, inp.value); }
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); renamingView=null; renderConvs(); }
});
cvToolsEl.addEventListener('focusout', e=>{ const inp=e.target.closest('[data-viewname]'); if(inp && renamingView===inp.dataset.viewname) renameView(inp.dataset.viewname, inp.value); });
const rootForKey = k => (vRoots().find(r=>convKey(r)===+k)||{}).id;
convListEl.addEventListener('keydown', e=>{
  const inp=e.target.closest('[data-cvname]'); if(!inp) return;
  if(e.key==='Enter'){ e.preventDefault(); renameConv(rootForKey(inp.dataset.cvname), inp.value); }
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); renamingConv=null; renderConvs(); }
});
convListEl.addEventListener('focusout', e=>{ const inp=e.target.closest('[data-cvname]'); if(inp && renamingConv===+inp.dataset.cvname) renameConv(rootForKey(inp.dataset.cvname), inp.value); });
document.getElementById('titleMenuBtn').onclick=e=>spaceMenu(e.currentTarget, DB.current);
document.getElementById('exampleBtn').onclick=()=>{ closeSide(); storeCommit('Added the example project', ()=>{ DB.current=addSpace(uniqueSpaceName('Example: rate limiter'), exampleTree()); }); };
const spaceListEl=document.getElementById('spaceList');
spaceListEl.addEventListener('click', e=>{
  const m=e.target.closest('[data-spmenu]'); if(m){ spaceMenu(m, m.dataset.spmenu); return; }
  const o=e.target.closest('[data-open]'); if(o) switchSpace(o.dataset.open);
});
spaceListEl.addEventListener('dblclick', e=>{ const o=e.target.closest('[data-open]'); if(o){ renamingSpace=o.dataset.open; renderSpaces(); } });
spaceListEl.addEventListener('keydown', e=>{
  const inp=e.target.closest('[data-spname]'); if(!inp) return;
  if(e.key==='Enter'){ e.preventDefault(); renameSpace(inp.dataset.spname, inp.value); }
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); renamingSpace=null; renderSpaces(); }
});
spaceListEl.addEventListener('focusout', e=>{ const inp=e.target.closest('[data-spname]'); if(inp && renamingSpace===inp.dataset.spname) renameSpace(inp.dataset.spname, inp.value); });

/* drag a prompt onto another to graft it there; hold Option/Alt to copy just its text instead (cherry-pick) */
let dragNode=null;
treeEl.addEventListener('dragstart', e=>{
  const row=e.target.closest && e.target.closest('.row[data-id]'); if(!row || !row.draggable) return;
  dragNode=+row.dataset.id;
  e.dataTransfer.effectAllowed='copyMove'; e.dataTransfer.setData('text/plain', S.nodes[dragNode].text||'');
  row.classList.add('dragsrc'); treeEl.classList.add('dragging-node');
  toast(`Drop #${dragNode} on a prompt to move it there. Hold ${IS_MAC?'Option':'Alt'} to copy it instead.`);
});
treeEl.addEventListener('dragover', e=>{
  if(dragNode==null) return;
  const row=e.target.closest('.row[data-id]'); for(const r of treeEl.querySelectorAll('.row.droptarget,.row.dropbad')) if(r!==row) r.classList.remove('droptarget','dropbad');
  if(!row) return;
  const t=+row.dataset.id, copy=e.altKey, ok = t!==dragNode && S.nodes[t].kind!=='merge' && (copy || validTarget('graft', dragNode, t));
  row.classList.toggle('droptarget', ok); row.classList.toggle('dropbad', !ok && t!==dragNode);
  if(ok){ e.preventDefault(); e.dataTransfer.dropEffect = copy ? 'copy' : 'move'; }
});
treeEl.addEventListener('dragleave', e=>{ const row=e.target.closest && e.target.closest('.row'); if(row && !row.contains(e.relatedTarget)) row.classList.remove('droptarget','dropbad'); });
treeEl.addEventListener('drop', e=>{
  if(dragNode==null) return;
  const row=e.target.closest('.row[data-id]'); if(!row) return;
  e.preventDefault();
  const t=+row.dataset.id, src=dragNode, copy=e.altKey; endNodeDrag();
  if(copy){ if(S.nodes[t].kind==='merge') return; pick={op:'cherry', src}; finishPick(t); }
  else if(validTarget('graft', src, t)){ pick={op:'graft', src}; finishPick(t); }
});
function endNodeDrag(){ dragNode=null; treeEl.classList.remove('dragging-node'); for(const r of treeEl.querySelectorAll('.dragsrc,.droptarget,.dropbad')) r.classList.remove('dragsrc','droptarget','dropbad'); }
treeEl.addEventListener('dragend', endNodeDrag);

/* drag a conversation's header onto a space to move it there */
let dragConv=null;
function onConvDragStart(e){
  const h=e.target.closest && e.target.closest('[data-convdrag]'); if(!h) return;
  dragConv=+h.dataset.convdrag;
  e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', convTitle(S.nodes[dragConv]));
  const c=h.closest('.conv, .cv'); if(c) c.classList.add('dragging');
}
function onConvDragEnd(){ dragConv=null; for(const el of document.querySelectorAll('.conv.dragging,.cv.dragging,.sp.drop')) el.classList.remove('dragging','drop'); }
for(const el of [treeEl, convListEl]){ el.addEventListener('dragstart', onConvDragStart); el.addEventListener('dragend', onConvDragEnd); }
spaceListEl.addEventListener('dragover', e=>{
  if(dragConv==null) return;
  const li=e.target.closest('[data-space]');
  for(const el of spaceListEl.querySelectorAll('.sp.drop')) if(el!==li) el.classList.remove('drop');
  if(!li || li.dataset.space===DB.current) return;
  e.preventDefault(); e.dataTransfer.dropEffect='move'; li.classList.add('drop');
});
spaceListEl.addEventListener('dragleave', e=>{ const li=e.target.closest('[data-space]'); if(li && !li.contains(e.relatedTarget)) li.classList.remove('drop'); });
spaceListEl.addEventListener('drop', e=>{
  const li=e.target.closest('[data-space]'); if(dragConv==null || !li || li.dataset.space===DB.current) return;
  e.preventDefault(); const r=dragConv; dragConv=null; moveConversation(r, li.dataset.space);
});
