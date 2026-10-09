/* Toasts (the short messages at the bottom), and the Preview and Copy buttons on code blocks. */

/* toast */
let toastTimer, toastAction=null;
function toast(msg, withUndo, action){
  const r=document.getElementById('toastRoot');
  toastAction = action || null;
  r.innerHTML=`<div class="toast"><span>${esc(msg)}</span>${action?`<button id="toastAct">${esc(action.label)}</button>`:''}${withUndo?'<button id="toastUndo">Undo</button>':''}</div>`;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>r.innerHTML='', action?6000:3800);
}
document.addEventListener('click', e=>{ const b=e.target.closest('[data-opengrid]'); if(b){ e.stopPropagation(); openGrid(b.dataset.opengrid); } }, true);
document.addEventListener('click', e=>{ const b=e.target.closest('[data-toolsmenu]'); if(b){ e.stopPropagation(); toolsMenu(b); } }, true);
/* a code block's Preview button, wherever the block is */
document.addEventListener('click', e=>{
  const b=e.target.closest('[data-previewcode]'); if(!b) return;
  e.stopPropagation();
  const code=b.closest('.codewrap').querySelector('pre code').textContent;
  const r=b.closest('.reply[data-key^="r"]'), from=r ? +r.dataset.key.slice(1) : null;
  openPreview(b.dataset.previewcode, code, Number.isFinite(from) ? from : null);
}, true);
fviewEl.addEventListener('click', e=>{
  const fv=fileView; if(!fv || !fv.art) return;
  const c=q=>e.target.closest(q);
  const m=c('[data-pvmode]'); if(m){ fv.mode=m.dataset.pvmode; paintPreview(); return; }
  if(c('[data-pvcopy]')){ copyText(fv.art.code, true).then(ok=>{ if(ok) toast('Copied.'); }); return; }
  if(c('[data-pvreload]')){ paintPreview(); return; }
  if(c('[data-pvdownload]')){ const a=fv.art, url=URL.createObjectURL(new Blob([a.code], {type:'text/plain'})), l=document.createElement('a'); l.href=url; l.download=a.title || `preview${a.from!=null?'-'+a.from:''}.${PREVIEW_EXT[a.kind]||'txt'}`; l.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); return; }
}, true);
/* a code block's Copy button, wherever the block is (a reply, Compare) */
document.addEventListener('click', async e=>{
  const b=e.target.closest('[data-copycode]'); if(!b) return;
  e.stopPropagation();
  const code=b.closest('.codewrap').querySelector('pre code');
  if(await copyText(code.textContent, true)){ b.textContent='Copied'; b.classList.add('done'); clearTimeout(b._t); b._t=setTimeout(()=>{ b.textContent='Copy'; b.classList.remove('done'); }, 1600); }
}, true);
