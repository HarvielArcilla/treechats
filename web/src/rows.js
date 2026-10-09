/* Drawing the Editor: each prompt's row, its reply, and the lines of the tree. */

/* ✦ marks tools where Claude does the work (each use sends a request), as opposed to ones that only move text.
   Replies themselves aren't marked. */
const AI='✦ ';
const usesClaude = k => sampleState==='ready' && (k==='fan' || (k==='reroot' && opts.summary && opts.rerootBy==='claude') || (k==='squash' && opts.squashBy==='claude'));
const opLabel=(k,id)=> k==='skip' && S.nodes[id] && S.nodes[id].skip ? 'Include' : (usesClaude(k) ? AI : '')+OPS[k].label;
/* a prompt changed during a replay so it fits the new reply above it; the original wording stays on the prompt */
const rwTitle = n => `${n.rewritten.by==='claude'?'Claude rewrote':'You rewrote'} this prompt during a replay${n.rewritten.why?` (${n.rewritten.why.replace(/\.$/,'')})`:''}. Written as: "${clip(n.rewritten.from||'',200)}"`;
function rowHTML(id, pathSet){
  const n=S.nodes[id], isM=n.kind==='merge';
  const cls=['row'];
  if(isM) cls.push('mergept');
  if(pathSet.has(id)) cls.push('onpath');
  if(n.kind==='summary') cls.push('summary');
  if(n.skip) cls.push('skipped');
  if(pick && pick.op==='also'){ if(id===pick.src) cls.push('src'); else if(n.kind==='merge') cls.push('dim'); else if(!alsoTargets.has(id)) cls.push('target'); }
  else if(pick){ if(id===pick.src) cls.push('src'); else cls.push(validTarget(pick.op,pick.src,id)?'target':'dim'); }
  else if(id===sel) cls.push('sel');
  if(promptEditFor===id && !pick) cls.push('editing');
  if(range && !pick && range.ids.includes(id)) cls.push('inrange');
  if((!pick || pick.op==='also') && alsoTargets.has(id)) cls.push('also');
  const refs = refsAt(id).map(rid=>`<button class="ref ${S.head===rid?'head':''}" data-key="c${rid}" data-co="${rid}" title="${S.head===rid?'Checked out':'Check out '+esc(refName(rid))}" aria-pressed="${S.head===rid}">${S.head===rid?'HEAD → ':''}${esc(refName(rid))}</button>`).join('');
  const vs = versions(id);
  const grids=gridsOf(id), gridTag = n.grid ? `<button class="tag gridtag" data-opengrid="${n.grid.id}" title="Part of a comparison grid. Click to open it.">grid ${n.grid.r+1}${String.fromCharCode(65+n.grid.c)}</button>` : grids.length ? `<button class="tag gridtag" data-opengrid="${grids[grids.length-1].id}" title="A comparison grid follows this prompt. Click to open it.">grid${grids.length>1?` ×${grids.length}`:''}</button>` : '';
 const lead = gridTag+sendTagHTML(n, false)+(n.sched?`<span class="tag" title="Sent by the scheduled task “${esc(n.sched.name||'')}”">scheduled</span>`:'')+(n.by?`<span class="tag agenttag" title="Added by the agent ${esc(n.by)} through MCP">⚙ ${esc(n.by)}</span>`:'')+(alsoTargets.has(id)&&(!pick||pick.op==='also')?'<span class="tag alsotag">replying</span>':'')+(n.kind==='summary'?'<span class="tag summary">summary</span>':'')+(n.kind==='squash'?'<span class="tag squash">squashed</span>':'')+(vs.length>1?`<span class="tag ver">${vs.indexOf(id)+1}/${vs.length}</span>`:'')+(n.skip?'<span class="tag skiptag" title="Not sent to Claude from the prompts below">left out</span>':'')+(n.rewritten?`<span class="tag rwtag" title="${esc(rwTitle(n))}">rewritten</span>`:'')+(n.reviewOf?`<button class="tag rwtag" data-goto="${n.reviewOf.id}" title="A second opinion on #${n.reviewOf.id}'s reply${n.reviewOf.whole?', with the conversation up to it':''}. Click to go to it.">review of #${n.reviewOf.id}</button>`:'')+(n.combined?`<span class="tag rwtag" title="${esc(combinedTitle(n))}">combined</span>`:'')+(n.imported?`<span class="tag agenttag" title="${esc(`From a ${n.imported.from} session${n.imported.model?`, ${n.imported.model}`:''}. Tool calls are summarized in the reply, with an excerpt of each result.${n.imported.notes?` ${n.imported.notes} note${n.imported.notes===1?'':'s'} ${n.imported.from} added to this message (the time, reminders) ${n.imported.notes===1?'is':'are'} left out.`:''}`)}">${esc(n.imported.from)}</span>${n.imported.tag?`<span class="tag summary" title="Here the agent’s context was compacted: everything before was replaced by this summary">${esc(n.imported.tag)}</span>`:''}`:'')+(n.loop?`<span class="tag rwtag" title="${esc(`Sent by /loop, ${n.loop.i} of ${n.loop.of}${n.loop.until?`, until: ${n.loop.until}`:''}`)}">loop ${n.loop.i}/${n.loop.of}</span>`:'')+(n.btw?'<span class="tag rwtag" title="A side question asked with /btw, kept as its own branch">by the way</span>':'')+(hasSettings(n.set)?`<span class="tag settag" title="${esc('Model settings from here on: '+setSummary(n.set))}">settings</span>`:'');
  const shown=replyShown(id, pathSet);
  const folded = !pick && !!S.fold[id];
  const foldable = !pick && (vKids(id).length || vSec(id).length) && !folded;
  /* only the selected prompt (and a folded one) shows how many follow it; counting for every row is quadratic */
  const nBelow = (foldable && id===sel) || folded ? [...desc(id)].filter(x=>S.nodes[x].kind!=='merge').length : 0;
  const fold = foldable ? `<button class="act" data-fold="${id}" title="Collapse the ${nBelow} prompt${nBelow===1?'':'s'} below this one. Nothing is deleted.">Hide ${nBelow} below</button>`
    : folded ? `<button class="act" data-unfold="${id}" title="Show the prompts below this one again">Show ${nBelow} below</button>` : '';
  const star = isM || pick ? '' : `<button class="star ${n.star?'on':''}" data-star="${id}" aria-pressed="${!!n.star}" aria-label="${n.star?'Unstar':'Star'} #${id}" title="${n.star?'Starred. Click to unstar.':'Star this prompt'}">${n.star?'★':'☆'}</button>`;
  const tog = n.reply && !liveGen(id) ? `<button class="act" data-rtog="${id}" aria-expanded="${shown}">${shown?'Hide reply':'Show reply'}</button>` : '';
  /* the selected prompt is shown in full and formatted (tables, math, code) when it has more than plain text */
  const rich = !isM && (id===sel || opts.simple) && !pick && !(n.pending && !n.text) && RICH_RE.test(n.text||'');
  const txt = isM ? `<span class="txt">Merged <b>${esc(n.from||'#'+n.parents[1])}</b> into <b>${esc(n.into||'#'+n.parents[0])}</b></span>`
    : rich ? `<div class="txt rbody ptext">${md(n.text)}</div>`
    : `<span class="txt">${n.pending && !n.text ? '<em class="thinking">Claude is summarizing…</em>' : esc(RICH_RE.test(n.text||'') ? plainText(n.text) : n.text)}</span>`;
  const editingHere = promptEditFor===id && !isM && !pick;
  const txtE = editingHere ? `<div class="txt pedit" data-key="pe${id}"><textarea id="promptEditText" rows="${Math.min(14, Math.max(2, (n.text||'').split('\n').length+1))}" aria-label="Edit prompt #${id}">${esc(n.text||'')}</textarea>
    <div class="bar">${opts.simple ? `<button class="btn primary" data-pedit="resend">Send <kbd class="inv">${IS_MAC?'⌘↵':'Ctrl ↵'}</kbd></button>` : `<button class="btn primary" data-pedit="resend" title="Starts a new branch with your edit and gets a reply. The original stays on its branch with everything after it.">Send on a new branch <kbd class="inv">${IS_MAC?'⌘↵':'Ctrl ↵'}</kbd></button>`}<button class="btn" data-pedit="cancel">Cancel</button>${opts.simple?'':'<button class="linkbtn pinplace" data-pedit="save" title="Change the text where it is, without a new reply. The reply and everything after it stay as they were, and they\u2019re marked as written for the old wording.">Save in place instead</button>'}</div></div>` : null;
  const txtF = txtE ? txtE : n.files && n.files.length ? txt.replace(/^<(span|div) class="txt[^"]*">/, m=>m+fileChips(n.files, false, 'n'+id)) : txt;
  /* Chat view shows the marks that change what a prompt means or sends; versions and branches have the ‹ › switch */
  const ptags=[n.star?'<span class="edtag star" title="Starred">★</span>':'', gridTag.replace('class="tag gridtag"','class="edtag linkish"'), n.sched?`<span class="edtag" title="Sent by the scheduled task “${esc(n.sched.name||'')}”">scheduled</span>`:'', n.skip?'<span class="edtag warn" title="Left out: not sent to Claude from the prompts below">left out</span>':'', sendTagHTML(n, true), n.by?`<span class="edtag" title="Added by the agent ${esc(n.by)} through MCP">⚙ ${esc(n.by)}</span>`:'', n.imported?`<span class="edtag" title="From a ${esc(n.imported.from)} session">${esc(n.imported.from)}</span>`:'', n.imported&&n.imported.tag?`<span class="edtag" title="Here the agent’s context was compacted: everything before was replaced by this summary">${esc(n.imported.tag)}</span>`:'', n.kind==='summary'?'<span class="edtag">summary</span>':'', n.kind==='squash'?'<span class="edtag">squashed</span>':'', n.reviewOf?`<button class="edtag linkish" data-goto="${n.reviewOf.id}" title="A second opinion on #${n.reviewOf.id}'s reply. Click to go to it.">review of #${n.reviewOf.id}</button>`:'', n.combined?`<span class="edtag" title="${esc(combinedTitle(n))}">combined</span>`:'', hasSettings(n.set)?`<span class="edtag" title="${esc('Model settings from here on: '+setSummary(n.set))}">settings</span>`:'', n.rewritten?`<span class="edtag" title="${esc(rwTitle(n))}">rewritten</span>`:'', n.loop?`<span class="edtag" title="Sent by /loop">loop ${n.loop.i} of ${n.loop.of}</span>`:'', n.btw?'<span class="edtag" title="A side question asked with /btw, kept as its own branch">by the way</span>':''].filter(Boolean).join(' ');
  let h=opts.simple && !pick && ptags ? `<div class="ptop">${ptags}</div>` : '';
  h+=`<div class="${cls.join(' ')}" data-id="${id}" ${!pick&&!isM&&!opts.simple&&!editingHere?'draggable="true"':''} tabindex="0" role="button" aria-pressed="${id===sel}" ${id===sel&&!pick?'title="Click again to deselect"':''}><span class="dot"></span><span class="nid">#${id}</span>${txtF}<span class="tags">${opts.simple && !pick ? '' : lead+star+refs}</span></div>`;
  /* actions sit in a row under the prompt: in Chat view under every message (shown on hover, like a chat app),
     in the full view under the selected prompt */
  if(!pick && !isM && !editingHere){
    if(opts.simple) h+=`<div class="uacts" data-key="ua${n.alt ?? id}">${promptTime(n)}<button class="act" data-copyprompt="${id}">Copy</button><button class="act" data-promptedit="${id}">Edit</button><button class="act" data-openeditor="${id}" title="Switch to Editor with this prompt selected: its context in the inspector, and every operation">Open in Editor</button>${forkHTML(id)}</div>`;
    else if(id===sel){
      const nRp = sampleState==='ready' && !liveGen(id) && !(replayAsk && replayAsk.at===id) ? replayCount(lineFrom(id)) : 0;
      const rp = nRp>1 ? `<button class="act" data-replayask="${id}" title="Re-send this prompt and the ${nRp-1} below it with the context as it is now, as new versions">${AI}Replay from here</button>` : '';
      h+=`<div class="pacts" data-key="pa${id}">${includeBtn(n, id)}<button class="act" data-promptedit="${id}" title="Edit this prompt">Edit</button>${rp}${tog}${fold}${promptTime(n)}</div>`;
    }
  }
  if(n.note) h+=`<p class="pnote" data-key="nt${id}"><span>Note</span>${esc(n.note)}</p>`;
  if(shown) h+=replyHTML(id);
  if(n.loopCheck && shown) h+=`<p class="pnote loopnote" data-key="lc${id}"><span>Loop check</span>${n.loopCheck.met?'Met':'Not yet'}${n.loopCheck.why?`: ${esc(n.loopCheck.why)}`:''}</p>`;
  if(fan && fan.id===id) h+=fanHTML();
  if(distill && distill.id===id) h+=distillHTML();
  if(reviewAsk && reviewAsk.id===id) h+=reviewHTML();
  if(replayAsk && replayAsk.at===id) h+=replayHTML();
  if(replayRun && !replayRun.done && replayRun.sid===DB.current && replayRun.at===id) h+=replayRunHTML();
  return h;
}
/* which replies are open; Chat view is one thread, so it shows every reply in it */
const repliesMode = () => opts.simple ? 'path' : opts.replies;
function setRepliesMode(m){ opts.replies=m; openReplies.clear(); save(); }
/* long replies away from the selected prompt are shortened unless Length is set to Full; each reply's own Show all / Shorten flips just that one */
const lenMode = () => opts.simple ? 'full' : set('replyLen');
const replyFull = id => id===sel || ((lenMode()==='full') !== fullReplies.has(id));
const RICH_RE=/\n|[|$`*#_\\]|^\s*([-*+]|\d+[.)])\s/;
function replyShown(id, pathSet){
  const n=S.nodes[id];
  if(n.kind==='merge') return false;
  if(liveGen(id)) return true;
  if(!n.reply) return id===sel;
  if(openReplies.has(id)) return true;
  if(openReplies.has(-id)) return false;
  const m=repliesMode();
  return id===sel || m==='all' || (m==='path' && pathSet.has(id));
}
function replyFoot(id){
  const vs=versions(id), i=vs.indexOf(id);
  const sw = vs.length>1 ? `<span class="ver" aria-label="Reply version"><button data-ver="${id}" data-dir="-1" ${i===0?'disabled':''} aria-label="Previous version">‹</button><span>${i+1} / ${vs.length}</span><button data-ver="${id}" data-dir="1" ${i===vs.length-1?'disabled':''} aria-label="Next version">›</button></span>` : '';
  const nOpt = id===sel && S.nodes[id].reply && !(fan && fan.id===id) ? listOptions(S.nodes[id].reply).options.length : 0;
  const fo = id===sel && S.nodes[id].reply && !(fan && fan.id===id) && !liveGen(id) ? `<button class="rmore" data-fan="${id}" title="${esc(OPS.fan.hint)}">${AI}Fan out${nOpt>=2?` · ${nOpt} options`:''}</button>` : '';
  const ds = id===sel && sampleState==='ready' && S.nodes[id].reply && !liveGen(id) && !(distill && distill.id===id) ? `<button class="rmore" data-distill="${id}" title="Claude writes a reusable brief of the context up to here">✦ Distill</button>` : '';
  const rv = id===sel && sampleState==='ready' && S.nodes[id].reply && !liveGen(id) && !(reviewAsk && reviewAsk.id===id) ? `<button class="rmore" data-review="${id}" title="A second opinion: a new chat that sees only this reply (and, if you choose, the conversation before it)">${AI}Review</button>` : '';
  const rg = (id===sel && sampleState==='ready' && S.nodes[id].reply && !liveGen(id) ? `<button class="rmore" data-regen="${id}">↻ Regenerate</button>` : '')+fo+ds+rv+reviewLinksHTML(id);
  const cm = ctxMarkHTML(id);
  const st = !cm && S.nodes[id].stale && S.nodes[id].reply && !liveGen(id) ? '<span class="stale">Prompt edited after this reply</span>' : '';
  return sw||rg||st||cm ? `<div class="rfoot">${sw}${rg}${st}${cm ? `<span class="ctxwrap">${cm}</span>` : ''}</div>` : '';
}

function replyHTML(id){
  const n=S.nodes[id];
  const gn=genNotes[gkey(DB.current,id)], note = gn ? `<p class="gnote">${esc(gn)}</p>` : '';
  const g=liveGen(id);
  if(g) return `<div class="reply live" data-gen="${id}" data-key="r${id}"><div class="rhead"><span class="rwho"><span class="who">Claude · ${esc(g.tier||opts.model)}</span><span class="ts" data-since="${g.started||Date.now()}" title="Time so far">${fmtElapsed(Date.now()-(g.started||Date.now()))}</span></span><button class="rmore" data-stop="${id}" title="Stop this reply${id===sel?' (Esc)':''}">Stop</button></div><div class="stepslot">${stepsHTML(g.steps, true)}</div><div class="rbody">${g.text?md(g.text):`<p class="thinking">${g.steps&&g.steps.length?'Working…':'Thinking…'}</p>`}</div>${replyFoot(id)}</div>`;
  if(!n.reply && queuedGen(id)){
    const w=waitingOn(genQueue.find(q=>q.sid===DB.current && q.id===id));
    return `<div class="reply empty" data-key="r${id}"><div class="rhead"><span class="who">Claude</span><button class="rmore" data-stop="${id}">Cancel</button></div><p class="thinking">${w!=null&&w!=='gone'?`Waiting for the reply to #${w} first…`:'Waiting its turn…'}</p></div>`;
  }
  if(!n.reply){
    const msg = sampleState==='ready' ? 'No reply yet.' : sampleState==='loading' ? 'Connecting to Claude…'
      : sampleState==='denied' ? 'Replies are turned off. Check your API key or Claude Code sign-in, then restart Treechats.'
      : 'To get replies, add an API key to .env or sign in to Claude Code (run claude once), then restart Treechats.';
    const btn = sampleState==='ready' && id===sel ? `<button class="btn primary sm" data-genreply="${id}">Get reply</button>` : '';
    return `<div class="reply empty" data-key="r${id}"><span class="who">Claude</span><p>${msg}</p>${note}${btn}${replyFoot(id)}</div>`;
  }
  const full = replyFull(id);
  const long = n.reply.length>320 || n.reply.includes('```');
  const more = id!==sel&&long ? `<button class="rmore" data-rfull="${id}">${full?'Shorten':'Show all'}</button>` : '';
  if(resendFor===id) return resendHTML(id);
  if(replyEditFor===id) return replyEditHTML(id);
  if(opts.simple){
    const ed = n.replyEdited ? '<span class="edtag" title="You changed this reply. Claude sees your version from here on.">edited</span>' : '';
    const ready = sampleState==='ready' && !liveGen(id);
    const extra = id===sel && ready ? `${!(fan && fan.id===id)?`<button class="act" data-fan="${id}" title="${esc(OPS.fan.hint)}">${AI}Fan out</button>`:''}${!(distill && distill.id===id)?`<button class="act" data-distill="${id}" title="Claude writes a reusable brief of the context up to here">${AI}Distill</button>`:''}${!(reviewAsk && reviewAsk.id===id)?`<button class="act" data-review="${id}" title="A second opinion from a new chat that sees only this reply">${AI}Review</button>`:''}` : '';
    return `<div class="reply ${replyUnsent(n)?'unsent':''}" data-key="r${id}">${ed?`<div class="rtop">${ed}</div>`:''}${sendNoteHTML(id)}${thinkHTML(n)}${stepsHTML(n.steps)}<div class="rbody">${md(n.reply)}</div>${sourcesHTML(n.sources)}${note}${proposalsHTML(id)}<div class="ractrow"><button class="act" data-copyreply="${id}">Copy</button>${ready?`<button class="act" data-regen="${id}" title="Ask for another reply. This one is kept as the other version.">Regenerate</button>`:''}<button class="act" data-editreply="${id}" title="Change what Claude said. Prompts below see your version.">Edit</button>${extra}${reviewLinksHTML(id)}${replyTime(n)}${(()=>{ const cm=ctxMarkHTML(id); return cm ? `<span class="ctxwrap">${cm}</span>` : ''; })()}</div></div>`;
  }
  const edited = n.replyEdited ? '<span class="edtag" title="You changed this reply. Claude sees your version from here on.">edited by you</span>' : '';
  return `<div class="reply ${full||!long?'':'clamp'} ${replyUnsent(n)?'unsent':''}" data-key="r${id}"><div class="rhead"><span class="rwho"><span class="who">Claude${n.model?' · '+esc(n.model):''}</span>${replyTime(n)}${edited}</span><span class="racts">${more}<button class="rmore" data-editreply="${id}" title="Change what Claude said. Prompts below see your version.">Edit</button><button class="rmore" data-copyreply="${id}">Copy</button></span></div>${sendNoteHTML(id)}${thinkHTML(n)}${stepsHTML(n.steps)}<div class="rbody">${md(n.reply)}</div>${sourcesHTML(n.sources)}${note}${proposalsHTML(id)}${replyFoot(id)}</div>`;
}
/* The straight line at each fork follows main, then the oldest child, so main never shifts right.
   A branch's lane color comes from where it starts, so it stays the same as the tree grows. */
