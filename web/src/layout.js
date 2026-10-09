/* The layout: drawers on narrow screens, and switching between Chat and Editor while keeping your place. */

/* ---- sidebar ---- */
const shellEl=document.getElementById('shell'), scrimEl=document.getElementById('scrim');
const narrow = () => window.matchMedia('(max-width:1099px)').matches;
/* docked panels collapse on wide screens; on narrow screens they are drawers */
function applySimple(){
  shellEl.classList.toggle('simple', !!opts.simple);
  document.getElementById('viewSw').dataset.view = opts.simple ? 'chat' : 'editor';
  for(const b of document.querySelectorAll('[data-viewsw]')) b.setAttribute('aria-checked', (b.dataset.viewsw==='chat')===!!opts.simple);
}
function applyLayout(){
  shellEl.classList.toggle('hide-spaces', !!opts.collapsed.spaces);
  shellEl.classList.toggle('hide-convs', !!opts.collapsed.convs);
}
function openDrawer(which){ closeDrawers(); shellEl.classList.add('open-'+which); scrimEl.hidden=false; const p=document.getElementById(which==='spaces'?'side':'convs'); setTimeout(()=>{ const f=p.querySelector('[aria-current], button'); if(f) f.focus({preventScroll:true}); }, 30); }
function closeDrawers(){ shellEl.classList.remove('open-spaces','open-convs'); scrimEl.hidden=true; }
const closeSide = closeDrawers;
function showPanel(which){ if(narrow()){ openDrawer(which); return; } opts.collapsed[which]=false; applyLayout(); save(); }
function hidePanel(which){ if(narrow()){ closeDrawers(); return; } opts.collapsed[which]=true; applyLayout(); save(); }
document.getElementById('spacesBtn').onclick=()=>showPanel('spaces');
/* Switching layouts (Chat and Editor, Selection and Focus) changes nearly everything on the page. Flying every element
   between two unrelated layouts would be noise, so what you were reading stays at the same height on screen and glides
   into its new place, while everything around it fades in. What you were reading is the selected prompt if it's on
   screen, else the prompt or reply at the reading line, a third of the way down the window: in Chat view that's
   usually the middle of a long reply, with no prompt on screen at all. */
/* where the page starts below the top bar, measured: its height changes with the browser's zoom and text size */
const barBottom=()=>{ const b=document.getElementById('topbar'); return b ? Math.max(0, b.getBoundingClientRect().bottom) : 66; };
const readLine=()=>{ const t=barBottom(); return t+(innerHeight-t)*0.3; };
function viewAnchor(){
  const top=barBottom(), vis=r=>r.bottom>top+4 && r.top<innerHeight;
  const s=sel!=null && treeEl.querySelector(`.row[data-id="${sel}"]`);
  if(s && vis(s.getBoundingClientRect())) return {el:s, id:sel, reply:false};
  const all=[...treeEl.querySelectorAll('.row[data-id], .reply[data-key^="r"]')].filter(el=>!el.closest('.mergebox'));
  const y=readLine(); let first=null;
  for(const el of all){
    const r=el.getBoundingClientRect(); if(!vis(r)) continue;
    const reply=el.classList.contains('reply'), id=+(reply ? el.dataset.key.slice(1) : el.dataset.id);
    if(!S.nodes[id]) continue;
    const a={el, id, reply};
    if(r.top<=y && r.bottom>=y) return a;
    if(!first) first=a;
  }
  return first;
}
/* For a moment after a switch, the page stays where the switch put it unless you scroll it yourself: a browser can
   still scroll on its own a frame or two later (Safari revealing a focused field, say), which lands you somewhere else
   with the glide happening off screen. */
function holdScroll(ms){
  const y=scrollY, until=performance.now()+ms; let done=false;
  const stop=()=>{ if(done) return; done=true; removeEventListener('scroll', onS); removeEventListener('wheel', onWheel, true); for(const t of ['touchstart','keydown','pointerdown']) removeEventListener(t, stop, true); anchorsOff(false); };
  const onS=()=>{ if(performance.now()>until){ stop(); return; } if(Math.abs(scrollY-y)>1) window.scrollTo(scrollX, y); };
  /* a trackpad sends wheel events with no movement when fingers just rest on it */
  const onWheel=e=>{ if(e.deltaY || e.deltaX) stop(); };
  addEventListener('scroll', onS, {passive:true});
  addEventListener('wheel', onWheel, {capture:true, passive:true});
  for(const t of ['touchstart','keydown','pointerdown']) addEventListener(t, stop, {capture:true, passive:true});
  setTimeout(stop, ms+20);
}
/* the browser's own keeping-the-page-still is off while a switch places the page itself: it would otherwise pick
   something on the old page to hold still, and move the new one to match */
