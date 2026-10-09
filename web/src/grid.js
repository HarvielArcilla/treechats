/* The comparison grid: one prompt, several wordings and setups, side by side, with scores. */

/* ---- Comparison grid ----
   One prompt, or several wordings of it, against several setups (a model and its settings: thinking, effort, tools, a
   system prompt), from the same point in a chat. Every pair becomes its own fork with its own reply, so nothing is lost
   and any of them can be continued; the grid shows them side by side with what each cost and took, and can have
   Claude score them against your criteria. Grids are kept with the chat (S.grids) and reopen from the prompt they
   start from. */
const gridsOf = id => (S.grids||[]).filter(g=>g.parent===id);
function colLabel(c){
  const t=TIERS.find(x=>x[0]===c.tier), bits=[t ? t[1].split(' · ')[0] : c.tier];
  if(c.thinking) bits.push('thinking');
  if(c.effort) bits.push(c.effort+' effort');
  for(const k of c.tools||[]) bits.push({search:'web search', fetch:'reads pages', code:'runs code'}[k]||k);
  if(c.system && c.system.trim()) bits.push('system prompt');
  return bits.join(' · ');
}
const gridEl=(()=>{ const w=document.createElement('div'); w.className='setwrap'; w.id='gridSheet'; w.hidden=true; w.innerHTML='<div class="setbox fsheet gsheet" role="dialog" aria-modal="true" aria-labelledby="gridTitle"></div>'; document.body.append(w); return w; })();
let gridUI=null;
function openGridBuilder(parent, text){
  if(parent==null || !S.nodes[parent] || S.nodes[parent].kind==='merge'){ toast('Select the prompt the grid should follow.'); return; }
  if(sampleState!=='ready'){ toast('The grid needs Claude. Add an API key or sign in to Claude Code, then restart Treechats.'); return; }
  const other=TIERS.map(x=>x[0]).find(x=>x!==opts.model) || opts.model;
  gridUI={mode:'build', draft:{parent, rows:[text||''], cols:[{tier:opts.model}, {tier:other}]}};
  gridEl.hidden=false; document.body.style.overflow='hidden'; paintGrid();
  setTimeout(()=>{ const f=gridEl.querySelector('[data-grow="0"]'); if(f) f.focus(); }, 30);
}
function openGrid(gid){
  const g=(S.grids||[]).find(x=>x.id===gid); if(!g) return;
  gridUI={mode:'view', gid}; gridEl.hidden=false; document.body.style.overflow='hidden'; paintGrid();
}
function closeGrid(){ gridUI=null; gridEl.hidden=true; document.body.style.overflow=''; }
function readGridDraft(){
  const d=gridUI.draft, q=s=>[...gridEl.querySelectorAll(s)];
  for(const t of q('[data-grow]')) d.rows[+t.dataset.grow]=t.value;
  for(const el of q('[data-gcol]')){ const c=d.cols[+el.dataset.gcol], f=el.dataset.f; if(!c) continue;
    if(f==='tier') c.tier=el.value; else if(f==='thinking') c.thinking=el.checked; else if(f==='effort') c.effort=el.value; else if(f==='system') c.system=el.value;
    else if(f.startsWith('tool:')){ const k=f.slice(5), s2=new Set(c.tools||[]); if(el.checked) s2.add(k); else s2.delete(k); c.tools=[...s2]; } }
}
function gridBuildHTML(){
  const d=gridUI.draft, rows=d.rows, cols=d.cols, nRows=rows.filter(r=>r.trim()).length, n=nRows*cols.length;
  const p=S.nodes[d.parent];
  const colHTML=(c,i)=>`<div class="gcol"><div class="gcolhead"><b>Setup ${String.fromCharCode(65+i)}</b>${cols.length>1?`<button class="fx" data-gcoldel="${i}" aria-label="Remove setup ${String.fromCharCode(65+i)}">×</button>`:''}</div>
    <label class="pfield">Model<select data-gcol="${i}" data-f="tier">${TIERS.map(([v,l])=>`<option value="${v}" ${c.tier===v?'selected':''}>${esc(l)}</option>`).join('')}</select></label>
    <label class="gchk"><input type="checkbox" data-gcol="${i}" data-f="thinking" ${c.thinking?'checked':''}> Thinking</label>
    <label class="pfield">Effort<select data-gcol="${i}" data-f="effort">${['', ...EFFORT_OPTS].map(v=>`<option value="${v}" ${(c.effort||'')===v?'selected':''}>${v?v[0].toUpperCase()+v.slice(1):'Default'}</option>`).join('')}</select></label>
    ${TOOL_LIST.filter(([k])=>toolAvail(k)).map(([k,l])=>`<label class="gchk"><input type="checkbox" data-gcol="${i}" data-f="tool:${k}" ${(c.tools||[]).includes(k)?'checked':''}> ${esc(l)}</label>`).join('')}
    <label class="pfield">System prompt<textarea data-gcol="${i}" data-f="system" rows="2" placeholder="Optional">${esc(c.system||'')}</textarea></label></div>`;
  return `<div class="sethead"><div class="cmptitle"><h2 id="gridTitle">Comparison grid</h2><p class="note">From #${d.parent}: ${esc(clip(p.text||'', 90))}</p></div><div class="bar"><button class="btn" data-gclose>Cancel</button></div></div>
    <div class="fbody gbuild">
      <section><h3 class="gh">Wordings <span class="note">· one row each</span></h3>
        ${rows.map((r,i)=>`<div class="growin"><textarea data-grow="${i}" rows="2" placeholder="${i?'Another wording':'The prompt to try'}" aria-label="Wording ${i+1}">${esc(r)}</textarea>${rows.length>1?`<button class="fx" data-growdel="${i}" aria-label="Remove wording ${i+1}">×</button>`:''}</div>`).join('')}
        <div class="tbar"><button class="btn xs" data-growadd>+ Add a wording</button></div></section>
      <section><h3 class="gh">Setups <span class="note">· one column each</span></h3>
        <div class="gcols">${cols.map(colHTML).join('')}${cols.length<6?'<button class="gcol gadd" data-gcoladd><span>+</span>Add a setup</button>':''}</div></section>
      <p class="perr" data-gerr role="alert"></p>
      <div class="tbar"><button class="btn primary" data-gorun ${n?'':'disabled'}>Run the grid: ${n} repl${n===1?'y':'ies'}</button><span class="note">${nRows} wording${nRows===1?'':'s'} × ${cols.length} setup${cols.length===1?'':'s'}. Each becomes its own branch from #${d.parent}, and replies are written a few at a time.</span></div>
    </div>`;
}
function runGridDraft(){
  readGridDraft();
  const d=gridUI.draft, rows=d.rows.map(r=>r.trim()).filter(Boolean);
  if(!rows.length){ const e=gridEl.querySelector('[data-gerr]'); if(e) e.textContent='Write at least one wording.'; return; }
  if(rows.length*d.cols.length>36){ const e=gridEl.querySelector('[data-gerr]'); if(e) e.textContent='That’s more than 36 replies. Use fewer wordings or setups.'; return; }
  const gid='g'+Date.now().toString(36), conv=convOf(d.parent), made=[], cells={};
  const cols=d.cols.map(c=>({tier:c.tier, ...(c.thinking?{thinking:true}:{}), ...(c.effort?{effort:c.effort}:{}), ...((c.tools||[]).length?{tools:[...c.tools]}:{}), ...(c.system&&c.system.trim()?{system:c.system.trim()}:{})}));
  commit(`Made a comparison grid of ${rows.length*cols.length} from #${d.parent}`, ()=>{
    rows.forEach((text, r)=>cols.forEach((c, ci)=>{
      const nid=S.nextId++, set={};
      if(c.thinking) set.thinking=true; if(c.effort) set.effort=c.effort; if(c.system) set.system=c.system;
      /* a setup without tools turns them off for its fork, so the Tools menu doesn't leak in */
      set.tools = c.tools ? c.tools : [];
      S.nodes[nid]={id:nid, parents:[d.parent], text, askTier:c.tier, set, grid:{id:gid, r, c:ci}};
      newRef(slugName(`grid-${r+1}${String.fromCharCode(97+ci)}`, conv), nid);
      cells[`${r}:${ci}`]=nid; made.push(nid);
    }));
    S.grids=[...(S.grids||[]), {id:gid, parent:d.parent, rows, cols, cells, created:Date.now()}];
  }, {touch:false});
  wantReplies(made);
  gridUI={mode:'view', gid}; paintGrid();
}
function cellMeta(n){
  const bits=[];
  if(n.usage && n.usage.cost!=null) bits.push(fmtCost(n.usage.cost));
  if(n.rt) bits.push(fmtElapsed(n.rt[1]-n.rt[0]));
  if(n.usage && n.usage.output) bits.push(`${n.usage.output.toLocaleString()} tokens out`);
  if(n.steps && n.steps.length) bits.push(`${n.steps.length} tool step${n.steps.length===1?'':'s'}`);
  return bits.join(' · ');
}
function gridViewHTML(){
  const g=(S.grids||[]).find(x=>x.id===gridUI.gid); if(!g) return '<div class="fbody"><p class="note">This grid is gone (undone or deleted).</p></div>';
  const p=S.nodes[g.parent], ids=Object.values(g.cells).filter(id=>S.nodes[id]);
  const missing=ids.filter(id=>!S.nodes[id].reply && !replyBusy(id)), running=ids.filter(id=>replyBusy(id));
  const cost=ids.reduce((a,id)=>a+((S.nodes[id].usage||{}).cost||0), 0);
  const cell=(r,c)=>{
    const id=g.cells[`${r}:${c}`], n=id!=null && S.nodes[id]; if(!n) return `<td class="gcell gone"><p class="note">Deleted</p></td>`;
    const live=liveGen(id), sc=g.scores && g.scores[id], best=g.best===id;
    const body = live ? `<div class="gtext rbody">${live.text?md(clip(live.text, 1500)):'<p class="thinking">Writing…</p>'}</div><p class="gmeta"><span class="ts" data-since="${live.started||Date.now()}">${fmtElapsed(Date.now()-(live.started||Date.now()))}</span></p>`
      : queuedGen(id) ? `<p class="note thinking">Waiting its turn…</p>`
      : n.reply ? `<div class="gtext rbody">${md(n.reply)}</div><p class="gmeta">${esc(cellMeta(n))}</p>`
      : `<p class="note">${esc(genNotes[gkey(DB.current,id)]||'No reply.')}</p>`;
    return `<td class="gcell ${best?'best':''}" data-gcell="${id}">${sc?`<div class="gscore" title="${esc(sc.why||'')}"><b>${sc.score}</b>/10${best?' · best':''}</div>`:''}${body}
      <div class="gacts"><button class="btn xs" data-gopen="${id}">Open</button>${n.reply?`<button class="btn xs" data-gkeep="${id}" ${onMain(id)?'disabled title="Already on main"':''}>Make mainline</button>`:''}${!n.reply&&!replyBusy(id)&&sampleState==='ready'?`<button class="btn xs" data-gget="${id}">Get reply</button>`:''}</div></td>`;
  };
  return `<div class="sethead"><div class="cmptitle"><h2 id="gridTitle">Comparison grid</h2><p class="note">From #${g.parent}${p?`: ${esc(clip(p.text||'', 80))}`:''} · ${ids.length} repl${ids.length===1?'y':'ies'}${cost?` · ${fmtCost(cost)} so far`:''}</p></div>
      <div class="bar">${missing.length&&sampleState==='ready'?`<button class="btn" data-ggetall>Get ${missing.length} missing</button>`:''}${running.length?`<button class="btn" data-gstopall>Stop ${running.length}</button>`:''}<button class="btn" data-gclose>Done <kbd class="inv">Esc</kbd></button></div></div>
    <div class="fbody gview">${gridScoreHTML(g)}
      <div class="gtablewrap"><table class="gtable"><thead><tr><th class="gcorner">${g.scores?'<span class="note">Average score</span>':''}</th>${g.cols.map((c,i)=>{ const a=g.scores?gridAvg(g, ([,ci])=>ci===i):null; return `<th><span class="gcl">${String.fromCharCode(65+i)}</span> ${esc(colLabel(c))}${a!=null?` <span class="gavg">${a}</span>`:''}</th>`; }).join('')}</tr></thead>
      <tbody>${g.rows.map((t,r)=>`<tr><th class="growh" title="${esc(t)}">${esc(clip(t, 140))}${g.scores&&gridAvg(g, ([ri])=>ri===r)!=null?` <span class="gavg">${gridAvg(g, ([ri])=>ri===r)}</span>`:''}</th>${g.cols.map((_,c)=>cell(r,c)).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
/* Score: one request in which Claude scores every reply against your criteria, without being told which setup wrote
   which; the best is marked and each setup and wording gets its average */
const GRID_CRITERIA='Correct, complete and clear, and answers what was asked';
function gridScoreHTML(g){
  const withReply=Object.values(g.cells).filter(id=>S.nodes[id] && S.nodes[id].reply).length, st=g.scoring;
  return `<div class="gscorebar"><input id="gridCriteria" placeholder="Criteria: ${esc(GRID_CRITERIA)}" value="${esc(g.criteria||'')}" aria-label="What to score by"><button class="btn" data-gscore ${withReply<2||st==='loading'||sampleState!=='ready'?'disabled':''} title="One request: Claude scores every reply from 1 to 10 against your criteria, without seeing which setup wrote it">${AI}${g.scores?'Score again':'Score'}</button>
    ${st==='loading'?'<span class="note thinking">Scoring…</span>':st&&st.error?`<span class="note serr">${esc(st.error)}</span>`:g.summary?`<span class="note">${esc(g.summary)}</span>`:withReply<2?'<span class="note">Scoring needs two or more replies.</span>':''}</div>`;
}
async function scoreGrid(g){
  const input=gridEl.querySelector('#gridCriteria'); g.criteria=(input ? input.value : g.criteria||'').trim();
  const ids=Object.values(g.cells).filter(id=>S.nodes[id] && S.nodes[id].reply);
  g.scoring='loading'; paintGrid();
  try{
    const m=compareMaterial(DB.current, g.parent, ids);
    const d=await sampleFn.json(fillPrompt('gridScore', {criteria:g.criteria||GRID_CRITERIA, conversation:m.conversation, alternatives:m.alternatives}), {modelTier:opts.model, cache:false});
    const num=x=>+String(x||'').replace(/[^\d]/g,''), scores={};
    for(const [k,v] of Object.entries((d && d.scores) || {})){ const id=num(k), sc=Math.max(1, Math.min(10, Math.round(+(v && v.score)))); if(m.ids.includes(id) && Number.isFinite(sc)) scores[id]={score:sc, why:String((v && v.why)||'')}; }
    if(!Object.keys(scores).length) throw new Error('Claude didn’t return scores. Try again.');
    let best=m.ids.includes(num(d.best)) ? num(d.best) : null;
    if(best==null) best=+Object.entries(scores).sort((a,b)=>b[1].score-a[1].score)[0][0];
    g.scores=scores; g.best=best; g.summary=String(d.summary||'').trim(); delete g.scoring;
  }catch(e){ g.scoring={error: e && e.message && !/^[a-z_]+$/.test(e.message) ? e.message : 'Claude couldn’t score them. Try again.'}; }
  save(); if(gridUI && gridUI.gid===g.id) paintGrid();
}
const avg = xs => xs.length ? Math.round(xs.reduce((a,b)=>a+b,0)/xs.length*10)/10 : null;
function gridAvg(g, pick){ return avg(Object.entries(g.cells).filter(([k])=>pick(k.split(':').map(Number))).map(([,id])=>g.scores && g.scores[id] && g.scores[id].score).filter(x=>x!=null)); }
function paintGrid(){
  if(!gridUI) return;
  const box=gridEl.firstChild, keep=box.querySelector('.gtablewrap'), sx=keep?keep.scrollLeft:0, sy=box.querySelector('.fbody')?.scrollTop||0;
  if(gridUI.mode==='build'){ box.innerHTML=gridBuildHTML(); return; }
  box.innerHTML=gridViewHTML();
  const w=box.querySelector('.gtablewrap'); if(w) w.scrollLeft=sx; const fb=box.querySelector('.fbody'); if(fb) fb.scrollTop=sy;
}
/* replies streaming into the grid repaint it at most a few times a second */
let gridPaint=0;
function gridChanged(){ if(!gridUI || gridUI.mode!=='view' || gridPaint) return; gridPaint=setTimeout(()=>{ gridPaint=0; paintGrid(); }, 250); }
gridEl.addEventListener('click', e=>{
  const c=q=>e.target.closest(q);
  if(e.target===gridEl || c('[data-gclose]')){ closeGrid(); return; }
  if(!gridUI) return;
  if(gridUI.mode==='build'){
    readGridDraft(); const d=gridUI.draft;
    if(c('[data-growadd]')){ d.rows.push(''); paintGrid(); gridEl.querySelector(`[data-grow="${d.rows.length-1}"]`)?.focus(); return; }
    const rd=c('[data-growdel]'); if(rd){ d.rows.splice(+rd.dataset.growdel, 1); paintGrid(); return; }
    if(c('[data-gcoladd]')){ const used=new Set(d.cols.map(x=>x.tier)); d.cols.push({tier:(TIERS.find(x=>!used.has(x[0]))||TIERS[0])[0]}); paintGrid(); return; }
    const cd=c('[data-gcoldel]'); if(cd){ d.cols.splice(+cd.dataset.gcoldel, 1); paintGrid(); return; }
    if(c('[data-gorun]')){ runGridDraft(); return; }
    return;
  }
  const g=(S.grids||[]).find(x=>x.id===gridUI.gid); if(!g) return;
  const op=c('[data-gopen]'); if(op){ const id=+op.dataset.gopen; closeGrid(); gotoNode(id); return; }
  const kp=c('[data-gkeep]'); if(kp){ promote(+kp.dataset.gkeep); paintGrid(); return; }
  if(c('[data-gscore]')){ scoreGrid(g); return; }
  const gg=c('[data-gget]'); if(gg){ wantReplies([+gg.dataset.gget]); paintGrid(); return; }
  if(c('[data-ggetall]')){ wantReplies(Object.values(g.cells).filter(id=>S.nodes[id] && !S.nodes[id].reply)); paintGrid(); return; }
  if(c('[data-gstopall]')){ for(const id of Object.values(g.cells)) if(replyBusy(id)) stopReply(id); paintGrid(); return; }
});
gridEl.addEventListener('change', e=>{ if(gridUI && gridUI.mode==='build' && e.target.matches('[data-gcol]')) readGridDraft(); });
gridEl.addEventListener('input', e=>{ if(gridUI && gridUI.mode==='build' && e.target.matches('[data-grow]')){ readGridDraft(); const n=gridUI.draft.rows.filter(r=>r.trim()).length*gridUI.draft.cols.length, b=gridEl.querySelector('[data-gorun]'); if(b){ b.disabled=!n; b.textContent=`Run the grid: ${n} repl${n===1?'y':'ies'}`; } } });
gridEl.addEventListener('keydown', e=>{ if(e.key==='Enter' && e.target.id==='gridCriteria'){ e.preventDefault(); const g=gridUI && (S.grids||[]).find(x=>x.id===gridUI.gid); if(g) scoreGrid(g); return; } if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeGrid(); } });
