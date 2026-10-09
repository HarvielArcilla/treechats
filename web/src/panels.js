/* Side panels: project files, import and export. */

/* ---- panels: Space files, Import / export ---- */
const sfEl=()=>document.getElementById('spaceFiles'), ioEl=()=>document.getElementById('ioView');
let panelReturn=null;
function openPanel(el){ panelReturn=document.activeElement; closeMenu && menuEl && closeMenu(); el.hidden=false; document.body.style.overflow='hidden'; const f=el.querySelector('textarea, [data-attachspace], button'); if(f) f.focus({preventScroll:true}); }
function closePanel(el){ el.hidden=true; document.body.style.overflow=''; if(panelReturn && panelReturn.focus && document.contains(panelReturn)) panelReturn.focus({preventScroll:true}); }
function openSpaceFiles(){ renderSpaceFiles(); openPanel(sfEl()); }
function openIo(text){ const t=document.getElementById('ioText'); t.value = text ?? JSON.stringify(S,null,2); openPanel(ioEl()); t.focus({preventScroll:true}); if(text!=null) t.select(); }
for(const el of [sfEl(), ioEl()]) el.addEventListener('click', e=>{ if(e.target===el || e.target.closest('[data-modalclose]')) closePanel(el); });
initExcerpt(); initRequest();
document.getElementById('copyJson').onclick=()=>copyText(JSON.stringify(S,null,2));
document.getElementById('loadJson').onclick=()=>{
  let d; try{ d=JSON.parse(document.getElementById('ioText').value); }catch(e){ toast('That isn’t valid JSON. Paste a tree exported from this page.'); return; }
  if(!valid(d)){ toast('JSON needs a nextId number and nodes with id, parents and text.'); return; }
  withTree(d, migrate);
  if(storeCommit('Imported the pasted JSON as a new project', ()=>{ DB.current=addSpace(uniqueSpaceName('Imported project'), d); })) closePanel(ioEl());
};
document.addEventListener('keydown', e=>{
  if((e.metaKey||e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase()==='k'){ e.preventDefault(); if(palEl().hidden) openPalette(); else closePalette(); return; }
  if(!palEl().hidden){ if(e.key==='Escape') closePalette(); return; }
  if(!impEl().hidden){ if(e.key==='Escape'){ e.preventDefault(); closeImport(); } else if(e.key==='Tab') trapTab(e, impEl()); return; }
  for(const el of [sfEl(), ioEl()]) if(!el.hidden){ if(e.key==='Escape'){ e.preventDefault(); closePanel(el); } else if(e.key==='Tab') trapTab(e, el); return; }
  if(!mapEl().hidden){ if(e.key==='Escape' || (e.key.toLowerCase()==='m' && !e.metaKey && !e.ctrlKey && !e.altKey)){ e.preventDefault(); closeMapView(); } else if(e.key==='Tab') trapTab(e, mapEl()); return; }
  if(!cmpEl().hidden){ if(e.key==='Escape'){ e.preventDefault(); closeCompare(); } else if(e.key==='Tab') trapTab(e, cmpEl()); return; }
  if(!setEl.hidden){ if(e.key==='Escape'){ e.preventDefault(); closeSettings(); } else if(e.key==='Tab') trapTab(e); return; }
  const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(e.target.tagName);
  if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='z' && !typing){ e.preventDefault(); e.shiftKey?redo():undo(); return; }
  /* Esc stops the reply you're looking at, unless you're typing or something else is open to close first */
  if(e.key==='Escape' && !typing && !pick && composeFor==null && !renaming && !variants && !fan && choosing==null && !pickingRows && !shellEl.matches('.open-spaces,.open-convs') && sel!=null && replyBusy(sel)){ stopReply(sel); return; }
  if(e.key==='Escape' && range && !typing){ range=null; animRender([sel]); return; }
  if(e.key==='Escape' && alsoTargets.size && !pick && !typing){ alsoTargets.clear(); keepDraft(()=>animRender([sel])); return; }
  if(e.key==='Escape' && sumGen && !typing){ sumGen.ctl.abort(); return; }
  if(e.key==='Escape' && choosing!=null){ finishChoosing(false); return; }
  if(e.key==='Escape' && pickingRows){ setPickingRows(false); return; }
  if(e.key==='Escape' && shellEl.matches('.open-spaces,.open-convs')){ closeDrawers(); return; }
  if(e.key==='Escape' && variants){ variants=null; animRender([sel]); return; }
  if(e.key==='Escape' && fan){ closeFan(); return; }
  if(e.key==='Escape' && distill && !typing){ closeDistill(); return; }
  if(e.key==='Escape'){ if(pick||composeFor!=null||renaming){ const src=pick&&pick.src; pick=null; composeFor=null; renaming=false; animRender([src, sel]); } else if(typing) e.target.blur(); else if(sel!=null && !opts.simple) deselect(); return; }
  if(!typing && opts.opKeys!==false && e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && /^Key[A-Z]$/.test(e.code)){
    if(e.repeat || pick || sel==null) return;
    const op=Object.keys(OPS).find(k=>OPS[k].key===e.code.slice(3).toLowerCase());
    if(op){ e.preventDefault(); run(op, sel); }
    return;
  }
  if(typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if(e.key==='m' || e.key==='M'){ e.preventDefault(); openMapView(); return; }
  if(e.key==='/'){ e.preventDefault(); if(narrow()) openDrawer('convs'); else if(opts.collapsed.convs){ opts.collapsed.convs=false; applyLayout(); save(); } setTimeout(()=>{ convFilterEl.focus(); convFilterEl.select(); }, narrow()?60:0); return; }
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    const rows=[...treeEl.querySelectorAll('.row')]; if(!rows.length) return;
    e.preventDefault();
    let i=rows.findIndex(r=>+r.dataset.id===sel); i=e.key==='ArrowDown'?Math.min(rows.length-1,i+1):Math.max(0,i-1);
    select(+rows[i].dataset.id); return;
  }
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){ if(sel!=null){ e.preventDefault(); switchVersion(sel, e.key==='ArrowLeft'?-1:1); } return; }
});
const kk=k=>IS_MAC?`⌥⇧${k.toUpperCase()}`:`Alt+Shift+${k.toUpperCase()}`;
