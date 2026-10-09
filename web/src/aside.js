/* The right-hand column: its height and place under the top bar. */

const asideEl=document.querySelector('aside');
asideEl.addEventListener('toggle', e=>{ const d=e.target, k=d.dataset && d.dataset.openkey; if(k && (opts.open[k] ?? null)!==d.open){ opts.open[k]=d.open; save(); } }, true);
/* The right column sticks under the top bar and scrolls on its own. Its height has to fit between where it
   starts and the bottom of the window. It is worked out when the window or the page changes size, never while
   scrolling: changing its height on every scroll frame (and on macOS, during the bounce past the top or end of
   the page) makes the page lay out again mid-scroll, which shows as jitter. */
let asideFrame=0, asideMax=-1, composerH=0;
function placeAside(){
  if(asideFrame) return;
  asideFrame=requestAnimationFrame(()=>{
    asideFrame=0;
    const c=opts.simple && document.querySelector('.shell.simple .simpleops');
    if(c){ const h=c.offsetHeight; if(h!==composerH){ composerH=h; document.documentElement.style.setProperty('--composerH', h+'px'); } }
    const a=document.querySelector('aside'); if(!a) return;
    if(getComputedStyle(a).position!=='sticky'){ if(asideMax!==-1){ a.style.maxHeight=''; asideMax=-1; } return; }
    /* where it would be with the page at the top, less however far the page is scrolled (the bounce past either
       end counts as no scroll) */
    const de=document.documentElement, sy=Math.min(Math.max(scrollY,0), Math.max(0, de.scrollHeight-innerHeight));
    const top=Math.max(a.getBoundingClientRect().top+scrollY-sy, barBottom()+12), mh=Math.max(200, Math.floor(innerHeight-top-12));
    if(mh!==asideMax){ asideMax=mh; a.style.maxHeight=mh+'px'; }
  });
}
window.addEventListener('resize', placeAside);
if(typeof ResizeObserver!=='undefined') new ResizeObserver(placeAside).observe(document.querySelector('.app') || document.body);