let trunk = new Set();
function laneFor(startId, parentLane){ let l=1+(startId%3); if(l===parentLane) l=1+((startId+1)%3); return l; }
let curLine=null;
function runHTML(id, lane, pathSet){
  const items=[]; let cur=id;
  while(cur!=null){
    let ks=vKids(cur), sk=vSec(cur), off=0;
    if(curLine){ const k0=ks.length; ks=ks.filter(k=>curLine.has(k.id)); off=k0-ks.length; sk=sk.filter(k=>curLine.has(k.id)); }
    const straight = ks.find(k=>trunk.has(k.id)) || ks[0];
    const pk = straight ? [straight, ...ks.filter(k=>k!==straight)] : [];
    let h=rowHTML(cur, pathSet);
    /* folded: the note sits right under the prompt (and its reply), where you folded it, before the input box */
    if(S.fold[cur]){
      const below=[...desc(cur)].filter(x=>S.nodes[x].kind!=='merge').length;
      h+=`<div class="foldnote" data-key="fd${cur}"><button class="linkbtn" data-unfold="${cur}">▸ ${below} prompt${below===1?'':'s'} hidden below · Show</button></div>`;
      if(cur===sel && !pick) h+=opsHTML(cur);
      items.push([cur,h]); break;
    }
    if(cur===sel && !pick) h+=opsHTML(cur);
    if(off) h+=`<div class="offbr" data-key="ob${cur}"><button class="linkbtn" data-linemode="all" title="Show every branch again">⑂ ${off} other branch${off===1?'':'es'} from here · Show</button></div>`;
    const used=new Set([lane]);
    for(const k of pk.slice(1)){
      let l=laneFor(k.alt ?? k.id, lane);
      for(let tries=0; used.has(l) && tries<3; tries++) l=l%3+1;
      used.add(l);
      h+=`<ul class="kids" data-key="k${k.alt ?? k.id}" style="--plane:var(--l${lane});--lane:var(--l${l})">${runHTML(k.id, l, pathSet)}</ul>`;
    }
    if(sk.length) h+=`<ul class="kids ghosts" data-key="g${cur}" style="--plane:var(--l${lane});--lane:var(--merge)">`+
      sk.map(k=>`<li class="ghost first last"><button data-sel="${k.id}">↘ ${k.kind==='merge' ? 'merged into '+esc(k.into||'#'+k.id) : 'merges into #'+k.id}</button></li>`).join('')+'</ul>';
    items.push([cur,h]);
    cur = pk.length ? pk[0].id : null;
  }
  /* rows are keyed by version group, so flipping reply versions keeps the row and swaps the reply */
  return items.map(([nid,h],i)=>`<li class="g ${i===0?'first ':''}${i===items.length-1?'last':''}" data-key="n${S.nodes[nid].alt ?? nid}">${h}</li>`).join('');
}
/* thinking the model did before its reply, as the API returned it; folded, never sent back to Claude */
const thinkHTML = n => n.thinking ? `<details class="thinkbox"><summary>Thinking <span class="note">· ${Math.ceil(n.thinking.length/4).toLocaleString()} tok · not sent to Claude again</span></summary><div class="rbody">${md(n.thinking)}</div></details>` : '';
function usageHTML(id){
  const n=S.nodes[id], u=n.usage;
  const line = u ? `This reply: ${u.input.toLocaleString()} in${u.cacheRead?` (+${u.cacheRead.toLocaleString()} from cache)`:''}${u.cacheWrite?` (+${u.cacheWrite.toLocaleString()} cached)`:''} · ${u.output.toLocaleString()} out${u.cost!=null?` · ${fmtCost(u.cost)}`:''}${u.via==='claude-code'?' · as reported by Claude Code':''}` : '';
  const withU=path(id).map(x=>S.nodes[x]).filter(m=>m && m.usage), total=withU.reduce((a,m)=>a+(m.usage.cost||0),0), anyCost=withU.some(m=>m.usage.cost!=null);
  const sum = withU.length>1 && anyCost ? `Context path so far: ${fmtCost(total)} across ${withU.length} replies` : '';
  return line||sum ? `<p class="meta usage" title="Token counts come from each reply; cost uses the published price of the model (TREECHATS_PRICE_* in .env overrides it).">${[line,sum].filter(Boolean).join('<br>')}</p>` : '';
}
