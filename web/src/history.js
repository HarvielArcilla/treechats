/* Undo and redo: every change you make goes through commit(), which keeps what to go back to. */

/* history */
function commit(msg, fn, o={}){
  if(choosing!=null) finishChoosing(true);
  const before = JSON.stringify(S), prevSel = sel;
  const pre = {}; for(const [rid,r] of Object.entries(S.refs||{})) pre[rid] = S.nodes[r.tip] ? chain(r.tip) : [];
  /* the graph cache describes the tree before the change; changes always read the live tree */
  G=null; fn(); G=null;
  DB.spaces[DB.current].tree=S;
  if(!S.refs || !S.active) migrate();
  /* a branch whose tip was deleted falls back to its nearest surviving ancestor, like a reset */
  for(const [rid,r] of Object.entries(S.refs)){
    if(S.nodes[r.tip]) continue;
    const back=(pre[rid]||[]).slice().reverse().find(x=>S.nodes[x]);
    if(back!=null) r.tip=back;
  }
  tidy(); applyVis();
  if(JSON.stringify(S)===before) return;
  pushUndo({kind:'tree', sid:DB.current, s:before});
  if((sel==null && prevSel!=null) || (sel!=null && !S.nodes[sel]) || (sel!=null && o.hidden && isHidden(S.nodes[chain(sel)[0]]))) sel = defaultSel();
  setActivePath(sel); syncHead(); if(o.touch!==false) touch(sel); save();
  reconcileReplies();
  if(o.swap) swapView(()=>render(true)); else showSelection(prevSel);
  /* the message can be worked out from the change itself (a function, called after it) */
  if(!o.quiet) toast(typeof msg==='function' ? msg() : msg, true, o.action);
  if(typeof scanNewBranches==='function') setTimeout(scanNewBranches, 0);
}
const snapshotDB = () => JSON.stringify({spaces:DB.spaces, order:DB.order, current:DB.current, nextSpace:DB.nextSpace});
function pushUndo(e){ undoStack.push(e); if(undoStack.length>120) undoStack.shift(); redoStack=[]; }
/* the state an entry would overwrite, so undo and redo can swap them */
function capture(e){ return e.kind==='store' ? {kind:'store', s:snapshotDB()} : {kind:'tree', sid:e.sid, s:JSON.stringify(DB.spaces[e.sid].tree)}; }
function restore(e){
  if(e.kind==='store'){
    const was=DB.spaces, wasNext=DB.nextSpace;
    Object.assign(DB, JSON.parse(e.s));
    /* ids are never reused, or a project made after the undo could take the id of one an agent made meanwhile */
    DB.nextSpace=Math.max(DB.nextSpace, wasNext);
    for(const sid of Object.keys(DB.spaces)) if(was[sid]) keepReplies(was[sid].tree, DB.spaces[sid].tree);
    /* agent run spaces are the agent's: your Undo leaves them exactly as they are */
    for(const [sid, sp] of Object.entries(was)) if(sp.agentRun){ DB.spaces[sid]=sp; if(!DB.order.includes(sid)) DB.order.unshift(sid); }
    enterSpace(DB.spaces[DB.current] ? DB.current : spaceIds()[0]);
    reconcileReplies();
    save(); render(true); Motion.swap(treeEl); return;
  }
  const was=DB.spaces[e.sid].tree;
  DB.spaces[e.sid].tree=JSON.parse(e.s);
  keepReplies(was, DB.spaces[e.sid].tree);
  reconcileReplies();
  if(e.sid!==DB.current){ save(); enterSpace(e.sid); save(); render(true); Motion.swap(treeEl); return; }
  S=DB.spaces[e.sid].tree; fix();
}
/* Replies arrive on their own time, outside undo. When undo brings back an earlier copy of a prompt,
   the reply it got since comes along, so undoing something else never throws a reply away. */
function keepReplies(from, to){
  if(!from || !to || from===to) return;
  for(const [k,n] of Object.entries(to.nodes)){
    const o=from.nodes[k];
    if(o && o.reply && !n.reply && o.text===n.text && String(o.parents)===String(n.parents)){ n.reply=o.reply; if(o.model) n.model=o.model; delete n.askTier; }
  }
}
const usable = e => e.kind==='store' || !!DB.spaces[e.sid];
function undo(){
  while(undoStack.length && !usable(undoStack[undoStack.length-1])) undoStack.pop();
  if(!undoStack.length) return;
  const e=undoStack.pop(); redoStack.push(capture(e)); restore(e); toast('Undone');
}
function redo(){
  while(redoStack.length && !usable(redoStack[redoStack.length-1])) redoStack.pop();
  if(!redoStack.length) return;
  const e=redoStack.pop(); undoStack.push(capture(e)); restore(e); toast('Redone');
}
