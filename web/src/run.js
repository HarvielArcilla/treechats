/* /run and /diff: commands and git in a linked folder. */

/* ---- Run and git in linked folders ----
   /run runs a command in a linked folder and shows its output above the input box, ready to attach to a prompt.
   It is off until turned on in Settings › System, since a command runs on this computer with your permissions.
   /diff attaches git's view of what changed (not committed, staged, the latest commit, or any commit) as a file. */
const linkedRoots = () => [...new Set((S.files||[]).filter(m=>m.src && m.src.root).map(m=>m.src.root))];
const rootName = r => r.split(/[\\/]/).filter(Boolean).pop() || r;
async function flushState(){ if(saveTimer) writeStore(); if(window.TREECHATS_FLUSH) await window.TREECHATS_FLUSH(); }
function chooseRoot(anchor, fn){
  const rs=linkedRoots();
  if(!hasServer()){ toast('This needs Treechats running on this computer.'); return; }
  if(!rs.length){ toast('Link a folder to this project first.', false, {label:'Link a folder', fn:()=>openFolder('space')}); return; }
  if(rs.length===1 || !anchor) return fn(rs[0]);
  openMenu(anchor, [{heading:'In which folder?'}, ...rs.map(r=>({label:rootName(r), run:()=>fn(r)}))]);
}
async function startRun(root, command, at){
  if(!set('allowCommands')){ toast('Running commands is off. Turn it on in Settings › System.', false, {label:'Open Settings', fn:()=>openSettings('system')}); return; }
  if(cmdPanel && cmdPanel.kind==='run' && cmdPanel.ctl) cmdPanel.ctl.abort();
  const p={kind:'run', at, root, command, status:'running', ctl:new AbortController(), started:Date.now()};
  cmdPanel=p; paintCmds(at);
  try{
    await flushState();
    const r=await fetch('/api/folder/run', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({root, command}), signal:p.ctl.signal});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.message || 'The command couldn’t run.');
    Object.assign(p, d, {status:'done'});
  }catch(e){ Object.assign(p, {status: e.name==='AbortError' ? 'stopped' : 'error', error:e.name==='AbortError' ? null : e.message}); }
  p.ctl=null;
  if(cmdPanel===p) paintCmds(p.at);
  refreshGit(root);
}
function runPanelHTML(p){
  const sec=s=>s<10 ? s.toFixed(1)+' s' : Math.round(s)+' s';
  const meta = p.status==='running' ? `running in ${esc(rootName(p.root))}…` : p.status==='done' ? `${p.timedOut?'stopped at the time limit':p.code===0?'exit 0':`exit ${p.code ?? p.signal}`} · ${sec(p.ms/1000)} · in ${esc(rootName(p.root))}` : p.status==='stopped' ? 'stopped' : esc(p.error||'failed');
  const acts = p.status==='running' ? '<button class="btn" data-runstop>Stop</button>' : `${p.output!=null?`<button class="btn" data-runattach title="Attach the command and its output to your next prompt">Attach to prompt</button><button class="btn" data-runcopy>Copy</button>`:''}<button class="btn" data-runagain>Run again</button><button class="btn" data-cmdclose>Close</button>`;
  return `<div class="fan cmdcard runcard" data-key="cmdrun"><div class="fanhead"><b><code>$ ${esc(clip(p.command, 80))}</code></b><span class="note ${p.status==='done'&&p.code!==0?'err':''}">${meta}</span></div>
    ${p.output!=null ? `<pre class="runout">${esc(p.output || '(no output)')}</pre>` : p.status==='running' ? '<p class="thinking note">Waiting for it to finish…</p>' : ''}
    <div class="bar">${acts}</div></div>`;
}
function attachRunOutput(p){
  const text=`$ ${p.command}\n(${p.timedOut?'stopped at the time limit':'exit '+(p.code ?? p.signal)}, ${rootName(p.root)})\n\n${p.output||''}`;
  const id=newFileId(), name=`${p.command.replace(/[^\w.-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'command'}-output.txt`, size=enc?enc.encode(text).length:text.length;
  Files.put(id, {name, type:'text/plain', size, kind:'text', text});
  pendingFiles=[...pendingFiles, {id, name, kind:'text', size}];
  cmdPanel=null; paintCmds(p.at);
  toast(`Attached the output of ${clip(p.command,40)} to your next prompt.`);
}
async function attachDiff(root, what, at){
  try{
    await flushState();
    const d=await folderApi('/api/folder/diff', {root, what});
    if(!d.text.trim() && !d.untracked.length){ toast(`No ${d.label} in ${rootName(root)}.`); return; }
    const text=d.text+(d.untracked.length?`\n# Files not yet tracked by git: ${d.untracked.join(', ')}\n`:'');
    const id=newFileId(), name=`${rootName(root)}-${what==='working'?'changes':what==='last'?'last-commit':what.replace(/[^\w.-]+/g,'-')}.diff`, size=enc?enc.encode(text).length:text.length;
    Files.put(id, {name, type:'text/x-diff', size, kind:'text', text});
    pendingFiles=[...pendingFiles, {id, name, kind:'text', size}];
    keepDraft(()=>renderTree());
    const idx=pendingFiles.length-1, lines=d.text.split('\n').length;
    toast(`Attached ${d.label} in ${rootName(root)} (${lines.toLocaleString()} lines) to your next prompt.`, false, {label:'Open', fn:()=>openFileView('p:'+idx)});
  }catch(e){ toast(e.message); }
}
function diffMenu(anchor, root){
  openMenu(anchor, [{heading:`Attach from git · ${rootName(root)}`},
    {label:'Changes not committed', run:()=>attachDiff(root, 'working')},
    {label:'Staged changes', run:()=>attachDiff(root, 'staged')},
    {label:'The latest commit', run:()=>attachDiff(root, 'last')},
    {label:'A commit or branch…', run:()=>{ closeSpaceFiles(); const t=document.getElementById('contText'); if(t){ t.value='/diff '; t.dispatchEvent(new Event('input', {bubbles:true})); t.focus(); } }}]);
}
const gitInfo=new Map();
async function refreshGit(root){
  if(!hasServer()) return;
  const was=gitInfo.get(root); if(was && was.loading) return;
  gitInfo.set(root, {...(was||{}), loading:true});
  try{ await flushState(); const d=await folderApi('/api/folder/git', {root}); gitInfo.set(root, {data:d, at:Date.now()}); }
  catch(e){ gitInfo.set(root, {error:e.message, at:Date.now()}); }
  if(!document.getElementById('spaceFiles').hidden) renderSpaceFiles();
}
function gitLine(root){
  const g=gitInfo.get(root);
  if(!g || (!g.loading && g.at && Date.now()-g.at>5000)) setTimeout(()=>refreshGit(root), 0); /* fresh each time the panel is looked at */
  if(!g || (!g.data && !g.error)) return '';
  if(g.error || !g.data.git) return '';
  const d=g.data, n=d.changed.length;
  return `<span class="gitline" title="${esc(n ? d.changed.slice(0,30).map(c=>`${c.status} ${c.path}`).join('\n') : 'Nothing changed since the last commit')}">⎇ ${esc(d.branch||'?')}${d.ahead?` ↑${d.ahead}`:''}${d.behind?` ↓${d.behind}`:''} · ${n ? `${n} changed` : 'clean'}</span>`;
}
function closeSpaceFiles(){ const el=document.getElementById('spaceFiles'); if(el && !el.hidden){ el.hidden=true; document.body.style.overflow=''; } }
