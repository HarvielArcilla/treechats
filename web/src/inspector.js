/* The inspector: the selected prompt's context, its model settings, and the project's files. */

/* ---- Model settings in the inspector ---- */
let bsetFor=null;
const EFFORT_OPTS=Ops.EFFORT_OPTS;
function setSummary(st){ return Ops.setSummary(st); }
/* which tiers' models use a setting, from what the server reports */
function capsNote(){
  const c=(window.TREECHATS_LOCAL && window.TREECHATS_LOCAL.caps) || null; if(!c) return '';
  const label=t=>(TIERS.find(x=>x[0]===t)||[t,t])[1].split(' · ')[0];
  if(Object.values(c).some(x=>x.systemOnly)) return 'Replies come from Claude Code, which uses the system prompt only.';
  const who=f=>Object.keys(c).filter(t=>f(c[t])).map(label);
  const temp=who(x=>x.temperature), eff=who(x=>x.effort);
  return `Temperature is used by ${temp.length?temp.join(', '):'none of your models'}; effort by ${eff.length?eff.join(', '):'none of them'}. Others skip it, and the reply says so.`;
}
function inheritedSettings(id){ const p=S.nodes[id].parents[0]; return p!=null && S.nodes[p] ? settingsFor(p).values : {}; }
function bsetHTML(id){
  const n=S.nodes[id], {values:v, from}=settingsFor(id);
  const src=f=>from[f]!=null ? (from[f]===id ? ' · set here' : ` · from #${from[f]}`) : '';
  const rows=[
    ['System prompt', v.system ? `“${esc(clip(v.system,80))}”` : 'none', 'system'],
    ['Thinking', v.thinking ? 'on' : 'off', 'thinking'],
    ['Effort', v.effort || 'model default', 'effort'],
    ['Temperature', v.temperature!=null ? String(v.temperature) : 'model default', 'temperature'],
    ['Reply length', v.maxTokens ? `up to ${v.maxTokens.toLocaleString()} tokens` : 'default', 'maxTokens'],
  ];
  if(bsetFor!==id) return `<div class="bset"><p class="flabel">Model settings <span class="flhint">for #${id} and the prompts after it</span></p>
    <ul class="bsetlist">${rows.map(([l,val,f])=>`<li><span>${l}</span><span>${val}<span class="note">${src(f)}</span></span></li>`).join('')}</ul>
    <div class="bar"><button class="btn xs" data-bsetedit="${id}">Change from #${id}</button>${hasSettings(n.set)?`<button class="btn xs" data-bsetclear="${id}" title="Go back to what the prompts above use">Clear what’s set here</button>`:''}</div></div>`;
  return `<div class="bset editing"><p class="flabel">Model settings <span class="flhint">from #${id} on</span></p>
    <label class="flabel" for="bsSystem">System prompt</label><textarea id="bsSystem" rows="3" placeholder="None">${esc(v.system||'')}</textarea>
    <div class="bsrow"><span>Thinking</span><span class="segs" role="group" aria-label="Thinking">${[['off','Off'],['on','On']].map(([k,l])=>`<button class="seg" data-bsthink="${k}" aria-pressed="${(k==='on')===!!v.thinking}">${l}</button>`).join('')}</span></div>
    <div class="bsrow"><label for="bsEffort">Effort</label><select id="bsEffort"><option value="">Model default</option>${EFFORT_OPTS.map(e=>`<option ${v.effort===e?'selected':''}>${e}</option>`).join('')}</select></div>
    <div class="bsrow"><label for="bsTemp">Temperature</label><input id="bsTemp" type="number" min="0" max="1" step="0.1" placeholder="Model default" value="${v.temperature!=null?v.temperature:''}"></div>
    <div class="bsrow"><label for="bsMax">Reply length (tokens)</label><input id="bsMax" type="number" min="256" max="128000" step="256" placeholder="Default" value="${v.maxTokens||''}"></div>
    <p class="note">${capsNote()}</p>
    <div class="bar"><button class="btn primary xs" data-bsetsave="${id}">Save</button><button class="btn xs" data-bsetcancel>Cancel</button></div></div>`;
}
function saveBset(id){
  const n=S.nodes[id]; if(!n) return;
  const box=document.querySelector('.bset.editing');
  const want={
    system: document.getElementById('bsSystem').value.trim() || undefined,
    thinking: box.querySelector('[data-bsthink][aria-pressed="true"]')?.dataset.bsthink==='on' || undefined,
    effort: document.getElementById('bsEffort').value || undefined,
    temperature: document.getElementById('bsTemp').value==='' ? undefined : Math.min(1, Math.max(0, +document.getElementById('bsTemp').value)),
    maxTokens: document.getElementById('bsMax').value==='' ? undefined : Math.round(+document.getElementById('bsMax').value) || undefined,
  };
  const inh=inheritedSettings(id), next={};
  for(const f of SET_FIELDS){ if(want[f]===inh[f]) continue; next[f] = want[f]===undefined ? null : want[f]; }
  bsetFor=null;
  commit(hasSettings(next) ? `Model settings from #${id}: ${setSummary(next)}` : `#${id} uses the same settings as the prompts above it`, ()=>{ if(hasSettings(next)) n.set=next; else delete n.set; });
  renderCtx();
}
let ctxFor;
/* ---- The inspector ----
   The right column has one job: what Claude sees from the selected prompt, and how to shape it. Every turn that
   would be sent is listed with its size and quiet markers; each can be left out or brought back in place. Below
   that sits what's specific to the prompt itself: your note, who added it, which model replied, its files.
   Editing happens where you read: on the prompt and the reply in the conversation. */
