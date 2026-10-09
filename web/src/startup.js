/* Starting the page: the top bar, then loading everything and drawing it. */

const topbarEl=document.getElementById('topbar');
/* the top bar's real height, for what sits under it (the side column, scrolling to a prompt): it changes with zoom and
   text size */
const setBarH=()=>{ const h=topbarEl.offsetHeight; if(h) document.documentElement.style.setProperty('--barH', h+'px'); };
setBarH(); if(typeof ResizeObserver!=='undefined') new ResizeObserver(setBarH).observe(topbarEl);
let wasScrolled=null;
const onScroll=()=>{ const on=window.scrollY>4; if(on!==wasScrolled){ wasScrolled=on; topbarEl.classList.toggle('scrolled', on); } };
window.addEventListener('scroll', onScroll, {passive:true});
Files.init().then(()=>{
  render(true);
  /* a note from the unlock screen (the key couldn't be kept in the keychain, say) */
  try{ const w=sessionStorage.getItem('treechats-warning'); if(w){ sessionStorage.removeItem('treechats-warning'); toast(w, false, {label:'Open settings', fn:()=>openSettings('privacy')}); } }catch(e){}
});
load(); Sync.init(); applyAppearance(); applyLayout(); applySimple(); renderOpsCard();
render(true); onScroll(); placeAside(); connectModel(); Agent.connect();
