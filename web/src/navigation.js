/* Moving around: selecting a prompt, keeping focus and what's typed across a redraw, opening a chat, which chats
   are on the page. */

function defaultSel(){
  const t=headTip(); if(t!=null && !isHidden(S.nodes[chain(t)[0]])) return t;
  const r=shownRoots()[0]; return r ? convTip(r) : null;
}

/* which field has focus, so a redraw can put focus and the caret back in the same place */
const FOCUS_ATTRS=['vtext','ftitle','fprompt'];
function focusKey(){
  const a=document.activeElement;
  if(!a || !treeEl.contains(a) || !/^(TEXTAREA|INPUT)$/.test(a.tagName)) return null;
  let q=a.id ? '#'+a.id : null;
  if(!q){ const at=FOCUS_ATTRS.find(x=>a.dataset[x]!=null); if(at) q=`[data-${at}="${a.dataset[at]}"]`; }
  return q && {q, s:a.selectionStart, e:a.selectionEnd, v:a.value, top:a.scrollTop};
}
function restoreFocus(k){
  if(!k) return;
  const el=treeEl.querySelector(k.q); if(!el) return;
  if(k.q==='#resendText' || k.q==='#replyEditText' || k.q==='#distillText' || k.q==='#promptEditText') el.value=k.v;
  /* the caret goes back before focus does: Safari scrolls the page to a focused field whose selection is set, a moment
     later, which would undo wherever the redraw left the page */
  const n=el.value.length;
  try{ el.setSelectionRange(Math.min(k.s,n), Math.min(k.e,n)); }catch(e){}
  el.focus({preventScroll:true});
  el.scrollTop=k.top;
}
/* keep what's typed in the input box across a redraw */
function keepDraft(fn){ const t=document.getElementById('contText'), v=t?t.value:null; fn(); const t2=document.getElementById('contText'); if(t2 && v!=null) t2.value=v; }
function select(id){
  if(S.nodes[id] && isHidden(S.nodes[chain(id)[0]])){ openConv(convKeyOf(id)); return; }
  if(id!==sel) alsoTargets.delete(id);
  if(id!==resendFor) resendFor=null;
  if(id!==replyEditFor) replyEditFor=null;
  if(id!==promptEditFor) promptEditFor=null;
  if(distill && distill.id!==id){ if(distill.ctl) distill.ctl.abort(); distill=null; }
  if(fan && fan.id!==id) fan=null;
  if(replayAsk && replayAsk.at!==id) replayAsk=null;
  if(reviewAsk && reviewAsk.id!==id) reviewAsk=null;
  if(variants && id!==sel) variants=null;
  if(S.nodes[id]) for(const x of path(id)) if(x!==id && S.fold[x]) delete S.fold[x];
  const changed=sel!==id, prevSel=sel;
  sel=id; setActivePath(id); syncHead(); composeFor=null; if(changed) renaming=false; save();
  showSelection(prevSel);
  /* Selecting never moves the page under you: it scrolls only when the prompt is entirely off screen (keyboard
     navigation, or a jump from somewhere else), and never when you flip between versions of the same prompt */
  const el=treeEl.querySelector(`.row[data-id="${id}"]`);
  const group=x=>S.nodes[x] ? (S.nodes[x].alt ?? x) : null, sameRow = prevSel!=null && group(prevSel)===group(id);
  if(el){
    el.focus({preventScroll:true});
    const r=el.getBoundingClientRect(), offScreen = r.bottom<72 || r.top>innerHeight;
    if(offScreen && !sameRow && el.scrollIntoView) el.scrollIntoView({block:'nearest', behavior: Motion.reduced() ? 'auto' : 'smooth'});
  }
}
/* moving within a conversation glides; landing in a different one swaps the view */
function showSelection(prevSel){ animRender([sel, prevSel], true); }
/* jump to a conversation on the page; a hidden one is shown first */
function openConv(key){
  closeDrawers();
  const r=vRoots().find(x=>convKey(x)===+key); if(!r) return;
  /* in Editor, an archived chat comes back to the list and the page; Chat view just opens it */
  if(!opts.simple && isArchived(r)){ delete S.convs[+key].archived; delete S.convs[+key].hidden; toast(`“${clip(convTitle(r),40)}” is back in your chats`); }
  if(opts.simple){
    const m=convMeta(+key).sel;
    composeFor=null; pick=null; renaming=false; simpleTip=null;
    sel = m!=null && S.nodes[m] && convKeyOf(m)===+key ? m : convTip(r);
    setActivePath(sel); syncHead(); save();
    render(true); Motion.swap(treeEl); scrollThreadEnd();
    return;
  }
  /* clicking the conversation you're in again switches between All and Focus */
  if(composeFor!=='root' && convKeyOf(sel)===+key && !isHidden(r)){
    if(visMode()==='focus'){ setVisMode('select'); return; }
    const othersShown=orderedRoots().some(x=>convKey(x)!==+key && !isHidden(x));
    if(othersShown) showOnly([+key]); else showAll();
    return;
  }
  if(visMode()==='focus'){
    const m=convMeta(+key).sel;
    composeFor=null; pick=null; renaming=false;
    sel = m!=null && S.nodes[m] && convKeyOf(m)===+key ? m : convTip(r);
    setActivePath(sel); syncHead(); applyVis(); save();
    render(true); Motion.swap(treeEl); window.scrollTo({top:0, behavior: Motion.reduced() ? 'auto' : 'smooth'});
    return;
  }
  const go=()=>{
    const m=convMeta(+key).sel, prevSel=sel;
    composeFor=null; pick=null; renaming=false;
    sel = m!=null && S.nodes[m] && convKeyOf(m)===+key ? m : convTip(r);
    setActivePath(sel); syncHead(); save();
    Motion.run(treeEl, ()=>render(true), []);
    const sec=treeEl.querySelector(`.conv[data-key="cv${key}"]`);
    if(sec){
      sec.scrollIntoView({block:'start', behavior: Motion.reduced() ? 'auto' : 'smooth'});
      if(!Motion.reduced()){ const c=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); sec.animate([{boxShadow:`0 0 0 3px ${c}`},{boxShadow:'0 0 0 0 transparent'}], {duration:900, easing:'ease-out'}); }
    }
  };
  if(isHidden(r)) setHidden([+key], false, go); else go();
}
/* Which conversations are on the page:
   select - you decide. Click a hidden conversation to show it; click the one you're in again to hide or show the others.
   focus  - only the one you're in, and the focus follows you as you open other conversations */
