/* Keeping the page in step with the server, which owns the document. */

/* ---- Sync with the server ----
   The server owns the document (server/doc.ts); this page is one of its writers. It loaded the document with a
   revision number; each save sends only the units that changed since then (docsync.js), and the server applies them
   unless another writer (another tab, an agent, a scheduled task) changed the same unit meanwhile. Every other
   writer's changes are pushed here and applied in place:
   - a unit this page changed and hasn't saved yet: theirs is kept, except a prompt both sides just made with the same
     number, where this page's moves to the next free number (and its reply, if one is coming, follows it)
   - Undo is rebased over their changes, so undoing your own change never takes theirs back (agent run projects
     simply leave your Undo, as before)
   Without the server (the file opened on its own) it saves to the browser as it always did. */
const Sync=(()=>{
  const DL=TreechatsDoc, TAB=window.TREECHATS_TAB||'page';
  let on=false, ready=false, rev=0, base=new Map(), inflight=false, pending=false, catching=false, retry=null;
  const queue=[], idle=[], revWaiters=[];
  const live = () => ({db:DB, opts});
  /* resolves once this page has every change up to revision r (a reply's, say); without the server, at once */
  function atLeast(r){
    if(!on || rev>=r) return Promise.resolve();
    return new Promise(res=>{ const w=[r, res]; revWaiters.push(w); setTimeout(()=>{ const i=revWaiters.indexOf(w); if(i>=0){ revWaiters.splice(i,1); res(); } }, 8000); });
  }
  function revMoved(){ for(let i=revWaiters.length-1; i>=0; i--) if(rev>=revWaiters[i][0]){ const [, res]=revWaiters[i]; revWaiters.splice(i,1); res(); } }
  const active = () => on;
  /* starts from the document as the server sent it (before this page tidied it up: that tidying is saved as changes) */
  async function init(){
    const L=window.TREECHATS_LOCAL; if(!L || L.offline) return;
    on=true; window.TREECHATS_SYNC=true;
    /* the first save of what an older version kept in this browser goes up whole first */
    if(window.TREECHATS_FLUSH) await window.TREECHATS_FLUSH();
    const d=window.TREECHATS_DOC||{};
    try{ base = d.raw ? DL.units(JSON.parse(d.raw)) : new Map(); }catch(e){ base=new Map(); }
    rev=d.rev||0; ready=true; revMoved();
    window.TREECHATS_FLUSH=flush;
    drainQueue(); push();
  }
  function settle(){ if(inflight || pending) return; const w=idle.splice(0); for(const f of w) f(); }
  /* resolves once everything changed so far has reached the server */
  function flush(){ if(!on) return Promise.resolve(); if(saveTimer) writeStore(); return inflight || pending || !ready ? new Promise(r=>idle.push(r)) : Promise.resolve(); }
  async function push(){
    if(!on) return;
    if(!ready || inflight || catching){ pending=true; return; }
    pending=false;
    const cur=DL.units(live()), ops=DL.diff(base, cur);
    if(!ops.length){ settle(); return; }
    inflight=true;
    let res, b;
    try{
      const body=JSON.stringify({base:rev, ops, tab:TAB});
      res=await fetch('/api/state/patch', {method:'POST', headers:{'content-type':'application/json'}, body, keepalive: body.length<60000});
      b=await res.json();
    }catch(e){
      inflight=false; window.TREECHATS_SAVE_ERROR=e; console.warn('Treechats could not save to the server:', e);
      pending=true; clearTimeout(retry); retry=setTimeout(push, 3000); return;
    }
    inflight=false;
    if(b && b.ok){
      for(const m of b.missed||[]) if(m.rev>rev) applyRemote(m.ops);
      for(const o of ops){
        const k=DL.key(o.p);
        if(o.d) base.delete(k);
        else if(DL.isCounter(o.p)) base.set(k, JSON.stringify(Math.max(+(base.get(k)||0), +cur.get(k))));
        else base.set(k, cur.get(k));
      }
      rev=Math.max(rev, b.rev); window.TREECHATS_SAVE_ERROR=null; revMoved();
    } else if(b && b.reload){ await reloadDoc(); }
    else if(b && b.conflicts){
      /* someone changed the same units first: take their changes, then send what's left of ours */
      for(const m of b.missed||[]) if(m.rev>rev){ applyRemote(m.ops); rev=m.rev; }
      rev=Math.max(rev, b.rev); pending=true; revMoved();
    } else { window.TREECHATS_SAVE_ERROR=new Error('save '+(res && res.status)); console.warn('Treechats could not save to the server:', b); }
    drainQueue();
    if(pending) push(); else settle();
  }
  /* a change pushed by the server */
  function remote(e){
    if(!on || e.tab===TAB) return;
    if(!ready || inflight || catching){ queue.push(e); return; }
    handle(e);
  }
  function handle(e){
    if(e.reload){ reloadDoc(); return; }
    if(e.rev<=rev) return;
    if(e.rev!==rev+1){ catchUp(); return; }
    applyRemote(e.ops); rev=e.rev; revMoved();
  }
  function drainQueue(){ const q=queue.splice(0).sort((a,b)=>(a.rev||0)-(b.rev||0)); for(const e of q) if(e.tab!==TAB) handle(e); }
  async function catchUp(){
    if(catching) return; catching=true;
    try{
      const r=await fetch('/api/state/since/'+rev+'?tab='+encodeURIComponent(TAB)), b=await r.json();
      if(b.reload){ catching=false; await reloadDoc(); return; }
      for(const m of b.missed||[]) if(m.rev>rev){ applyRemote(m.ops); rev=m.rev; }
      rev=Math.max(rev, b.rev); revMoved();
    }catch(e){ /* the next change tries again */ }
    finally{ catching=false; }
    drainQueue(); if(pending) push();
  }
  /* the next free prompt number in a tree, past any the incoming change uses */
  function freeId(t, sid, ops){
    let n=t.nextId||1;
    for(const o of ops){ const nd=DL.nodeOf(o.p); if(nd && nd.sid===sid) n=Math.max(n, nd.id+1); if(o.p.length===5 && o.p[2]===sid && o.p[4]==='nextId' && typeof o.v==='number') n=Math.max(n, o.v); }
    while(t.nodes[n]) n++;
    return n;
  }
  /* this page's new prompt moves to another number, with what refers to it here: the selection and a reply on its way */
  function renumberLocal(sid, from, to){
    const t=DB.spaces[sid] && DB.spaces[sid].tree; if(!t || !DL.renumberNode(t, from, to)) return;
    if(sid===DB.current){ if(sel===from) sel=to; if(editorFor===from) editorFor=to; if(promptEditFor===from) promptEditFor=to; if(replyEditFor===from) replyEditFor=to; }
    for(const [k, g] of [...gens]) if(g.sid===sid && g.id===from){ gens.delete(k); g.id=to; gens.set(gkey(sid, to), g); }
    for(const q of genQueue) if(q.sid===sid && q.id===from) q.id=to;
    const wk=gkey(sid, from); if(replyWaiters.has(wk)){ replyWaiters.set(gkey(sid, to), replyWaiters.get(wk)); replyWaiters.delete(wk); }
    if(genNotes[wk]){ genNotes[gkey(sid, to)]=genNotes[wk]; delete genNotes[wk]; }
  }
  function applyRemote(ops){
    if(!ops || !ops.length) return;
    const doc=live(), clash=[];
    /* units this page changed and hasn't saved yet */
    for(const o of ops){
      if(DL.isContainer(o.p) || DL.isCounter(o.p)) continue;
      const k=DL.key(o.p), lv=DL.get(doc, o.p), lj=lv===undefined ? undefined : JSON.stringify(lv);
      if(lj===base.get(k) || (!o.d && JSON.stringify(o.v)===lj)) continue;
      const nd=DL.nodeOf(o.p), rf=DL.refOf(o.p);
      if(nd && !base.has(k) && lv!==undefined && !o.d){ const t=DB.spaces[nd.sid].tree; renumberLocal(nd.sid, nd.id, freeId(t, nd.sid, ops)); continue; }
      if(rf && !base.has(k) && lv!==undefined && !o.d){ const t=DB.spaces[rf.sid].tree; let n=Math.max(t.nextRef||1, 1); while(t.refs['r'+n] || ops.some(x=>DL.refOf(x.p) && x.p[2]===rf.sid && x.p[5]==='r'+n)) n++; DL.renumberRef(t, rf.rid, 'r'+n); continue; }
      if(o.p.length===2 && o.p[0]==='db' && o.p[1]==='current') continue;
      clash.push(o.p);
    }
    /* which project each tab has open is its own: another tab switching doesn't move this one */
    const mine=ops.filter(o=>!(o.p.length===2 && o.p[0]==='db' && o.p[1]==='current'));
    const curTree=S, touched=DL.apply(doc, mine);
    for(const o of ops){
      const k=DL.key(o.p);
      if(DL.isContainer(o.p)){ if(o.d){ const pre=k.slice(0,-1)+','; for(const x of [...base.keys()]) if(x.startsWith(pre)) base.delete(x); base.delete(k); } else base.set(k, '{}'); continue; }
      if(o.d) base.delete(k); else base.set(k, JSON.stringify(o.v));
    }
    for(const sid of touched){
      const sp=DB.spaces[sid];
      if(!sp || sp.agentRun){ undoStack=undoStack.filter(e=>e.sid!==sid); redoStack=redoStack.filter(e=>e.sid!==sid); }
      else rebaseUndo(sid, mine);
      if(sp && sp.tree) withTree(sp.tree, ()=>{ if(!S.refs || !S.active || !S.convs || !S.fold) migrate(); });
    }
    if(touched.size) rebaseStoreUndo(mine);
    if(!DB.spaces[DB.current]){ enterSpace(DB.order.find(x=>DB.spaces[x]) || addSpace('My project', null)); }
    else if(DB.spaces[DB.current].tree!==curTree) S=DB.spaces[DB.current].tree;
    if(sel!=null && !S.nodes[sel]) sel=defaultSel();
    G=null; reconcileReplies();
    if(clash.length) toast(`Another tab or an agent changed ${clash.length===1?'something you were changing':clash.length+' things you were changing'} at the same moment; their version was kept.`);
    if(touched.has(DB.current)){ readCurrent(true); keepDraft(()=>render(true)); if(cmpFor!=null) renderCompare(); }
    else renderSpaces();
  }
  /* Undo snapshots of a project get the same change, so they only hold your own changes */
  function rebaseUndo(sid, ops){
    const tops=ops.filter(o=>o.p[0]==='db' && o.p[1]==='spaces' && o.p[2]===sid && o.p[3]==='tree');
    if(!tops.length) return;
    for(const st of [undoStack, redoStack]) for(const e of st){
      if(e.kind!=='tree' || e.sid!==sid) continue;
      try{ const w={db:{spaces:{[sid]:{tree:JSON.parse(e.s)}}}}; DL.apply(w, tops); e.s=JSON.stringify(w.db.spaces[sid].tree); }catch(err){}
    }
  }
  function rebaseStoreUndo(ops){
    const dops=ops.filter(o=>o.p[0]==='db' && !(o.p.length===2 && o.p[1]==='current'));
    if(!dops.length) return;
    for(const st of [undoStack, redoStack]) for(const e of st){
      if(e.kind!=='store') continue;
      try{ const w={db:JSON.parse(e.s)}; DL.apply(w, dops); e.s=JSON.stringify(w.db); }catch(err){}
    }
  }
  /* The server's copy is too far ahead to catch up change by change (it restarted, or a tab replaced the whole
     document): load it, and put this page's unsaved changes on top, except where it changed the same thing. */
  async function reloadDoc(){
    let raw=null, nrev=0;
    try{ const r=await fetch('/api/state'); nrev=+(r.headers.get('x-treechats-rev')||0); raw=r.status===200 ? await r.text() : null; }catch(e){ return; }
    const server=raw ? JSON.parse(raw) : {db:{spaces:{}, order:[], current:null, nextSpace:1}, opts:{}};
    const sU=DL.units(server);
    /* prompts both sides made with the same number: ours move first */
    for(const o of DL.diff(base, DL.units(live()))){ const nd=DL.nodeOf(o.p), k=DL.key(o.p); if(nd && !o.d && !base.has(k) && sU.has(k)){ const t=DB.spaces[nd.sid].tree; let n=Math.max(t.nextId||1, (DL.get(server, ['db','spaces',nd.sid,'tree','nextId'])||1)); while(t.nodes[n] || sU.has(DL.key(['db','spaces',nd.sid,'tree','nodes',String(n)]))) n++; renumberLocal(nd.sid, nd.id, n); } }
    const mine=DL.diff(base, DL.units(live())).filter(o=>{ const k=DL.key(o.p); return DL.isCounter(o.p) || DL.isContainer(o.p) || sU.get(k)===base.get(k); });
    DL.apply(server, mine);
    const keep=DB.current;
    for(const k of Object.keys(DB)) delete DB[k]; Object.assign(DB, server.db);
    for(const k of Object.keys(opts)) delete opts[k]; Object.assign(opts, server.opts||{});
    base=sU; rev=nrev; undoStack=[]; redoStack=[]; revMoved();
    enterSpace(DB.spaces[keep] ? keep : (DB.order.find(x=>DB.spaces[x]) || addSpace('My project', null)));
    G=null; reconcileReplies(); render(true);
    pending=true; push();
  }
  return {init, push, remote, flush, active, atLeast};
})();
