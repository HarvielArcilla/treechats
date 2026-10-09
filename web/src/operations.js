/* The operations on prompts and the tree (branch, merge, rebase, splice, squash, reroot…), as you run them. Each
   change itself is in treeops.js, shared with agents; here it gets Undo, the selection and its options. */

/* operations */
const OPS = {
  regen:{group:'prompt', label:'Regenerate', key:'e', bar:false, hint:'Get another reply to this prompt.',
    detail:'Asks Claude for a new reply to the selected prompt and keeps the old one. Flip between versions with ‹ › under the reply. Each version keeps its own follow-ups, and Continue builds on the version you are viewing.'},
  fan:{group:'branch', label:'Fan out…', key:'f', bar:false, hint:'Turn the options in this reply into one branch each.',
    detail:'Reads Claude’s reply for the options it offers and makes one follow-up prompt per option, each on its own branch. You review the list first: untick any you don’t want, edit the names and prompts, and choose the mainline, which continues the current branch (Claude’s pick if it recommended one, otherwise the first). Replies for every branch can be fetched right away or later. Finding the options takes one quick request; without Claude it reads the numbered and bulleted lists in the reply instead. Find it under the reply as <b>Fan out</b>.'},
  variants:{group:'branch', label:'Variants…', key:'a', hint:'Send your next prompt several ways at once: other wordings or other models.',
    detail:'Opens the variants editor in place of the input box. Each variant is a prompt with its own model, and each becomes its own branch from the selected prompt; the first continues the current branch. Start from what you have typed, add wordings yourself or ask Claude to suggest some, then send them all. Replies come one after another, ready for Compare.'},
  compare:{group:'branch', label:'Compare', key:'v', hide:true, hint:'Read the replies to this prompt’s follow-ups side by side.',
    detail:'Only on prompts with two or more follow-ups, such as the branches a Fan out makes. Shows each follow-up and Claude’s reply in its own column so you can read them together, then open one, make one the mainline, or prune the ones you don’t want.'},
  promote:{group:'branch', label:'Make mainline', key:'p', hide:true, hint:'Make the branch through this prompt the chat’s main branch.',
    detail:'The branch running through this prompt becomes main and is drawn as the straight line. The old main takes that branch’s name, so nothing is lost. No prompts move.'},
  skip:{group:'prompt', label:'Leave out', key:'l', hint:'Keep this prompt in the tree but stop sending it to Claude.',
    detail:'Keeps the prompt and its reply where they are, but leaves them out of the context sent from the prompts below it. It shows faded with a “left out” tag. Run it again to bring it back. A prompt is always sent when Claude is answering that prompt itself.'},
  send:{group:'prompt', label:'Include as…', key:'k', hint:'Choose how this turn is included in the context of the prompts below: in full, as a summary, an excerpt, only the prompt or only the reply, or left out.',
    detail:'Keeps the prompt and its reply as they are, and changes only how the prompts below it include them: <em>Full</em>, a <em>Summary</em> in place of the reply (Claude writes it, and you can edit it), an <em>Excerpt</em> (only the parts you highlight, from the prompt, the reply or both), <em>Prompt only</em>, <em>Reply only</em>, or <em>Left out</em>. Switch back to Full any time; nothing is deleted. It sits under the selected prompt in Editor, and on each row of the Context panel; Chat view shows the result as a note. The wording Claude gets in place of what\u2019s left out is under Settings › Prompts › Include as.'},
  clone:{group:'move', label:'Clone…', key:'d', hint:'Copy this prompt into a new chat: its path, its path and everything below, or the whole chat.',
    detail:'Makes an independent copy as a new chat at the top of the project, and opens it. Each option includes this prompt. <em>Up to here</em>: everything before it, the exact context it was written in, with no side branches. <em>From here on</em>: it and everything after it, as a fresh chat with no earlier context. <em>Through here</em>: both together. Replies, versions, files and branch names come along; the original never changes. To copy a whole chat, use Clone in its ⋯ menu.'},
  branch:{group:'branch', label:'Branch', key:'b', hint:'Start a new branch at this prompt and switch to it.',
    detail:'Adds a branch at the selected prompt with a default name like branch-1 and checks it out, without adding a prompt. If other branches point at the same prompt, tap a branch chip or use the picker above the Continue box to choose which one your next prompt goes on. Rename it any time under Branches or with Rename above the Continue box. As in git, a branch is only a label on a tip, so deleting one never deletes prompts.'},
  reroot:{group:'move', label:'Reroot', key:'r', hint:'Cut this prompt from its parent and start a new chat from it.',
    detail:'Cuts the link to the parent, so the prompt and everything below it become a separate chat. The model no longer sees any earlier turns, except through the optional summary root, which the template or Claude can write.'},
  splice:{group:'remove', label:'Splice out', key:'s', hint:'Remove only this prompt. Its follow-ups attach to its parent.',
    detail:'Deletes just this prompt. Its children move up to its parent, so their context loses this one turn and keeps everything else. Useful for dropping a bad or off-topic turn.'},
  prune:{group:'remove', label:'Delete subtree', key:'x', hint:'Delete this prompt and everything below it.', danger:true,
    detail:'Deletes the prompt and its whole subtree. A merged prompt below it survives if it still has another parent outside the deleted part. Branches that pointed into it move back to the prompt above it.'},
  graft:{group:'move', label:'Rebase onto…', key:'g', hint:'Move this prompt and its subtree under another prompt, like git rebase --onto.', pick:'choose the new parent',
    detail:'Moves the prompt and its subtree to a new parent, like <code>git rebase --onto</code>. The moved prompts now see the new parent’s path instead of their old one; their replies stay as they were. You can’t rebase onto your own descendants. You can also drag a prompt onto its new parent.'},
  cherry:{group:'move', label:'Cherry-pick', key:'c', hint:'Copy this prompt’s text under another prompt.', pick:'choose where the copy goes',
    detail:'Copies only this prompt’s text as a new child of another prompt. The original stays where it is, and nothing below it is copied.'},
  squash:{group:'merge', label:'Squash', key:'q', hint:'Collapse the path from an ancestor down to here into one prompt.', pick:'choose the ancestor to squash up to',
    detail:'Collapses every prompt from a chosen ancestor down to this one into a single node. By default the prompts and replies are joined together; you can have Claude write a short summary of them instead, which saves more context. Side branches that started partway along now hang off the squashed node.'},
  merge:{group:'merge', label:'Merge into…', key:'m', hint:'Merge this branch into another prompt you pick next.', pick:'pick the prompt to merge it into',
    detail:'Merges the selected prompt\u2019s branch into the prompt you pick next, the way a feature branch merges into main. A merge point is added after the picked prompt and its branch moves forward to it. Anything you continue from there sees the picked branch, then a short merge note, then every turn unique to the merged branch. Nothing that already exists is changed.'},
  unmerge:{group:'merge', label:'Undo merge', key:'u', hint:'Remove this merge point.',
    detail:'Only on merge points. Removes the merge point, so prompts after it go back to following only the branch it was merged into.'}
};
function promptEditor(k, suffix=''){
  const P=PROMPTS[k], v=promptText(k), custom=v!==P.def, id=`pr-${k}${suffix}`;
  return `<div class="pe" data-pe="${k}"><div class="pe-head"><label class="flabel" for="${id}">${P.label}</label><span class="tag custom" ${custom?'':'hidden'}>custom</span></div>
    <textarea id="${id}" data-prompt="${k}" rows="3" placeholder="${esc(P.placeholder||'')}">${esc(v)}</textarea>
    ${P.fmt?`<p class="note pefmt">Treechats adds this after it, so it can read Claude\u2019s answer: <code>${esc(P.fmt.split('\n')[0])}</code></p>`:''}
    <div class="pe-foot"><p class="note">${P.help}</p><button class="btn xs" data-reset="${k}" ${custom?'':'disabled'}>Reset to default</button></div></div>`;
}
const OP_PROMPTS = {every:['instructions'], reroot:['reroot','summarize'], squash:['summarize'], merge:['seam']};
const radio=(name, val, cur, label)=>`<label class="chk"><input type="radio" name="${name}" value="${val}" ${cur===val?'checked':''}> <span>${label}</span></label>`;
function renderOpsCard(){
  const card=document.getElementById('opsCard'); if(!card) return;
  const extra={
    reroot:`<label class="chk"><input type="checkbox" id="optSummary" ${opts.summary?'checked':''}> <span>Add a summary root that stands in for the cut context</span></label>
      <label class="chk"><input type="checkbox" id="optCow" ${opts.cow?'checked':''}> <span>Reroot a copy and leave the original in place</span></label>
      <fieldset class="optset"><legend>The summary is written by</legend>${radio('rerootBy','template',opts.rerootBy,'The template below')}${radio('rerootBy','claude',opts.rerootBy,'Claude, from the turns that were cut')}</fieldset>
      <p class="note">Its prompts are in <button class="linkbtn" data-setprompts style="color:var(--accent)">Prompts</button>.</p>`,
    squash:`<fieldset class="optset"><legend>Squashed turns become</legend>${radio('squashBy','join',opts.squashBy,'The prompts and replies joined together')}${radio('squashBy','claude',opts.squashBy,'A summary Claude writes of them')}</fieldset><p class="note">Its prompt is in <button class="linkbtn" data-setprompts style="color:var(--accent)">Prompts</button>.</p>`,
    merge:`<p class="note">The merge note is in <button class="linkbtn" data-setprompts style="color:var(--accent)">Prompts</button>.</p>`
  };
  const q=new Set(quickList());
  const ctl=key=> OPS[key] && pinnable(key) ? `<div class="opctl"><button class="btn xs" data-runop="${key}">Run</button></div>` : '';
  const entry=(key,label,k,body,danger)=>`<details class="opd" data-openkey="op-${key}" ${opts.open['op-'+key]?'open':''}><summary><span class="opname ${danger?'danger':''}">${label}</span><span class="tag custom" data-custom-for="${key}" hidden>custom</span>${q.has(key)?'<span class="tag pin" title="In the quick-access bar">bar</span>':''}${k?`<kbd>${k}</kbd>`:''}</summary><div class="opbody">${ctl(key)}${body}</div></details>`;
  card.innerHTML=`<div>
    <p class="note">What each operation does, and how some of them behave. Open one to read it or run it on the selected prompt. Choose which sit above the input box in <button class="linkbtn" data-openquick style="color:var(--accent)">Quick access</button>.</p>
    <div class="oplist">
      ${OP_GROUPS.map(([g,l,note])=>{ const ks=Object.keys(OPS).filter(k=>opGroup(k)===g); return ks.length ? `<h4 class="opgh">${esc(l)}</h4><p class="note opgn">${esc(note)}</p>`+ks.map(k=>{ const o=OPS[k]; return entry(k,o.label,opts.opKeys===false?'':kk(o.key),`<p class="dd">${o.detail}${o.pick?' <em>Tap a target after choosing it.</em>':''}</p>${extra[k]||''}`,o.danger); }).join('') : ''; }).join('')}
    </div>
    <p class="note">Reply to several prompts at once with <b>Reply to several…</b> above the input box, or Ctrl/⌘- or Shift-click prompts. Keyboard shortcuts are listed in Settings. Click a selected prompt again to deselect it.</p></details>`;
  refreshCustomBadges(); refreshRunButtons();
}
function refreshRunButtons(){
  for(const b of document.querySelectorAll('#opsCard [data-runop]')){
    const k=b.dataset.runop, ok=sel!=null && S.nodes[sel] && available(k,sel) && !(k==='regen' && sampleState!=='ready');
    b.disabled=!ok; b.textContent = sel!=null && S.nodes[sel] ? `Run on #${sel}` : 'Run';
    b.title = ok ? '' : sel==null ? 'Select a prompt first' : 'Not available on this prompt';
  }
}
function refreshCustomBadges(){
  const card=document.getElementById('opsCard');
  if(card) for(const [op,ks] of Object.entries(OP_PROMPTS)){ const b=card.querySelector(`[data-custom-for="${op}"]`); if(b) b.hidden=!ks.some(k=>promptText(k)!==PROMPTS[k].def); }
  for(const pe of setEl.querySelectorAll('[data-pe]')){ const k=pe.dataset.pe, custom=promptText(k)!==PROMPTS[k].def; pe.querySelector('.tag.custom').hidden=!custom; pe.querySelector('[data-reset]').disabled=!custom; }
}
/* every field for a prompt shows the same text */
function setPrompt(k, v, from){
  opts.prompts[k] = v===PROMPTS[k].def ? null : v;
  for(const t of document.querySelectorAll(`[data-prompt="${k}"]`)) if(t!==from) t.value=v;
  save(); refreshCustomBadges(); renderCtx();
}
function syncPromptFields(){ for(const t of document.querySelectorAll('[data-prompt]')) t.value=promptText(t.dataset.prompt); save(); refreshCustomBadges(); renderCtx(); }
function resetPrompt(k){ opts.prompts[k]=null; syncPromptFields(); toast(`${PROMPTS[k].label} is back to the default`); }
function available(op, id){
  const n=S.nodes[id]; if(!n) return false;
  const isM=n.kind==='merge';
  if(op==='unmerge') return isM;
  if(isM && ['regen','reroot','splice','graft','cherry','squash','fan','skip','send','promote'].includes(op)) return false;
  if(op==='fan') return !!n.reply;
  if(op==='compare') return cmpKids(id).length>=2;
  if(op==='variants') return !isM;
  if(op==='promote') return !onMain(id);
  if(op==='reroot' || op==='squash') return n.parents.length>0;
  return true;
}
function validTarget(op, src, t){
  if(op==='cherry') return true;
  if(op==='replayonto') return !pick.line.includes(t) && S.nodes[t].kind!=='merge';
  if(op==='squash') return t!==src && S.nodes[t].kind!=='merge' && chain(src).includes(t);
  if(op==='merge') return t!==src && !path(src).includes(t) && !path(t).includes(src);
  const d = desc(src);
  if(t===src || d.has(t)) return false;
  if(op==='graft') return S.nodes[src].parents[0]!==t;
  return false;
}

