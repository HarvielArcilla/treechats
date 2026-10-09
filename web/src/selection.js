/* Selecting a stretch of a line (Shift-click) or prompts anywhere (Ctrl/⌘-click), and the bar of what works on them. */

/* ---- Selecting a stretch of a line ----
   Shift-click selects every prompt between the selected one and the clicked one, on the same line. A bar above the
   tree offers the tools that need a stretch: Squash, Replay this stretch, Replay onto…, Copy as a prompt, Leave out,
   Splice out. Ctrl/⌘-click picks prompts anywhere instead (Reply to several, Compare). */
let range=null;
function setRange(a, b){
  const ca=chain(a), cb=chain(b);
  const ids = cb.includes(a) ? cb.slice(cb.indexOf(a)) : ca.includes(b) ? ca.slice(ca.indexOf(b)) : null;
  if(!ids){ toast('Shift-click a prompt on the same line to select everything between them. Ctrl/⌘-click picks prompts anywhere.'); return; }
  range={ids}; alsoTargets.clear(); keepDraft(()=>animRender([b]));
}
function rangeBarHTML(){
  const ids=range.ids, asks=ids.filter(x=>S.nodes[x] && S.nodes[x].kind!=='merge'), first=ids[0], last=ids[ids.length-1];
  const allOut=asks.length && asks.every(x=>S.nodes[x].skip), hasMerge=asks.length!==ids.length, ready=sampleState==='ready';
  const b=(k,l,t,dis)=>`<button class="btn" data-rg="${k}" title="${esc(t)}" ${dis?'disabled':''}>${l}</button>`;
  return `<div class="pickBanner rangebar" data-key="range"><span><b>#${first}–#${last}</b> · ${asks.length} prompt${asks.length===1?'':'s'} selected</span>
    <span class="rgacts">${b('copy','Copy as a prompt','These turns only, as one block to paste anywhere')}
    ${b('skip', allOut?`Include ${asks.length}`:`Leave out ${asks.length}`, allOut?'Send them again from the prompts below':'Stop sending them from the prompts below. Nothing is deleted.')}
    ${b('send','Include as…','Include these turns as summaries, as their prompts or replies only, left out, or in full again', !asks.length)}
    ${b('squash','Squash','Collapse the stretch into one prompt and reply', asks.length<2 || hasMerge)}
    ${b('splice','Splice out','Remove these prompts; what follows attaches to the prompt before them', hasMerge)}
    ${ready?b('replay',AI+'Replay this stretch','Re-send these prompts with the context as it is now, as new versions'):''}
    ${ready?b('replayonto',AI+'Replay onto…','Re-send these prompts under another prompt, so they get replies in that context'):''}</span>
    <button class="btn" data-rangeclear>Clear <kbd style="color:inherit;border-color:currentColor">Esc</kbd></button></div>`;
}
/* ---- Picking prompts anywhere ----
   Ctrl/⌘-click adds prompts to the selection wherever they are (Shift-click takes a stretch of one line instead). A bar
   above the tree offers what works on prompts that aren't next to each other: reply to all of them, compare them,
   choose how they're included, leave them out, copy them. A plain click selects just the prompt you click, and Esc
   clears the rest, as in a file list. */
