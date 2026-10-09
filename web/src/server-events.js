/* What the server tells the page as it happens: changes to the document, replies being written, scheduled
   runs, the lock. */

/* ---- Agents (Phase 1: subagents over MCP) ----
   The server relays commands from MCP clients (server/relay.ts); this page carries them out. Agents only ever work
   in their own run spaces, never in yours. Their changes skip your Undo, and every prompt they add carries their
   name. Operations wait for Claude's reply and return it. */
/* ---- Events from the server ----
   Agents work through MCP, and the server carries their operations out (server/agent.ts), so nothing here has to be
   open. This page is told about each change to the document (see Sync), about replies (see Replies), scheduled
   runs and the lock. */
const Agent=(()=>{
  function connect(){
    if(!window.TREECHATS_LOCAL || window.TREECHATS_LOCAL.offline || typeof EventSource==='undefined') return;
    const es=new EventSource('/api/agent/events');
    /* Treechats locked (Lock now, or the auto-lock): reloading clears the page and shows the unlock screen */
    es.addEventListener('lock', ()=>location.reload());
    /* the lock was turned on or off, or the token reset, in another tab: reload to match */
    es.addEventListener('vault', e=>{ if(e.data!==window.TREECHATS_TAB) location.reload(); });
    /* replies, written by the server: waiting, coming in (shown as it comes, with Stop), done */
    es.addEventListener('genwait', e=>{ try{ replyWaiting(JSON.parse(e.data)); }catch(err){} });
    es.addEventListener('gen', e=>{ try{ replyLive(JSON.parse(e.data)); }catch(err){} });
    es.addEventListener('gendone', e=>{ try{ replyDone(JSON.parse(e.data)); }catch(err){} });
    /* the document changed: another tab, an agent or a scheduled task */
    es.addEventListener('doc', e=>{ try{ Sync.remote(JSON.parse(e.data)); }catch(err){ console.warn('Treechats could not apply a change from the server:', err); } });
    /* a scheduled task ran (its prompt and reply came as a change to the document) */
    es.addEventListener('scheduled', e=>{
      let d; try{ d=JSON.parse(e.data); }catch(err){ return; }
      if(d.error) toast(`Scheduled task “${clip(d.name||'',40)}” didn’t run: ${d.error}`, false, {label:'See tasks', fn:()=>openSchedules()});
      else if(d.sid===DB.current){ const ids=all().filter(n=>n.sched && n.sched.id===d.task).map(n=>n.id), last=ids[ids.length-1]; toast(`A scheduled task ran: “${clip(d.name||'',40)}”`, false, last!=null ? {label:'Open', fn:()=>gotoNode(last)} : undefined); }
      renderSpaces(); if(schedUI) refreshSchedStatus();
    });
  }
  return {connect};
})();
