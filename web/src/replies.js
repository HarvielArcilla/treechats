/* Replies: asking the server for them and showing them as they're written. The server writes every reply. */

/* ---- Replies ----
   The server writes every reply (server/replies.ts), yours and agents' alike, so a reply carries on when this page
   closes. Asking for one saves what has changed first (the server needs the prompt), then asks; the server queues
   it, a few at a time, each prompt waiting for the replies above it. This page mirrors what's waiting (genQueue)
   and what's being written (gens) from the server's events, and Stop asks the server. */
const gens=new Map(), genQueue=[];
const gkey=(sid,id)=>sid+':'+id;
const treeOf=sid=>DB.spaces[sid] && DB.spaces[sid].tree;
const liveGen=id=>gens.get(gkey(DB.current,id));
const queuedGen=id=>genQueue.some(q=>q.sid===DB.current && q.id===id);
const replyBusy=id=>!!liveGen(id) || queuedGen(id);
const busyCount=()=>gens.size+genQueue.length;
/* ask Claude to answer these prompts */
function wantReplies(ids, sid=DB.current){
  if(sampleState!=='ready') return;
  const t=treeOf(sid), list=[];
  for(const id of ids){
    const n=t && t.nodes[id]; if(!n || n.kind==='merge' || gens.has(gkey(sid,id)) || genQueue.some(q=>q.sid===sid && q.id===id)) continue;
    genQueue.push({id, sid}); delete genNotes[gkey(sid,id)]; list.push(id);
  }
  if(!list.length) return;
  if(sid===DB.current) refreshWaiting();
  (async()=>{
    try{
      await Sync.flush();
      const r=await fetch('/api/replies', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sid, ids:list})});
      if(!r.ok) throw new Error('replies '+r.status);
    }catch(e){ for(const id of list) replyDone({sid, id, error:'Couldn’t reach the Treechats server to ask for this reply.'}); }
  })();
}
/* resolves when the reply to a prompt is written (or fails, or is stopped): {reply, note} or {error} */
const replyWaiters=new Map();
function awaitReply(sid, id){ return new Promise(res=>{ const k=gkey(sid,id); replyWaiters.set(k, [...(replyWaiters.get(k)||[]), res]); }); }
function settleReply(sid, id, result){ const k=gkey(sid,id), ws=replyWaiters.get(k); if(!ws) return; replyWaiters.delete(k); for(const w of ws) w(result); }
const generate=id=>wantReplies([id]);
/* the prompt above this one that still has a reply or summary on the way, if any */
function waitingOn(q){
  const t=treeOf(q.sid); if(!t || !t.nodes[q.id]) return 'gone';
  for(const x of withTree(t, ()=>path(q.id))){
    if(x===q.id) continue;
    if(gens.has(gkey(q.sid,x)) || t.nodes[x].pending || genQueue.some(o=>o!==q && o.sid===q.sid && o.id===x)) return x;
  }
  return null;
}
/* the server's events: a prompt is waiting, its reply is coming in, or it's done */
function replyWaiting(d){
  if(gens.has(gkey(d.sid, d.id)) || genQueue.some(q=>q.sid===d.sid && q.id===d.id)) return;
  genQueue.push({id:d.id, sid:d.sid});
  if(d.sid===DB.current) refreshWaiting();
}
function replyLive(d){
  const k=gkey(d.sid, d.id); let g=gens.get(k);
  if(!g){
    const i=genQueue.findIndex(q=>q.sid===d.sid && q.id===d.id); if(i>=0) genQueue.splice(i,1);
    g={id:d.id, sid:d.sid, text:'', steps:[], tier:d.tier, started:d.started,
      ctl:{abort(){ fetch('/api/agent/stop', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sid:d.sid, id:d.id})}).catch(()=>{}); }}};
    gens.set(k, g); delete genNotes[k];
    if(d.sid===DB.current && S.nodes[d.id]) showLive(d.id);
  }
  const stepsChanged=JSON.stringify(d.steps||[])!==JSON.stringify(g.steps);
  g.text=d.text||''; g.steps=d.steps||[];
  if(d.sid===DB.current){ paintGen(g); if(stepsChanged) paintSteps(g); }
}
/* done: the reply is in the document once this page has the change that holds it (rev), and then whatever waited
   for it (Replay, /loop) goes on */