const pickedIds = () => [sel, ...alsoTargets].filter(x=>x!=null && S.nodes[x] && S.nodes[x].kind!=='merge').sort((a,b)=>a-b);
function pickedBarHTML(){
  const ids=pickedIds(), allOut=ids.every(x=>S.nodes[x].skip);
  const b=(k,l,t,dis)=>`<button class="btn" data-pk="${k}" title="${esc(t)}" ${dis?'disabled':''}>${l}</button>`;
  return `<div class="pickBanner rangebar" data-key="picked"><span><b>${ids.map(x=>'#'+x).join(', ')}</b> · ${ids.length} prompts selected</span>
    <span class="rgacts">${b('reply',`Reply to all ${ids.length}`,'Type below: the message goes to each of them, each in its own branch')}
    ${b('compare','Compare','Read them and their replies side by side')}
    ${b('send','Include as…','Include them as summaries, as their prompts or replies only, left out, or in full again')}
    ${b('skip', allOut?`Include ${ids.length}`:`Leave out ${ids.length}`, allOut?'Send them again from the prompts below':'Stop sending them from the prompts below. Nothing is deleted.')}
    ${b('copy','Copy as a prompt','These turns only, oldest first, as one block to paste anywhere')}</span>
    <button class="btn" data-pk="clear">Clear <kbd style="color:inherit;border-color:currentColor">Esc</kbd></button></div>`;
}
function pickedAction(k, btn){
  const ids=pickedIds();
  if(k==='clear'){ alsoTargets.clear(); keepDraft(()=>animRender([sel])); return; }
  if(k==='reply'){ const t=document.getElementById('contText'); if(t){ t.focus(); t.scrollIntoView({block:'nearest', behavior: Motion.reduced()?'auto':'smooth'}); } return; }
  if(k==='compare'){ openCompareIds(ids); return; }
  if(k==='send'){ sendMenu(btn, ids); return; }
  if(k==='skip'){ const out=!ids.every(x=>S.nodes[x].skip); commit(out?`Left ${ids.length} prompts out of the context. They stay in the tree.`:`${ids.length} prompts are back in the context`, ()=>{ for(const x of ids){ if(out) S.nodes[x].skip=true; else delete S.nodes[x].skip; } }); return; }
  if(k==='copy'){
    const body=ids.filter(x=>!S.nodes[x].skip).flatMap(x=>{ const {sent}=sentOf(S.nodes[x]); return [...(sent.user?[`<user>\n${sent.user}\n</user>`]:[]), ...(sent.reply?[`<assistant>\n${sent.reply}\n</assistant>`]:[])]; }).join('\n\n');
    copyText(`Here are parts of an earlier conversation, for context. Read them, then help with what I ask after them.\n\n<conversation>\n${body}\n</conversation>\n\n`);
  }
}
function rangeAction(k){
  const ids=range.ids.filter(x=>S.nodes[x]), asks=ids.filter(x=>S.nodes[x].kind!=='merge'), first=ids[0], last=ids[ids.length-1];
  if(k==='copy'){
    /* as each turn is sent: a summary, an excerpt or one side only where that's its mode */
    const body=asks.filter(x=>!S.nodes[x].skip).flatMap(x=>{ const {sent}=sentOf(S.nodes[x]); return [...(sent.user?[`<user>\n${sent.user}\n</user>`]:[]), ...(sent.reply?[`<assistant>\n${sent.reply}\n</assistant>`]:[])]; }).join('\n\n');
    copyText(`Here is part of an earlier conversation, for context. Read it, then help with what I ask after it.\n\n<conversation>\n${body}\n</conversation>\n\n`);
    return;
  }
  if(k==='skip'){ const out=!asks.every(x=>S.nodes[x].skip); range=null; commit(out?`Left ${asks.length} prompts out of the context. They stay in the tree.`:`${asks.length} prompts are back in the context`, ()=>{ for(const x of asks){ if(out) S.nodes[x].skip=true; else delete S.nodes[x].skip; } }); return; }
  if(k==='send'){ sendMenu(document.querySelector('[data-rg="send"]'), asks); return; }
  if(k==='squash'){ range=null; pick={op:'squash', src:last}; finishPick(first); return; }
  if(k==='splice'){
    range=null;
    const above=S.nodes[first] ? S.nodes[first].parents[0] : null, after=vKids(last)[0];
    commit(`Spliced out #${first}–#${last}`, ()=>{
      const here=asks.filter(x=>S.nodes[x]); if(here.length) Ops.splice(S, here);
      sel = after && S.nodes[after.id] ? after.id : above!=null && S.nodes[above] ? above : (ids.map(x=>S.nodes[x]).find(Boolean)||{}).id ?? defaultSel();
    });
    return;
  }
  if(k==='replay'){ range=null; askReplay(first, null, ids); return; }
  if(k==='replayonto'){ pick={op:'replayonto', src:first, line:ids}; range=null; composeFor=null; animRender([first]); return; }
}