const VIS_LABEL={select:'Selection', focus:'Focus'};
const VIS_HINT={select:'Click a hidden chat to show it. Click the one you\u2019re in again to hide or show the others.', focus:'Only the chat you\u2019re in. Open another and it takes its place.'};
const visMode = () => (S && S.vis==='focus') ? 'focus' : 'select';
function applyVis(){
  const m=visMode(); if(m!=='focus' || !S.convs) return;
  let keep=null;
  if(m==='focus'){ keep=lastConvKey(); if(keep==null){ const r=orderedRoots().find(x=>!isHidden(x)) || orderedRoots()[0]; keep=r ? convKey(r) : null; } }
  for(const r of orderedRoots()){ const k=convKey(r); setOff(k, k!==keep); }
}
function setVisMode(m){
  if(m==='focus' && !orderedRoots().length) return;
  if(m==='focus') pickingRows=false;
  const msg = m==='focus' ? 'Focus is on the chat you\u2019re in' : 'Left focus. Showing all chats';
  /* leaving focus brings everything back */
  morphTools(()=>commit(msg, ()=>{ S.vis=m; if(m==='focus') applyVis(); else for(const r of orderedRoots()) setOff(convKey(r), false); }, {touch:false, hidden:true, swap:true}), {fade:false});
}
/* nothing selected: just read the tree, with no tool panel or input box open */
function deselect(){
  if(sel==null) return;
  const prevSel=sel;
  sel=null; renaming=false; editingNow=false;
  save(); animRender([prevSel], true);
}
