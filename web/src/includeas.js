/* Include as: how a turn is included in the context below it (full, summary, excerpt, one side, left out). */

/* ---- Include as (send modes) ----
   How much of a turn the prompts below it send: full, a summary in place of the reply, an excerpt (only highlighted
   parts), the prompt only, the reply only, or nothing (Leave out, n.skip). The rules live in sendmodes.js, shared with
   the server; this is the part you see: the Include as… menu, the note above a reply that isn't included as it is, writing and
   editing summaries, and the excerpt highlighter. */
const SM = TreechatsSend;
const modeName = m => SM.LABELS[m] || 'Full';
/* the turn as it would go out in full, and as its mode sends it */
function sentOf(n){
  const fl=(n.files||[]).map(fileBlock).join('\n\n');
  const user = fl ? fl+(n.text?'\n\n'+n.text:'') : (n.text||''), reply=n.reply||'';
  return {full:{user, reply}, sent: n.send ? SM.apply(n, user, reply, promptText) : {user, reply}};
}
const tokOf = s => Math.ceil((s||'').length/4);
/* the menu: every mode with what it would send; the ✓ is the turn's mode (or the first turn's, for several) */
function sendMenu(anchor, ids, o={}){
  ids=ids.filter(x=>S.nodes[x] && S.nodes[x].kind!=='merge'); if(!ids.length || !anchor) return;
  const one = ids.length===1 ? S.nodes[ids[0]] : null, cur = SM.modeOf(S.nodes[ids[0]]);
  const anyReply = ids.some(x=>S.nodes[x].reply);
  const sizeIf = m => { if(!one) return ''; const t={...one, send:m==='full'||m==='out'?undefined:m, skip:m==='out'}; const {full}=sentOf(one); const o2=m==='out'?{user:'',reply:''}:SM.apply(t, full.user, full.reply, promptText); return ` · ~${(tokOf(o2.user)+tokOf(o2.reply)).toLocaleString()} tok`; };
  const note = m => {
    if(m==='summary'){
      if(one && SM.hasSummary(one)) return 'Uses its summary'+(SM.stale(one,h5).length?' (written before the reply changed)':'')+sizeIf(m);
      return sampleState==='ready' ? `${AI}Claude writes ${ids.length>1?'one for each':'one'} (${ids.length} request${ids.length===1?'':'s'}); you can edit it` : 'You write it (Claude isn’t connected)';
    }
    if(m==='excerpt') return one ? (one.ex && SM.modeOf(one)==='excerpt' ? 'Change the highlights…' : 'Highlight the parts to send…') : 'One turn at a time';
    return SM.HINTS[m]+(m==='out'?'':sizeIf(m));
  };
  const lockOut = o.target!=null && ids.includes(o.target);
  const items=[{heading: ids.length>1 ? `Include ${ids.length} turns as` : `Include #${ids[0]} as`}];
  for(const m of SM.MODES){
    const needsReply = m==='summary'||m==='prompt'||m==='reply';
    items.push({label:modeName(m), note:note(m), checked: ids.length===1 || ids.every(x=>SM.modeOf(S.nodes[x])===cur) ? m===cur : false,
      disabled:(needsReply && !anyReply) || (m==='excerpt' && ids.length>1) || (m==='out' && lockOut),
      run:()=> m==='excerpt' ? openExcerpt(ids[0]) : setSendMode(ids, m)});
  }
  if(one && cur==='summary') items.push({sep:true}, {label:'Edit the summary', run:()=>{ sumEditFor=one.id; showSendNote(one.id); }}, ...(sampleState==='ready'?[{label:`${AI}Write a new summary`, run:()=>rewriteSummary([one.id])}]:[]));
  if(sampleState==='ready' && anyReply) items.push({sep:true}, {label:`${AI}Summary with my own instructions…`, note:'See and change what Claude is asked, this once', run:()=>{ reviewNext=Date.now(); rewriteSummary(ids.filter(x=>S.nodes[x].reply)); }});
  openMenu(anchor, items);
}
/* sets the mode of these turns, with Undo; a summary that's missing or out of date gets written */
function setSendMode(ids, mode){
  ids=ids.filter(x=>S.nodes[x] && S.nodes[x].kind!=='merge'); if(!ids.length) return;
  const what = ids.length>1 ? `#${ids[0]}–#${ids[ids.length-1]}` : `#${ids[0]}`;
  const msg = mode==='full' ? `${what} included in full` : mode==='out' ? `Left ${what} out of the context. It stays in the tree.` : `${what} included as ${modeName(mode).toLowerCase()}`;
  commit(msg, ()=>{ for(const x of ids){ const n=S.nodes[x];
    if(mode==='out'){ n.skip=true; continue; }
    delete n.skip;
    if(mode==='full') delete n.send; else n.send=mode;
  } });
  if(mode==='summary'){
    const need=ids.filter(x=>S.nodes[x].reply && (!SM.hasSummary(S.nodes[x]) || SM.stale(S.nodes[x],h5).length));
    if(need.length && sampleState==='ready') (async()=>{ const sid=DB.current, n0=S.nodes[need[0]];
      const tpl=await askTemplate('summarizeReply', {prompt:n0.text||'', reply:n0.reply}, need.length>1 ? `Summaries of ${need.length} turns` : `Summary of #${need[0]}`);
      if(tpl==null){ toast('No summary was written, so the full reply is still sent.'); return; }
      for(const x of need) await summarizeTurn(sid, x, tpl); })();
    else if(need.length===1){ sumEditFor=need[0]; showSendNote(need[0]); }
  }
}
/* writes new summaries for these turns (and includes them as summaries), asking for the instruction once if you've
   chosen to see it */
