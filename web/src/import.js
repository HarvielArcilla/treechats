/* Importing chats: pasted text, Claude and ChatGPT exports, Claude Code and Codex sessions. */

/* ---- Import chats ----
   Everything becomes a list of messages {id, parent, role, text}; one builder turns that into prompts and replies.
   Siblings mean different things by source: in a ChatGPT or Claude export they are edits and regenerations, so they
   become versions; in a Treechats export they are branches. */
function msgText(v){ return typeof v==='string' ? v : ''; }
function fromChatGPT(c){
  const map=c.mapping||{}, msgs=[];
  for(const [id,nd] of Object.entries(map)){
    const m=nd.message, role=m && m.author && m.author.role, ct=m && m.content;
    let text='';
    if(ct){ if(Array.isArray(ct.parts)) text=ct.parts.map(p=>typeof p==='string'?p:(p && p.content_type && /image/.test(p.content_type)?'[image]':'')).filter(Boolean).join('\n\n'); else if(typeof ct.text==='string') text=ct.text; }
    const hidden = m && m.metadata && m.metadata.is_visually_hidden_from_conversation;
    msgs.push({id, parent:nd.parent ?? null, role: hidden ? 'other' : role==='user'||role==='assistant' ? role : 'other', text:text.trim()});
  }
  return {title:c.title||'Imported chat', msgs, current:c.current_node||null, siblings:'versions', source:'ChatGPT'};
}
function fromClaude(c){
  const ms=c.chat_messages||[], ROOT='00000000-0000-4000-8000-000000000000';
  const hasParents=ms.some(m=>m.parent_message_uuid);
  const msgs=ms.map((m,i)=>{
    let text=msgText(m.text);
    if(!text && Array.isArray(m.content)) text=m.content.filter(x=>x && x.type==='text').map(x=>x.text).join('\n\n');
    const files=[...(m.attachments||[]), ...(m.files||[])].map(f=>f.file_name||f.name).filter(Boolean);
    if(files.length) text=(text?text+'\n\n':'')+'[Attached: '+files.join(', ')+']';
    return {id:m.uuid||('m'+i), parent: hasParents ? (m.parent_message_uuid && m.parent_message_uuid!==ROOT ? m.parent_message_uuid : null) : (i ? (ms[i-1].uuid||('m'+(i-1))) : null), role: m.sender==='human'?'user':m.sender==='assistant'?'assistant':'other', text:(text||'').trim()};
  });
  return {title:c.name||'Imported chat', msgs, current:c.current_leaf_message_uuid||null, siblings:'versions', source:'Claude'};
}
const SPEAKER_U=/^\s*(?:\*\*|#{1,4}\s*)?(you|user|human|me|q|prompt)(?:\s*·\s*#(\d+))?(?:\s*·[^:\n]*)?(?:\*\*)?\s*(?::|：|$)\s*(.*)$/i;
const SPEAKER_A=/^\s*(?:\*\*|#{1,4}\s*)?(claude|assistant|chatgpt|gpt-?[\w.]*|ai|gemini|bot|a|answer|response)(?:\*\*)?\s*(?::|：|$)\s*(.*)$/i;
function fromText(txt){
  const lines=txt.replace(/\r\n?/g,'\n').split('\n');
  let title=null, cur=null, branchFrom=null, branchName=null, last=null, n=0;
  const msgs=[], byNum={};
  const flush=()=>{ if(cur){ cur.text=cur.text.join('\n').replace(/\n*(> Note:[\s\S]*)$/,'').trim(); const nm=cur.noteLines; msgs.push(cur); cur=null; } };
  for(const line of lines){
    const h1=line.match(/^#\s+(.+)$/); if(h1 && title==null && !msgs.length && !cur){ title=h1[1].trim(); continue; }
    const br=line.match(/^##\s+Branch\s*([^·\n]*?)\s*·\s*from\s*#(\d+)\s*$/i);
    if(br){ flush(); branchName=br[1].trim()||null; branchFrom=+br[2]; continue; }
    const u=line.match(SPEAKER_U), a=!u && line.match(SPEAKER_A);
    const headingish = /^\s*(#{1,4}\s|\*\*)/.test(line) || /:\s*/.test(line);
    if(u && (u[3]!=null) && headingish){
      flush();
      const id='u'+(n++);
      let parent = last;
      if(branchFrom!=null){ const tgt=byNum[branchFrom]; parent = tgt ? (tgt.reply||tgt.user) : last; }
      cur={id, parent, role:'user', text:[u[3]].filter(x=>x!==''), branch:branchFrom!=null?branchName:null};
      if(u[2]) byNum[+u[2]]={user:id};
      branchFrom=null; branchName=null; last=id; cur.num=u[2]?+u[2]:null; continue;
    }
    if(a && headingish){
      const pnum = cur && cur.role==='user' ? cur.num : null;
      flush();
      const id='a'+(n++); cur={id, parent:last, role:'assistant', text:[a[2]].filter(x=>x!=='')};
      if(pnum!=null && byNum[pnum]) byNum[pnum].reply=id;
      last=id; continue;
    }
    if(/^\*Merged .* into .*\.\*$/.test(line.trim())) continue;
    if(cur) cur.text.push(line);
  }
  flush();
  if(!msgs.some(m=>m.role==='user')) return null;
  const firstU=msgs.find(m=>m.role==='user');
  return {title: title || clip(firstU.text.replace(/\s+/g,' '),80) || 'Imported chat', msgs, current:null, siblings:'branches', source:'text'};
}
function parseImport(txt){
  const t=txt.trim(); if(!t) return {convs:[], error:null};
  if(/^[\[{]/.test(t)){
    let d; try{ d=JSON.parse(t); }catch(e){ return {convs:[], error:'That looks like JSON but couldn’t be read. Check that the whole file was pasted.'}; }
    const arr=Array.isArray(d) ? d : [d], out=[];
    for(const c of arr){ if(c && c.mapping) out.push(fromChatGPT(c)); else if(c && Array.isArray(c.chat_messages)) out.push(fromClaude(c)); }
    if(!out.length) return {convs:[], error:'No chats found in that JSON. Use conversations.json from a Claude or ChatGPT data export. To restore a Treechats project, use “Import pasted JSON as a new project” instead.'};
    return {convs:out.map(c=>Object.assign(c, buildTurns(c))).filter(c=>c.turns.length), error:null};
  }
  const c=fromText(t);
  if(!c) return {convs:[], error:'Couldn’t tell who said what. Put a label like “You:” or “Claude:” at the start of each message.'};
  Object.assign(c, buildTurns(c));
  return {convs:[c], error:null};
}
/* messages → turns (prompt + reply). Returns {turns:[{k, parent, text, reply, alt, branch}], mainLeaf} */
function buildTurns(c){
  const byParent=new Map(), byId=new Map();
  for(const m of c.msgs){ byId.set(m.id, m); const p=m.parent!=null && c.msgs.some(x=>x.id===m.parent) ? m.parent : null; m.parent=p; if(!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(m); }
  const turns=[], turnOf=new Map(); let k=0;
  const newTurn=(parent, text, extra={})=>{ const t={k:k++, parent, text, ...extra}; turns.push(t); return t; };
  /* visit the children of one message. ctx.parent: turn new prompts attach to; ctx.turn: turn waiting for its reply */
  const kidsOf=id=>byParent.get(id)||[];
  function visit(list, ctx){
    const isU=m=>m.role==='user' && m.text, isA=m=>m.role==='assistant' && m.text;
    for(const o of list.filter(m=>!isU(m) && !isA(m))){ const t=ctx.turn||ctx.parent; if(t) turnOf.set(o.id, t); visit(kidsOf(o.id), ctx); }
    const attach=ctx.turn||ctx.parent;
    let firstU=null;
    for(const u of list.filter(isU)){
      let t;
      if(c.siblings==='versions' && firstU){ t=newTurn(firstU.parent, u.text, {alt:firstU.k}); firstU.alt=firstU.k; }
      else { t=newTurn(attach ? attach.k : null, u.text, {branch:u.branch||null}); if(!firstU) firstU=t; }
      turnOf.set(u.id, t);
      visit(kidsOf(u.id), {parent:attach, turn:t});
    }
    let firstA=null;
    for(const a of list.filter(isA)){
      let t;
      if(ctx.turn){
        if(!firstA){ t=ctx.turn; t.reply=a.text; firstA=t; }
        else if(c.siblings==='versions'){ t=newTurn(firstA.parent, firstA.text, {alt:firstA.k, reply:a.text}); firstA.alt=firstA.k; }
        else { t=ctx.turn; t.reply+='\n\n'+a.text; }
      } else if(ctx.parent){ t=ctx.parent; t.reply = t.reply ? t.reply+'\n\n'+a.text : a.text; }
      else t=newTurn(null, '(The chat started with this reply)', {reply:a.text});
      turnOf.set(a.id, t);
      visit(kidsOf(a.id), {parent:t, turn:null});
    }
  }
  visit(byParent.get(null)||[], {parent:null, turn:null});
  let mainLeaf=null;
  if(c.current && turnOf.has(c.current)) mainLeaf=turnOf.get(c.current);
  if(!mainLeaf){ const last=[...c.msgs].reverse().find(m=>turnOf.has(m.id)); mainLeaf=last ? turnOf.get(last.id) : turns[turns.length-1]; }
  return {turns, mainLeaf: mainLeaf ? mainLeaf.k : null};
}
let impParsed={convs:[], error:null}, impChecked=new Set(), impReturn=null;
const impEl=()=>document.getElementById('importDlg');
function openImport(){
  if(!setEl.hidden) closeSettings();
  impReturn=document.activeElement; closeMenu && menuEl && closeMenu();
  const t=document.getElementById('impText'); t.value=''; document.getElementById('impFileName').textContent='';
  impParsed={convs:[], error:null}; impChecked=new Set(); impSess=null; renderImpSessions();
  const sp=document.getElementById('impSpace');
  sp.innerHTML=spaceIds().map(id=>`<option value="${id}" ${id===DB.current?'selected':''}>${esc(DB.spaces[id].name)}</option>`).join('')+'<option value="new">A new project</option>';
  renderImportPreview(); impEl().hidden=false; document.body.style.overflow='hidden'; t.focus({preventScroll:true});
}
function closeImport(){ impEl().hidden=true; document.body.style.overflow=''; if(impReturn && impReturn.focus && document.contains(impReturn)) impReturn.focus({preventScroll:true}); }
function parseImportNow(txt){ impParsed=parseImport(txt); impChecked=new Set(impParsed.convs.map((_,i)=>i)); renderImportPreview(); }
function renderImportPreview(){
  const el=document.getElementById('impPreview'), go=impEl().querySelector('[data-impgo]');
  const {convs, error}=impParsed;
  if(error){ el.innerHTML=`<p class="note imperr">${esc(error)}</p>`; go.disabled=true; go.textContent='Import'; return; }
  if(!convs.length){ el.innerHTML=''; go.disabled=true; go.textContent='Import'; return; }
  const row=(c,i)=>{ const prompts=c.turns.filter(t=>t.alt==null||t.alt===t.k).length, vers=c.turns.length-prompts, branches=c.turns.filter(t=>t.branch).length;
    return `<li><label class="chk"><input type="checkbox" data-impc="${i}" ${impChecked.has(i)?'checked':''}> <span><b>${esc(clip(c.title,90))}</b><small>${prompts} prompt${prompts===1?'':'s'}${vers?` · ${vers} other version${vers===1?'':'s'}`:''}${branches?` · ${branches} branch${branches===1?'':'es'}`:''}${c.source!=='text'?` · from ${c.source}`:''}</small></span></label></li>`; };
  el.innerHTML = `<div class="imphead"><b>Found ${convs.length} chat${convs.length===1?'':'s'}</b>${convs.length>1?`<button class="rmore" data-impall>${impChecked.size===convs.length?'Select none':'Select all'}</button>`:''}</div><ul class="implist">${convs.map(row).join('')}</ul>`;
  const n=impChecked.size; go.disabled=!n; go.textContent = n ? `Import ${n} chat${n===1?'':'s'}` : 'Import';
}
/* Claude Code and Codex sessions from this computer: listed on request, each read into a chat for the list above */
let impSess=null;
function renderImpSessions(){
  const el=document.getElementById('impSessions'); if(!el) return;
  if(!hasServer()){ el.innerHTML=''; return; }
  if(!impSess){ el.innerHTML=`<div class="impsess"><button class="btn" data-sesslist>Coding sessions on this computer…</button><span class="note">Claude Code and Codex keep a log of every session. Open one as a chat to see what the agent saw at each step, then fork, leave turns out or replay.</span></div>`; return; }
  if(impSess.loading){ el.innerHTML='<p class="note thinking">Looking for sessions…</p>'; return; }
  if(impSess.error){ el.innerHTML=`<p class="note imperr">${esc(impSess.error)}</p>`; return; }
  const list=impSess.sessions, q=(impSess.q||'').toLowerCase(), shown=list.filter(x=>!q || (x.title+' '+(x.cwd||'')).toLowerCase().includes(q));
  if(!list.length){ el.innerHTML=`<p class="note">No sessions found in ${esc(impSess.dirs['claude-code'])} or ${esc(impSess.dirs.codex)}.</p>`; return; }
  const ago=t=>{ const m=Math.round((Date.now()-t)/60000); return m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} h ago`:`${Math.round(m/1440)} d ago`; };
  el.innerHTML=`<div class="impsess"><div class="frowin"><input type="search" id="sessFilter" placeholder="Filter by title or folder" value="${esc(impSess.q||'')}" aria-label="Filter sessions"></div>
    <ul class="sesslist">${shown.slice(0,80).map(x=>{ const i=list.indexOf(x), added=impSess.added.has(i); return `<li><button class="sessrow" data-sessadd="${i}" ${added||impSess.reading===i?'disabled':''}><span class="sesst">${esc(x.title)}</span><span class="note">${x.source==='codex'?'Codex':'Claude Code'} · ${esc(x.cwd||'')} · ${ago(x.updated)} · ${fmtSize(x.size)}</span><span class="sessgo">${added?'Added':impSess.reading===i?'Reading…':'Add'}</span></button></li>`; }).join('')}</ul></div>`;
}
async function addSessionConv(load, label){
  try{
    const c=await load();
    if(!c.turns || !c.turns.length){ toast(`${label}: no prompts found in that log.`); return false; }
    c.title=c.cwd ? `${c.title}` : c.title;
    impParsed={convs:[...(impParsed.convs||[]), c], error:null}; impChecked.add(impParsed.convs.length-1); renderImportPreview();
    return true;
  }catch(e){ toast(e.message); return false; }
}
function insertImported(c){
  const map=new Map();
  for(const t of c.turns){
    const nid=S.nextId++; map.set(t.k, nid);
    S.nodes[nid]={id:nid, parents: t.parent!=null ? [map.get(t.parent)] : [], text:t.text||''};
    if(t.reply) S.nodes[nid].reply=t.reply;
    if(t.usage) S.nodes[nid].usage=t.usage; if(t.thinking) S.nodes[nid].thinking=t.thinking;
    if(c.source==='Claude Code' || c.source==='Codex') S.nodes[nid].imported={from:c.source, ...(t.model?{model:t.model}:{}), ...(t.tag?{tag:t.tag}:{}), ...(t.notes?{notes:t.notes}:{})};
  }
  for(const t of c.turns) if(t.alt!=null && map.has(t.alt)) S.nodes[map.get(t.k)].alt=map.get(t.alt);
  const leaf=map.get(c.mainLeaf ?? c.turns[c.turns.length-1].k);
  setActivePath(leaf);
  const root=S.nodes[chain(leaf)[0]];
  S.convs[convKey(root)]=Object.assign(S.convs[convKey(root)]||{}, {title:clip(c.title,120), t:Date.now()});
  newRef('main', leafOf(leaf));
  const conv=root.id;
  for(const t of c.turns) if(t.branch){ const id=map.get(t.k); newRef(slugName(t.branch, conv), leafOf(id)); }
  return leaf;
}
function runImport(){
  const pick=[...impChecked].sort((a,b)=>a-b).map(i=>impParsed.convs[i]).filter(Boolean); if(!pick.length) return;
  const to=document.getElementById('impSpace').value;
  closeImport();
  const msg=`Imported ${pick.length} chat${pick.length===1?'':'s'}`;
  if(to===DB.current){
    let lastLeaf=null;
    commit(msg, ()=>{ for(const c of pick) lastLeaf=insertImported(c); if(lastLeaf!=null){ sel=lastLeaf; setActivePath(sel); S.head=refsAt(sel)[0] ?? null; } });
    const k=convKeyOf(sel), sec=k!=null && treeEl.querySelector(`.conv[data-key="cv${k}"]`); if(sec) sec.scrollIntoView({block:'start'});
  } else {
    storeCommit(msg, ()=>{
      const target = to==='new' ? addSpace(uniqueSpaceName(pick.length===1 ? clip(pick[0].title,40) : 'Imported chats'), null) : to;
      save(); withTree(DB.spaces[target].tree, ()=>{ migrate(); let leaf=null; for(const c of pick) leaf=insertImported(c); tidy(); DB.spaces[target].sel=leaf; });
      DB.current=target;
    });
  }
}
document.getElementById('impText').addEventListener('input', e=>{ clearTimeout(parseImportNow.t); parseImportNow.t=setTimeout(()=>parseImportNow(e.target.value), 250); });
const impPicker=document.createElement('input'); impPicker.type='file'; impPicker.accept='.json,.jsonl,.md,.markdown,.txt,application/json,text/*'; impPicker.hidden=true; document.body.append(impPicker);
impPicker.addEventListener('change', async ()=>{
  const f=impPicker.files[0]; if(!f) return;
  if(f.size>200*1024*1024){ toast('That file is over 200 MB. Try exporting fewer chats.'); return; }
  document.getElementById('impFileName').textContent=`${f.name} · ${fmtSize(f.size)}`;
  const txt=await f.text();
  if(/\.jsonl$/i.test(f.name)){ addSessionConv(()=>folderApi('/api/sessions/parse', {text:txt}), f.name); return; }
  const ta=document.getElementById('impText'); ta.value = txt.length>20000 ? '' : txt; ta.placeholder = txt.length>20000 ? `Read ${f.name}. Its chats are listed below.` : ta.placeholder;
  parseImportNow(txt);
});
impEl().addEventListener('click', e=>{
  const c=x=>e.target.closest(x);
  if(e.target===impEl() || c('[data-impclose]')){ closeImport(); return; }
  if(c('[data-impfile]')){ impPicker.value=''; impPicker.click(); return; }
  if(c('[data-impall]')){ if(impChecked.size===impParsed.convs.length) impChecked.clear(); else impParsed.convs.forEach((_,i)=>impChecked.add(i)); renderImportPreview(); return; }
  if(c('[data-impgo]')){ runImport(); return; }
  if(c('[data-sesslist]')){ impSess={loading:true}; renderImpSessions(); folderApi('/api/sessions/list', {}).then(d=>{ impSess={sessions:d.sessions, dirs:d.dirs, added:new Set(), q:''}; renderImpSessions(); }).catch(e=>{ impSess={error:e.message}; renderImpSessions(); }); return; }
  const sa=c('[data-sessadd]'); if(sa && impSess && impSess.sessions){ const i=+sa.dataset.sessadd, x=impSess.sessions[i]; impSess.reading=i; renderImpSessions(); addSessionConv(()=>folderApi('/api/sessions/read', {source:x.source, file:x.file}), x.title).then(ok=>{ impSess.reading=null; if(ok) impSess.added.add(i); renderImpSessions(); }); return; }
});
impEl().addEventListener('input', e=>{ if(e.target.id==='sessFilter' && impSess){ impSess.q=e.target.value; const pos=e.target.selectionStart; renderImpSessions(); const f=document.getElementById('sessFilter'); if(f){ f.focus(); f.setSelectionRange(pos,pos); } } });
impEl().addEventListener('change', e=>{ const i=e.target.dataset && e.target.dataset.impc; if(i!=null){ e.target.checked?impChecked.add(+i):impChecked.delete(+i); renderImportPreview(); } });
document.addEventListener('click', e=>{ if(e.target.closest && e.target.closest('[data-openimport]')) openImport(); });
