/* Menus. */

/* ---- menus ---- */
let menuEl=null, menuAnchor=null;
function closeMenu(refocus){
  if(!menuEl) return;
  menuEl.remove(); menuEl=null;
  if(menuAnchor){ menuAnchor.setAttribute('aria-expanded','false'); if(refocus) menuAnchor.focus({preventScroll:true}); }
  menuAnchor=null;
}
function openMenu(anchor, items){
  closeMenu();
  menuAnchor=anchor; anchor.setAttribute('aria-expanded','true');
  menuEl=document.createElement('div'); menuEl.className='menu'; menuEl.setAttribute('role','menu');
  for(const it of items){
    if(it.sep){ menuEl.append(document.createElement('hr')); continue; }
    if(it.heading){ const h=document.createElement('div'); h.className='mh'; h.textContent=it.heading; menuEl.append(h); continue; }
    const b=document.createElement('button'); b.setAttribute('role', it.checked!=null ? 'menuitemradio' : 'menuitem'); b.textContent=it.label;
    if(it.checked!=null){ b.setAttribute('aria-checked', String(!!it.checked)); b.classList.add('radio'); }
    /* a second line under the label */
    if(it.note){ const sm=document.createElement('small'); sm.textContent=it.note; b.append(sm); b.classList.add('two'); }
    if(it.danger) b.className='danger';
    if(it.disabled) b.disabled=true;
    if(it.sub){ b.textContent=it.label+'  ›'; b.setAttribute('aria-haspopup','menu'); b.onclick=()=>openMenu(anchor, [{label:'‹ Back', run:()=>openMenu(anchor, items)}, {heading:it.label}, ...it.sub()]); menuEl.append(b); continue; }
    b.onclick=()=>{ closeMenu(); it.run(); };
    menuEl.append(b);
  }
  document.body.append(menuEl);
  const r=anchor.getBoundingClientRect(), m=menuEl.getBoundingClientRect();
  const left=Math.max(8, Math.min(r.left, innerWidth-m.width-8));
  const below=r.bottom+4, top = below+m.height>innerHeight-8 ? Math.max(8, r.top-4-m.height) : below;
  menuEl.style.left=left+'px'; menuEl.style.top=top+'px';
  if(!Motion.reduced()) menuEl.animate([{opacity:0, transform:'translateY(-4px)'},{opacity:1, transform:'none'}], {duration:140, easing:'ease-out'});
  const first=menuEl.querySelector('button:not(:disabled)'); if(first) first.focus({preventScroll:true});
}
document.addEventListener('pointerdown', e=>{ if(menuEl && !menuEl.contains(e.target) && e.target!==menuAnchor) closeMenu(); }, true);
document.addEventListener('keydown', e=>{
  if(!menuEl) return;
  if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); closeMenu(true); return; }
  if(e.key==='ArrowDown' || e.key==='ArrowUp'){
    e.preventDefault(); e.stopImmediatePropagation();
    const bs=[...menuEl.querySelectorAll('button:not(:disabled)')], i=bs.indexOf(document.activeElement);
    const n=bs[(i + (e.key==='ArrowDown'?1:-1) + bs.length) % bs.length]; if(n) n.focus();
  }
}, true);
window.addEventListener('resize', ()=>closeMenu());
