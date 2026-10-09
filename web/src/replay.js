/* ✦ Replay: re-sending prompts against the context as it is now (the engine is in treeops.js). */

/* ---- Replay ----
   Re-sends a run of prompts against the context as it is now: after you fix an early turn, edit a reply, or leave
   something out. Prompts go one at a time. Each is copied as a new version (the first one beside the original, the
   rest below it) and answered before the next, so the old line and its replies stay one ‹ › away.

   A new reply can go somewhere the old one didn't, and the next prompt, written for the old reply, may no longer make
   sense. So before each prompt after the first, a quick ✦ check asks whether it still fits. What happens when it
   doesn't is your choice: stop and ask (the default: you see why, with a suggested rewrite you can edit, send the
   original, or stop there), rewrite it (Claude's version is sent, marked as rewritten, the original kept on the
   prompt), or don't check at all. Nothing is replayed without asking first, and the ask says what it can cost. */
let replayAsk=null, replayRun=null;
const FIT_MODES=[['stop','Stop and ask','Pause on a prompt that no longer fits, with a suggested rewrite you can edit'],['rewrite','Rewrite it','Send Claude’s rewrite and keep going. The prompt is marked as rewritten and keeps your original'],['off','Don’t check','Send every prompt as written, with no checks']];
const fitMode = () => FIT_MODES.some(m=>m[0]===opts.replayFit) ? opts.replayFit : 'stop';
/* the prompts from id down to the tip of the line you're looking at */
function lineFrom(id){
  const h=headTip();
  const tip = simpleTip!=null && S.nodes[simpleTip] && path(simpleTip).includes(id) ? simpleTip
    : h!=null && path(h).includes(id) ? h
    : sel!=null && S.nodes[sel] && path(sel).includes(id) ? leafOf(sel)
    : (()=>{ const rid=refsThrough(id)[0]; return rid ? S.refs[rid].tip : leafOf(id); })();
  const c=chain(tip), i=c.indexOf(id);
  return i<0 ? [id] : c.slice(i);
}
const replayCount = line => Ops.replayCount(S, line);
/* from: replay `from` and the prompts below it. onto (optional): attach the copies under this prompt instead, for
   carrying the prompts below an edited prompt over to its new version. */
function askReplay(from, onto=null, only=null){
  if(sampleState!=='ready'){ toast('To get replies, add an API key to .env or sign in to Claude Code (run claude once), then restart Treechats.'); return; }
  if(replayRun && !replayRun.done){ toast('A replay is already running. Stop it first.'); return; }
  const line = only ? only.filter(x=>S.nodes[x]) : onto!=null ? lineFrom(from).slice(1) : lineFrom(from);
  if(!line.length) return;
  replayAsk={at: onto ?? from, from, onto, line, only:!!only};
  if(sel!==replayAsk.at) select(replayAsk.at); else animRender([replayAsk.at]);
  const b=treeEl.querySelector('[data-replaygo]'); if(b) b.focus({preventScroll:true});
}
function replayHTML(){
  const r=replayAsk, n=replayCount(r.line), first=r.line[0], last=r.line[r.line.length-1], m=fitMode();
  const what = r.only && r.onto!=null ? `Re-send ${n===1?`#${first}`:`#${first}–#${last}`} under #${r.onto}, one at a time, so ${n===1?'it gets a reply':'they get replies'} in that context.`
    : r.only ? `Re-send #${first}${n>1?`–#${last}`:''} with the context as it is now, one at a time. The prompts after it stay on the original line.`
    : r.onto!=null
    ? `Carry the ${n} prompt${n===1?'':'s'} that followed the original #${r.from} over to this version, and get new replies to ${n===1?'it':'them'}.`
    : `Re-send ${n===1?`#${first}`:n===2?`#${first} and #${last}`:`#${first} and the ${n-1} prompts below it (down to #${last})`} with the context as it is now, one at a time.`;
  const checks = m==='off' ? 0 : Math.max(0, n-1) + (r.onto!=null ? 1 : 0);
  const cost = `${n} request${n===1?'':'s'}${checks?`, plus up to ${checks} quick check${checks===1?'':'s'}`:''}`;
  const modes = n>1 || r.onto!=null ? `<div class="vgroup fitmodes" role="group" aria-label="When a prompt no longer fits"><span>When a prompt no longer fits</span>${FIT_MODES.map(([v,l,t])=>`<button class="seg" data-replayfit="${v}" aria-pressed="${m===v}" title="${esc(t)}">${l}</button>`).join('')}</div>` : '';
  return `<div class="fan replay" data-key="rp${r.at}"><div class="fanhead"><b>${AI}Replay</b><span class="note">${cost}</span><button class="rmore" data-replaycancel>Cancel</button></div>
    <p class="note">${what} ${r.onto!=null ? 'The original keeps its prompts and replies.' : 'Each becomes a new version; the current ones stay one ‹ › away.'}</p>
    ${modes}
    <div class="bar"><button class="btn primary" data-replaygo>${AI}Replay ${n} prompt${n===1?'':'s'}</button><button class="btn" data-replaycancel>Cancel</button></div></div>`;
}
/* one prompt of the line, copied under `parent` (or beside the original as a new version), in the tree in S */
function copyOne(o, parent, asVersion, by, text, rewrite){ return Ops.copyOne(S, o, parent, asVersion, by, text, rewrite); }
/* ✦ does this prompt still make sense after the conversation as it now stands? */
function checkFit(sid, afterId, o, original){ return Ops.checkFit(opsIo(), treeOf(sid), afterId, o, original); }
/* The replay itself, shared by the page and agents. io.apply(fn, msg) makes a change in the space; io.pause(info)
   resolves to {text} to send, or null to stop; io.update() redraws. Returns what happened. */
