/* Notes, stars and folding. */

/* ---- Notes ---- */
/* notes show under their prompt; the Notes filter in the conversation list finds them all */
function renderNotes(){}

/* ---- Stars ---- */
function toggleStar(id){
  const n=S.nodes[id]; if(!n || n.kind==='merge') return;
  if(n.star) delete n.star; else n.star=true;
  save();
  const b=treeEl.querySelector(`[data-star="${id}"]`);
  if(b){ b.classList.toggle('on', !!n.star); b.textContent=n.star?'★':'☆'; b.setAttribute('aria-pressed', !!n.star); b.setAttribute('aria-label', `${n.star?'Unstar':'Star'} #${id}`); b.title=n.star?'Starred. Click to unstar.':'Star this prompt'; }
  if(filters.size || convFilterEl.value.trim()) renderConvs();
  drawMap();
}
/* ---- Folding ---- */
function toggleFold(id){
  if(!S.nodes[id]) return;
  if(S.fold[id]) delete S.fold[id];
  else { if(!kids(id).length) return; S.fold[id]=true; if(sel!=null && desc(id).has(sel)){ sel=id; setActivePath(sel); syncHead(); } }
  save(); Motion.run(treeEl, ()=>render(), [id]);
}