function run(op, id){
  if(!available(op,id)) return;
  if(op==='regen'){ regenerate(id); return; }
  if(op==='clone'){ cloneMenu(id); return; }
  if(op==='send'){ sendMenu(treeEl.querySelector('[data-act="send"]') || treeEl.querySelector(`.row[data-id="${id}"]`), [id]); return; }
  if(op==='fan'){ openFan(id); return; }
  if(op==='variants'){ openVariants(id); return; }
  if(op==='compare'){ openCompare(id); return; }
  if(op==='promote'){ promote(id); return; }
  if(op==='skip'){ const on=!S.nodes[id].skip; commit(on?`Left #${id} out of the context. It stays in the tree.`:`#${id} is back in the context`, ()=>{ if(on) S.nodes[id].skip=true; else delete S.nodes[id].skip; }); return; }
  if(op==='branch'){ const name=autoName(convOf(id)); commit(`Started ${name} at #${id}. Rename it any time.`, ()=>{ S.head=newRef(name, id); }); return; }
  /* choosing a target needs the whole tree, so from Chat view this continues in Editor */
  if(OPS[op].pick){ if(opts.simple){ setView(false); toast(`Switched to Editor to choose where: ${OPS[op].label.replace('…','')}.`); } pick={op, src:id}; composeFor=null; animRender([id]); return; }
  const n=S.nodes[id];
  if(op==='reroot'){
    const anc = path(id).slice(0,-1), byClaude = opts.summary && opts.rerootBy==='claude' && canSummarize();
    const ctx=anc.filter(a=>S.nodes[a].text).map(a=>clip(S.nodes[a].text,70)).join(' → '), tpl=promptText('reroot');
    const templateText = tpl.includes('{context}') ? tpl.split('{context}').join(ctx) : tpl;
    const conversation = byClaude ? transcript(anc) : '';
    let sid=null;
    commit(`Rerooted #${id}`+(opts.cow?' as a copy':''), ()=>{
      const r=Ops.reroot(S, id, opts.summary ? {text: byClaude ? '' : templateText, pending:byClaude} : null, opts.cow);
      sid=r.summary; if(opts.cow) sel=r.at;
    });
    if(byClaude && sid!=null) summarizeInto(sid, conversation, {text:templateText});
    else if(opts.summary && opts.rerootBy==='claude') summaryUnavailable();
  }
  if(op==='splice') commit(`Spliced out #${id}`, ()=>{
    const ks = kids(id);
    sel = n.parents[0] ?? (ks[0]&&ks[0].id) ?? null;
    Ops.splice(S, [id]);
  });
  if(op==='prune'){
    let r;
    commit(()=>`Deleted ${r.deleted.size} prompt${r.deleted.size>1?'s':''}`, ()=>{ r=Ops.prune(S, id); sel = r.up ?? null; });
  }
  if(op==='unmerge') commit(`Undid the merge at #${id}`, ()=>{ sel=Ops.unmerge(S, id); });
}

