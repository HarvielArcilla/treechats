/* Folders: adding a folder's files, and linking a folder on this computer so its files stay in sync. */

/* ---- Folders ----
   Add a folder's files to the project (sent with every request) or to the next prompt. Choose files from a folder
   in the browser (a copy), or, when Treechats runs on this computer, link a folder by its path: the files keep
   where they came from, Sync re-reads the ones that changed on disk, and edits made in the file viewer can be saved
   back. .gitignore is respected, dependency and build folders are skipped, and lock files and .env files start
   unticked. Every file is shown with its size against the request limit before anything is added. */
const hasServer = () => !!(window.TREECHATS_LOCAL && !window.TREECHATS_LOCAL.offline);
const LOCK_RE=/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|uv\.lock)$/i;
const SECRET_RE=/(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/i;
const SKIP_DIR_RE=/(^|\/)(\.git|node_modules|dist|build|out|\.next|\.nuxt|\.cache|coverage|__pycache__|\.venv|venv|target|\.idea|\.vscode|\.turbo|vendor)\//;
const textish = p => TEXT_EXT.test(p) || /(^|\/)(Dockerfile|Makefile|LICENSE|README|Procfile|\.gitignore|\.editorconfig|\.env\.[a-z]+)$/i.test(p);
const folderDefault = f => textish(f.path) && !LOCK_RE.test(f.path) && !SECRET_RE.test(f.path) && f.size>0 && f.size<=MAX_TEXT_FILE;
async function folderApi(path, body){
  /* writes need the folder linked, and the server checks that against what's saved, so save first */
  if(path==='/api/folder/write') await flushState();
  const r=await fetch(path, {method:'POST', headers:{'content-type':'application/json', 'x-treechats-tab':window.TREECHATS_TAB||''}, body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw Object.assign(new Error(d.message || 'Treechats couldn’t reach the folder.'), {code:d.code});
  return d;
}
/* a small .gitignore reader for folders chosen in the browser (linked folders use git itself) */
function gitignoreTest(txt){
  const pats=String(txt||'').split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith('#') && !l.startsWith('!')).map(l=>{
    const anchored=l.startsWith('/'), dir=l.endsWith('/');
    const body=l.replace(/^\//,'').replace(/\/$/,'').replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'\u0000').replace(/\*/g,'[^/]*').replace(/\?/g,'[^/]').replace(/\u0000/g,'.*');
    return new RegExp((anchored?'^':'(^|/)')+body+(dir?'/':'(/|$)'));
  });
  return p=>pats.some(re=>re.test(p));
}
let folderPick=null;
const folderEl=(()=>{ const w=document.createElement('div'); w.className='setwrap'; w.id='folderSheet'; w.hidden=true; w.innerHTML='<div class="setbox fsheet" role="dialog" aria-modal="true" aria-labelledby="folderTitle"></div>'; document.body.append(w); return w; })();
const dirPicker=(()=>{ const i=document.createElement('input'); i.type='file'; i.multiple=true; i.hidden=true; i.setAttribute('webkitdirectory',''); document.body.append(i); return i; })();
function openFolder(target='space', root=null){
  folderPick={target, stage:'choose', path:root||'', files:[], on:new Set(), open:new Set(), filter:'', linked:hasServer(), error:null};
  folderEl.hidden=false; document.body.style.overflow='hidden';
  paintFolder();
  if(root) loadLinkedFolder(root);
  else { const f=folderEl.querySelector('#folderPath') || folderEl.querySelector('[data-fpchoose]'); if(f) f.focus({preventScroll:true}); }
}
function closeFolder(){ folderPick=null; folderEl.hidden=true; document.body.style.overflow=''; }
function setFolderFiles(fp, files, info){
  Object.assign(fp, info, {files, stage:'tree', error:null});
  const linkedHere=new Map((S.files||[]).filter(m=>m.src && m.src.root && m.src.root===fp.root).map(m=>[m.src.path, m]));
  fp.on=new Set(files.filter(f=>linkedHere.size ? linkedHere.has(f.path) : folderDefault(f)).map(f=>f.path));
  if(linkedHere.size) for(const f of files) if(!linkedHere.has(f.path) && folderDefault(f) && !(fp.seen||new Set()).has(f.path)) fp.fresh=(fp.fresh||0)+1;
  const dirs=new Set(files.map(f=>f.path.split('/').slice(0,-1).join('/')).filter(Boolean));
  fp.open = files.length<=80 ? dirs : new Set();
  paintFolder();
}
async function loadLinkedFolder(path){
  const fp=folderPick; if(!fp) return;
  fp.path=path; fp.stage='loading'; fp.error=null; paintFolder();
  try{
    const d=await folderApi('/api/folder/list', {root:path});
    if(folderPick!==fp) return;
    setFolderFiles(fp, d.files, {root:d.root, name:d.name, git:d.git, truncated:d.truncated});
    opts.folders=[d.root, ...(opts.folders||[]).filter(x=>x!==d.root)].slice(0,6); save();
  }catch(e){ if(folderPick!==fp) return; fp.stage='choose'; fp.error=e.message; paintFolder(); }
}
dirPicker.addEventListener('change', async ()=>{
  const fp=folderPick, list=[...dirPicker.files]; if(!fp || !list.length) return;
  const top=(list[0].webkitRelativePath||'').split('/')[0]||'folder';
  const rel=f=>(f.webkitRelativePath||f.name).split('/').slice(1).join('/');
  const gi=list.find(f=>rel(f)==='.gitignore'), ignored=gitignoreTest(gi ? await gi.text() : '');
  const files=list.map(f=>({path:rel(f), size:f.size, mtime:f.lastModified, file:f})).filter(f=>f.path && !SKIP_DIR_RE.test(f.path) && !ignored(f.path)).sort((a,b)=>a.path.localeCompare(b.path));
  setFolderFiles(fp, files, {root:null, name:top, git:false, truncated:false, linked:false});
});
function folderTree(fp){
  const root={dirs:new Map(), files:[]};
  for(const f of fp.files){ const parts=f.path.split('/'); let d=root; for(const p of parts.slice(0,-1)){ if(!d.dirs.has(p)) d.dirs.set(p, {dirs:new Map(), files:[]}); d=d.dirs.get(p); } d.files.push(f); }
  return root;
}
function dirFiles(d){ const out=[...d.files]; for(const c of d.dirs.values()) out.push(...dirFiles(c)); return out; }
function folderRowsHTML(fp){
  const q=fp.filter.trim().toLowerCase();
  const fileRow=(f, depth)=>{ const big=f.size>MAX_TEXT_FILE, tag=SECRET_RE.test(f.path)?'<span class="ftag warn" title="Often holds passwords and keys">may hold secrets</span>':LOCK_RE.test(f.path)?'<span class="ftag">lock file</span>':big?'<span class="ftag">too large</span>':!textish(f.path)?'<span class="ftag">not text</span>':'';
    return `<label class="frow" style="--d:${depth}"><input type="checkbox" data-fpfile="${esc(f.path)}" ${fp.on.has(f.path)?'checked':''} ${big?'disabled':''}><span class="fn">${esc(q ? f.path : f.path.split('/').pop())}</span>${tag}<span class="fs">${fmtSize(f.size)}</span></label>`; };
  if(q) { const hits=fp.files.filter(f=>f.path.toLowerCase().includes(q)); return hits.length ? hits.slice(0,400).map(f=>fileRow(f,0)).join('')+(hits.length>400?`<p class="note">${hits.length-400} more match; narrow the filter.</p>`:'') : '<p class="note">No files match.</p>'; }
  const out=[];
  const walk=(d, prefix, depth)=>{
    for(const [name, c] of [...d.dirs.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      const p=prefix?prefix+'/'+name:name, all=dirFiles(c), n=all.filter(f=>fp.on.has(f.path)).length, open=fp.open.has(p);
      out.push(`<div class="frow fdir" style="--d:${depth}"><input type="checkbox" data-fpdir="${esc(p)}" ${n&&n===all.length?'checked':''} ${n&&n<all.length?'data-mixed="1"':''} aria-label="All of ${esc(p)}"><button class="ftog" data-fpopen="${esc(p)}" aria-expanded="${open}">${open?'▾':'▸'} ${esc(name)}/</button><span class="fs">${n}/${all.length}</span></div>`);
      if(open) walk(c, p, depth+1);
    }
    for(const f of d.files) out.push(fileRow(f, depth));
  };
  walk(folderTree(fp), '', 0);
  return out.join('');
}
function folderSumHTML(fp){
  const on=fp.files.filter(f=>fp.on.has(f.path)), bytes=on.reduce((a,f)=>a+f.size,0), pct=bytes/promptLimit*100;
  return `<b>${on.length} file${on.length===1?'':'s'}</b> · ${fmtSize(bytes)} · ~${Math.ceil(bytes/4).toLocaleString()} tokens · <span class="${pct>=100?'over':pct>=50?'high':''}">${pct<1&&bytes?'<1':Math.round(pct)}% of the request limit</span>${pct>=100?' · too much to send at once: untick some':''}`;
}
function paintFolder(){
  const fp=folderPick; if(!fp) return;
  const box=folderEl.querySelector('.fsheet');
  const head=`<div class="sethead"><h2 id="folderTitle">Add a folder</h2><button class="btn" data-fpclose>Close</button></div>`;
  if(fp.stage==='choose' || fp.stage==='loading'){
    const recent=(opts.folders||[]);
    box.innerHTML=head+`<div class="fbody">
      <section class="setsec"><h3>Choose a folder</h3><p class="note">Copies the files you tick into Treechats. Your browser asks before it shares the folder.</p><div><button class="btn" data-fpchoose>Choose a folder…</button></div></section>
      ${hasServer()?`<section class="setsec"><h3>Or link a folder on this computer</h3><p class="note">Treechats reads it from disk: <b>Sync</b> picks up files that changed, and edits you make in Treechats can be saved back to the folder. Uses <code>.gitignore</code> when the folder is a git repository.</p>
        <div class="frowin"><input id="folderPath" type="text" placeholder="/Users/you/code/app or ~/code/app" value="${esc(fp.path)}" autocomplete="off" spellcheck="false" aria-label="Folder path"><button class="btn primary" data-fplink ${fp.stage==='loading'?'disabled':''}>${fp.stage==='loading'?'Reading…':'Open'}</button></div>
        ${fp.error?`<p class="note err">${esc(fp.error)}</p>`:''}
        ${recent.length?`<p class="note">Recent: ${recent.map(r=>`<button class="rmore" data-fprecent="${esc(r)}">${esc(r)}</button>`).join(' ')}</p>`:''}</section>`:''}
    </div>`;
    return;
  }
  if(fp.stage==='reading'){ box.innerHTML=head+`<div class="fbody"><p class="note thinking">Reading ${fp.on.size} files…</p></div>`; return; }
  const linkedOK=!!fp.root && hasServer();
  box.innerHTML=head+`<div class="fbody ftree">
    <div class="fphead"><b>${esc(fp.name)}</b> <span class="note">${fp.root?esc(fp.root)+' · ':''}${fp.files.length} files${fp.git?' · from git, .gitignore respected':' · build and dependency folders skipped'}${fp.truncated?' · only the first 5,000 listed':''}</span></div>
    <div class="frowin"><input id="folderFilter" type="search" placeholder="Filter by path" value="${esc(fp.filter)}" aria-label="Filter files"><button class="rmore" data-fpall>Tick the usual</button><button class="rmore" data-fpnone>Untick all</button></div>
    <div class="flistbox" role="group" aria-label="Files">${folderRowsHTML(fp)}</div>
    <p class="fsum note">${folderSumHTML(fp)}</p>
    <div class="segs" role="group" aria-label="Add them to"><button class="seg" data-fptarget="space" aria-pressed="${fp.target==='space'}">Project files <span class="note">sent with every request</span></button><button class="seg" data-fptarget="prompt" aria-pressed="${fp.target==='prompt'}">My next prompt</button></div>
    ${linkedOK&&fp.target==='space'?`<label class="chk"><input type="checkbox" data-fplinked ${fp.linked?'checked':''}> Stay linked to the folder: Sync re-reads changed files, and edits can be saved back</label>`:''}
    <div class="bar"><button class="btn primary" data-fpadd ${fp.on.size?'':'disabled'}>Add ${fp.on.size} file${fp.on.size===1?'':'s'}</button><button class="btn" data-fpback>Choose another folder</button></div></div>`;
  for(const cb of box.querySelectorAll('[data-mixed]')) cb.indeterminate=true;
}
function paintFolderList(){ const fp=folderPick; const l=folderEl.querySelector('.flistbox'), s=folderEl.querySelector('.fsum'), b=folderEl.querySelector('[data-fpadd]'); if(!l) return paintFolder(); const top=l.scrollTop; l.innerHTML=folderRowsHTML(fp); l.scrollTop=top; for(const cb of l.querySelectorAll('[data-mixed]')) cb.indeterminate=true; s.innerHTML=folderSumHTML(fp); b.disabled=!fp.on.size; b.textContent=`Add ${fp.on.size} file${fp.on.size===1?'':'s'}`; }
const newFileId = () => 'f'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
async function folderAdd(){
  const fp=folderPick; if(!fp || !fp.on.size) return;
  const paths=fp.files.filter(f=>fp.on.has(f.path)).map(f=>f.path), linked=!!(fp.root && fp.linked && fp.target==='space');
  fp.stage='reading'; paintFolder();
  const got=[];
  try{
    if(fp.root){ for(let i=0;i<paths.length;i+=200) got.push(...await folderApi('/api/folder/read', {root:fp.root, paths:paths.slice(i,i+200)})); }
    else for(const p of paths){ const f=fp.files.find(x=>x.path===p); try{ const text=await f.file.text(); got.push(text.includes('\u0000') ? {path:p, error:'It looks like a binary file.'} : {path:p, text, size:f.size, mtime:f.mtime}); }catch(e){ got.push({path:p, error:'It couldn’t be read.'}); } }
  }catch(e){ if(folderPick===fp){ fp.stage='tree'; paintFolder(); } toast(e.message); return; }
  const ok=got.filter(g=>g.text!=null), bad=got.filter(g=>g.text==null);
  const existing=new Map((S.files||[]).filter(m=>m.src && m.src.root && m.src.root===fp.root).map(m=>[m.src.path, m]));
  const metas=ok.map(g=>{
    const was=fp.target==='space' && existing.get(g.path);
    if(was && was.src.mtime===g.mtime && !was.dirty && Files.get(was.id)) return was; /* unchanged: same id, so replies don't see a change */
    const id=newFileId(), name=`${fp.name}/${g.path}`;
    Files.put(id, {name, type:'text/plain', size:g.size, kind:'text', text:g.text});
    const m={id, name, kind:'text', size:g.size};
    if(linked) m.src={root:fp.root, path:g.path, mtime:g.mtime};
    return m;
  });
  closeFolder();
  if(fp.target==='space'){
    const names=new Set(metas.map(m=>m.name));
    commit(`Added ${metas.length} file${metas.length===1?'':'s'} from ${fp.name} to this project${linked?', linked to the folder':''}`, ()=>{
      S.files=[...(S.files||[]).filter(m=>!names.has(m.name) && !(linked && m.src && m.src.root===fp.root && !fp.on.has(m.src.path))), ...metas];
    }, {touch:false});
  } else { pendingFiles=[...pendingFiles, ...metas]; keepDraft(()=>renderTree()); toast(`Attached ${metas.length} file${metas.length===1?'':'s'} from ${fp.name} to your next prompt.`); }
  if(bad.length) setTimeout(()=>toast(`Skipped ${bad.length}: ${bad.slice(0,3).map(b=>`${b.path} (${b.error.replace(/\.$/,'')})`).join('; ')}${bad.length>3?'…':''}`), 1600);
}
/* Sync: re-reads linked files that changed on disk. A file edited in Treechats and not saved to disk is left alone
   and reported, so nothing you wrote is overwritten. */
async function syncFolder(root){
  if(!hasServer()){ toast('Linked folders need Treechats running on this computer.'); return; }
  let list; try{ list=await folderApi('/api/folder/list', {root}); }catch(e){ toast(e.message); return; }
  const mine=(S.files||[]).filter(m=>m.src && m.src.root===root), disk=new Map(list.files.map(f=>[f.path, f]));
  const changed=mine.filter(m=>disk.has(m.src.path) && disk.get(m.src.path).mtime!==m.src.mtime);
  const clash=changed.filter(m=>m.dirty), take=changed.filter(m=>!m.dirty), gone=mine.filter(m=>!disk.has(m.src.path));
  const fresh=list.files.filter(f=>!mine.some(m=>m.src.path===f.path) && folderDefault(f)).length;
  const got=take.length ? await folderApi('/api/folder/read', {root, paths:take.map(m=>m.src.path)}).catch(e=>{ toast(e.message); return null; }) : [];
  if(!got) return;
  const upd=new Map();
  for(const g of got){ if(g.text==null) continue; const m=take.find(x=>x.src.path===g.path), id=newFileId(); Files.put(id, {name:m.name, type:'text/plain', size:g.size, kind:'text', text:g.text}); upd.set(m.id, {...m, id, size:g.size, src:{...m.src, mtime:g.mtime}}); }
  const msg=[upd.size?`${upd.size} changed`:'', gone.length?`${gone.length} no longer on disk, removed`:'', clash.length?`${clash.length} edited here and on disk, left as edited here`:''].filter(Boolean).join(', ') || 'nothing changed';
  if(upd.size || gone.length) commit(`Synced ${list.name}: ${msg}`, ()=>{ S.files=S.files.filter(m=>!gone.includes(m)).map(m=>upd.get(m.id)||m); }, {touch:false, action: fresh?{label:`Add ${fresh} new…`, fn:()=>openFolder('space', root)}:undefined});
  else toast(`Synced ${list.name}: ${msg}.`, false, fresh?{label:`Add ${fresh} new…`, fn:()=>openFolder('space', root)}:undefined);
}
function unlinkFolder(root){
  const name=root.split(/[\\/]/).filter(Boolean).pop();
  commit(`Unlinked ${name}. Its files stay in the project as copies.`, ()=>{ S.files=S.files.map(m=>m.src && m.src.root===root ? (({src, dirty, ...rest})=>rest)(m) : m); }, {touch:false});
}
folderEl.addEventListener('click', e=>{
  const fp=folderPick; if(!fp) return;
  const c=s=>e.target.closest(s);
  if(e.target===folderEl || c('[data-fpclose]')){ closeFolder(); return; }
  if(c('[data-fpchoose]')){ dirPicker.value=''; dirPicker.click(); return; }
  if(c('[data-fplink]')){ const v=folderEl.querySelector('#folderPath').value; loadLinkedFolder(v); return; }
  const rc=c('[data-fprecent]'); if(rc){ loadLinkedFolder(rc.dataset.fprecent); return; }
  if(c('[data-fpback]')){ fp.stage='choose'; fp.files=[]; fp.on.clear(); paintFolder(); return; }
  const tg=c('[data-fptarget]'); if(tg){ fp.target=tg.dataset.fptarget; paintFolder(); return; }
  const op=c('[data-fpopen]'); if(op){ const p=op.dataset.fpopen; fp.open.has(p)?fp.open.delete(p):fp.open.add(p); paintFolderList(); return; }
  if(c('[data-fpall]')){ fp.on=new Set(fp.files.filter(folderDefault).map(f=>f.path)); paintFolderList(); return; }
  if(c('[data-fpnone]')){ fp.on.clear(); paintFolderList(); return; }
  if(c('[data-fpadd]')){ folderAdd(); return; }
});
folderEl.addEventListener('change', e=>{
  const fp=folderPick; if(!fp) return;
  const f=e.target.dataset.fpfile, d=e.target.dataset.fpdir;
  if(f!=null){ e.target.checked ? fp.on.add(f) : fp.on.delete(f); paintFolderList(); return; }
  if(d!=null){ const all=fp.files.filter(x=>x.path.startsWith(d+'/') && x.size<=MAX_TEXT_FILE); const on=e.target.checked; for(const x of all) on ? fp.on.add(x.path) : fp.on.delete(x.path); paintFolderList(); return; }
  if(e.target.matches('[data-fplinked]')){ fp.linked=e.target.checked; return; }
});
folderEl.addEventListener('input', e=>{ if(e.target.id==='folderFilter' && folderPick){ folderPick.filter=e.target.value; paintFolderList(); } });
folderEl.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeFolder(); return; }
  if(e.key==='Enter' && e.target.id==='folderPath'){ e.preventDefault(); loadLinkedFolder(e.target.value); }
});
