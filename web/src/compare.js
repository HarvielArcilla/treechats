/* Compare: follow-ups side by side. */

/* ---- Compare ----
   The follow-ups to one prompt side by side, with their replies. */
const cmpEl=()=>document.getElementById('compare');
let cmpFor=null, cmpReturn=null, cmpIds=null;
function cmpKids(id){ return Ops.cmpKids(S, id, G); }
/* Compare shows the follow-ups of one prompt, or prompts you picked with Ctrl/⌘-click (cmpIds) */
const cmpList = () => cmpIds ? cmpIds.map(i=>S.nodes[i]).filter(n=>n && n.kind!=='merge') : cmpKids(cmpFor);
const cmpKey = () => cmpIds ? 'p'+cmpIds.join(',') : cmpFor;
/* the deepest prompt every picked one follows: their shared context (null when they're in different chats) */
function sharedParent(ids){ return Ops.sharedParent(S, ids, path); }
const cmpParent = () => cmpIds ? sharedParent(cmpIds) : cmpFor;
function openCompareIds(ids){
  ids=[...new Set(ids)].filter(i=>S.nodes[i] && S.nodes[i].kind!=='merge');
  if(ids.length<2){ toast('Pick two or more prompts to compare.'); return; }
  cmpIds=ids; cmpFor=ids[0]; cmpReturn=document.activeElement; closeMenu && menuEl && closeMenu();
  renderCompare(); cmpEl().hidden=false; document.body.style.overflow='hidden';
  const f=cmpEl().querySelector('[data-cmpclose]'); if(f) f.focus({preventScroll:true});
}
function openCompare(id){
  if(cmpKids(id).length<2){ toast('Compare needs a prompt with two or more follow-ups.'); return; }
  cmpIds=null; cmpFor=id; cmpReturn=document.activeElement; closeMenu && menuEl && closeMenu();
  renderCompare(); cmpEl().hidden=false; document.body.style.overflow='hidden';
  const f=cmpEl().querySelector('[data-cmpclose]'); if(f) f.focus({preventScroll:true});
}
function closeCompare(){ cmpFor=null; cmpIds=null; cmpEl().hidden=true; document.body.style.overflow=''; if(cmpReturn && cmpReturn.focus && document.contains(cmpReturn)) cmpReturn.focus({preventScroll:true}); }
function renderCompare(){
  const el=cmpEl(); if(cmpFor==null || (!cmpIds && !S.nodes[cmpFor])){ if(!el.hidden) closeCompare(); return; }
  const id=cmpFor, ks=cmpList(), par=cmpParent();
  if(ks.length<2){ closeCompare(); return; }
  const p=S.nodes[id]||{}, missing=ks.filter(k=>!k.reply && !replyBusy(k.id)).length, running=ks.filter(k=>replyBusy(k.id)).length;
  const verdict = cmpTool && cmpTool.key===cmpKey() && cmpTool.judge && cmpTool.judge.result || null;
  const cols=ks.map(k=>{
    const names=refsThrough(k.id).map(refName), main=onMain(k.id), below=desc(k.id).size, live=liveGen(k.id), note=genNotes[gkey(DB.current,k.id)];
    const reply = live ? `<div class="rbody" data-cgen="${k.id}">${live.text?md(live.text):'<p class="thinking">Writing…</p>'}</div><button class="btn xs" data-cstop="${k.id}">Stop</button>`
      : queuedGen(k.id) ? `<p class="note thinking">Waiting its turn…</p><button class="btn xs" data-cstop="${k.id}">Cancel</button>`
      : (k.reply ? `<div class="rbody">${md(k.reply)}</div>` : '<p class="note">No reply yet.</p>')+(note?`<p class="gnote">${esc(note)}</p>`:'')+(!k.reply && sampleState==='ready'?`<button class="btn sm" data-cget="${k.id}">Get reply</button>`:'');
    return `<article class="ccol ${main?'main':''}" style="--lane:var(--l${main?0:1+(k.id%3)})">
      <header><span class="nid">#${k.id}</span>${names.slice(0,3).map(nm=>`<span class="ref ${nm==='main'?'head':''}">${esc(nm)}</span>`).join('')}${k.skip?'<span class="tag skiptag">left out</span>':''}${k.combined?`<span class="tag rwtag" title="${esc(combinedTitle(k))}">combined</span>`:''}${verdict && verdict.best===k.id?`<span class="tag pick">${AI}pick</span>`:''}${verdict && verdict.reasons[k.id]?`<p class="cverdict">${AI}${esc(verdict.reasons[k.id])}</p>`:''}</header>
      <p class="cprompt">${esc(k.text)}</p>
      <div class="creply">${reply}</div>
      <footer>${below?`<span class="note">${below} more prompt${below===1?'':'s'} below</span>`:''}
        <span class="cacts"><button class="btn xs" data-copen="${k.id}">Open</button><button class="btn xs" data-cmain="${k.id}" ${main?'disabled title="Already on main"':''}>Make mainline</button><button class="btn xs danger" data-cprune="${k.id}" title="Delete this follow-up and everything below it">Delete</button></span></footer>
    </article>`;
  }).join('');
  /* what's typed in the tools survives a redraw (replies streaming in redraw Compare) */
  const keep=['judgeCriteria','combineInstr','combPrompt','combReply'].map(k=>{ const x=document.getElementById(k); return x ? [k, x.value, document.activeElement===x] : null; }).filter(Boolean);
  el.querySelector('.cmpbox').innerHTML=`<div class="sethead"><div class="cmptitle"><h2 id="cmpTitle">Compare ${ks.length} ${cmpIds?'picked prompts':'follow-ups'}</h2><p class="note">${cmpIds ? (par!=null ? `sharing the context up to #${par}: ${esc(clip(S.nodes[par].text||'',120))}` : 'from different chats, with no shared context') : `to #${id}: ${esc(clip(p.text||'',140))}`}</p></div>
    <div class="bar">${missing>1&&sampleState==='ready'?`<button class="btn" data-cgetall>Get ${missing} missing replies</button>`:''}${running>1?`<button class="btn" data-cstopall>Stop ${running} replies</button>`:''}<button class="btn" data-cmpclose>Done <kbd class="inv">Esc</kbd></button></div></div>
    ${cmpToolsHTML()}
    <div class="ccols">${cols}</div>`;
  for(const [k,v,f] of keep){ const x=document.getElementById(k); if(x){ x.value=v; if(f) x.focus({preventScroll:true}); } }
}
