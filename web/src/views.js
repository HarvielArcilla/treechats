/* Groups (saved sets of chats to show), picking chats, and showing or hiding them. */

/* ---- Groups: a saved, named set of conversations to show, like a tab group. One click brings them back ---- */
let renamingView=null;
const shownKeys = () => orderedRoots().filter(r=>!isHidden(r)).map(convKey);
function viewIsActive(v){ const a=new Set(shownKeys()); return v.keys.length===a.size && v.keys.every(k=>a.has(k)); }
function viewsHTML(){
  const vs=S.views||[];
  const chips=vs.map(v=> renamingView===v.id
    ? `<input class="viewinput" id="vname-${v.id}" data-viewname="${v.id}" value="${esc(v.name)}" maxlength="40" aria-label="Group name">`
    : `<button class="chip" data-view="${v.id}" aria-pressed="${viewIsActive(v)}" title="${viewIsActive(v)?'Showing this group. Click again for options.':'Show '+v.keys.length+' chat'+(v.keys.length===1?'':'s')}">${esc(v.name)}</button>`).join('');
  return `<div class="views"><span class="vislabel">Groups</span>${chips}<button class="chip add" data-view="save" title="Save the chats shown now as a group">+ Save as group</button></div>`;
}
function saveView(){
  const keys=shownKeys(); if(!keys.length){ toast('Show at least one chat first.'); return; }
  const used=new Set((S.views||[]).map(v=>v.name)); let k=(S.views||[]).length+1; while(used.has(`Group ${k}`)) k++;
  const name = keys.length===1 ? clip(convTitle(vRoots().find(r=>convKey(r)===keys[0])), 24) : `Group ${k}`;
  commit(`Saved “${name}”. Click it any time to show those ${keys.length} chat${keys.length===1?'':'s'} again.`, ()=>{
    S.nextView=(S.nextView||0)+1; S.views.push({id:'v'+S.nextView, name: used.has(name) ? `Group ${k}` : name, keys});
  }, {touch:false});
}
function applyView(v){
  const set=new Set(v.keys);
  commit(`Showing “${v.name}”`, ()=>{ S.vis='select'; for(const r of orderedRoots()){ const k=convKey(r); setOff(k, !set.has(k)); } }, {touch:false, hidden:true});
}
function viewMenu(anchor, v){
  openMenu(anchor, [
    {label:'Rename', run:()=>{ renamingView=v.id; renderConvs(); }},
    {label:'Update to what\u2019s shown now', run:()=>{ const keys=shownKeys(); if(!keys.length){ toast('Show at least one chat first.'); return; } commit(`Updated “${v.name}”`, ()=>{ S.views.find(x=>x.id===v.id).keys=keys; }, {touch:false}); }},
    {sep:true},
    {label:'Delete group', danger:true, run:()=>commit(`Deleted group “${v.name}”`, ()=>{ S.views=S.views.filter(x=>x.id!==v.id); }, {touch:false})}
  ]);
}
function renameView(id, name){
  renamingView=null; name=(name||'').trim().slice(0,40);
  const v=(S.views||[]).find(x=>x.id===id);
  if(!v || !name || name===v.name){ renderConvs(); return; }
  commit(`Renamed group to “${name}”`, ()=>{ S.views.find(x=>x.id===id).name=name; }, {touch:false});
}
function setPickingRows(on){
  pickingRows=on;
  const btn=document.querySelector('#cvTools [data-pick="toggle"]'), hint=document.querySelector('#cvTools .vishint');
  if(btn){ btn.setAttribute('aria-pressed', on); btn.textContent = on ? 'Done' : 'Select…'; btn.title = on ? 'Stop selecting' : 'Click chats in the list to show or hide them'; btn.blur(); }
  if(hint){
    const h0=hint.getBoundingClientRect().height;
    hint.textContent = on ? 'Click chats to show or hide them. Press Done when you\u2019re finished.' : VIS_HINT[visMode()];
    const h1=hint.getBoundingClientRect().height;
    if(!Motion.reduced()){ hint.animate([{opacity:.25},{opacity:1}], {duration:180, easing:'ease-out'}); if(Math.abs(h1-h0)>1) hint.animate([{height:h0+'px', overflow:'hidden'},{height:h1+'px', overflow:'hidden'}], {duration:200, easing:'cubic-bezier(.2,.75,.2,1)'}); }
  }
  convListEl.classList.toggle('choosing', on);
  for(const b of convListEl.querySelectorAll('[data-openconv]')){
    const li=b.closest('.cv'), off=li.classList.contains('off');
    if(on){ li.classList.remove('cur'); b.removeAttribute('aria-current'); b.setAttribute('aria-pressed', !off); b.title = off ? 'Hidden. Click to show it.' : 'Shown. Click to hide it.'; }
  }
  if(!on) renderConvs();
}
function pickToggle(k){
  const r=vRoots().find(x=>convKey(x)===k); if(!r) return;
  if(visMode()==='focus') S.vis='select';
  const hide=!isHidden(r);
  commit(`${hide?'Hid':'Showing'} “${clip(convTitle(r),40)}”`, ()=>setOff(k, hide), {touch:false, hidden:true});
}
/* entering or leaving a list mode: the tools area grows or shrinks smoothly, its contents fade in, and the rows below glide */
let morphingTools=false;
function morphTools(update, o={}){
  const el=document.getElementById('cvTools');
  if(Motion.reduced()){ update(); return; }
  const h0=el.getBoundingClientRect().height;
  const pill0=el.querySelector('.vmpill'), p0=pill0 ? pill0.getBoundingClientRect().left : null;
  /* only the panel's height animates; the rows below simply follow it, so nothing moves twice (the list's own
     animation is held off while this runs) */
  morphingTools=true; try{ update(); } finally{ morphingTools=false; }
  const h1=el.getBoundingClientRect().height;
  const pill1=el.querySelector('.vmpill');
  if(pill1 && p0!=null){ const dx=p0-pill1.getBoundingClientRect().left; if(Math.abs(dx)>.5) pill1.animate([{transform:`translateX(${dx}px)`},{transform:'none'}], {duration:260, easing:'cubic-bezier(.2,.75,.2,1)'}); }
  if(Math.abs(h1-h0)>1) el.animate([{height:h0+'px', overflow:'hidden'},{height:h1+'px', overflow:'hidden'}], {duration:260, easing:'cubic-bezier(.2,.75,.2,1)'});
  if(o.fade===false){
    /* same panel, new state: only the parts that changed fade, and the switch's highlight slides */
    for(const c of el.querySelectorAll('.vishint, .pickacts')) c.animate([{opacity:0},{opacity:1}], {duration:200, easing:'ease-out'});
    return;
  }
  [...el.children].forEach((c,i)=>c.animate([{opacity:0, transform:'translateY(-4px)'},{opacity:1, transform:'none'}], {duration:200, delay:70+i*30, easing:'ease-out', fill:'backwards'}));
}
function startChoosing(){ selecting=false; checked.clear(); choosing=JSON.stringify(S); morphTools(renderConvs); }
function setOff(k, off){ S.convs[k]=Object.assign(S.convs[k]||{}); if(off) S.convs[k].hidden=true; else delete S.convs[k].hidden; }
/* the conversation you're working in: the selected one, or the last one you had selected */
let lastConv=null;
function lastConvKey(){ const k=convKeyOf(sel); if(k!=null) return k; return lastConv!=null && vRoots().some(r=>convKey(r)===lastConv) ? lastConv : null; }
function chooseApply(fn){
  const before=JSON.stringify(S.convs);
  fn();
  if(JSON.stringify(S.convs)===before){ toast('Already that way'); return; }
  if(sel!=null && S.nodes[sel] && isHidden(S.nodes[chain(sel)[0]])) sel=null;
  save(); Motion.run(treeEl, ()=>render(true), []);
}
function finishChoosing(apply){
  if(choosing==null) return;
  const before=choosing; choosing=null;
  if(!apply){ S=JSON.parse(before); DB.spaces[DB.current].tree=S; if(sel!=null && !S.nodes[sel]) sel=defaultSel(); save(); morphTools(()=>Motion.run(treeEl, ()=>render(true), [])); return; }
  if(JSON.stringify(S)!==before){ pushUndo({kind:'tree', sid:DB.current, s:before}); toast('Updated which chats are hidden', true); }
  save(); morphTools(()=>Motion.run(treeEl, ()=>render(true), []));
}
function chooseAction(a){
  const roots=orderedRoots(), q=convFilterEl.value.trim().toLowerCase(), cur=lastConvKey();
  if(a==='start'){ startChoosing(); return; }
  if(a==='current' && cur==null){ toast('Select a prompt in a chat first'); return; }
  if(a==='done'){ finishChoosing(true); return; }
  if(a==='cancel'){ finishChoosing(false); return; }
  chooseApply(()=>{
    for(const r of roots){
      const k=convKey(r), on=!isHidden(r);
      if(a==='all') setOff(k, false);
      if(a==='none') setOff(k, true);
      if(a==='invert') setOff(k, on);
      if(a==='matches') setOff(k, !convTitle(r).toLowerCase().includes(q));
      if(a==='current') setOff(k, k!==cur);
    }
  });
}
function setHidden(keys, hidden, then){
  const names=keys.map(k=>{ const r=vRoots().find(x=>convKey(x)===k); return r ? convTitle(r) : ''; });
  const msg = keys.length===1 ? `${hidden?'Hid':'Showing'} “${clip(names[0],40)}”` : `${hidden?'Hid':'Showing'} ${keys.length} chats`;
  commit(msg, ()=>{ for(const k of keys) S.convs[k]=Object.assign(S.convs[k]||{}, {hidden}); for(const k of keys) if(!hidden) delete S.convs[k].hidden; }, {touch:false, hidden:true});
  if(then) then();
}
function showOnly(keys){
  const set=new Set(keys), roots=orderedRoots();
  if(roots.every(r=>isHidden(r)!==set.has(convKey(r)))){ toast(keys.length===1 ? 'The other chats are already hidden' : 'Already showing just those'); return; }
  commit(keys.length===1 ? 'Hid all other chats' : `Hid all but ${keys.length} chats`, ()=>{
    for(const r of roots){ const k=convKey(r); S.convs[k]=Object.assign(S.convs[k]||{}, {hidden:!set.has(k)}); if(set.has(k)) delete S.convs[k].hidden; }
  }, {touch:false, hidden:true, swap:true});
}
function showAll(){ if(visMode()==='focus'){ setVisMode('select'); return; }
  const keys=orderedRoots().filter(isHidden).map(convKey); if(!keys.length){ toast('All chats are already shown'); return; }
  commit('Showing all chats', ()=>{ for(const k of keys) delete S.convs[k].hidden; }, {touch:false, swap:true});
}
