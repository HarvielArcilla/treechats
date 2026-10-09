/* Scheduled tasks: setting them up and seeing when they run (the server runs them). */

/* ---- Scheduled tasks ----
   A prompt sent at a set time, once or on a schedule: in a chat (continuing its branch each time) or as a new chat
   each time. The tasks are saved with everything else (opts.schedules); the server runs them, even while this page is
   closed, and the page adds each result to its chat when it next can, marked unread if you're elsewhere. */
const schedules = () => Array.isArray(opts.schedules) ? opts.schedules : (opts.schedules=[]);
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const clockText = hm => { const [h,m]=String(hm||'09:00').split(':').map(Number); return new Date(2000,0,1,h||0,m||0).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'}); };
function whenText(w){
  if(!w) return '';
  if('once' in w) return `Once, ${tsFull(w.once)}`;
  if(w.every==='hour') return `Every hour at :${String(w.minute|0).padStart(2,'0')}`;
  if(w.every==='day') return `Every day at ${clockText(w.time)}`;
  if(w.every==='weekday') return `Weekdays at ${clockText(w.time)}`;
  if(w.every==='week') return `Every ${DAYS[w.day|0]} at ${clockText(w.time)}`;
  return '';
}
function whereText(t){
  const sp=DB.spaces[t.sid]; if(!sp) return 'Its project is gone';
  return withTree(sp.tree, ()=>{
    const rf=t.ref && S.refs[t.ref], at=rf && S.nodes[rf.tip] ? rf.tip : (t.after!=null && S.nodes[t.after] ? t.after : null);
    if(at==null) return `${sp.name} · a new chat each time`;
    return `${sp.name} · ${convTitle(S.nodes[chain(at)[0]])}${rf?` · ${refName(t.ref)}`:` · after #${at}`}`;
  });
}
const schedEl=(()=>{ const w=document.createElement('div'); w.className='setwrap'; w.id='schedSheet'; w.hidden=true; w.innerHTML='<div class="setbox fsheet ssheet" role="dialog" aria-modal="true" aria-labelledby="schedTitle"></div>'; document.body.append(w); return w; })();
let schedUI=null, schedStatus={};
/* opens the list, or the form for a new task (from the prompt you're at, with text typed so far) */
function openSchedules(newFrom){
  schedUI={mode:'list'};
  if(newFrom) schedUI={mode:'form', form:newFrom};
  schedEl.hidden=false; document.body.style.overflow='hidden';
  paintSchedules(); refreshSchedStatus();
  setTimeout(()=>{ const f=schedEl.querySelector('textarea, [data-snew], button'); if(f) f.focus({preventScroll:true}); }, 30);
}
function closeSchedules(){ schedUI=null; schedEl.hidden=true; document.body.style.overflow=''; }
async function refreshSchedStatus(){
  if(!hasServer()) return;
  try{ const r=await fetch('/api/schedule/status'); if(r.ok){ schedStatus=await r.json(); if(schedUI && schedUI.mode==='list') paintSchedules(); } }catch(e){}
}
/* a new task's starting point: where you are, or a new chat */
function schedFormFor(at, text){
  const t={text:text||'', name:'', repeat:'day', time:'09:00', minute:0, day:new Date().getDay(), at:'', tier:opts.model||'default', sid:DB.current, ref:null, after:null, where:'new'};
  const d=new Date(Date.now()+3600e3); d.setMinutes(0,0,0);
  t.at=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  if(at!=null && S.nodes[at]){ const tip=refsAt(at)[0]; t.ref=tip||null; t.after=at; t.where='here'; }
  return t;
}
function formFromTask(task){
  const w=task.when, f={id:task.id, text:task.text, name:task.name||'', tier:task.tier||'default', sid:task.sid, ref:task.ref||null, after:task.after??null, where:(task.ref||task.after!=null)?'here':'new', repeat:'once' in w ? 'once' : w.every, time:w.time||'09:00', minute:w.minute|0, day:w.day??1, at:''};
  const d=new Date('once' in w ? w.once : Date.now()+3600e3); f.at=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  return f;
}
function paintSchedules(){
  if(!schedUI) return;
  const box=schedEl.firstChild;
  if(!hasServer()){ box.innerHTML=`<div class="sethead"><h2 id="schedTitle">Scheduled tasks</h2><button class="btn" data-sclose>Done</button></div><div class="fbody"><p class="note">Scheduled tasks need the Treechats server, which runs them. Start Treechats with npm start.</p></div>`; return; }
  if(schedUI.mode==='list'){
    const list=schedules();
    const row=t=>{
      const st=schedStatus[t.id]||{};
      const status=[t.paused?'Paused':st.running?'Running now…':st.next?`Next: ${new Date(st.next).toLocaleString(undefined,{weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})}`:('once' in t.when && st.last?'Done':''), st.last?`last ran ${tsShort(st.last)}${tsShort(st.last).includes(':')?'':' '+new Date(st.last).toLocaleTimeString(undefined,{hour:'numeric', minute:'2-digit'})}`:'', st.error?`failed: ${st.error}`:''].filter(Boolean).join(' · ');
      return `<li class="srow ${t.paused?'paused':''}"><div class="smain"><b>${esc(t.name||clip(t.text.replace(/\s+/g,' '),60))}</b><span class="note">${esc(whenText(t.when))} · ${esc(whereText(t))}</span><span class="note ${st.error?'serr':''}">${esc(status)}</span></div>
        <div class="sacts"><button class="btn xs" data-srun="${t.id}" ${st.running||sampleState!=='ready'?'disabled':''}>Run now</button><button class="btn xs" data-spause="${t.id}">${t.paused?'Resume':'Pause'}</button><button class="btn xs" data-sedit="${t.id}">Edit</button><button class="btn xs danger" data-sdel="${t.id}">Delete</button></div></li>`;
    };
    box.innerHTML=`<div class="sethead"><div class="cmptitle"><h2 id="schedTitle">Scheduled tasks</h2><p class="note">Prompts sent at a set time. Treechats runs them while it’s running, even with this page closed; one that was due while it was off runs when it starts.</p></div><div class="bar"><button class="btn primary" data-snew>+ New task</button><button class="btn" data-sclose>Done <kbd class="inv">Esc</kbd></button></div></div>
      <div class="fbody">${list.length?`<ul class="slist">${list.map(row).join('')}</ul>`:'<p class="note sempty">No scheduled tasks yet. Make one here, with <code>/schedule</code> in the input box, or from a chat’s ⋯ menu.</p>'}</div>`;
    return;
  }
  const f=schedUI.form, here=f.where==='here' && (f.ref||f.after!=null);
  const hereLabel = (f.ref||f.after!=null) ? whereText({sid:f.sid, ref:f.ref, after:f.after}).replace(/^[^·]*· /,'') : '';
  const tiers=TIERS.map(([v,l])=>`<option value="${v}" ${f.tier===v?'selected':''}>${esc(l)}</option>`).join('');
  box.innerHTML=`<div class="sethead"><h2 id="schedTitle">${f.id?'Edit scheduled task':'Schedule a prompt'}</h2><div class="bar"><button class="btn" data-sback>${schedules().length?'Back':'Cancel'}</button></div></div>
    <form class="fbody sform" data-sform>
      <label class="pfield">Prompt<textarea data-sf="text" rows="4" required placeholder="What should Claude do, for example: Summarize what changed in this project since yesterday.">${esc(f.text)}</textarea></label>
      <label class="pfield"><span>Name <span class="note" style="font-weight:400">(optional)</span></span><input data-sf="name" value="${esc(f.name)}" maxlength="60" placeholder="Shown in the list and as the chat title"></label>
      <fieldset class="sfset"><legend>Where</legend>
        ${(f.ref||f.after!=null)?`<label class="sradio"><input type="radio" name="swhere" value="here" ${here?'checked':''}> Continue ${esc(hereLabel)}<span class="note">Each run is added at the end${f.ref?' of the branch':''}, with the chat so far as context.</span></label>`:''}
        <label class="sradio"><input type="radio" name="swhere" value="new" ${here?'':'checked'}> A new chat each time<span class="note">In ${esc(DB.spaces[f.sid]?.name||'this project')}, with the project’s instructions and files.</span></label>
      </fieldset>
      <fieldset class="sfset"><legend>When</legend>
        <div class="srowin"><select data-sf="repeat" aria-label="How often">${[['once','Once'],['hour','Every hour'],['day','Every day'],['weekday','Weekdays'],['week','Every week']].map(([v,l])=>`<option value="${v}" ${f.repeat===v?'selected':''}>${l}</option>`).join('')}</select>
        ${f.repeat==='once'?`<input type="datetime-local" data-sf="at" value="${f.at}" aria-label="Date and time">`:''}
        ${f.repeat==='week'?`<select data-sf="day" aria-label="Day">${DAYS.map((d,i)=>`<option value="${i}" ${+f.day===i?'selected':''}>${d}</option>`).join('')}</select>`:''}
        ${f.repeat==='hour'?`<label class="inl">at minute <input type="number" min="0" max="59" data-sf="minute" value="${f.minute|0}" aria-label="Minute past the hour"></label>`:''}
        ${['day','weekday','week'].includes(f.repeat)?`<input type="time" data-sf="time" value="${f.time}" aria-label="Time">`:''}</div>
      </fieldset>
      <label class="pfield">Model<select data-sf="tier">${tiers}</select></label>
      <p class="perr" data-serr role="alert"></p>
      <div class="tbar"><button class="btn primary">${f.id?'Save':'Schedule it'}</button>${f.id?`<button type="button" class="btn danger" data-sdel="${f.id}">Delete</button>`:''}</div>
    </form>`;
}
function readSchedForm(){
  const f=schedUI.form, v=k=>{ const e=schedEl.querySelector(`[data-sf="${k}"]`); return e ? e.value : null; };
  for(const k of ['text','name','repeat','at','day','minute','time','tier']){ const x=v(k); if(x!=null) f[k]=x; }
  const w=schedEl.querySelector('input[name="swhere"]:checked'); if(w) f.where=w.value;
}
function saveSchedForm(){
  readSchedForm();
  const f=schedUI.form, err=m=>{ const e=schedEl.querySelector('[data-serr]'); if(e) e.textContent=m; };
  if(!f.text.trim()) return err('Write the prompt to send.');
  let when;
  if(f.repeat==='once'){ const t=new Date(f.at).getTime(); if(!t) return err('Choose a date and time.'); if(t<Date.now()-60000) return err('That time has passed. Choose one in the future.'); when={once:t}; }
  else if(f.repeat==='hour') when={every:'hour', minute:Math.min(59, Math.max(0, +f.minute|0))};
  else if(f.repeat==='week') when={every:'week', day:+f.day|0, time:f.time||'09:00'};
  else when={every:f.repeat, time:f.time||'09:00'};
  const task={id:f.id||('t'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)), name:f.name.trim()||undefined, text:f.text.trim(), sid:f.sid, ref:f.where==='here'?f.ref:null, after:f.where==='here'?f.after:null, when, tier:f.tier, created:Date.now()};
  const list=schedules(), i=list.findIndex(x=>x.id===task.id);
  if(i>=0){ task.paused=list[i].paused; task.created=list[i].created; if(JSON.stringify(list[i].when)!==JSON.stringify(when)) task.created=Date.now(); list[i]=task; } else list.push(task);
  save(); flushState().then(refreshSchedStatus);
  schedUI={mode:'list'}; paintSchedules();
  toast(`${i>=0?'Saved':'Scheduled'}: ${whenText(when)}`);
}
schedEl.addEventListener('click', e=>{
  const c=q=>e.target.closest(q);
  if(e.target===schedEl || c('[data-sclose]')){ closeSchedules(); return; }
  if(c('[data-snew]')){ schedUI={mode:'form', form:schedFormFor(opts.simple?composeParent():sel, '')}; paintSchedules(); schedEl.querySelector('textarea')?.focus(); return; }
  if(c('[data-sback]')){ if(schedules().length){ schedUI={mode:'list'}; paintSchedules(); } else closeSchedules(); return; }
  const ed=c('[data-sedit]'); if(ed){ const t=schedules().find(x=>x.id===ed.dataset.sedit); if(t){ schedUI={mode:'form', form:formFromTask(t)}; paintSchedules(); } return; }
  const pa=c('[data-spause]'); if(pa){ const t=schedules().find(x=>x.id===pa.dataset.spause); if(t){ if(t.paused) delete t.paused; else t.paused=true; save(); flushState().then(refreshSchedStatus); paintSchedules(); } return; }
  const de=c('[data-sdel]'); if(de){ const i=schedules().findIndex(x=>x.id===de.dataset.sdel); if(i>=0){ const [was]=schedules().splice(i,1); save(); schedUI={mode:'list'}; paintSchedules(); toast('Deleted the task', false, {label:'Undo', fn:()=>{ schedules().splice(i,0,was); save(); paintSchedules(); }}); } return; }
  const ru=c('[data-srun]'); if(ru){ const id=ru.dataset.srun; flushState().then(()=>folderApi('/api/schedule/run', {id})).then(()=>{ toast('Running it now. The reply is added when it’s ready.'); setTimeout(refreshSchedStatus, 300); }).catch(err=>toast(err.message)); return; }
});
schedEl.addEventListener('change', e=>{ if(e.target.matches('[data-sf="repeat"], input[name="swhere"]')){ readSchedForm(); paintSchedules(); } });
schedEl.addEventListener('submit', e=>{ e.preventDefault(); saveSchedForm(); });
schedEl.addEventListener('keydown', e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeSchedules(); } });
