/* Attaching files: the file picker, pasting and dropping files. */

/* one hidden file picker serves every "attach" button */
const filePicker=document.createElement('input'); filePicker.type='file'; filePicker.multiple=true; filePicker.hidden=true; document.body.append(filePicker);
let pickerTarget='prompt';
function openPicker(target){ pickerTarget=target; filePicker.value=''; filePicker.accept = target==='space' ? '.txt,.md,.csv,.json,.xml,.yaml,.yml,.html,.css,.js,.ts,.py,.go,.rs,.java,.c,.cpp,.sql,.sh,text/*' : ''; filePicker.click(); }
filePicker.addEventListener('change', ()=>addFiles([...filePicker.files], pickerTarget));
async function addFiles(list, target){
  if(!list.length) return;
  if(target==='space'){
    const metas=await readFiles(list, {textOnly:true}); if(!metas.length) return;
    commit(`Added ${metas.length===1?metas[0].name:metas.length+' files'} to this project`, ()=>{ S.files=[...(S.files||[]), ...metas]; }, {touch:false});
    return;
  }
  const metas=await readFiles(list); if(!metas.length) return;
  pendingFiles=[...pendingFiles, ...metas];
  const t=document.getElementById('contText')||document.getElementById('composeText'), keep=t?t.value:'';
  renderTree(); const t2=document.getElementById('contText')||document.getElementById('composeText'); if(t2){ t2.value=keep; t2.focus({preventScroll:true}); }
}
treeEl.addEventListener('input', e=>{
  if(e.target.id==='distillText' && distill){ distill.text=e.target.value; const has=!!e.target.value.trim(); for(const b of treeEl.querySelectorAll('[data-dgo]')) if(b.dataset.dgo!=='again') b.disabled=!has; }
  if(e.target.id==='contText') draft=e.target.value; else if(e.target.id==='composeText') draftRoot=e.target.value;
  if(e.target.id==='contText' || e.target.id==='composeText') updateSlash(e.target);
  if(variants && e.target.dataset.vtext!=null){ const i=+e.target.dataset.vtext, r=variants.rows[i], was=!!r.text.trim(); r.text=e.target.value; if(i===0) draft=r.text;
    if(was!==!!r.text.trim()){ const n=variants.rows.filter(x=>x.text.trim()).length, b=treeEl.querySelector('[data-vsend]'); if(b){ b.disabled=!n; b.textContent=`Send ${n} variant${n===1?'':'s'}`; } const sg=treeEl.querySelector('[data-vsuggest]'); if(sg && i===0) sg.disabled=variants.suggesting||!r.text.trim(); } }
  if(fan){ const d=e.target.dataset; if(d.ftitle!=null) fan.options[+d.ftitle].title=e.target.value; if(d.fprompt!=null){ const o=fan.options[+d.fprompt], was=!!o.prompt.trim(); o.prompt=e.target.value; if(was!==!!o.prompt.trim()){ const b=treeEl.querySelector('[data-fango]'), n=fan.options.filter(x=>x.on&&x.prompt.trim()).length; if(b){ b.disabled=!n; b.firstChild.textContent=fanGoLabel(n)+' '; } } } }
});
treeEl.addEventListener('paste', e=>{
  if(!e.target.matches || !e.target.matches('#contText, #composeText')) return;
  const fs=[...(e.clipboardData && e.clipboardData.files || [])]; if(!fs.length) return;
  e.preventDefault(); addFiles(fs, 'prompt');
});
for(const [el, target] of [[treeEl,'prompt'], [document.getElementById('filesCard'),'space']]){
  el.addEventListener('dragover', e=>{ if(!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; const z=e.target.closest(target==='space'?'#filesCard':'.composer'); if(!z) return; e.preventDefault(); z.classList.add('dropping'); });
  el.addEventListener('dragleave', e=>{ const z=e.target.closest('.dropping'); if(z && !z.contains(e.relatedTarget)) z.classList.remove('dropping'); });
  el.addEventListener('drop', e=>{ const z=e.target.closest(target==='space'?'#filesCard':'.composer'); if(!z || !e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); z.classList.remove('dropping'); addFiles([...e.dataTransfer.files], target); });
}
document.getElementById('filesCard').addEventListener('click', e=>{
  if(e.target.closest('[data-attachspace]')){ openPicker('space'); return; }
  const fo=e.target.closest('[data-fileopen]'); if(fo){ openFileView(fo.dataset.fileopen); return; }
  const af=e.target.closest('[data-addfolder]'); if(af){ openFolder('space', af.dataset.addfolder || null); return; }
  const sf=e.target.closest('[data-syncfolder]'); if(sf){ syncFolder(sf.dataset.syncfolder); refreshGit(sf.dataset.syncfolder); return; }
  const rf=e.target.closest('[data-runfolder]'); if(rf){ closeSpaceFiles(); const t=document.getElementById('contText'); if(t){ t.value='/run '; t.dispatchEvent(new Event('input', {bubbles:true})); t.focus(); } else toast('Open a chat, then type /run and the command.'); return; }
  const df=e.target.closest('[data-difffolder]'); if(df){ diffMenu(df, df.dataset.difffolder); return; }
  const uf=e.target.closest('[data-unlinkfolder]'); if(uf){ unlinkFolder(uf.dataset.unlinkfolder); return; }
  const r=e.target.closest('[data-rmspacefile]'); if(r){ const i=+r.dataset.rmspacefile, m=S.files[i]; commit(`Removed ${m.name} from this project`, ()=>{ S.files.splice(i,1); }, {touch:false}); }
});
document.getElementById('toastRoot').addEventListener('click', e=>{
  if(e.target.id==='toastUndo') undo();
  if(e.target.id==='toastAct' && toastAction){ const a=toastAction; document.getElementById('toastRoot').innerHTML=''; a.fn(); }
});
document.getElementById('undoBtn').onclick=undo;
document.getElementById('redoBtn').onclick=redo;
document.getElementById('newBtn').onclick=startNewConversation;