async function rewriteSummary(ids){
  ids=ids.filter(x=>S.nodes[x] && S.nodes[x].reply); if(!ids.length) return;
  const sid=DB.current, n0=S.nodes[ids[0]];
  const tpl=await askTemplate('summarizeReply', {prompt:n0.text||'', reply:n0.reply}, ids.length>1 ? `Summaries of ${ids.length} turns` : `Summary of #${ids[0]}`);
  if(tpl==null) return;
  if(ids.some(x=>SM.modeOf(S.nodes[x])!=='summary')) commit(`${ids.length>1?ids.length+' turns':'#'+ids[0]} included as summary`, ()=>{ for(const x of ids){ delete S.nodes[x].skip; S.nodes[x].send='summary'; } });
  for(const x of ids) await summarizeTurn(sid, x, tpl);
}
/* Claude writes a turn's summary. It goes on the turn (n.sum) with a hash of the reply it summarizes; until it's
   written the full reply is still sent. */
const sumJobs=new Map();
let sumEditFor=null;
/* The summary that stands in for a reply, written by the server (server/agent.ts, the same code agents use): it
   marks the turn as having one on the way, and the change comes back here like any other. tpl: your wording for
   this once (from the request card), else Settings › Prompts. */
async function summarizeTurn(sid, id, tpl){
  const t=treeOf(sid), n=t && t.nodes[id]; if(!n || !n.reply) return {error:'That prompt has no reply to summarize.'};
  if(sampleState!=='ready') return {error:'Claude isn’t connected, so it can’t write the summary.'};
  const key=sid+':'+id; if(sumJobs.has(key)) return sumJobs.get(key);
  const job=(async()=>{
    let r;
    try{
      await Sync.flush();
      const res=await fetch('/api/summarize', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sid, id, tpl:tpl ?? null})});
      r=await res.json();
      await Sync.atLeast(r.rev||0);
    }catch(e){ r={error:'Claude couldn’t write the summary.'}; }
    sumJobs.delete(key);
    if(r.error && sid===DB.current) toast('Claude couldn’t write the summary, so the full reply is still sent. You can write one yourself.');
    if(sid===DB.current){ showSendNote(id); renderCtx(); }
    return r.error ? {error:r.error} : {summary:r.summary};
  })();
  sumJobs.set(key, job);
  return job;
}