function runReplay(r, io){
  /* the shared engine (treeops.js), with the page's way of changing the tree: io.apply runs fn on the tree in S */
  return Ops.runReplay(r, Object.assign(opsIo(), io, {apply:(fn, msg)=>io.apply(()=>fn(S), msg)}));
}
async function replay(from, onto=null, line=lineFrom(from)){
  if(sampleState!=='ready' || !line.length) return;
  const sid=DB.current, run={sid, from, onto, line, mode:fitMode(), at: onto ?? from, done:false};
  replayAsk=null; simpleTip=null; replayRun=run;
  const io={
    apply(fn, msg){
      let out;
      if(run.sid===DB.current){ if(msg) commit(msg, ()=>{ out=fn(); if(out!=null) sel=out; }, {quiet:true}); else { out=fn(); save(); render(); } }
      else { out=withTree(treeOf(run.sid), fn); save(); }
      return out;
    },
    pause(info){ return new Promise(res=>{ run.resolve=res; if(run.sid===DB.current){ if(sel!==run.at) select(run.at); else animRender([run.at]); const t=document.getElementById('replayFitText'); if(t) t.focus({preventScroll:true}); } }); },
    update(){ if(run.sid===DB.current){ const el=treeEl.querySelector('.replayrun'); if(el) el.outerHTML=replayRunHTML(); else animRender([run.at]); } }
  };
  animRender([run.at]);
  const out=await runReplay(run, io);
  if(replayRun===run) replayRun=null;
  if(run.sid===DB.current) animRender([sel]);
  const n=out.made.filter(x=>S.nodes[x] && S.nodes[x].kind!=='merge').length;
  const rw = out.rewrites ? ` ${out.rewrites} rewritten to fit.` : '';
  toast(out.stoppedAt==null ? `Replay finished: ${n} prompt${n===1?'':'s'} re-sent.${rw}`
    : out.why==='mismatch' ? `Replay stopped before #${out.stoppedAt}, which no longer fit. ${n} re-sent.`
    : out.why==='error' ? `Replay stopped: ${out.error}` : `Replay stopped. ${n} prompt${n===1?'':'s'} re-sent.`);
}
function replayRunHTML(){
  const r=replayRun; if(!r || r.done) return '';
  const st=r.status||{}, o=st.id!=null ? S.nodes[st.id] : null;
  if(st.what==='paused'){
    return `<div class="fan replay replayrun" data-key="rr"><div class="fanhead"><b>${AI}Replay paused</b><span class="note">before #${st.id}</span></div>
      <p class="note"><b>#${st.id} may not fit anymore.</b> ${esc(st.reason||'The new reply went a different way.')}</p>
      <p class="note">Written as: <q>${esc(clip(o ? o.text : '', 300))}</q></p>
      <textarea id="replayFitText" rows="${Math.min(10, Math.max(3, (st.suggest||o&&o.text||'').split('\n').length+1))}" aria-label="Prompt to send">${esc(st.suggest || (o ? o.text : ''))}</textarea>
      <div class="bar"><button class="btn primary" data-replayfitgo="edited">Send this</button><button class="btn" data-replayfitgo="original">Send the original</button><button class="btn" data-replayfitgo="stop">Stop here</button></div></div>`;
  }
  const what = st.what==='checking' ? `Checking that #${st.id} still fits…` : st.what==='sending' ? `Waiting for the reply to #${st.id}…` : 'Starting…';
  return `<div class="fan replay replayrun" data-key="rr"><div class="fanhead"><b>${AI}Replaying</b><span class="note">${what}</span><button class="rmore" data-replaystop>Stop</button></div></div>`;
}