function finishPick(t){
  const {op, src, line} = pick; pick=null;
  if(op==='replayonto'){ askReplay(src, t, line); return; }
  const n=S.nodes[src];
  if(op==='graft') commit(`Rebased #${src} onto #${t}`, ()=>{ Ops.rebase(S, src, t); });
  if(op==='merge'){
    let r;
    commit(()=>`Merged ${r.from} into ${r.into}`, ()=>{ r=Ops.merge(S, src, t); S.head=r.rid; sel=r.mid; });
  }
  /* the copy's reply is left empty: it was written for a different context */
  if(op==='cherry') commit(`Copied #${src} under #${t}`, ()=>{ sel=Ops.cherryPick(S, src, t); });
  if(op==='squash'){
    const seg=Ops.squashLine(S, t, src), byClaude = opts.squashBy==='claude' && canSummarize();
    const joinedText=seg.map(x=>S.nodes[x].text).filter(Boolean).join('\n\n'), rsAll=seg.map(x=>S.nodes[x].reply).filter(Boolean);
    const conversation = byClaude ? transcript(seg) : '';
    commit(`Squashed ${seg.length} prompts into #${t}`, ()=>{ Ops.squash(S, t, src, byClaude); sel=t; });
    if(byClaude) summarizeInto(t, conversation, {text:joinedText, reply: rsAll.length ? rsAll.join('\n\n') : undefined});
    else if(opts.squashBy==='claude') summaryUnavailable();
  }
}