function renderCtx(){
  const card=document.getElementById('ctxCard'); if(!card) return;
  const changed = ctxFor!==sel; ctxFor=sel;
  /* a note being typed survives redraws (a reply landing elsewhere redraws everything) */
  const a=document.activeElement, keepNote = a && a.id==='editNote' && card.contains(a) ? {s:a.selectionStart, e:a.selectionEnd} : null;
  /* model settings being edited survive redraws too */
  const bsDraft = bsetFor!=null && document.querySelector('.bset.editing') ? ['bsSystem','bsEffort','bsTemp','bsMax'].map(k=>[k, document.getElementById(k).value]).concat([['think', document.querySelector('.bset.editing [data-bsthink][aria-pressed="true"]')?.dataset.bsthink]]) : null, bsFocus = a && a.closest && a.closest('.bset.editing') ? a.id : null;
  if(sel==null||!S.nodes[sel]){ setCard(card,'ctx','<h2>Context</h2><p class="note">Select a prompt to see exactly what Claude would be sent from there, and to shape it.</p>'); return; }
  const n=S.nodes[sel];
  if(n.kind==='merge'){
    setCard(card,'ctx',`<h2>Merge point <small>#${sel}</small></h2>
      <p class="note">Brings <b>${esc(n.from||'#'+n.parents[1])}</b> into <b>${esc(n.into||'#'+n.parents[0])}</b>. Anything you continue from here sees both branches: the one merged into first, then this note, then the turns only the merged branch has.</p>
      <blockquote class="seamq">${esc(n.seam||promptText('seam'))}</blockquote>
      <div class="bar"><button class="btn" data-gotoprompts>Change the merge note</button></div>`);
    if(changed) Motion.fade(card);
    return;
  }
  const ents=contextEntries(sel), msgs=turnsFor(sel,true), merged=ents.some(e=>e.seam), instr=promptText('instructions').trim(), fs=S.files||[];
  const tok=t=>Math.ceil(t.length/4);
  const bsv=settingsFor(sel), sysTxt=(bsv.values.system||'').trim();
  const items=(sysTxt?`<li class="seam instr" ${set('branchSettings')?`data-bsetedit="${bsv.from.system}"`:''} title="System prompt from #${bsv.from.system}'s model settings, sent alongside every message"><span class="cid">⚙</span><span class="ct">System prompt: ${esc(sysTxt)}</span><span></span></li>`:'')+(instr?`<li class="seam instr" data-gotoprompts title="Standing instructions, sent first. Change them in Settings › Prompts."><span class="cid">✎</span><span class="ct">${esc(instr)}</span><span></span></li>`:'')
    +(fs.length?`<li class="files" data-openspacefiles title="Sent with every request in this project"><span class="cid">⎘</span><span class="ct">${fs.length} project file${fs.length===1?'':'s'}: ${esc(fs.map(f=>f.name).join(', '))}</span><span></span></li>`:'')
    +ents.map(e=>{
      if(e.seam) return `<li class="seam" data-sel="${e.merge}"><span class="cid">⑂</span><span class="ct">${esc(e.text)}</span><span></span></li>`;
      const m=S.nodes[e.id]; if(m.kind==='merge') return '';
      const out = m.skip && e.id!==sel;
      /* what this turn sends now, under its mode (the selected prompt is always sent, even if left out) */
      const md0 = out ? 'out' : (m.send && SM.MODES.includes(m.send) ? m.send : 'full'), {full, sent} = sentOf(m), go = md0==='full' ? full : sent;
      const pEx = md0==='excerpt' ? SM.exSide(m,'p') : null, rEx = md0==='excerpt' ? SM.exSide(m,'r') : null;
      const pTxt = md0==='reply' && m.reply ? '<em>prompt not sent</em>' : esc(plainText(pEx ? pEx.text : m.text)||'');
      const rTxt = !m.reply ? '' : md0==='prompt' ? '<em>reply not sent</em>' : md0==='summary' && SM.hasSummary(m) ? '<b>summary:</b> '+esc(plainText(m.sum.text)) : rEx ? esc(plainText(rEx.text)) : esc(plainText(m.reply));
      const marks=[m.by?`⚙ ${esc(m.by)}`:'', m.replyEdited?'edited':'', `${out?0:(tokOf(go.user)+tokOf(go.reply)).toLocaleString()} tok`].filter(Boolean).join(' · ');
      const toggle = `<button class="ctog" data-ctxmode="${e.id}" aria-haspopup="menu" title="How this turn is included in the prompts below: ${esc(SM.HINTS[md0])} Click to change.">${esc(modeName(md0).toLowerCase())} ▾</button>`;
      return `<li data-sel="${e.id}" class="${e.id===sel?'cur':''} ${out?'skipped':''} ${md0!=='full'&&!out?'moded':''}" ${out?'title="Left out: not sent"':''}><span class="cid">#${e.id}</span><span class="ct">${pTxt}${m.reply?`<span class="cr">${rTxt}</span>`:''}<span class="cmk">${marks}</span></span>${toggle}</li>`;
    }).join('');
  const nSkip=ents.filter(e=>!e.seam && e.id!==sel && S.nodes[e.id].skip).length;
  const vs=versions(sel), kidsN=kids(sel).length;
  const facts=[n.by?`added by ${esc(n.by)}`:'', n.model?`replied by ${esc(n.model)}`:'', n.replyEdited?`reply edited${n.editedBy?' by '+esc(n.editedBy):''}`:'', vs.length>1?`version ${vs.indexOf(sel)+1} of ${vs.length}`:'', n.ctx&&n.reply?`<span title="A hash of exactly what was sent for this reply. It changes when anything above it does.">context ${n.ctx.h}${ctxSig(sel).h!==n.ctx.h?' (now '+ctxSig(sel).h+')':''}</span>`:'', `${kidsN} follow-up${kidsN===1?'':'s'}`, S.head && refsAt(sel).includes(S.head)?`on branch ${esc(refName(S.head))}`:''].filter(Boolean).join(' · ');
  setCard(card,'ctx',`<h2>Context <small>from #${sel} · ${msgs.length} messages · ~${tokens(msgs).toLocaleString()} tok</small></h2>
    ${meterHTML(msgs)}
    <p class="note">Exactly what the next request from #${sel} sends, oldest first.${nSkip?` ${nSkip} left out and not sent.`:''} Change how a turn is included (in full, as a summary or an excerpt, its prompt or reply only, or left out) from its row.</p>
    <ol class="ctx">${items}</ol>
    ${merged?'<p class="note">At a merge: the branch merged into comes first, then the merge note, then the turns only the merged branch has.</p>':''}
    <div class="bar"><button class="btn" id="copyPrompt" title="One block to paste into Claude anywhere, then ask your question">Copy as a prompt</button><button class="btn" id="distillCtx" ${sampleState==='ready'?'':'disabled'} title="Claude writes a short brief of this context that you can reuse">${AI}Distill…</button><button class="btn" id="copyMd">Copy as Markdown</button><button class="btn" id="copyCtx">Copy as JSON</button></div>
    <div class="insp"><h3>#${sel}</h3>
      <label class="flabel" for="editNote">Your note <span class="flhint">never sent to Claude</span></label>
      <textarea id="editNote" rows="2" placeholder="Decisions, reminders, what to try next…">${esc(n.note||'')}</textarea>
      ${n.files && n.files.length ? `<p class="flabel">Attached files</p><ul class="flist">${n.files.map((m,i)=>`<li><span class="fkind">${m.kind==='image'?'IMG':'TXT'}</span><span class="fname" title="${esc(m.name)}">${esc(m.name)}</span><span class="meta">${fmtSize(m.size)}</span><button class="btn xs danger" data-rmnodefile="${i}">Remove</button></li>`).join('')}</ul>` : ''}
      ${n.kind==='summary'?'<p class="note">A summary root made by a reroot. Edit it into a proper recap of the context you cut.</p>':''}
      ${usageHTML(sel)}
      ${set('branchSettings') ? bsetHTML(sel) : ''}
      <p class="meta">${facts}</p></div>`);
  if(bsDraft && document.querySelector('.bset.editing')){ for(const [k,v] of bsDraft){ if(k==='think'){ if(v) for(const x of document.querySelectorAll('.bset.editing [data-bsthink]')) x.setAttribute('aria-pressed', x.dataset.bsthink===v); } else { const el=document.getElementById(k); if(el) el.value=v; } } if(bsFocus){ const f=document.getElementById(bsFocus); if(f) f.focus({preventScroll:true}); } }
  if(keepNote){ const t=document.getElementById('editNote'); if(t){ t.focus({preventScroll:true}); try{ t.setSelectionRange(keepNote.s, keepNote.e); }catch(e){} } }
  if(changed) Motion.fade(card);
}
function renderSpaceFiles(){
  const card=document.getElementById('filesCard'), fs=S.files||[];
  document.getElementById('sfSpace').textContent='in '+DB.spaces[DB.current].name;
  const row=(m,i)=>`<li><span class="fkind">${m.kind==='image'?'IMG':'TXT'}</span><button class="fname linkbtn" data-fileopen="s:${i}" title="${esc(m.name)} · click to open">${esc(m.src&&m.src.root ? m.src.path : m.name)}</button><span class="meta">${m.dirty?'<span class="ftag warn" title="Edited in Treechats and not saved to disk">edited</span> ':''}${fmtSize(m.size)}</span><button class="btn xs danger" data-rmspacefile="${i}">Remove</button></li>`;
  /* files from a linked folder are grouped under it, with Sync */
  const groups=new Map(), loose=[];
  fs.forEach((m,i)=>{ if(m.src && m.src.root){ if(!groups.has(m.src.root)) groups.set(m.src.root, []); groups.get(m.src.root).push([m,i]); } else loose.push([m,i]); });
  const total=fs.reduce((a,m)=>a+(m.size||0),0);
  card.innerHTML=`<p class="note">Sent with every request in this project, like project knowledge in Claude. Text and code files only.${fs.length?` ${fs.length} file${fs.length===1?'':'s'}, ${fmtSize(total)}, ${Math.round(total/promptLimit*100)}% of the request limit.`:''}</p>
    ${[...groups].map(([root, list])=>`<div class="fgroup"><div class="fghead"><span class="fgname" title="${esc(root)}">📁 ${esc(root.split(/[\\/]/).filter(Boolean).pop())}</span><span class="note">linked</span>${gitLine(root)}<button class="btn xs" data-runfolder="${esc(root)}" title="Run a command in this folder (/run)">Run…</button><button class="btn xs" data-difffolder="${esc(root)}" aria-haspopup="menu" title="Attach a diff from git to your next prompt">Diff ▾</button><button class="btn xs" data-syncfolder="${esc(root)}" title="Re-read files that changed on disk">Sync</button><button class="btn xs" data-addfolder="${esc(root)}" title="Choose which files from this folder are in the project">Files…</button><button class="btn xs" data-unlinkfolder="${esc(root)}" title="Keep the files as copies, no longer read from disk">Unlink</button></div><ul class="flist">${list.map(([m,i])=>row(m,i)).join('')}</ul></div>`).join('')}
    ${loose.length ? `<ul class="flist">${loose.map(([m,i])=>row(m,i)).join('')}</ul>` : ''}
    <div class="dropzone" data-dropspace>Drop files here, or <button class="linkbtn" data-attachspace style="color:var(--accent)">choose files</button> or <button class="linkbtn" data-addfolder style="color:var(--accent)">a folder</button></div>`;
}