function anchorsOff(on){ document.documentElement.style.overflowAnchor = on ? 'none' : ''; }
/* Moves the page by dy, as an absolute scroll: in Safari, a relative scroll (scrollBy) on a zoomed-out page moves it
   further than asked (twice as far at 50%), though the page reports the distance it asked for. */
function scrollByY(dy){ window.scrollTo(scrollX, scrollY+dy); }
function swapView(update, anchor=viewAnchor()){
  const id=anchor ? anchor.id : null, r0=anchor ? anchor.el.getBoundingClientRect() : null;
  anchorsOff(true);
  update();
  /* the same reply if it's shown in full, else its prompt */
  let b=null, want=null;
  if(id!=null && anchor.reply){
    const rep=treeEl.querySelector(`.reply[data-key="r${id}"]`);
    if(rep && !rep.classList.contains('clamp')){ b=rep; const y=readLine(), frac=r0.height ? Math.min(1, Math.max(0, (y-r0.top)/r0.height)) : 0; want=()=>y-frac*b.getBoundingClientRect().height; }
  }
  if(id!=null && !b){ b=treeEl.querySelector(`.row[data-id="${id}"]`); want=()=>Math.max(barBottom()+12, anchor.reply ? Math.min(r0.top, readLine()) : r0.top); }
  /* chats render lazily with an estimated height; lay out the anchor's chat and the ones above it for real, or the
     anchor moves once the browser gets to them */
  const sec0=b && b.closest('section.conv');
  for(let sec=sec0; sec; sec=sec.previousElementSibling) if(sec.matches('section.conv')) sec.style.contentVisibility='visible';
  if(b) scrollByY(b.getBoundingClientRect().top-want());
  if(b) holdScroll(500); else setTimeout(()=>anchorsOff(false), 500);
  /* and the chats below it that are on screen now, so they're there at once instead of a frame or two later */
  for(let sec=sec0 && sec0.nextElementSibling; sec && sec.getBoundingClientRect().top<innerHeight; sec=sec.nextElementSibling) if(sec.matches('section.conv')) sec.style.contentVisibility='visible';
  if(!b) for(const sec of treeEl.querySelectorAll('section.conv')){ const r=sec.getBoundingClientRect(); if(r.bottom>0 && r.top<innerHeight) sec.style.contentVisibility='visible'; }
  /* a prompt glides from where it was; from a reply, only sideways, so the line you were reading stays put */
  const glideFrom=!b ? null : anchor.reply ? {left:r0.left, top:b.getBoundingClientRect().top} : r0;
  if(Motion.reduced()) return !!b;
  const ease='cubic-bezier(.2,.75,.2,1)', moving=new Set();
  const glide=(el, was)=>{ if(!el || !was) return; const r=el.getBoundingClientRect(), dx=was.left-r.left, dy=was.top-r.top;
    moving.add(el); if(Math.abs(dx)>.5 || Math.abs(dy)>.5) el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}], {duration:300, easing:ease}); };
  glide(b, glideFrom);
  /* the column clips while it glides, so it never slides across the inspector */
  if(moving.size){ treeEl.style.overflowX='clip'; clearTimeout(swapView.t); swapView.t=setTimeout(()=>{ treeEl.style.overflowX=''; }, 320); }
  /* everything else on screen fades in; only blocks near the viewport, so a long chat stays cheap */
  const near=r=>r.bottom>-60 && r.top<innerHeight+60, fade={duration:220, easing:ease};
  for(const el of treeEl.querySelectorAll('.chathead, .convHead, .row, .reply, .uacts, .pacts, .ractrow, .foldnote, .ops, .simpleops, .mergebox, .composer, .seam')){
    if(moving.has(el) || [...moving].some(m=>el.contains(m)) || (el.parentElement && el.parentElement.closest('.mergebox')) || !near(el.getBoundingClientRect())) continue;
    el.animate([{opacity:0},{opacity:1}], fade);
  }
  const aside=document.querySelector('aside'); if(aside && aside.offsetParent) aside.animate([{opacity:0},{opacity:1}], fade);
  return !!b;
}
/* Chat view → Editor on one message: that prompt is selected and stays where it is on screen, with the line you were
   reading kept as the active one */
