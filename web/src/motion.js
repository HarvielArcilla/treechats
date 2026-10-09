/* Animations: rows gliding to their new places when the tree changes. */

/* ---- Motion ----
   The tree is rebuilt from state on every change, so transitions use FLIP: measure keyed elements,
   rebuild, then animate each one from where it was. Only standard Web Animations, no library and
   nothing specific to this host, so it carries over unchanged to a locally served build. */
const Motion = (()=>{
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : {matches:false};
  const can = typeof Element!=='undefined' && typeof Element.prototype.animate==='function';
  const EASE='cubic-bezier(.2,.75,.2,1)', MOVE=260, ENTER=220;
  const reduced = () => mq.matches || !can || document.documentElement.classList.contains('motion-off');
  function run(root, update, anchors=[]){
    if(reduced()){ update(); return; }
    const before=new Map(), looks=new Map(), marks=new Map(), vh=innerHeight, near=r=>r.bottom>-120 && r.top<vh+120;
    const keyed=root.querySelectorAll('[data-key]');
    /* a large page would animate hundreds of off-screen elements; only what you can see moves */
    /* conversations far off screen are skipped entirely, so the browser doesn't have to lay them out */
    const secNear=new Map(), isNearSec=el=>{ const sec=el.closest('section.conv'); if(!sec) return true; if(!secNear.has(sec)) secNear.set(sec, near(sec.getBoundingClientRect())); return secNear.get(sec); };
    for(const el of keyed){ if(el.matches('section.conv') || isNearSec(el)) before.set(el.dataset.key, el.getBoundingClientRect()); }
    for(const el of root.querySelectorAll('.row[data-id]')){ const li=el.closest('[data-key]'), r=li && before.get(li.dataset.key); if(!r || !near(r)) continue; const cs=getComputedStyle(el); looks.set(el.dataset.id, [cs.backgroundColor, cs.borderColor]); }
    for(const a of anchors){ if(a==null) continue; const el=root.querySelector(`.row[data-id="${a}"]`); if(el && !looks.has(String(a))){ const cs=getComputedStyle(el); looks.set(String(a), [cs.backgroundColor, cs.borderColor]); } }
    for(const a of anchors){ if(a==null) continue; const el=root.querySelector(`.row[data-id="${a}"]`); if(el) marks.set(String(a), el.getBoundingClientRect().top); }
    update();
    /* keep the row you acted on where it was, so the page doesn't shift under the pointer */
    for(const a of anchors){
      if(a==null || !marks.has(String(a))) continue;
      const el=root.querySelector(`.row[data-id="${a}"]`); if(!el) continue;
      const dy=el.getBoundingClientRect().top-marks.get(String(a)); if(Math.abs(dy)>1) scrollByY(dy);
      break;
    }
    const els=[...root.querySelectorAll('[data-key]')], delta=new Map(), seen=new Set(); secNear.clear();
    for(const el of els){ if(!el.matches('section.conv') && !isNearSec(el)) continue; const b=before.get(el.dataset.key), r=el.getBoundingClientRect(); if(near(r) || (b && near(b))) seen.add(el); if(!b) continue; delta.set(el, [b.left-r.left, b.top-r.top]); }
    for(const el of els){
      if(!seen.has(el)) continue;
      if(el.parentElement && el.parentElement.closest('[data-entering]')) continue;
      const d=delta.get(el);
      if(!d){ enter(el); continue; }
      let [dx,dy]=d;
      for(let p=el.parentElement; p && p!==root; p=p.parentElement){ const pd=delta.get(p); if(pd){ dx-=pd[0]; dy-=pd[1]; break; } }
      if(Math.abs(dx)<.5 && Math.abs(dy)<.5) continue;
      el.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}], {duration:MOVE, easing:EASE});
    }
    /* the selection highlight eases between rows instead of snapping */
    for(const id of looks.keys()){
      const el=root.querySelector(`.row[data-id="${id}"]`); if(!el) continue;
      const was=looks.get(id);
      const cs=getComputedStyle(el);
      if(was[0]!==cs.backgroundColor || was[1]!==cs.borderColor)
        el.animate([{backgroundColor:was[0], borderColor:was[1]},{backgroundColor:cs.backgroundColor, borderColor:cs.borderColor}], {duration:MOVE, easing:EASE});
    }
  }
  function enter(el){
    el.dataset.entering='';
    const a=el.animate([{opacity:0, transform:'translateY(-6px)', clipPath:'inset(0 0 100% 0)'},{opacity:1, transform:'none', clipPath:'inset(0 0 0 0)'}], {duration:ENTER, easing:EASE});
    const done=()=>{ delete el.dataset.entering; }; a.onfinish=done; a.oncancel=done;
  }
  function fade(el){ if(reduced()) return; el.animate([{opacity:.3},{opacity:1}], {duration:180, easing:EASE}); }
  function swap(el){ if(reduced()) return; el.animate([{opacity:0, transform:'translateY(8px)'},{opacity:1, transform:'none'}], {duration:240, easing:EASE}); }
  return {run, fade, swap, reduced};
})();

/* rendering */
const treeEl=document.getElementById('tree');
