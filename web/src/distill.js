/* ✦ Distill: a brief of the context, to start fresh from or keep. */

/* ---- Distill ----
   Claude writes a brief of everything up to a prompt (goal, decisions, facts, open questions) that you can edit,
   then use to start a fresh conversation, keep as a space file, keep as a note, or copy. It never changes the tree
   by itself. */
let distill=null;
async function openDistill(id){
  if(id==null || !S.nodes[id]){ toast('Select a prompt first. The brief covers its chat up to it.'); return; }
  if(sampleState!=='ready'){ toast('Distill needs Claude. Add an API key or sign in to Claude Code, then restart Treechats.'); return; }
  const convo0=turnsFor(id, true).map(t=>`${t.role==='user'?'User':'Claude'}: ${t.content}`).join('\n\n');
  const tpl=await askTemplate('distill', {conversation:convo0}, `Distill up to #${id}`); if(tpl==null) return;
  if(distill && distill.ctl) distill.ctl.abort();
  closeCompare && cmpFor!=null && closeCompare();
  const ctl=new AbortController(), d={id, status:'loading', text:'', ctl};
  distill=d; fan=null;
  if(sel!==id) select(id); else animRender([id]);
  const el=treeEl.querySelector('.distill'); if(el) el.scrollIntoView({block:'nearest', behavior: Motion.reduced()?'auto':'smooth'});
  const convo=turnsFor(id, true).map(t=>`${t.role==='user'?'User':'Claude'}: ${t.content}`).join('\n\n');
  const input=fillPrompt('distill', {conversation:convo}, tpl);
  try{
    const r=await sampleFn(input, {modelTier:opts.model, cache:false, signal:ctl.signal, onText:({text})=>{ if(distill===d){ d.text=text; const b=treeEl.querySelector('.distill .rbody'); if(b) b.innerHTML=md(text); } }});
    if(distill!==d) return;
    d.text=r.text.trim(); d.status='ready';
  }catch(e){
    if(distill!==d) return;
    d.status = e && e.code==='cancelled' ? 'ready' : 'error'; d.err=errCopy(e && e.code); if(e && e.text) d.text=e.text;
  }
  d.ctl=null; paintDistill();
  const t=document.getElementById('distillText'); if(t) t.focus({preventScroll:true});
}
function paintDistill(){ const el=treeEl.querySelector('.distill'); if(el && distill) el.outerHTML=distillHTML(); else if(distill) animRender([distill.id]); }
function closeDistill(){ if(!distill) return; const id=distill.id; if(distill.ctl) distill.ctl.abort(); distill=null; animRender([id]); }
function distillHTML(){
  const d=distill, id=d.id, n=d.text.trim() ? 1 : 0;
  const head=`<div class="fanhead"><b>Brief of the context up to #${id}</b><span class="note">${d.status==='loading'?'Claude is writing it…':'Edit it before you use it.'}</span><button class="rmore" data-dcancel>${d.status==='loading'?'Stop':'Close'}</button></div>`;
  const body = d.status==='loading'
    ? `<div class="rbody">${d.text?md(d.text):'<p class="thinking">Reading the chat…</p>'}</div>`
    : `${d.status==='error'?`<p class="gnote">${esc(d.err||'Claude couldn’t write the brief.')}</p>`:''}<textarea id="distillText" rows="${Math.min(22, Math.max(6, d.text.split('\n').length+1))}" aria-label="Brief">${esc(d.text)}</textarea>
      <div class="bar"><button class="btn primary" data-dgo="new" ${n?'':'disabled'} title="A new chat whose first prompt starts with this brief">Start a new chat with it</button><button class="btn" data-dgo="file" ${n?'':'disabled'} title="Sent with every chat in this project">Add to project files</button><button class="btn" data-dgo="note" ${n?'':'disabled'} title="Kept on #${id}, never sent to Claude">Save as note</button><button class="btn" data-dgo="copy" ${n?'':'disabled'}>Copy</button>${hasServer() && linkedRoots().length ? `<button class="btn" data-dgo="repo" ${n?'':'disabled'} aria-haspopup="menu" title="Add it to CLAUDE.md or AGENTS.md in a linked folder, so coding agents start with it">Add to the repo ▾</button>` : ''}<button class="btn" data-dgo="again">Write again</button></div>`;
  return `<div class="fan distill" data-key="ds${id}">${head}${body}</div>`;
}
/* a brief written into the repo: appended to CLAUDE.md (read by Claude Code) or AGENTS.md (read by Codex and others)
   in a linked folder, under a heading naming the chat, so coding agents start from what was worked out here */
function repoMenu(anchor){
  const d=distill; if(!d) return;
  const t=document.getElementById('distillText'); if(t) d.text=t.value;
  const items=[];
  for(const r of linkedRoots()) for(const f of ['CLAUDE.md','AGENTS.md']) items.push({label:`Add to ${f} in ${rootName(r)}`, run:()=>briefToRepo(r, f, d.text.trim(), d.id)});
  openMenu(anchor, items);
}
async function briefToRepo(root, file, text, id){
  if(!text) return;
  try{
    await flushState();
    const [cur]=await folderApi('/api/folder/read', {root, paths:[file]});
    const exists=cur && cur.text!=null;
    if(cur && cur.text==null && !/couldn’t be read/.test(cur.error||'')) throw new Error(`${file}: ${cur.error}`);
    const title=convTitle(S.nodes[chain(id)[0]]), day=new Date().toISOString().slice(0,10);
    const block=`## ${title}\n\n_From a Treechats chat, ${day}._\n\n${text.replace(/^#\s+/gm,'### ')}\n`;
    const next=exists ? cur.text.replace(/\s*$/,'')+'\n\n'+block : block;
    await folderApi('/api/folder/write', {root, path:file, text:next, mtime: exists ? cur.mtime : null});
    distill=null; animRender([id]);
    if((S.files||[]).some(m=>m.src && m.src.root===root && m.src.path===file)) syncFolder(root);
    toast(`${exists?'Added the brief to':'Created'} ${file} in ${rootName(root)}.`);
  }catch(e){ toast(e.message); }
}
async function useDistill(how){
  const d=distill; if(!d) return;
  const t=document.getElementById('distillText'); if(t) d.text=t.value;
  const text=d.text.trim(); if(!text && how!=='again') return;
  if(how==='again'){ openDistill(d.id); return; }
  if(how==='copy'){ copyText(text); return; }
  const id=d.id, title=convTitle(S.nodes[convOf(id)]);
  if(how==='note'){ distill=null; commit(`Saved the brief as a note on #${id}`, ()=>{ const n=S.nodes[id]; n.note=(n.note&&n.note.trim()?n.note.trim()+'\n\n':'')+text; }); renderNotes(); return; }
  if(how==='file'){
    const name=`brief-${slugName(title, convOf(id)).slice(0,32)}.md`;
    distill=null; animRender([id]);
    await addFiles([new File([text], name, {type:'text/markdown'})], 'space');
    return;
  }
  if(how==='new'){
    distill=null; draftRoot=`${text}\n\n---\n\n`; composeFor='root'; pick=null;
    render(true); Motion.swap(treeEl); window.scrollTo({top:0});
    const ct=document.getElementById('composeText'); if(ct){ ct.focus({preventScroll:true}); ct.setSelectionRange(ct.value.length, ct.value.length); ct.scrollTop=ct.scrollHeight; }
    toast('The brief is in a new chat. Write your question under it and send.');
  }
}
