/* ✦ Judge and ✦ Combine, in Compare. */

/* ---- ✦ Judge and ✦ Combine (in Compare) ----
   Judge: one request with the context up to the prompt, each follow-up and its reply, and your criteria; Claude gives a
   reason for every follow-up and picks one. It changes nothing; you act on the verdict.
   Combine: one request that writes a single reply from the best parts of the follow-ups, with the follow-up message it
   answers and where each part came from. It arrives as a draft you can edit, and enters the tree only when you add it,
   as a new follow-up marked "combined" with its sources. Both prompts are editable in Settings › Prompts. */
const JUDGE_DEFAULT=Ops.JUDGE_DEFAULT;
const COMBINE_DEFAULT=Ops.COMBINE_DEFAULT;
let cmpTool=null;
function compareMaterial(sid, parent, ids){ const t=treeOf(sid); return Ops.compareMaterial(t, coreEnv(t), parent, ids); }
function judgeCore(sid, parent, ids, criteria){ return Ops.judge(opsIo(), treeOf(sid), parent, ids, criteria); }
function combineCore(sid, parent, ids, instructions){ return Ops.combine(opsIo(), treeOf(sid), parent, ids, instructions); }
/* adds a combined reply as a new follow-up to `parent`, on its own branch, in the tree in S */
function addCombined(parent, c, by){ return Ops.addCombined(S, coreEnv(), parent, c, by); }
const combinedTitle = n => `Claude combined ${n.combined.from.map(x=>'#'+x).join(', ')} in Compare.${Object.entries(n.combined.sources||{}).map(([k,v])=>` #${k}: ${v}`).join('')}`;
function cmpToolsHTML(){
  const key=cmpKey(), par=cmpParent();
  const t=cmpTool && cmpTool.key===key ? cmpTool : (cmpTool={key, parent:par, criteria:opts.judgeCriteria||'', instructions:opts.combineInstructions||'', judge:null, combine:null});
  t.parent=par; const id=par;
  if(sampleState!=='ready') return '';
  const withReplies=cmpList().filter(k=>k.reply).length;
  const j=t.judge, c=t.combine;
  const judgeBox = j && j.status==='loading' ? '<p class="note thinking">Claude is judging…</p>' : j && j.status==='error' ? `<p class="gnote">${esc(j.err)}</p>` : j && j.result ? `<div class="cverdict-sum"><b>${AI}Judge${j.result.best?`: #${j.result.best}`:''}</b> ${esc(j.result.summary||'')} <span class="note">· against “${esc(clip(j.result.criteria,80))}” · your call</span></div>` : '';
  const comboBox = c && c.status==='loading' ? '<p class="note thinking">Claude is combining…</p>' : c && c.status==='error' ? `<p class="gnote">${esc(c.err)}</p>` : c && c.draft ? `<div class="ccombine"><div class="fanhead"><b>${AI}Combined draft</b><span class="note">from ${c.draft.ids.map(x=>'#'+x).join(', ')} · edit before you add it</span></div>
      <label class="flabel" for="combPrompt">Follow-up it answers</label><input id="combPrompt" value="${esc(c.draft.prompt)}">
      <label class="flabel" for="combReply">Reply</label><textarea id="combReply" rows="${Math.min(16, Math.max(5, c.draft.reply.split('\n').length+1))}">${esc(c.draft.reply)}</textarea>
      ${Object.keys(c.draft.sources).length?`<ul class="csources">${Object.entries(c.draft.sources).map(([k,v])=>`<li><b>#${k}</b> ${esc(v)}</li>`).join('')}</ul>`:''}
      <div class="bar"><button class="btn primary" data-combadd>Add as a follow-up to #${id}</button><button class="btn" data-combagain>Write again</button><button class="btn" data-combdiscard>Discard</button></div></div>` : '';
  return `<div class="ctools">
    <div class="ctrow"><input id="judgeCriteria" placeholder="Criteria: ${esc(JUDGE_DEFAULT)}" value="${esc(t.criteria)}" aria-label="What to judge by"><button class="btn" data-judge ${withReplies<2||(j&&j.status==='loading')?'disabled':''} title="One request: Claude gives a reason for each follow-up and picks one against your criteria. Nothing changes.">${AI}Judge</button></div>
    <div class="ctrow"><input id="combineInstr" placeholder="How to combine: ${esc(COMBINE_DEFAULT)}" value="${esc(t.instructions)}" aria-label="How to combine"><button class="btn" data-combine ${withReplies<2||par==null||(c&&c.status==='loading')?'disabled':''} title="${par==null?'These prompts share no context, so there is no prompt to add a combined reply to.':'One request: Claude writes one reply from the best parts, as a draft you review before adding it.'}">${AI}Combine</button></div>
    ${judgeBox}${comboBox}</div>`;
}
async function runJudge(){
  const t=cmpTool; t.criteria=document.getElementById('judgeCriteria').value.trim(); opts.judgeCriteria=t.criteria; save();
  t.judge={status:'loading'}; renderCompare();
  try{ t.judge={status:'done', result:await judgeCore(DB.current, t.parent, cmpList().map(k=>k.id), t.criteria)}; }
  catch(e){ t.judge={status:'error', err: e && e.message && !/^[a-z_]+$/.test(e.message) ? e.message : 'Claude couldn’t judge them. Try again.'}; }
  if(cmpTool===t) renderCompare();
}
async function runCombine(){
  const t=cmpTool; t.instructions=document.getElementById('combineInstr').value.trim(); opts.combineInstructions=t.instructions; save();
  t.combine={status:'loading'}; renderCompare();
  try{ t.combine={status:'done', draft:await combineCore(DB.current, t.parent, cmpList().map(k=>k.id), t.instructions)}; }
  catch(e){ t.combine={status:'error', err: e && e.message && !/^[a-z_]+$/.test(e.message) ? e.message : 'Claude couldn’t combine them. Try again.'}; }
  if(cmpTool===t) renderCompare();
}
function addCombinedDraft(){
  const t=cmpTool, d=t && t.combine && t.combine.draft; if(!d) return;
  const pr=document.getElementById('combPrompt').value.trim(), rp=document.getElementById('combReply').value.trim();
  if(!rp){ toast('The combined reply is empty.'); return; }
  const edited = pr!==d.prompt || rp!==d.reply;
  let nid;
  if(t.parent==null) return;
  commit(`Added the combined reply as #${S.nextId}, a new follow-up to #${t.parent}`, ()=>{ nid=addCombined(t.parent, {...d, prompt:pr||d.prompt, reply:rp}); if(edited) S.nodes[nid].replyEdited=true; sel=nid; });
  if(cmpIds) cmpIds=[...cmpIds, nid];
  t.combine=null; renderCompare();
}