/* redraws just the parts that show a turn's mode */
function showSendNote(id){ if(S.nodes[id]) animRender([id]); }
/* the tag on a prompt sent another way; it opens the menu */
function sendTagHTML(n, chat){
  const m=SM.modeOf(n); if(m==='full' || m==='out') return '';
  const stale=SM.stale(n,h5).length, pending=m==='summary' && n.sum && n.sum.pending;
  const tip = `${SM.HINTS[m]}${stale?' The text changed since it was made.':''} Click to change.`;
  const label=`${esc(modeName(m).toLowerCase())}${pending?'…':''}${stale?' · out of date':''}`;
  /* Chat view shows how a turn is included; changing it is in Editor */
  if(chat) return `<span class="edtag sendtag${stale?' warn':''}" title="${esc(SM.HINTS[m]+(stale?' The text changed since it was made.':'')+' Change it in Editor.')}">${label}</span>`;
  return `<button class="tag sendtag${stale?' warn':''}" data-sendmenu="${n.id}" aria-haspopup="menu" title="${esc(tip)}">${label}</button>`;
}
/* above a reply that isn't sent as it is: what goes instead, and how to change it */
function sendNoteHTML(id){
  const n=S.nodes[id], m=SM.modeOf(n); if(!n.reply || m==='full' || m==='out') return '';
  const stale=SM.stale(n,h5), full=`<button class="linkbtn" data-sendfull="${id}">Include in full</button>`;
  const menu=`<button class="linkbtn" data-sendmenu="${id}" aria-haspopup="menu">Change…</button>`;
  let body='';
  if(m==='summary'){
    if(sumEditFor===id) return `<div class="sendnote" data-key="sn${id}"><div class="snhead"><b>The summary included instead of this reply</b></div>
      <textarea id="sumEditText" rows="4" aria-label="Summary of the reply to #${id}">${esc((n.sum&&n.sum.text)||'')}</textarea>
      <div class="bar"><button class="btn primary sm" data-sumsave="${id}">Save <kbd class="inv">${IS_MAC?'⌘↵':'Ctrl ↵'}</kbd></button><button class="btn sm" data-sumcancel="${id}">Cancel</button></div></div>`;
    const pend = n.sum && n.sum.pending;
    body = pend ? `<p class="thinking">Claude is writing the summary… Until it’s done the full reply is sent.</p>`
      : SM.hasSummary(n) ? `<div class="sntext">${md(n.sum.text)}</div>`
      : `<p class="note">No summary yet, so the full reply is still sent.</p>`;
    const acts=[pend?'':`<button class="linkbtn" data-sumedit="${id}">${SM.hasSummary(n)?'Edit':'Write one'}</button>`, !pend && sampleState==='ready' ? `<button class="linkbtn" data-sumregen="${id}">${AI}${SM.hasSummary(n)?'Rewrite':'Write it'}</button>`:'', full, menu].filter(Boolean).join('');
    return `<div class="sendnote" data-key="sn${id}"><div class="snhead"><b>Included as a summary</b>${stale.length?'<span class="edtag warn" title="The reply was edited after this summary was written">reply changed since</span>':''}<span class="snacts">${acts}</span></div>${body}</div>`;
  }
  if(m==='excerpt'){
    const ex=n.ex||{}, pe=SM.exSide(n,'p'), re=SM.exSide(n,'r'), p=SM.texts(ex.p), r=SM.texts(ex.r), len=a=>a.reduce((x,t)=>x+t.length,0);
    const side=(e,a,total,what)=>e && e.edited ? `your own wording of the ${what}` : a.length ? `${a.length} part${a.length===1?'':'s'} of the ${what} (${len(a).toLocaleString()} of ${total.toLocaleString()} characters)` : `the whole ${what}`;
    const what = `${side(pe,p,(n.text||'').length,'prompt')} and ${side(re,r,n.reply.length,'reply')}`, hand=(pe&&pe.edited)||(re&&re.edited);
    return `<div class="sendnote" data-key="sn${id}"><div class="snhead"><b>Included as an excerpt</b>${stale.length?`<span class="edtag warn" title="Some highlighted text is no longer in the ${stale.join(' or ')}">${esc(stale.join(' and '))} changed since</span>`:''}<span class="snacts"><button class="linkbtn" data-excerpt="${id}">Change highlights</button>${full}${menu}</span></div>
      <p class="note">Only ${esc(what)}.${hand?' <span class="edtag" title="You wrote some of what\u2019s included, so it may say what the original didn\u2019t">edited by you</span>':''}</p>${re?`<details class="snmore"><summary>What\u2019s included from the reply</summary><div class="sntext">${md(re.text)}</div></details>`:''}</div>`;
  }
  const t = m==='prompt' ? 'This reply isn’t included: the prompts below get only the prompt above it.' : 'Only this reply is included: the prompts below don’t get the prompt above it.';
  return `<div class="sendnote" data-key="sn${id}"><div class="snhead"><b>${esc(modeName(m))}</b><span class="snacts">${full}${menu}</span></div><p class="note">${t}</p></div>`;
}
/* the reply's own text is shown dimmer when something else goes in its place */
/* under the prompt: how it's included, and the menu to change it */
const includeBtn = (n, id) => n.kind==='merge' ? '' : `<button class="act incl" data-sendmenu="${id}" aria-haspopup="menu" title="${esc(OPS.send.hint)}">Include as: ${esc(modeName(SM.modeOf(n)))} ▾</button>`;
const replyUnsent = n => { const m=SM.modeOf(n); return !!n.reply && (m==='prompt' || (m==='summary' && SM.hasSummary(n)) || (m==='excerpt' && !!SM.exSide(n,'r'))); };

