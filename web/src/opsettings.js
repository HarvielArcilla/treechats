/* Operation options in Settings › Operations. */

/* operation options live in Settings › Operations (setEl is declared further down, so look it up here) */
document.getElementById('settings').addEventListener('change', e=>{

  if(e.target.id==='optSummary'){ opts.summary=e.target.checked; save(); }
  if(e.target.id==='optCow'){ opts.cow=e.target.checked; save(); }
  if(e.target.name==='rerootBy'){ opts.rerootBy=e.target.value; save(); }
  if(e.target.name==='squashBy'){ opts.squashBy=e.target.value; save(); }
});
document.getElementById('settings').addEventListener('click', e=>{
  const ro=e.target.closest('[data-runop]'); if(ro){ closeSettings(); if(sel!=null) run(ro.dataset.runop, sel); else toast('Select a prompt first.'); return; }
  if(e.target.closest('[data-openquick]')){ openSettings('bar'); return; }
});