function openInEditor(id){
  if(!S.nodes[id]) return;
  if(simpleTip!=null && S.nodes[simpleTip] && path(simpleTip).includes(id)) setActivePath(simpleTip);
  sel=id; composeFor=null; syncHead(); save();
  setView(false);
}
function setView(chat){
  if(!!opts.simple===chat) return;
  /* a field in one view isn't the same field in the other (Chat's input box and Editor's share an id), so focus doesn't
     carry over. Safari leaves focus in the field when you click the switch, and putting it back in the other view's
     box scrolled the page to that box. */
  const fa=document.activeElement; if(fa && fa!==document.body && treeEl.contains(fa)) fa.blur();
  const anchor=viewAnchor();
  /* Chat view → Editor: the message you were reading is the one selected there, on the line you were reading */
  if(!chat && anchor && anchor.id!==sel && composeFor!=='root'){
    if(simpleTip!=null && S.nodes[simpleTip] && path(simpleTip).includes(anchor.id)) setActivePath(simpleTip);
    sel=anchor.id; composeFor=null; syncHead();
  }
  opts.simple=chat; simpleTip=null; pick=null;
  applyAppearance();
  if(chat) pickingRows=false;
  /* Back to Editor: the chat you were in is always on the page. In Selection it's shown; in Focus, the focus moves to
     it. (Chat view goes to any chat without changing which are hidden, so this is where it catches up.) */
  else if(composeFor!=='root'){
    const k=convKeyOf(sel);
    if(k!=null){
      lastConv=k;
      if(isArchived(S.nodes[chain(sel)[0]])){ delete S.convs[k].archived; toast(`“${clip(convTitle(S.nodes[chain(sel)[0]]),40)}” is back in your chats`); }
      if(visMode()==='focus') applyVis(); else setOff(k, false);
    }
  }
  save();
  const kept=swapView(()=>{ applySimple(); render(true); }, anchor);
  if(opts.simple && !kept) scrollThreadEnd();
}
document.getElementById('viewSw').addEventListener('click', e=>{ const b=e.target.closest('[data-viewsw]'); if(b) setView(b.dataset.viewsw==='chat'); });
document.getElementById('viewSw').addEventListener('keydown', e=>{ if(['ArrowLeft','ArrowRight'].includes(e.key)){ e.preventDefault(); setView(e.key==='ArrowRight'); const b=document.querySelector(`[data-viewsw="${opts.simple?'chat':'editor'}"]`); if(b) b.focus(); } });
document.getElementById('convsBtn').onclick=()=>showPanel('convs');
for(const b of document.querySelectorAll('[data-panelclose]')) b.onclick=()=>hidePanel(b.dataset.panelclose);
scrimEl.onclick=closeDrawers;
document.getElementById('newSpaceBtn').onclick=()=>{ closeSide(); createSpace(); };
document.getElementById('newConvSide').onclick=startNewConversation;
convFilterEl.addEventListener('input', ()=>renderConvs());
convFilterEl.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ if(convFilterEl.value){ e.preventDefault(); e.stopPropagation(); convFilterEl.value=''; renderConvs(); } else convFilterEl.blur(); }
  if(e.key==='Enter'){ e.preventDefault(); const h=convListEl.querySelector('[data-hit]'), c=convListEl.querySelector('[data-openconv]'); if(h) gotoNode(+h.dataset.hit); else if(c) openConv(+c.dataset.openconv); }
});
convListEl.addEventListener('click', e=>{
  const m=e.target.closest('[data-cvmenu]'); if(m){ convMenu(m, +m.dataset.cvmenu, true); return; }
  const t=e.target.closest('[data-toggleconv]'); if(t){ const k=+t.dataset.toggleconv, r=vRoots().find(x=>convKey(x)===k); chooseApply(()=>setOff(k, !isHidden(r))); return; }
  const hb=e.target.closest('[data-hit]'); if(hb){ gotoNode(+hb.dataset.hit); return; }
  const o=e.target.closest('[data-openconv]'); if(o){ if(pickingRows) pickToggle(+o.dataset.openconv); else openConv(+o.dataset.openconv); }
});
document.getElementById('cvBar').addEventListener('click', e=>{
  const v=e.target.closest('[data-cvviewmenu]'); if(v){ viewMenu2(v); return; }
  const so=e.target.closest('[data-cvsort]'); if(so){ sortMenu(so); return; }
});
treeEl.addEventListener('click', e=>{ const u=e.target.closest('[data-unarchive]'); if(u) setArchived(+u.dataset.unarchive, false); });
