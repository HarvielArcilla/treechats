/* Tools Claude can use (web search, reading pages, running code), and the steps a reply took. */

/* ---- Tools Claude can use ----
   Searching the web, reading pages and running code, all run by Anthropic, not on this computer. The Tools menu by the
   input box sets them for new replies; a branch can have its own in its model settings. Each step shows in the reply,
   and pages its answer cites are listed under it. */
const TOOL_LIST=[['search','Search the web','Claude looks things up and cites its sources. Searches cost $10 per 1,000, on top of tokens.'],['fetch','Read web pages','Claude opens links you give it, or that it found, and reads them.'],['code','Run code','Claude writes and runs code in a sandbox at Anthropic, for math, data and files.']];
/* with Claude Code, its own web search and page reading are used; running code needs the API, where it runs at Anthropic */
const viaCLI = () => (window.TREECHATS_LOCAL||{}).provider==='claude-code';
const toolsOK = () => { const L=window.TREECHATS_LOCAL; return !!L && ['api','fake','claude-code'].includes(L.provider); };
const toolAvail = k => toolsOK() && !(viaCLI() && k==='code');
const activeTools = () => Ops.toolsFor(opts.tools, (window.TREECHATS_LOCAL||{}).provider);
function toolsPicker(){
  if(!toolsOK()) return '';
  const n=activeTools().length;
  return `<button class="btn ${n?'toolson':''}" data-toolsmenu aria-haspopup="menu" title="Tools Claude can use in its replies">${n?`Tools · ${n}`:'Tools'} ▾</button>`;
}
function toolsMenu(anchor){
  const on=new Set(activeTools());
  openMenu(anchor, [
    {heading:'Claude can'},
    ...TOOL_LIST.map(([k,l])=>({label:(on.has(k)?'✓ ':'\u2003 ')+l+(toolAvail(k)?'':' (needs an API key)'), disabled:!toolAvail(k), run:()=>{ const s2=new Set(activeTools()); if(s2.has(k)) s2.delete(k); else s2.add(k); opts.tools=[...s2]; save(); keepDraft(()=>renderTree()); toast(`${l}: ${s2.has(k)?'on':'off'} for new replies. ${TOOL_LIST.find(x=>x[0]===k)[2]}`); }})),
  ]);
}
const TOOL_ICONS={web_search:'⌕', web_fetch:'↗', code_execution:'›_', bash_code_execution:'›_', text_editor_code_execution:'✎'};
const hostOf = u => { try{ return new URL(u).hostname.replace(/^www\./,''); }catch(e){ return u; } };
function stepLine(st){
  const i=st.input||{}, r=st.result||{};
  if(st.tool==='web_search') return `Searched <b>${esc(i.query||'')}</b>${r.results?` · ${r.results.length} result${r.results.length===1?'':'s'}`:r.error?` · <span class="serr">${esc(r.error)}</span>`:''}`;
  if(st.tool==='web_fetch') return `Read <b>${esc(r.title||hostOf(i.url||r.url||''))}</b>${r.error?` · <span class="serr">${esc(r.error)}</span>`:''}`;
  if(st.tool==='text_editor_code_execution') return `${esc(i.command==='create'?'Wrote':i.command==='view'?'Opened':'Edited')} <b>${esc(i.path||'a file')}</b>`;
  return `Ran <code>${esc(clip(String(i.command||i.code||'code').split('\n')[0], 80))}</code>${r.code!=null?` · exit ${r.code}`:''}${r.error?` · <span class="serr">${esc(r.error)}</span>`:''}`;
}
function stepDetail(st){
  const r=st.result||{};
  if(r.results && r.results.length) return `<ul class="stepres">${r.results.map(x=>`<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title||x.url)}</a> <span class="note">${esc(hostOf(x.url))}</span></li>`).join('')}</ul>`;
  if(st.tool==='web_fetch' && (r.url || (st.input||{}).url)) return `<p class="stepres"><a href="${esc(r.url||st.input.url)}" target="_blank" rel="noopener noreferrer">${esc(r.url||st.input.url)}</a></p>`;
  const code=(st.input||{}).command||(st.input||{}).code;
  if(r.text) return `<pre class="stepout">${esc(clip(r.text, 600))}</pre>`;
  if(r.stdout!=null || r.stderr || code) return `${code?`<pre class="stepcode">${esc(code)}</pre>`:''}${r.stdout?`<pre class="stepout">${esc(r.stdout)}</pre>`:''}${r.stderr?`<pre class="stepout err">${esc(r.stderr)}</pre>`:''}`;
  return '';
}
function stepsHTML(steps, live){
  if(!steps || !steps.length) return '';
  const n=k=>steps.filter(s=>k.includes(s.tool)).length, sr=n(['web_search']), rd=n(['web_fetch']), rc=n(['code_execution','bash_code_execution','text_editor_code_execution']);
  const sum=[sr?`searched the web${sr>1?` ${sr} times`:''}`:'', rd?`read ${rd} page${rd===1?'':'s'}`:'', rc?`ran code${rc>1?` ${rc} times`:''}`:''].filter(Boolean).join(', ');
  const running = live && steps.some(s=>!s.result);
  return `<details class="steps" ${live?'open':''}><summary>${running?'<span class="spin" aria-hidden="true"></span>':''}${esc(sum.charAt(0).toUpperCase()+sum.slice(1))}</summary><ol>${steps.map(st=>`<li><span class="sticon" aria-hidden="true">${TOOL_ICONS[st.tool]||'•'}</span><div><div class="stline">${stepLine(st)}${st.result?'':' <span class="note">…</span>'}</div>${stepDetail(st)}</div></li>`).join('')}</ol></details>`;
}
function sourcesHTML(src){
  if(!src || !src.length) return '';
  return `<div class="sources"><span class="srchead">Sources</span>${src.map((x,i)=>`<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.url)}"><span>${i+1}</span>${esc(clip(x.title||hostOf(x.url), 60))} <em>${esc(hostOf(x.url))}</em></a>`).join('')}</div>`;
}
/* the steps of a reply being written, kept up to date as they come in */
function paintSteps(g){
  if(g.sid!==DB.current) return;
  const slot=treeEl.querySelector(`.reply[data-gen="${g.id}"] .stepslot`); if(slot){ const open=slot.querySelector('details'); slot.innerHTML=stepsHTML(g.steps, true); if(open && !open.open) slot.querySelector('details').open=false; }
  const th=treeEl.querySelector(`.reply[data-gen="${g.id}"] .rbody .thinking`); if(th) th.textContent='Working…';
}
