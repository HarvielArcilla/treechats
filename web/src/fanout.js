/* ✦ Fan out: one branch for each option a reply offers. */

/* ---- Fan out ----
   Turns the options a reply offers into one follow-up prompt each, on its own branch. */
let fan=null;
const stripMd = t => Ops.stripMd(t);
function shortTitle(line){ return Ops.shortTitle(line); }
/* without Claude: read numbered and bulleted lists, or headings, at the top level of the reply */
function listOptions(reply){ return Ops.listOptions(reply); }
const FAN_ASK = (text, reply) => Ops.fanAsk(opsIo(), text, reply);
async function openFan(id){
  const n=S.nodes[id]; if(!n || !n.reply) return;
  let tpl=null;
  if(sampleState==='ready'){ tpl=await askTemplate('fan', {message:clip(n.text||'',4000), reply:clip(n.reply,24000)}, `Fan out #${id}`); if(tpl==null) return; }
  resendFor=null;
  if(fan && fan.ctl) fan.ctl.abort();
  const ctl=new AbortController();
  fan={id, status:'loading', options:[], main:0, replies:opts.fanReplies!==false, note:'', ctl, quick:listOptions(n.reply)};
  animRender([id]);
  let res=null, note='';
  if(sampleState==='ready' && sampleFn && sampleFn.json){
    try{
      const d=await sampleFn.json(fillPrompt('fan', {message:clip(n.text||'',4000), reply:clip(n.reply,24000)}, tpl), {modelTier:'quick', cache:false, signal:ctl.signal});
      const list=Array.isArray(d && d.options) ? d.options.filter(o=>o && typeof o.title==='string' && typeof o.prompt==='string' && o.prompt.trim()).slice(0,10) : null;
      if(list) res={options:list.map(o=>({title:clip(o.title.trim(),48), prompt:o.prompt.trim()})), recommended: Number.isInteger(d.recommended) && d.recommended>=0 && d.recommended<list.length ? d.recommended : null};
    }catch(e){ note='Claude couldn’t read the options, so they come from the lists in the reply.'; }
  } else note='Without Claude here, the options come from the lists in the reply.';
  if(!fan || fan.ctl!==ctl || fan.status!=='loading') return;
  fanReady(res || fan.quick, note);
}
function fanReady(res, note){
  fan.options=res.options.map((o,i)=>({...o, on:true, rec:i===res.recommended}));
  fan.main = res.recommended ?? 0;
  fan.status='ready'; fan.note=note||''; fan.ctl=null;
  paintFan();
  const b=treeEl.querySelector('[data-fango]'); if(b && !b.disabled) b.focus({preventScroll:true});
}
function closeFan(){ if(!fan) return; const id=fan.id; if(fan.ctl) fan.ctl.abort(); fan=null; animRender([id]); }
function paintFan(){ const el=treeEl.querySelector('.fan'); if(el) el.outerHTML=fanHTML(); else animRender([fan&&fan.id]); }
function fanHTML(){
  if(!fan) return '';
  const id=fan.id, on=fan.options.filter(o=>o.on && o.prompt.trim()).length;
  const here=refsAt(id), rid0=here.includes(S.head)?S.head:here[0];
  let body;
  if(fan.status==='loading') body=`<p class="thinking">Claude is reading the options in this reply…</p>${fan.quick.options.length>=2?`<p class="note"><button class="rmore" data-fskip>Use the ${fan.quick.options.length} options listed in the reply instead</button></p>`:''}`;
  else {
    body = fan.options.length ? `<ol class="fopts">${fan.options.map((o,i)=>`<li class="fopt ${o.on?'':'off'}">
        <input type="checkbox" data-fon="${i}" ${o.on?'checked':''} aria-label="Make a branch for ${esc(o.title)}">
        <div class="fbody"><div class="fhead"><input class="ftitle" data-ftitle="${i}" value="${esc(o.title)}" aria-label="Option name" maxlength="48">${o.rec?'<span class="tag rec">Claude’s pick</span>':''}</div>
        <textarea data-fprompt="${i}" rows="2" aria-label="Follow-up prompt for ${esc(o.title)}">${esc(o.prompt)}</textarea></div>
        <label class="fmain" title="The mainline continues the current branch"><input type="radio" name="fanmain" data-fmain="${i}" ${fan.main===i?'checked':''} ${o.on?'':'disabled'}> Mainline</label>
        <button class="fx" data-fdel="${i}" aria-label="Remove ${esc(o.title)}">×</button></li>`).join('')}</ol>`
      : '<p class="note">No separate options turned up in this reply. Add them yourself below.</p>';
    if(fan.note) body+=`<p class="note">${esc(fan.note)}</p>`;
  }
  const mainOpt=fan.options[fan.main];
  const where = rid0 ? `continues <b>${esc(refName(rid0))}</b>` : `starts a branch named after it`;
  const canReply = sampleState==='ready';
  return `<div class="fan" data-key="fan${id}">
    <div class="fanhead"><b>Fan out #${id} into branches</b><button class="rmore" data-fcancel>Cancel</button></div>
    ${body}
    ${fan.status==='ready' ? `<p class="note">${mainOpt&&mainOpt.on?`The mainline, <b>${esc(mainOpt.title)}</b>, ${where}.`:'Pick a mainline.'} Each other option gets its own branch named after it.</p>
    ${canReply?`<label class="chk"><input type="checkbox" data-freplies ${fan.replies?'checked':''}> <span>Get Claude’s reply on each branch${on>1?` and compare them side by side`:''}</span></label>`:''}
    <div class="bar"><button class="btn primary" data-fango ${on?'':'disabled'}>${fanGoLabel(on)} <kbd class="inv">${IS_MAC?'⌘↵':'Ctrl ↵'}</kbd></button><button class="btn" data-fadd>+ Add option</button></div>` : ''}
  </div>`;
}
const fanGoLabel = on => `Create ${on} branch${on===1?'':'es'}`;
function slugName(title, conv){ return Ops.slugName(S, title, conv, chain); }
function fanCreate(){
  const f=fan; if(!f) return;
  const id=f.id, list=f.options.map((o,i)=>({...o, i})).filter(o=>o.on && o.prompt.trim());
  if(!list.length){ toast('Tick at least one option.'); return; }
  const main=list.find(o=>o.i===f.main) || list[0], ordered=[main, ...list.filter(o=>o!==main)];
  const conv=convOf(id), here=refsAt(id), rid0=here.includes(S.head)?S.head:here[0];
  const made=[];
  fan=null;
  commit(`Fanned out #${id} into ${list.length} branch${list.length===1?'':'es'}`, ()=>{
    for(const o of ordered){
      const nid=Ops.addTurn(S, id, o.prompt.trim());
      if(o===main){ if(rid0){ S.refs[rid0].tip=nid; S.head=rid0; } else S.head=newRef(slugName(o.title, conv), nid); }
      else newRef(slugName(o.title, conv), nid);
      made.push(nid);
    }
    sel=made[0];
  }, {action: list.length>1 ? {label:'Compare', fn:()=>openCompare(id)} : undefined});
  opts.fanReplies=f.replies; save();
  if(f.replies && sampleState==='ready'){ wantReplies(made); if(made.length>1) openCompare(id); }
}