function copySubtree(id, parents){ return Ops.copySubtree(S, id, parents); }

function addPrompt(parent, text){
  text=text.trim(); if(!text && !pendingFiles.length){ toast('Write a prompt first.'); return; }
  if(parent==null) draftRoot=''; else draft='';
  composeFor=null; renaming=false;
  if(parent==null){
    const files=takePending();
    commit('Started a chat on main', ()=>{ const nid=Ops.addTurn(S, null, text, {files}); S.head=newRef('main', nid); sel=nid; });
    wantReplies([sel]);
    return;
  }
  pruneAlso();
  const targets=[parent, ...alsoTargets], files=takePending(), created=[];
  alsoTargets.clear();
  const one = targets.length===1;
  const here0 = refsAt(parent), rid0 = here0.includes(S.head) ? S.head : here0[0];
  const name0 = rid0 ? refName(rid0) : autoName(convOf(parent));
  commit(one ? (rid0 ? `Continued on ${name0}` : `Started ${name0} at #${parent}`) : `Replied to ${targets.length} prompts`, ()=>{
    for(const t of targets){
      const nid=Ops.addTurn(S, t, text, {files}), rid=Ops.extend(S, t, nid);
      if(t===parent) S.head=rid;
      created.push(nid);
    }
    sel=created[0];
  });
  wantReplies(created);
  if(opts.simple) scrollThreadEnd();
}
function takePending(){ const f=pendingFiles.length ? pendingFiles : null; pendingFiles=[]; return f; }
const NAME_RE=Ops.NAME_RE;
/* flipping versions at a branch tip carries the branch along, so you just keep going from what you see */
function switchVersion(id, dir){
  const vs=versions(id), i=vs.indexOf(id), t=vs[i+dir];
  if(t==null) return;
  if(!kids(id).length && !kids(t).length && !refsAt(t).length) for(const rid of refsAt(id)) S.refs[rid].tip=t;
  /* the ‹ › you clicked stays under the pointer, however long the other version's reply is */
  const was=treeEl.querySelector(`.ver [data-ver="${id}"]`), y0=was ? was.getBoundingClientRect().top : null;
  select(t);
  const now=treeEl.querySelector(`.ver [data-ver="${t}"]`);
  if(now && y0!=null){ const dy=now.getBoundingClientRect().top-y0; if(Math.abs(dy)>1) scrollByY(dy); }
}
/* A new reply is a new version: the old one, and anything built on it, stays one ‹ › away.
   An edited prompt (newText) is a new line of thought, so it also gets its own branch, checked out: the original keeps
   its branch and everything after it. Asking again with the same prompt just adds a version in place. */
