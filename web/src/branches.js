/* Branches: names on tips, the checked-out branch, renaming and deleting them. */

/* branches: labels on tips, scoped to their conversation so each can have its own main */
function refsAt(id){ return Ops.refsAt(S, id, G); }
const refName = rid => Ops.refName(S, rid);
function namesIn(root, exceptRid){ return Ops.namesIn(S, root, exceptRid, chain); }
function autoName(root){ return Ops.autoName(S, root, chain); }
function newRef(name, tip){ return Ops.newRef(S, name, tip); }
function headTip(){ const r=S.head && S.refs[S.head]; return r && S.nodes[r.tip] ? r.tip : null; }
function syncHead(){
  if(sel==null) return; /* deselecting keeps the checked-out branch */
  if(S.head && S.refs[S.head] && S.refs[S.head].tip===sel) return;
  S.head = sel==null ? null : (refsAt(sel)[0] ?? null);
}
function renameRef(rid, to){
  const r=S.refs[rid]; if(!r) return;
  to=to.trim(); if(to===r.name) return;
  const why=Ops.renameError(S, rid, to);
  if(why==='invalid'){ toast('Use letters, numbers, dots, dashes, slashes or underscores (no spaces).'); renderBranches(); return; }
  if(why==='taken'){ toast(`This chat already has a branch named ${to}.`); renderBranches(); return; }
  const from=r.name;
  commit(`Renamed ${from} to ${to}`, ()=>{ S.refs[rid].name=to; });
}
function deleteRef(rid){
  const r=S.refs[rid]; if(!r) return;
  commit(`Deleted branch ${r.name}. Its prompts are kept.`, ()=>{ delete S.refs[rid]; if(S.head===rid) S.head=null; });
}
function checkout(rid){ const r=S.refs[rid]; if(!r || !S.nodes[r.tip]) return; const prevSel=sel; sel=r.tip; setActivePath(sel); S.head=rid; composeFor=null; renaming=false; save(); showSelection(prevSel); }
function refsThrough(id){ return Ops.refsThrough(S, id, chain); }
function renameFormHTML(){
  return `<div class="composer"><label class="contLabel" for="branchName">Rename branch <b>${esc(refName(S.head))}</b></label>
    <div class="bar"><input id="branchName" value="${esc(refName(S.head))}" spellcheck="false" autocomplete="off"><button class="btn primary" data-compose="renbranch">Rename</button><button class="btn" data-compose="cancel-rename">Cancel</button></div></div>`;
}