/* clicks on the send-mode controls, in the tree and in Chat view; true when one was handled */
function sendClick(e){
  const sm=e.target.closest('[data-sendmenu]'); if(sm){ e.stopPropagation(); sendMenu(sm, [+sm.dataset.sendmenu]); return true; }
  const sf=e.target.closest('[data-sendfull]'); if(sf){ setSendMode([+sf.dataset.sendfull], 'full'); return true; }
  const se=e.target.closest('[data-sumedit]'); if(se){ sumEditFor=+se.dataset.sumedit; showSendNote(sumEditFor); setTimeout(()=>{ const t=document.getElementById('sumEditText'); if(t) t.focus({preventScroll:true}); }, 30); return true; }
  const ss=e.target.closest('[data-sumsave]'); if(ss){ saveSummary(+ss.dataset.sumsave); return true; }
  if(e.target.closest('[data-sumcancel]')){ const id=sumEditFor; sumEditFor=null; showSendNote(id); return true; }
  const sr=e.target.closest('[data-sumregen]'); if(sr){ rewriteSummary([+sr.dataset.sumregen]); return true; }
  const ex=e.target.closest('[data-excerpt]'); if(ex){ openExcerpt(+ex.dataset.excerpt); return true; }
  return !!e.target.closest('.sendnote');
}
function saveSummary(id){
  const t=document.getElementById('sumEditText'), n=S.nodes[id]; if(!t || !n) return;
  const text=t.value.trim(); sumEditFor=null;
  commit(text ? `Saved the summary of #${id}` : `Removed the summary of #${id}`, ()=>{ if(text) n.sum={text, of:h5(n.reply||''), by:'you'}; else delete n.sum; if(text && !n.send){ n.send='summary'; delete n.skip; } });
  showSendNote(id);
}
treeEl.addEventListener('keydown', e=>{
  if(e.target.id!=='sumEditText') return;
  if(e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); saveSummary(sumEditFor); }
  else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); const id=sumEditFor; sumEditFor=null; showSendNote(id); }
});
