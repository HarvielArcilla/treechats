/* Seeing a ✦ request before it goes, with its wording editable. */

/* ---- Reviewing a ✦ request before it goes ----
   ✦ tools you start yourself (a summary for Include as, Squash or Reroot, Distill, Fan out) send an instruction from
   Settings › Prompts. With "Show me first" (Settings › Prompts), or a Shift-click on any ✦ button, a card shows that
   instruction before it's sent: change it for this one use, or keep the change as your default. Review asks every
   time anyway. Checks that run on their own (naming, Replay and loop checks) never stop to ask. */
let reviewNext=0;
document.addEventListener('click', e=>{ if(!e.shiftKey) return; const b=e.target.closest('button'); if(b && (b.textContent||'').includes('✦')) reviewNext=Date.now(); }, true);
const reqEl=()=>document.getElementById('requestView');
let reqUI=null;
/* the instruction to use for this request: your default, or what you write in the card (null if you cancel) */
function askTemplate(k, vars, label){
  const want = set('aiReview')==='review' || Date.now()-reviewNext<2500;
  reviewNext=0;
  if(!want) return Promise.resolve(promptText(k));
  return new Promise(res=>{
    if(reqUI) reqUI.res(null);
    reqUI={k, vars, label, res};
    paintRequest(); openPanel(reqEl());
    const t=document.getElementById('reqText'); if(t){ t.focus({preventScroll:true}); t.setSelectionRange(0,0); }
  });
}
function paintRequest(){
  const box=reqEl().querySelector('.cmpbox'); if(!reqUI){ box.innerHTML=''; return; }
  const {k, label}=reqUI, P=PROMPTS[k];
  box.innerHTML=`<div class="sethead"><div class="cmptitle"><h2 id="reqTitle">${AI}${esc(label)}</h2><p class="note">The instruction Claude gets. Change it for this one use, or keep the change as your default.</p></div>
      <div class="bar"><button class="btn" data-reqcancel>Cancel</button><button class="btn primary" data-reqsend>Send <kbd class="inv">${IS_MAC?'⌘↵':'Ctrl ↵'}</kbd></button></div></div>
    <div class="sfbody">
      <textarea id="reqText" rows="9" aria-label="The instruction for ${esc(label)}">${esc(promptText(k))}</textarea>
      <p class="note">${P.help}${P.fmt?' Treechats adds a line asking for its answer as JSON, so it can read it.':''}</p>
      <label class="chk"><input type="checkbox" id="reqSave"> <span>Make this my default (Settings › Prompts › ${esc(P.label)})</span></label>
      <details class="reqfull"><summary>The whole request, filled in</summary><pre id="reqFull"></pre></details>
      ${setRow('Before a ✦ tool sends its request', 'Shift-click a ✦ button to see this once either way.', segs('aiReview',[['send','Send it right away'],['review','Show me first']],'Before a ✦ tool sends its request'))}
    </div>`;
  fillReqFull();
}
function fillReqFull(){ const t=document.getElementById('reqText'), p=document.getElementById('reqFull'); if(t && p && reqUI) p.textContent=clip(fillPrompt(reqUI.k, reqUI.vars, t.value), 20000); }
function finishRequest(send){
  if(!reqUI) return; const {k, res}=reqUI, t=document.getElementById('reqText'), keep=document.getElementById('reqSave');
  const v = send && t ? t.value : null;
  if(v!=null && keep && keep.checked){ opts.prompts[k] = v===PROMPTS[k].def ? null : v; save(); toast(`Saved as your default for ${PROMPTS[k].label}`); }
  reqUI=null; closePanel(reqEl()); res(v!=null && v.trim() ? v : (send ? promptText(k) : null));
}
function initRequest(){
  const el=reqEl();
  el.addEventListener('click', e=>{
    if(e.target===el || e.target.closest('[data-reqcancel]')){ finishRequest(false); return; }
    if(e.target.closest('[data-reqsend]')){ finishRequest(true); return; }
    const b=e.target.closest('[data-set="aiReview"]'); if(b){ opts.aiReview=b.dataset.val; save(); for(const x of el.querySelectorAll('[data-set="aiReview"]')) x.setAttribute('aria-pressed', String(x===b)); }
  });
  el.addEventListener('input', e=>{ if(e.target.id==='reqText') fillReqFull(); });
  el.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); finishRequest(false); }
    else if(e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); finishRequest(true); }
  });
}