function replyDone(d){
  const k=gkey(d.sid, d.id);
  gens.delete(k);
  const i=genQueue.findIndex(q=>q.sid===d.sid && q.id===d.id); if(i>=0) genQueue.splice(i,1);
  if(d.note) genNotes[k]=d.note;
  Sync.atLeast(d.rev||0).then(()=>{
    settleReply(d.sid, d.id, d.reply!=null ? {reply:d.reply, note:d.note||undefined} : {error:d.error || d.note || 'No reply came back.'});
    gridChanged();
    if(d.sid===DB.current && S.nodes[d.id]){
      const end=atPageEnd();
      animRender([d.id], editorFor===d.id);
      if(end) scrollThreadEnd();
      if(cmpFor!=null) renderCompare();
      if(S.nodes[d.id].reply) afterReplyNaming(d.id);
    } else if(d.sid===DB.current) refreshWaiting();
    if(!busyCount()) setTimeout(pumpNames, 0);
  });
}
/* Stop: the server stops a reply being written (keeping what came) or cancels a waiting one, with the prompts
   waiting below it */
function stopReply(id){
  if(!liveGen(id) && !queuedGen(id)) return false;
  fetch('/api/agent/stop', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sid:DB.current, id})}).catch(()=>{});
  return true;
}
/* after undo, deleting or moving prompts: the server stops replies whose prompt is gone once it has the change */
function reconcileReplies(){ if(saveTimer) writeStore(); }
function showLive(id){
  const slot=treeEl.querySelector(`[data-key="r${id}"]`);
  if(slot && slot.closest('.tree')) slot.outerHTML=replyHTML(id); else animRender([id]);
  if(cmpFor!=null) renderCompare();
}
/* the selected prompt's reply box and Compare show what's waiting */
function refreshWaiting(){
  if(cmpFor!=null) renderCompare();
  if(sel==null || !S.nodes[sel] || liveGen(sel) || S.nodes[sel].reply) return;
  const slot=treeEl.querySelector(`[data-key="r${sel}"]`); if(slot) slot.outerHTML=replyHTML(sel);
}
/* In Chat view a reply coming in keeps the page at the bottom, as chat apps do, but only until you scroll up: from
   then on it stays where you put it, until you scroll back down to the end. Without this, scrolling up a little
   while a reply streams in (with a trackpad's glide, say) gets pulled back down every frame, which jitters. */
let followEnd=true, lastSY=0;
const maxScroll=()=>Math.max(0, document.documentElement.scrollHeight-innerHeight);
addEventListener('scroll', ()=>{
  const max=maxScroll(), y=Math.min(Math.max(scrollY,0), max); /* the bounce past either end isn't scrolling */
  if(y<lastSY-1) followEnd=false; else if(y>=max-24) followEnd=true;
  lastSY=y;
}, {passive:true});
const atPageEnd = () => opts.simple && followEnd && innerHeight+scrollY >= document.documentElement.scrollHeight-140;
/* streamed text is painted at most once a frame, however many replies are coming in */
const paintDue=new Set(); let paintRaf=0;
function paintGen(g){
  gridChanged();
  paintDue.add(g);
  if(paintRaf) return;
  paintRaf=requestAnimationFrame(()=>{
    paintRaf=0;
    /* in Chat view, a reply coming in keeps the page at the bottom if you were there, as chat apps do */
    const de=document.documentElement, atEnd=atPageEnd();
    for(const x of paintDue){
      if(x.sid!==DB.current || !gens.has(gkey(x.sid,x.id))) continue;
      const b=treeEl.querySelector(`.reply[data-gen="${x.id}"] .rbody`); if(b) b.innerHTML=md(x.text);
      const c=document.querySelector(`[data-cgen="${x.id}"]`); if(c) c.innerHTML=md(x.text);
    }
    paintDue.clear();
    if(atEnd) window.scrollTo(0, de.scrollHeight);
  });
}