function regenerate(id, newText){
  if(sampleState!=='ready'){ toast('To get replies, add an API key to .env or sign in to Claude Code (run claude once), then restart Treechats.'); return; }
  const n=S.nodes[id]; if(!n) return;
  resendFor=null;
  let nid, name='';
  const edit = newText!=null;
  const below = edit ? replayCount(lineFrom(id).slice(1)) : 0;
  const was = edit ? (refsAt(id).includes(S.head) ? refName(S.head) : refsAt(id).map(refName)[0] || refsThrough(id).map(refName)[0] || '') : '';
  commit(edit ? '' : `Asking for another reply to #${id}. The old one is kept.`, ()=>{
    const r=Ops.newVersion(S, id, edit ? {text:newText} : {});
    nid=r.nid; if(edit){ name=r.name; S.head=r.rid; }
    sel=nid;
  }, {quiet:edit});
  if(edit) toast(`Sent your edit as #${nid} on a new branch, ${name}.${was?` The original stays on ${was}${below?` with the ${below} prompt${below===1?'':'s'} after it`:''}.`:''}`, true, below ? {label:`${AI}Replay ${below} below`, fn:()=>askReplay(id, nid)} : undefined);
  generate(nid);
}
/* ---- Mainline ----
   main is just the branch named main; the straight line in the drawing follows it. */
function onMain(id){ return Ops.onMain(S, id); }
function promote(id){
  if(onMain(id)){ toast('This prompt is already on main.'); return; }
  let r;
  commit(()=>r.old ? `${r.old} is now main. The old main is now ${r.old}.` : `The line through #${id} is now main`, ()=>{
    r=Ops.makeMainline(S, id); S.head=r.rid;
    if(sel==null || !chain(S.refs[r.rid].tip).includes(sel)) sel=id;
  });
}
