/* What a prompt sends: the connection to Claude, the context (built by treecore.js), model settings, and the
   "Context changed" marker. */

/* model replies via the artifact's sample capability */
let imageLimits=null;
async function connectModel(){
  try{ sampleFn = window.claude && window.claude.use ? await window.claude.use('sample') : null; }catch(e){ sampleFn = null; }
  sampleState = sampleFn ? 'ready' : 'off';
  if(sampleFn && sampleFn.limits) try{ const l=await sampleFn.limits(); imageLimits=l && l.images || null; if(l && l.maxPromptBytes) promptLimit=l.maxPromptBytes; }catch(e){ imageLimits=null; }
  render();
}
/* The path to a node, in send order, with a seam note before the turns each merge brings in. */
function contextEntries(id){ return Core.entries(S, id, coreEnv()); }
/* what the core needs from the page: your wording (Settings › Prompts), files with their contents, and the memoized
   path and chain */
function coreEnv(t){ return t && t!==S ? {tpl:promptText, file:fileBlock} : {tpl:promptText, file:fileBlock, path, chain}; }
/* what the shared ✦ tools need from the page (see treeops.js) */
function opsIo(){
  return {tpl:promptText, env:coreEnv, sample:(i, o)=>sampleFn(i, o), json:(i, o)=>sampleFn.json(i, o), model:opts.model, tree:treeOf,
    ask:(sid, id)=>{ const w=awaitReply(sid, id); wantReplies([id], sid); return w; }, update(){}, pause:()=>Promise.resolve(null)};
}
/* Messages for the API: user/assistant turns, with back-to-back turns of one role joined so they alternate. */
/* ---- Model settings ----
   A system prompt, thinking, effort, temperature and a reply length limit, set on a prompt and used by it and every
   prompt after it, unless a later prompt sets its own. Forking and changing one setting compares the same
   conversation under a different setup. Each field is inherited on its own; null means "back to the default". */
const SET_FIELDS=Core.SET_FIELDS;
function settingsFor(id){ return Core.settingsFor(S, id, coreEnv()); }
const hasSettings = st => Ops.hasSettings(st);
function turnsFor(id, includeLastReply){ return Core.turnsFor(S, id, coreEnv(), includeLastReply); }
/* ---- Context fingerprint ----
   Each reply remembers exactly what was sent to get it: a short hash per turn (instructions, project files, merge
   notes, each prompt and each reply) and a hash chained over all of them. It's recorded when the reply is written and
   never sent to Claude. Comparing it with what the same prompt would send now gives the small "context changed"
   marker: it says what changed above a reply, and Replay re-sends from there. It informs; it never blocks or
   regenerates anything on its own. */
function hash53(str, seed=0){ return Core.hash53(str, seed); }
const h5 = str => Core.h5(str);
/* what a request from this prompt sends, as in turnsFor(id): one entry per part, in order */
function ctxSig(id){ return Core.ctxSig(S, id, coreEnv()); }
/* what changed above a reply since it was written, oldest first; null when nothing did (or nothing was recorded) */
function ctxChanges(id){
  const n=S.nodes[id];
  if(!n || !n.ctx || !n.reply || liveGen(id) || set('ctxMarks')===false) return null;
  return Core.ctxChanges(S, id, coreEnv());
}
function ctxMarkHTML(id){
  const ch=ctxChanges(id); if(!ch) return '';
  const all=ch.map(c=>c.label).join('; ');
  const rp = sampleState==='ready' ? `<button class="linkbtn" data-replayask="${id}" title="Re-send #${id} and the prompts below it with the context as it is now">Replay</button>` : '';
  return `<span class="ctxmark" title="Changed above this reply since it was written: ${esc(all)}. Claude never sees this note.">Context changed: ${esc(ch[0].label)}${ch.length>1?` +${ch.length-1}`:''}</span>${rp}`;
}
const PERMANENT=Ops.PERMANENT;
function errCopy(code){ return Ops.errCopy(code); }
