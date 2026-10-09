/* Search and filters (starred, notes, left out). */

/* Select… only changes what a click on a row does, so it updates the controls in place rather than redrawing the panel */
/* ---- Search: every prompt and reply in the space, including other reply versions ---- */
const filters=new Set();
const FILTER_TEST={star:n=>!!n.star, note:n=>!!(n.note&&n.note.trim()), skip:n=>!!n.skip};
const passFilters = n => [...filters].every(f=>FILTER_TEST[f](n));
function setFilter(f, on){
  if(on==null) on=!filters.has(f);
  on?filters.add(f):filters.delete(f);
  for(const b of document.querySelectorAll('[data-filter]')) b.setAttribute('aria-pressed', filters.has(b.dataset.filter));
  if(on){ if(narrow()) openDrawer('convs'); else if(opts.collapsed.convs){ opts.collapsed.convs=false; applyLayout(); save(); } }
  renderConvs();
}
document.getElementById('convFilters').addEventListener('click', e=>{ const b=e.target.closest('[data-filter]'); if(b) setFilter(b.dataset.filter); });
function searchHits(q){
  const out=[];
  for(const n of all()){
    if(n.kind==='merge' || !passFilters(n)) continue;
    if(!q){ out.push({id:n.id, field:'text'}); if(out.length>=60) return out; continue; }
    for(const f of ['text','reply']){ const v=n[f]; if(v && v.toLowerCase().includes(q)){ out.push({id:n.id, field:f}); if(out.length>=60) return out; } }
  }
  return out;
}
function snippet(text, q){
  const t=(text||'').replace(/\s+/g,' '), i=q?t.toLowerCase().indexOf(q):-1; if(i<0) return esc(clip(t,90));
  const a=Math.max(0,i-36), b=Math.min(t.length, i+q.length+48);
  return (a?'…':'')+esc(t.slice(a,i))+'<mark>'+esc(t.slice(i,i+q.length))+'</mark>'+esc(t.slice(i+q.length,b))+(b<t.length?'…':'');
}
function hitHTML(h, q){
  const n=S.nodes[h.id], root=S.nodes[chain(h.id)[0]], hid=!opts.simple && isHidden(root), vs=versions(h.id);
  return `<li class="hit ${hid?'off':''}" data-key="h${h.id}${h.field}"><button class="cvmain" data-hit="${h.id}" title="Go to #${h.id}"><span class="hitsn">${snippet(n[h.field], q)}</span><span class="cvmeta">${h.field==='reply'?'Claude':'You'} · #${h.id}${vs.length>1?` · version ${vs.indexOf(h.id)+1}`:''} · ${esc(clip(convTitle(root),26))}${hid?' · hidden':''}</span></button></li>`;
}
/* go straight to a prompt: show its conversation if needed, switch to its reply version, and bring it into view */
function gotoNode(id){
  if(!S.nodes[id]) return;
  closeDrawers();
  const k=convKeyOf(id), root=vRoots().find(r=>convKey(r)===k) || S.nodes[chain(id)[0]];
  /* in Editor the chat is shown (or focused) first; Chat view goes there without changing which chats are hidden */
  if(!opts.simple && isArchived(root)){ delete S.convs[k].archived; }
  if(!opts.simple && visMode()!=='focus' && isHidden(root)) setHidden([k], false);
  composeFor=null; pick=null; renaming=false;
  sel=id; setActivePath(id); syncHead(); lastConv=k;
  if(!opts.simple && visMode()==='focus') applyVis();
  save(); render(true);
  const row=treeEl.querySelector(`.row[data-id="${id}"]`);
  if(row){
    row.scrollIntoView({block:'center', behavior: Motion.reduced() ? 'auto' : 'smooth'});
    if(!Motion.reduced()){ const c=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); row.animate([{boxShadow:`0 0 0 3px ${c}`},{boxShadow:'0 0 0 0 transparent'}], {duration:1000, easing:'ease-out'}); }
  }
}
