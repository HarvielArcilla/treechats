/* The file viewer and editor beside the page, and previews of HTML, SVG, Mermaid and Markdown. */

/* ---- File viewer and editor ----
   Click a file (in Project files, on a prompt, or waiting in the input box) to read it with syntax colors and line
   numbers, preview Markdown and images, copy or download it, and edit it. An edit is a new version of the file:
   replies written before it are marked "context changed" with the file's name, and Undo brings the old text back.
   A file linked to a folder can be saved back to disk; a disk copy that changed since it was read is never
   overwritten without asking. */
let fileView=null;
const fviewEl=(()=>{ const w=document.createElement('aside'); w.className='fpane'; w.id='fileView'; w.inert=true; w.setAttribute('aria-labelledby','fvTitle'); w.innerHTML='<div class="fvresize" role="separator" aria-orientation="vertical" aria-label="Resize the file panel" tabindex="0"></div><div class="fview"></div>'; (document.getElementById('shell')||document.body).append(w); return w; })();
const shellBox=()=>document.getElementById('shell');
/* the panel's width: remembered, and kept so the chat beside it stays at least 440px wide */
function paneWidth(w){
  const sh=shellBox(), cs=getComputedStyle(sh), side=(parseFloat(cs.getPropertyValue('--sw'))||0)+(parseFloat(cs.getPropertyValue('--cw'))||0);
  const max=Math.max(320, innerWidth-side-440);
  return Math.round(Math.min(max, Math.max(320, w || opts.fileW || Math.min(760, innerWidth*0.4))));
}
let paneTimer=0;
function showPane(){
  clearTimeout(paneTimer);
  const sh=shellBox(); sh.style.setProperty('--fwopen', paneWidth()+'px');
  fviewEl.inert=false;
  requestAnimationFrame(()=>sh.classList.add('with-file'));
}
function hidePane(){
  const sh=shellBox(); sh.classList.remove('with-file');
  paneTimer=setTimeout(()=>{ if(!fileView){ fviewEl.inert=true; fviewEl.querySelector('.fview').innerHTML=''; } }, 300);
}
/* drag the panel's left edge (or use the arrow keys on it) to resize */
(()=>{
  const h=fviewEl.querySelector('.fvresize');
  const setW=w=>{ const v=paneWidth(w); shellBox().style.setProperty('--fwopen', v+'px'); return v; };
  h.addEventListener('pointerdown', e=>{
    e.preventDefault(); h.setPointerCapture(e.pointerId); const sh=shellBox(); sh.classList.add('resizing');
    const move=ev=>{ opts.fileW=setW(innerWidth-ev.clientX); };
    const up=()=>{ sh.classList.remove('resizing'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); save(); };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  h.addEventListener('keydown', e=>{ if(e.key!=='ArrowLeft' && e.key!=='ArrowRight') return; e.preventDefault(); const cur=parseFloat(shellBox().style.getPropertyValue('--fwopen'))||paneWidth(); opts.fileW=setW(cur+(e.key==='ArrowLeft'?40:-40)); save(); });
  addEventListener('resize', ()=>{ if(fileView) setW(opts.fileW); });
})();
/* where a file is: "p:2" waiting in the input box, "s:0" a project file, "n12:1" attached to #12 */
function fileAt(where){
  const [k, i]=where.split(':'), idx=+i;
  if(k==='p') return pendingFiles[idx] || null;
  if(k==='s') return (S.files||[])[idx] || null;
  const n=S.nodes[+k.slice(1)]; return n && n.files ? n.files[idx] || null : null;
}
function openFileView(where){
  const m=fileAt(where); if(!m) return;
  /* an HTML, SVG or diagram file opens as a preview too, with its source a click away */
  const r0=Files.get(m.id), pk=r0 && r0.kind==='text' ? (/\.html?$/i.test(m.name) ? 'html' : /\.svg$/i.test(m.name) ? 'svg' : /\.(mmd|mermaid)$/i.test(m.name) ? 'mermaid' : '') : '';
  if(pk){ openPreview(pk, r0.text, null, m.name); fileView.where=where; return; }
  if(!Files.get(m.id)){ toast(`${m.name} isn’t stored in this browser, so it can’t be shown here.`); return; }
  fileView={where, id:m.id, mode: /\.(md|markdown)$/i.test(m.name) ? 'preview' : 'view', saveDisk:true, ret:document.activeElement};
  showPane(); paintFileView();
  const b=fviewEl.querySelector('[data-fvclose]'); if(b) b.focus({preventScroll:true});
}
/* ---- Previews ----
   A code block Claude wrote as HTML, SVG, Markdown or a Mermaid diagram, drawn in the side panel. HTML, SVG and
   diagrams run in a sandboxed frame with no access to this page: it can't read your chats, the token or anything
   stored here, and the server refuses its requests (they come from no origin). */
const PREVIEW_NAMES={html:'HTML', svg:'SVG', markdown:'Markdown', mermaid:'Diagram'};
const PREVIEW_EXT={html:'html', svg:'svg', markdown:'md', mermaid:'mmd'};
function openPreview(kind, code, from, title){
  if(fileView && fileView.url) URL.revokeObjectURL(fileView.url);
  fileView={art:{kind, code, from, title, key:Math.random().toString(36).slice(2)}, mode:'preview', ret:document.activeElement};
  showPane(); paintPreview();
  const b=fviewEl.querySelector('[data-fvclose]'); if(b) b.focus({preventScroll:true});
}
/* the page the frame shows: the code itself for HTML; SVG and diagrams centered on a plain page */
function previewDoc(kind, code){
  const base='<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  if(kind==='html') return /<html[\s>]|<!doctype/i.test(code) ? code : `<!doctype html>${base}<body>${code}</body>`;
  const page='<style>html,body{margin:0;min-height:100%;background:#fff;color:#111;font-family:system-ui,sans-serif}body{display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}svg{max-width:100%;height:auto}.err{color:#b3261e;white-space:pre-wrap;font:13px ui-monospace,monospace}</style>';
  if(kind==='svg') return `<!doctype html>${base}${page}<body>${code}</body>`;
  if(kind==='mermaid') return `<!doctype html>${base}${page}<body><pre class="mermaid">${esc(code)}</pre><script src="${location.origin}/vendor/mermaid.min.js"><\/script><script>try{mermaid.initialize({startOnLoad:false,securityLevel:'strict'});mermaid.run().catch(function(e){document.body.innerHTML='<p class=err></p>';document.querySelector('.err').textContent='This diagram has an error: '+(e&&e.message||e);});}catch(e){document.body.innerHTML='<p class=err>Diagrams need the Treechats server, which serves the diagram library.</p>';}<\/script></body>`;
  return '';
}
function paintPreview(){
  const fv=fileView, a=fv.art, box=fviewEl.querySelector('.fview'), name=PREVIEW_NAMES[a.kind]||'Preview';
  const sw=`<div class="viewsw fvsw" role="radiogroup" aria-label="Show as" data-pos="${fv.mode==='preview'?2:1}"><span class="vtrack"><span class="vthumb" aria-hidden="true"></span><button role="radio" aria-checked="${fv.mode!=='preview'}" data-pvmode="source">Source</button><button role="radio" aria-checked="${fv.mode==='preview'}" data-pvmode="preview">Preview</button></span></div>`;
  const lines=a.code.replace(/\n$/,'').split('\n').length;
  let body;
  if(fv.mode==='source'){ const hl=hlFor(a.code, 'preview.'+(a.kind==='mermaid'?'txt':PREVIEW_EXT[a.kind])); body=`<div class="fvcode"><pre class="fvgutter" aria-hidden="true">${Array.from({length:lines}, (_,i)=>i+1).join('\n')}</pre><pre class="fvsrc"><code class="hljs">${hl}</code></pre></div>`; }
  else if(a.kind==='markdown') body=`<div class="rbody fvmd">${md(a.code)}</div>`;
  else body=`<iframe class="pvframe" sandbox="allow-scripts allow-popups allow-forms allow-modals" referrerpolicy="no-referrer" title="${name} preview"></iframe>`;
  box.innerHTML=`<div class="fvhead"><div class="fvtitle"><h2 id="fvTitle">${esc(a.title || name+' preview')}</h2><p class="note">${a.from!=null&&S.nodes[a.from]?`From the reply to #${a.from} · `:''}${lines.toLocaleString()} line${lines===1?'':'s'}${a.kind==='html'?' · runs sandboxed, apart from Treechats':''}</p></div>${sw}<button class="btn" data-fvclose aria-label="Close the preview">Close</button></div>
    <div class="bar fvtools"><button class="btn" data-pvcopy>Copy</button><button class="btn" data-pvdownload title="Save it as a file">Download</button>${fv.mode==='preview'&&a.kind!=='markdown'?'<button class="btn" data-pvreload title="Draw it again from the start">Reload</button>':''}</div>
    <div class="fvbody">${body}</div>`;
  box.dataset.art=a.key+fv.mode;
  const f=box.querySelector('.pvframe'); if(f) f.srcdoc=previewDoc(a.kind, a.code);
}
function closeFileView(force){
  const fv=fileView; if(!fv) return;
  if(!force && fv.mode==='edit'){ const t=fviewEl.querySelector('#fvText'), r=Files.get(fv.id); if(t && r && t.value!==r.text && t.value!==fv.draft){ toast('You have unsaved edits. Save them, or Cancel to drop them.'); return; } }
  fileView=null; hidePane(); if(fv.url) URL.revokeObjectURL(fv.url); delete fviewEl.querySelector('.fview').dataset.art;
  if(fv.ret && fv.ret.focus && document.contains(fv.ret)) fv.ret.focus({preventScroll:true});
}
function fileSource(m, where){
  if(m.src && m.src.root) return `linked to ${m.src.root}${m.dirty?' · <b>edited here, not saved to disk</b>':''}`;
  const k=where.split(':')[0];
  return k==='p' ? 'waiting to be sent with your next prompt' : k==='s' ? 'a project file, sent with every request' : `attached to #${k.slice(1)}`;
}
function paintFileView(){
  const fv=fileView; if(!fv) return;
  /* a preview is drawn when it opens or you change it, not on every redraw of the page, so a running page keeps its state */
  if(fv.art){ if(fviewEl.querySelector('.fview').dataset.art!==fv.art.key+fv.mode) paintPreview(); return; }
  const m=fileAt(fv.where), r=m && Files.get(m.id); if(!m || !r){ closeFileView(true); return; }
  const box=fviewEl.querySelector('.fview'), isImg=r.kind==='image', text=r.text||'', lines=isImg?0:text.replace(/\n$/,'').split('\n').length;
  const isMd=!isImg && /\.(md|markdown)$/i.test(m.name), editable=!isImg;
  /* Download only where the browser holds the only copy: a linked file is already on disk, unless edited here and not saved */
  const onDisk = !!(m.src && m.src.root && !m.dirty);
  const sw = isMd ? `<div class="viewsw fvsw" role="radiogroup" aria-label="Show as" data-pos="${fv.mode==='preview'?2:1}"><span class="vtrack"><span class="vthumb" aria-hidden="true"></span><button role="radio" aria-checked="${fv.mode!=='preview'}" data-fvmode="view">Source</button><button role="radio" aria-checked="${fv.mode==='preview'}" data-fvmode="preview">Preview</button></span></div>` : '';
  const tools = fv.mode==='edit' || fv.mode==='diff' ? '' : `${editable?'<button class="btn" data-fvedit>Edit</button>':''}${isImg?'':'<button class="btn" data-fvcopy>Copy</button>'}${onDisk?'':`<button class="btn" data-fvdownload title="Save a copy to your computer: Treechats holds the only copy of this file">Download</button>`}${sw?`<span class="fvspacer"></span>${sw}`:''}`;
  let body;
  if(isImg){ if(!fv.url) fv.url=URL.createObjectURL(r.blob); body=`<div class="fvimg"><img src="${fv.url}" alt="${esc(m.name)}"></div>`; }
  else if(fv.mode==='diff'){
    const d=fv.diff, kept=d.hunks.filter(h=>h.on).length, canDisk=!!(m.src && m.src.root && hasServer());
    body=`${d.note?`<p class="note dnote ${d.warn?'err':''}">${esc(d.note)}</p>`:''}<div class="fvdiff">${diffHTML(fv)}</div>
      <div class="bar fvbar"><button class="btn primary" data-dsave ${kept?'':'disabled'}>Save ${kept} of ${d.hunks.length} change${d.hunks.length===1?'':'s'}</button><button class="btn" data-dedit title="Open the result in the editor before saving">Edit the result</button><button class="btn" data-fvclose>Cancel</button>${canDisk?`<label class="chk"><input type="checkbox" data-fvdisk ${fv.saveDisk?'checked':''}> Also save to disk</label>`:''}</div>
      <p class="note">Proposed in the reply to #${d.from}. Nothing changes until you save; saving makes a new version of the file, and Undo brings this one back.</p>`;
  }
  else if(fv.mode==='edit'){
    const canDisk=!!(m.src && m.src.root && hasServer());
    const t0=fv.draft ?? text;
    body=`<div class="fvedwrap"><pre class="fvgutter" aria-hidden="true">${gutterNums(t0)}</pre><div class="fvedarea"><pre class="fvedhl" aria-hidden="true"><code class="hljs">${hlFor(t0, m.name)}\n</code></pre><textarea id="fvText" class="fvedit" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="Edit ${esc(m.name)}">${esc(t0)}</textarea></div></div>
      <div class="bar fvbar"><button class="btn primary" data-fvsave>Save <kbd class="inv">${IS_MAC?'⌘S':'Ctrl S'}</kbd></button><button class="btn" data-fvcancel>Cancel</button>${canDisk?`<label class="chk"><input type="checkbox" data-fvdisk ${fv.saveDisk?'checked':''}> Also save to disk</label>`:''}</div>
      <p class="note">Saving makes a new version of the file. Replies written before it are marked “context changed”, and Undo brings this version back.</p>`;
  }
  else if(fv.mode==='preview') body=`<div class="rbody fvmd">${md(text)}</div>`;
  else {
    const hl=window.TreechatsMarkdown && window.TreechatsMarkdown.highlightFile ? window.TreechatsMarkdown.highlightFile(text, m.name) : esc(text);
    body=`<div class="fvcode"><pre class="fvgutter" aria-hidden="true">${Array.from({length:lines}, (_,i)=>i+1).join('\n')}</pre><pre class="fvsrc"><code class="hljs">${hl}</code></pre></div>`;
  }
  box.innerHTML=`<div class="fvhead"><div class="fvtitle"><h2 id="fvTitle" title="${esc(m.name)}">${fv.mode==='diff'?'Proposed change · ':''}${esc(m.name)}</h2><p class="note">${fmtSize(m.size)}${lines?` · ${lines.toLocaleString()} line${lines===1?'':'s'}`:''}${(()=>{ const l=!isImg && window.TreechatsMarkdown && window.TreechatsMarkdown.langName ? window.TreechatsMarkdown.langName(m.name) : null; return l ? ' · '+esc(l) : ''; })()} · ${fileSource(m, fv.where)}</p></div><button class="btn" data-fvclose>Close</button></div>
    ${tools?`<div class="bar fvtools">${tools}</div>`:''}<div class="fvbody">${body}</div>`;
  if(fv.mode==='edit'){ const t=box.querySelector('#fvText'); if(t){ t.focus({preventScroll:true}); t.setSelectionRange(0,0); } }
}
const hlFor = (text, name) => window.TreechatsMarkdown && window.TreechatsMarkdown.highlightFile ? window.TreechatsMarkdown.highlightFile(text, name) : esc(text);
const gutterNums = text => Array.from({length:text.replace(/\n$/,'').split('\n').length}, (_,i)=>i+1).join('\n');
/* the editor is a plain text box over a colored copy of its text, kept in step as you type and scroll */
let fvHlFrame=0;
function syncEditorColors(){
  const t=fviewEl.querySelector('#fvText'), hl=fviewEl.querySelector('.fvedhl'), gu=fviewEl.querySelector('.fvedwrap .fvgutter'); if(!t || !hl || !fileView) return;
  const m=fileAt(fileView.where);
  hl.firstElementChild.innerHTML=hlFor(t.value, m ? m.name : '')+'\n';
  if(gu) gu.textContent=gutterNums(t.value);
  syncEditorScroll();
}
function syncEditorScroll(){ const t=fviewEl.querySelector('#fvText'), hl=fviewEl.querySelector('.fvedhl'), gu=fviewEl.querySelector('.fvedwrap .fvgutter'); if(!t || !hl) return; hl.scrollTop=t.scrollTop; hl.scrollLeft=t.scrollLeft; if(gu) gu.scrollTop=t.scrollTop; }
fviewEl.addEventListener('input', e=>{ if(e.target.id==='fvText'){ cancelAnimationFrame(fvHlFrame); fvHlFrame=requestAnimationFrame(syncEditorColors); } });
fviewEl.addEventListener('scroll', e=>{ if(e.target.id==='fvText') syncEditorScroll(); }, true);
async function saveFileEdit(given){
  const fv=fileView; if(!fv) return;
  const t=fviewEl.querySelector('#fvText'), m=fileAt(fv.where), r=m && Files.get(m.id); if((!t && given==null) || !r) return;
  const text = given ?? t.value; fv.draft=null;
  if(text===r.text){ fv.mode='view'; paintFileView(); return; }
  const id=newFileId(), size=enc?enc.encode(text).length:text.length;
  if(size>MAX_TEXT_FILE){ toast(`Files can be up to ${MAX_TEXT_FILE/1024} KB here.`); return; }
  Files.put(id, {...r, text, size});
  let src=m.src ? {...m.src} : null, dirty=!!(src && src.root), diskNote='';
  if(src && src.root && fv.saveDisk && hasServer()){
    try{ const w=await folderApi('/api/folder/write', {root:src.root, path:src.path, text, mtime:src.mtime}); src.mtime=w.mtime; dirty=false; diskNote=' and on disk'; }
    catch(e){ diskNote = e.code==='changed_on_disk' ? '. It changed on disk since it was read, so the disk copy was left alone' : `. Not saved to disk: ${e.message}`; if(e.code==='changed_on_disk') fv.conflict=true; }
  }
  const nm={...m, id, size}; if(src) nm.src=src; if(dirty) nm.dirty=true; else delete nm.dirty;
  const [k, i]=fv.where.split(':'), idx=+i;
  /* a change saved from a reply's proposal: that reply isn't marked as having a changed context by it */
  const fromReply = fv.diff ? fv.diff.from : null;
  fv.id=id; fv.mode='view'; fv.diff=null;
  const noteApplied = () => { const rn=fromReply!=null && S.nodes[fromReply]; if(rn){ rn.applied=Object.assign({}, rn.applied, {[nm.name]:h5(id)}); } };
  const action = fv.conflict ? {label:'Overwrite the disk copy', fn:()=>forceDiskSave(fv.where)} : undefined; fv.conflict=false;
  if(k==='p'){ pendingFiles[idx]=nm; keepDraft(()=>renderTree()); toast(`Saved ${m.name}${diskNote}.`, false, action); }
  else if(k==='s') commit(`Saved ${m.name}${diskNote}.`, ()=>{ S.files[idx]=nm; noteApplied(); }, {touch:false, action});
  else commit(`Saved ${m.name} attached to #${k.slice(1)}${diskNote}.`, ()=>{ S.nodes[+k.slice(1)].files[idx]=nm; noteApplied(); }, {touch:false, action});
  paintFileView();
}
async function forceDiskSave(where){
  const m=fileAt(where), r=m && Files.get(m.id); if(!m || !r || !m.src) return;
  try{ const w=await folderApi('/api/folder/write', {root:m.src.root, path:m.src.path, text:r.text, force:true}); m.src={...m.src, mtime:w.mtime}; delete m.dirty; save(); renderSpaceFiles(); if(fileView) paintFileView(); toast(`Saved ${m.name} to disk.`); }
  catch(e){ toast(e.message); }
}
fviewEl.addEventListener('click', e=>{
  const fv=fileView; if(!fv) return;
  const c=s=>e.target.closest(s);
  if(c('[data-fvclose]')){ closeFileView(); return; }
  if(c('[data-fvedit]')){ fv.mode='edit'; paintFileView(); return; }
  if(c('[data-fvcancel]')){ fv.mode='view'; fv.draft=null; paintFileView(); return; }
  if(c('[data-dsave]') && fv.diff){ saveFileEdit(diffResult(fv)); return; }
  if(c('[data-dedit]') && fv.diff){ fv.draft=diffResult(fv); fv.mode='edit'; paintFileView(); return; }
  if(c('[data-fvsave]')){ saveFileEdit(); return; }
  const mo=c('[data-fvmode]'); if(mo){ fv.mode=mo.dataset.fvmode; paintFileView(); return; }
  if(c('[data-fvcopy]')){ const r=Files.get(fv.id); if(r) copyText(r.text, true).then(ok=>{ if(ok) toast('Copied the file.'); }); return; }
  if(c('[data-fvdownload]')){ const m=fileAt(fv.where), r=Files.get(fv.id); if(!m || !r) return; const url=URL.createObjectURL(r.blob || new Blob([r.text], {type:'text/plain'})); const a=document.createElement('a'); a.href=url; a.download=m.name.split('/').pop(); a.click(); setTimeout(()=>URL.revokeObjectURL(url), 1000); return; }
});
fviewEl.addEventListener('change', e=>{
  if(fileView && e.target.matches('[data-fvdisk]')) fileView.saveDisk=e.target.checked;
  if(fileView && fileView.diff && e.target.dataset.dhunk!=null){ fileView.diff.hunks[+e.target.dataset.dhunk].on=e.target.checked; const sc=fviewEl.querySelector('.fvdiff'), top=sc?sc.scrollTop:0; paintFileView(); const sc2=fviewEl.querySelector('.fvdiff'); if(sc2) sc2.scrollTop=top; }
});
fviewEl.addEventListener('keydown', e=>{
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); if(fileView && fileView.mode==='edit'){ const t=fviewEl.querySelector('#fvText'), r=Files.get(fileView.id); if(t && r && t.value!==r.text){ toast('You have unsaved edits. Save them, or Cancel to drop them.'); return; } fileView.mode='view'; paintFileView(); } else closeFileView(); return; }
  if(e.target.id==='fvText'){
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); saveFileEdit(); return; }
    if(e.key==='Tab' && !e.shiftKey){ e.preventDefault(); const t=e.target, ind=/\n\t/.test(t.value) ? '\t' : '  '; t.setRangeText(ind, t.selectionStart, t.selectionEnd, 'end'); syncEditorColors(); }
  }
});
