/* Chat view: one conversation as a thread, with branch switching and merges. */

/* ---- Chat view ----
   One conversation, read top to bottom like a chat: the line from its start to the tip of the branch you're on,
   with Claude's replies in full and the input box at the end. Where the conversation branches, ‹ 1 / 3 › on the
   prompt switches between the branches, the way Claude switches between edits. Nothing about the tree changes. */
let simpleTip=null;
function threadTip(id){
  if(simpleTip!=null && S.nodes[simpleTip] && path(simpleTip).includes(id)) return simpleTip;
  const h=headTip(); if(h!=null && path(h).includes(id)) return h;
  const rid=refsThrough(id)[0]; return rid ? S.refs[rid].tip : leafOf(id);
}
const composeParent = () => opts.simple && !pick && simpleTip!=null && S.nodes[simpleTip] ? simpleTip : sel;
function forkHTML(id){
  const n=S.nodes[id], p=n.parents[0]; if(n.kind==='merge') return '';
  /* a first prompt has no siblings, only its own versions */
  const sib = p==null ? versions(id).map(x=>S.nodes[x]) : primaryKids(p).filter(k=>k.kind!=='merge'); if(sib.length<2) return '';
  const i=sib.findIndex(k=>k.id===id); if(i<0) return '';
  const go=j=>sib[j] ? `data-forkgo="${sib[j].id}"` : 'disabled';
  return `<span class="fork" title="Other versions and branches from here"><button ${go(i-1)} aria-label="Previous branch">‹</button><span>${i+1} / ${sib.length}</span><button ${go(i+1)} aria-label="Next branch">›</button></span>`;
}
function lenGroupHTML(rl=lenMode()){
  return `<div class="vgroup" role="group" aria-label="Reply length"><span>Length</span>${[['full','Full','Every reply in full'],['short','Shorten','Long replies away from the selected prompt are cut short']].map(([v,l,t])=>`<button class="seg" data-rlen="${v}" aria-pressed="${rl===v}" title="${t}">${l}</button>`).join('')}</div>`;
}
function newChatHTML(hasChats){
  const sp=DB.spaces[DB.current], files=(S.files||[]).length;
  return `<section class="conv thread newchat" data-key="cv${S.nextId}"><div class="chathead" data-key="chathead"><button class="chatproj" data-projmenu aria-haspopup="menu" title="Project options">${esc(sp.name)}</button><div class="chattitle"><h1>New chat</h1></div></div>
    <div class="newchatbody" data-key="ncbody"><p class="ncgreet">What are you working on?</p><p class="note">${hasChats?`A new chat in ${esc(sp.name)}.`:`The first chat in ${esc(sp.name)}.`}${files?` It starts with the project’s ${files} file${files===1?'':'s'}.`:''} Type <code>/</code> for commands and saved prompts.</p></div>
    <div class="ops simpleops" data-key="osimple">${composerHTML('root')}</div></section>`;
}
function simpleHTML(){
  const rs=orderedRoots();
  let base = sel!=null && S.nodes[sel] ? sel : null;
  if(base==null){ const k=lastConvKey(), r=rs.find(x=>convKey(x)===k) || rs[0]; base=r ? convTip(r) : null; }
  if(base==null) return '';
  const tip=threadTip(base); simpleTip=tip;
  const c=chain(tip), pathSet=new Set(path(tip)), r=S.nodes[c[0]];
  /* the thread follows this conversation's own line; what a merge brings in folds into one line at the merge */
  const items=c.map(id=>`<li class="g" data-key="n${S.nodes[id].alt ?? id}">${S.nodes[id].kind==='merge' ? mergeBoxHTML(id, pathSet) : rowHTML(id, pathSet)}</li>`).join('');
  return `<section class="conv thread" data-conv="${r.id}" data-key="cv${convKey(r)}"><div class="chathead" data-key="chathead"><button class="chatproj" data-projmenu aria-haspopup="menu" title="Project options">${esc(DB.spaces[DB.current].name)}</button><div class="chattitle"><h1>${esc(convTitle(r))}</h1><button class="btn xs" data-convmenu="${r.id}" aria-haspopup="menu" aria-label="Chat options">⋯</button></div>${isArchived(r)?`<p class="archnote">Archived <button class="linkbtn" data-unarchive="${convKey(r)}">Unarchive</button></p>`:''}</div><ul class="tree thread">${items}</ul><div class="ops simpleops" data-key="osimple">${composerHTML(tip)}</div></section>`;
}
/* A merge in the thread: one line saying which branch came in, opening to the note Claude reads at the join
   and the prompts and replies the branch brings, which Claude sees as part of this conversation. */
const openMerges=new Set();
function mergeBoxHTML(m, pathSet){
  const n=S.nodes[m], seen=new Set(path(n.parents[0])), inn=[];
  for(const q of n.parents.slice(1)) for(const x of path(q)) if(!seen.has(x)){ seen.add(x); if(S.nodes[x].kind!=='merge') inn.push(x); }
  const from=n.from || '#'+n.parents[1], k=inn.length, open=openMerges.has(m) || inn.includes(sel);
  return `<details class="mergebox" data-mergebox="${m}" ${open?'open':''}><summary><span class="mic" aria-hidden="true">⤵</span><span class="mwhat"><b>${esc(from)}</b> merged in here</span><span class="mmeta">${k} prompt${k===1?'':'s'} with replies · Claude sees ${k===1?'it':'them'} too</span></summary>
    <div class="mbody"><p class="note">Claude reads this note, then the prompts below, as part of this chat:</p><blockquote class="seamq">${esc(n.seam || promptText('seam'))}</blockquote>
    <ul class="tree thread">${inn.map(x=>`<li class="g" data-key="n${S.nodes[x].alt ?? x}">${rowHTML(x, pathSet)}</li>`).join('')}</ul></div></details>`;
}
treeEl.addEventListener('toggle', e=>{ const d=e.target; if(d.dataset && d.dataset.mergebox!=null){ const m=+d.dataset.mergebox; d.open ? openMerges.add(m) : openMerges.delete(m); } }, true);
function scrollThreadEnd(){ followEnd=true; requestAnimationFrame(()=>{ if(treeEl.querySelector('.simpleops')) window.scrollTo(0, document.documentElement.scrollHeight); }); }
