/* Clicks and keys on the tree and the page. */

/* events */
treeEl.addEventListener('click', e=>{
  const pm=e.target.closest('[data-projmenu]'); if(pm){ spaceMenu(pm, DB.current); return; }
  const pe=e.target.closest('[data-pedit]'); if(pe){ finishPromptEdit(pe.dataset.pedit); return; }
  if(e.target.closest('.pedit')) return; /* typing in the prompt editor doesn't select anything */
  const pb=e.target.closest('[data-promptedit]'); if(pb){ openPromptEdit(+pb.dataset.promptedit); return; }
  const act=e.target.closest('[data-act]'); if(act){ run(act.dataset.act, sel); return; }
  if(sendClick(e)) return;
  const om=e.target.closest('[data-opsmore]'); if(om){ opsMoreMenu(om, sel); return; }
  const vs=e.target.closest('[data-variants]'); if(vs){ openVariants(sel); return; }
  const st=e.target.closest('[data-star]'); if(st){ toggleStar(+st.dataset.star); return; }
  const fo=e.target.closest('[data-fold]'); if(fo){ toggleFold(+fo.dataset.fold); return; }
  const uf=e.target.closest('[data-unfold]'); if(uf){ toggleFold(+uf.dataset.unfold); return; }
  const fb=e.target.closest('[data-fan]'); if(fb){ openFan(+fb.dataset.fan); return; }
  const dsb=e.target.closest('[data-distill]'); if(dsb){ openDistill(+dsb.dataset.distill); return; }
  const rvb=e.target.closest('[data-review]'); if(rvb){ openReview(+rvb.dataset.review); return; }
  const rvw=e.target.closest('[data-rvwhole]'); if(rvw && reviewAsk){ const t=document.getElementById('reviewText'); if(t) reviewAsk.text=t.value; reviewAsk.whole=rvw.dataset.rvwhole==='1'; animRender([reviewAsk.id]); return; }
  if(e.target.closest('[data-rvgo]')){ startReview(); return; }
  if(e.target.closest('[data-rvcancel]') && reviewAsk){ const id=reviewAsk.id; reviewAsk=null; animRender([id]); return; }
  const gt=e.target.closest('[data-goto]'); if(gt){ e.stopPropagation(); gotoNode(+gt.dataset.goto); return; }
  if(variants){
    if(e.target.closest('[data-vcancel]')){ const keep=variants.rows[0].text; variants=null; draft=keep; animRender([sel]); return; }
    if(e.target.closest('[data-vsend]')){ sendVariants(); return; }
    if(e.target.closest('[data-vgrid]')){
      /* the variants' wordings become the grid's rows, and their models its setups */
      const rows=[...new Set(variants.rows.map(r=>r.text.trim()).filter(Boolean))], tiers=[...new Set(variants.rows.map(r=>r.tier))], at=sel;
      variants=null; animRender([at]);
      openGridBuilder(at, rows[0]||''); if(gridUI){ gridUI.draft.rows=rows.length?rows:['']; gridUI.draft.cols=tiers.map(t=>({tier:t})); paintGrid(); }
      return;
    }
    if(e.target.closest('[data-vadd]')){ variants.rows.push({text:'', tier:opts.model}); paintVariants(); const t=treeEl.querySelectorAll('[data-vtext]'); t[t.length-1].focus(); return; }
    if(e.target.closest('[data-vsuggest]')){ suggestWordings(); return; }
    const vd=e.target.closest('[data-vdel]'); if(vd){ variants.rows.splice(+vd.dataset.vdel,1); paintVariants(); return; }
  }
  if(distill && e.target.closest('.distill')){
    if(e.target.closest('[data-dcancel]')){ closeDistill(); return; }
    const dg=e.target.closest('[data-dgo]'); if(dg){ if(dg.dataset.dgo==='repo') repoMenu(dg); else useDistill(dg.dataset.dgo); return; }
    return;
  }
  if(fan){
    if(e.target.closest('[data-fcancel]')){ closeFan(); return; }
    if(e.target.closest('[data-fskip]')){ if(fan.ctl) fan.ctl.abort(); fanReady(fan.quick, ''); return; }
    if(e.target.closest('[data-fango]')){ fanCreate(); return; }
    if(e.target.closest('[data-fadd]')){ fan.options.push({title:'New option', prompt:'', on:true}); paintFan(); const t=treeEl.querySelectorAll('[data-ftitle]'); const last=t[t.length-1]; if(last){ last.focus(); last.select(); } return; }
    const fd=e.target.closest('[data-fdel]'); if(fd){ const i=+fd.dataset.fdel; fan.options.splice(i,1); if(fan.main===i) fan.main=0; else if(fan.main>i) fan.main--; paintFan(); return; }
    if(e.target.closest('.fan')) return;
  }
  const at0=e.target.closest('[data-attach]'); if(at0){ openMenu(at0, [{label:'Files…', run:()=>openPicker('prompt')}, {label:'A folder…', run:()=>openFolder('prompt')}]); return; }
  const ua=e.target.closest('[data-unattach]'); if(ua){ pendingFiles.splice(+ua.dataset.unattach,1); const t=document.getElementById('contText')||document.getElementById('composeText'), keep=t?t.value:''; renderTree(); const t2=document.getElementById('contText')||document.getElementById('composeText'); if(t2) t2.value=keep; return; }
  const cr=e.target.closest('[data-copyreply]'); if(cr){ copyText(S.nodes[+cr.dataset.copyreply].reply||''); return; }
  const oe=e.target.closest('[data-openeditor]'); if(oe){ openInEditor(+oe.dataset.openeditor); return; }
  const cp=e.target.closest('[data-copyprompt]'); if(cp){ copyText(S.nodes[+cp.dataset.copyprompt].text||''); return; }
  const ere=e.target.closest('[data-editreply]'); if(ere){ openReplyEdit(+ere.dataset.editreply); return; }
  const rea=e.target.closest('[data-replyedit]'); if(rea){ if(rea.dataset.replyedit==='save') saveReplyEdit(); else { const id=replyEditFor; replyEditFor=null; animRender([id]); } return; }
  const er=e.target.closest('[data-editresend]'); if(er){ resendFor=+er.dataset.editresend; animRender([sel]); const t=document.getElementById('resendText'); if(t){ t.focus({preventScroll:true}); t.setSelectionRange(t.value.length,t.value.length); } return; }
  const rs=e.target.closest('[data-resend]');
  if(rs){ if(rs.dataset.resend==='go'){ const v=document.getElementById('resendText').value.trim(); if(!v){ toast('Write a prompt first.'); return; } regenerate(resendFor, v); } else { resendFor=null; animRender([sel]); } return; }
  const cm=e.target.closest('[data-convmenu]'); if(cm){ convMenu(cm, +cm.dataset.convmenu, true); return; }
  const hc=e.target.closest('[data-hideconv]'); if(hc){ setHidden([+hc.dataset.hideconv], true); return; }
  if(e.target.closest('[data-showall]')){ showAll(); return; }
  const co=e.target.closest('[data-co]'); if(co && !pick){ checkout(co.dataset.co); return; }
  if(e.target.closest('[data-renamehead]')){ renaming=true; animRender([sel]); return; }
  const pv=e.target.closest('[data-propview]'); if(pv){ const [a,b]=pv.dataset.propview.split(':'); openProposal(+a, +b); return; }
  const pa=e.target.closest('[data-propany]'); if(pa){ proposalAnyMenu(pa, +pa.dataset.propany); return; }
  const fop=e.target.closest('[data-fileopen]'); if(fop){ e.stopPropagation(); openFileView(fop.dataset.fileopen); return; }
  const sp=e.target.closest('[data-stop]'); if(sp){ stopReply(+sp.dataset.stop); return; }
  if(e.target.closest('[data-cmdclose]')){ const at=cmdPanel && cmdPanel.at; cmdPanel=null; paintCmds(at); return; }
  if(e.target.closest('[data-sideclose]')){ if(side){ const at=side.at; if(side.ctl) side.ctl.abort(); side=null; paintCmds(at); } return; }
  if(e.target.closest('[data-sidestop]')){ if(side && side.ctl) side.ctl.abort(); return; }
  if(e.target.closest('[data-sidekeep]')){ keepSide(); return; }
  if(e.target.closest('[data-sidecopy]')){ if(side) copyText(side.text, true).then(ok=>{ if(ok) toast('Copied the answer.'); }); return; }
  if(e.target.closest('[data-loopstop]')){ stopLoop(); return; }
  if(e.target.closest('[data-runstop]')){ if(cmdPanel && cmdPanel.ctl) cmdPanel.ctl.abort(); return; }
  if(e.target.closest('[data-runattach]')){ if(cmdPanel && cmdPanel.kind==='run') attachRunOutput(cmdPanel); return; }
  if(e.target.closest('[data-runcopy]')){ if(cmdPanel && cmdPanel.output!=null) copyText(cmdPanel.output, true).then(ok=>{ if(ok) toast('Copied the output.'); }); return; }
  if(e.target.closest('[data-runagain]')){ if(cmdPanel && cmdPanel.kind==='run') startRun(cmdPanel.root, cmdPanel.command, cmdPanel.at); return; }
  const ua2=e.target.closest('[data-unalso]'); if(ua2){ alsoTargets.delete(+ua2.dataset.unalso); keepDraft(()=>animRender([sel])); return; }
  if(e.target.closest('[data-alsoclear]')){ alsoTargets.clear(); keepDraft(()=>animRender([sel])); return; }
  if(e.target.closest('[data-alsopick]')){ const base=composeParent(); if(opts.simple){ keepDraft(()=>setView(false)); if(base!=null) select(base); toast('Switched to Editor to pick the prompts to reply to.'); } pick={op:'also', src:sel}; composeFor=null; keepDraft(()=>animRender([sel])); return; }
  const gr=e.target.closest('[data-genreply]'); if(gr){ generate(+gr.dataset.genreply); return; }
  const lm=e.target.closest('[data-linemode]'); if(lm){ const on=lm.dataset.linemode==='line'; if(!!opts.lineOnly!==on){ opts.lineOnly=on; save(); Motion.run(treeEl, renderTree, [sel]); } return; }
  const svm=e.target.closest('[data-savedmenu]'); if(svm){ savedMenu(svm, document.getElementById(svm.dataset.savedmenu)); return; }
  const rgb=e.target.closest('[data-rg]'); if(rgb && range){ rangeAction(rgb.dataset.rg); return; }
  if(e.target.closest('[data-rangeclear]')){ range=null; animRender([sel]); return; }
  const pkb=e.target.closest('[data-pk]'); if(pkb){ pickedAction(pkb.dataset.pk, pkb); return; }
  if(e.target.closest('[data-alsocompare]')){ openCompareIds([sel, ...alsoTargets]); return; }
  const rg=e.target.closest('[data-regen]'); if(rg){ regenerate(+rg.dataset.regen); return; }
  const rpa=e.target.closest('[data-replayask]'); if(rpa){ askReplay(+rpa.dataset.replayask); return; }
  if(e.target.closest('[data-replaygo]') && replayAsk){ const r=replayAsk; replay(r.from, r.onto, r.line); return; }
  const rfm=e.target.closest('[data-replayfit]'); if(rfm){ opts.replayFit=rfm.dataset.replayfit; save(); if(replayAsk) animRender([replayAsk.at]); return; }
  if(e.target.closest('[data-replaystop]') && replayRun){ const r=replayRun; r.stop=true; if(r.status && r.status.what==='sending') stopReply(r.status.id); if(r.resolve) r.resolve(null); return; }
  const rfg=e.target.closest('[data-replayfitgo]'); if(rfg && replayRun && replayRun.resolve){ const r=replayRun, how=rfg.dataset.replayfitgo, res=r.resolve; r.resolve=null;
    if(how==='stop'){ res(null); return; }
    const o=S.nodes[r.status.id], t=document.getElementById('replayFitText'), v=how==='original' ? o.text : (t ? t.value : '');
    if(!v.trim()){ r.resolve=res; toast('Write a prompt first.'); return; }
    res({text:v}); return; }
  if(e.target.closest('[data-replaycancel]') && replayAsk){ const at=replayAsk.at; replayAsk=null; animRender([at]); return; }
  const vb=e.target.closest('[data-ver]'); if(vb){ switchVersion(+vb.dataset.ver, +vb.dataset.dir); return; }
  const rt=e.target.closest('[data-rtog]');
  if(rt){ const id=+rt.dataset.rtog, open=rt.getAttribute('aria-expanded')==='true'; openReplies.delete(id); openReplies.delete(-id); openReplies.add(open?-id:id); Motion.run(treeEl, renderTree, [id]); return; }
  const rf=e.target.closest('[data-rfull]'); if(rf){ const id=+rf.dataset.rfull; fullReplies.has(id)?fullReplies.delete(id):fullReplies.add(id); Motion.run(treeEl, renderTree, [id]); return; }
  const rm=e.target.closest('[data-rmode]'); if(rm){ setRepliesMode(rm.dataset.rmode); Motion.run(treeEl, renderTree, [sel]); return; }
  const rl=e.target.closest('[data-rlen]'); if(rl){ opts.replyLen=rl.dataset.rlen; fullReplies.clear(); save(); Motion.run(treeEl, renderTree, [sel]); return; }
  if(e.target.closest('[data-cancel]')){ const src=pick&&pick.src, wasAlso=pick&&pick.op==='also'; pick=null; keepDraft(()=>animRender([src, sel])); if(wasAlso){ const t=document.getElementById('contText'); if(t){ t.focus({preventScroll:true}); t.setSelectionRange(t.value.length, t.value.length); } } return; }
  const cmp=e.target.closest('[data-compose]');
  if(cmp){ const a=cmp.dataset.compose;
    if(a==='add-root') submitPrompt(null, document.getElementById('composeText').value);
    else if(a==='cont') submitPrompt(composeParent(), document.getElementById('contText').value);
    else if(a==='renbranch'){ const v=document.getElementById('branchName').value; renaming=false; renameRef(S.head, v); animRender([sel]); }
    else if(a==='cancel-root'){ composeFor=null; animRender([sel]); }
    else { composeFor=null; renaming=false; animRender([sel]); }
    return; }
  const g=e.target.closest('[data-sel]'); if(g){ select(+g.dataset.sel); return; }
  if(e.target.closest('.ptext a')) return;
  const fg=e.target.closest('[data-forkgo]'); if(fg){ const k=+fg.dataset.forkgo, kn=S.nodes[k]; if(kn && kn.alt!=null) S.active[kn.alt]=k; const rid=refsThrough(k)[0]; simpleTip=null; select(rid ? S.refs[rid].tip : leafOf(k)); return; }
  if(String(window.getSelection ? getSelection() : '') && e.target.closest('.row')) return;
  const row=e.target.closest('.row'); if(!row) return;
  const id=+row.dataset.id;
  if(pick && pick.op==='also'){ if(id!==pick.src && S.nodes[id].kind!=='merge'){ alsoTargets.has(id) ? alsoTargets.delete(id) : alsoTargets.add(id); keepDraft(()=>animRender([id])); } return; }
  if(!pick && !opts.simple && sel!=null && id!==sel && e.shiftKey && !e.metaKey && !e.ctrlKey){ setRange(sel, id); return; }
  if(!pick && sel!=null && id!==sel && (e.metaKey || e.ctrlKey)){ if(S.nodes[id].kind==='merge'){ toast('A merge point has no prompt of its own to pick.'); return; } range=null; alsoTargets.has(id) ? alsoTargets.delete(id) : alsoTargets.add(id); keepDraft(()=>animRender([id])); return; }
  if(range && !pick){ range=null; }
  /* a plain click after picking several selects just the one clicked */
  if(!pick && alsoTargets.size){ alsoTargets.clear(); if(id===sel){ keepDraft(()=>animRender([sel])); return; } }
  if(!pick && id===sel){ if(!opts.simple) deselect(); return; }
  if(pick){ if(id===pick.src) return; if(validTarget(pick.op,pick.src,id)) finishPick(id); else toast(pick.op==='merge' ? 'That prompt is already on the same line as this branch, so there is nothing to merge.' : 'That prompt can’t be used here. It would create a loop or change nothing.'); return; }
  select(id);
});
treeEl.addEventListener('change', e=>{
  if(e.target.dataset && e.target.dataset.model!=null){ opts.model=e.target.value; save(); }
  if(variants && e.target.dataset && e.target.dataset.vtier!=null){ variants.rows[+e.target.dataset.vtier].tier=e.target.value; }
  if(fan && e.target.closest && e.target.closest('.fan')){
    const d=e.target.dataset;
    if(d.fon!=null){ const o=fan.options[+d.fon]; o.on=e.target.checked; if(!o.on && fan.main===+d.fon){ const j=fan.options.findIndex(x=>x.on); fan.main=j<0?0:j; } paintFan(); }
    if(d.fmain!=null){ fan.main=+d.fmain; paintFan(); }
    if(d.freplies!=null){ fan.replies=e.target.checked; }
  }
  if(e.target.id==='headSel'){ checkout(e.target.value); const t=document.getElementById('contText'); if(t) t.focus(); }
});
treeEl.addEventListener('mouseover', e=>{ const b=e.target.closest('[data-hint]'); const h=document.getElementById('hint'); if(b&&h) h.textContent=b.dataset.hint; });
treeEl.addEventListener('focusin', e=>{ const b=e.target.closest('[data-hint]'); const h=document.getElementById('hint'); if(b&&h) h.textContent=b.dataset.hint; });
treeEl.addEventListener('focusout', e=>{ if(slash && e.target===slash.box) setTimeout(()=>{ if(slash && document.activeElement!==slash.box) closeSlash(); }, 120); });
addEventListener('scroll', ()=>{ if(slash) paintSlash(); }, {passive:true});
treeEl.addEventListener('keydown', e=>{
  const send = e.key==='Enter' && !e.isComposing && e.keyCode!==229 && (opts.sendKey==='mod' ? (e.metaKey||e.ctrlKey) : (!e.shiftKey && !e.altKey));
  if(slash && e.target===slash.box && !e.isComposing){
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){ if(!slash.hint){ e.preventDefault(); moveSlash(e.key==='ArrowDown'?1:-1); return; } }
    else if(e.key==='Escape'){ e.preventDefault(); e.stopImmediatePropagation(); closeSlash(); return; }
    else if(e.key==='Tab' && !e.shiftKey){ if(acceptSlash(false)){ e.preventDefault(); return; } }
    else if(e.key==='Enter' && !e.shiftKey && !e.altKey){ if(acceptSlash(true)){ e.preventDefault(); return; } }
  }
  if(e.target.id==='composeText' && send){ e.preventDefault(); submitPrompt(null, e.target.value); }
  if(e.target.id==='contText' && send){ e.preventDefault(); submitPrompt(composeParent(), e.target.value); }
  if(e.target.dataset && e.target.dataset.vtext!=null && send){ e.preventDefault(); sendVariants(); }
  if(fan && fan.status==='ready' && e.key==='Enter' && (e.metaKey||e.ctrlKey) && e.target.closest && e.target.closest('.fan')){ e.preventDefault(); fanCreate(); }
  if(e.target.id==='resendText' && send){ e.preventDefault(); const v=e.target.value.trim(); if(v) regenerate(resendFor, v); }
  if(e.target.id==='promptEditText' && e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); finishPromptEdit('resend'); }
  if(e.target.id==='promptEditText' && e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); finishPromptEdit('cancel'); }
  if(e.target.id==='replyEditText' && e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); saveReplyEdit(); }
  if(e.target.id==='replyEditText' && e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); const id=replyEditFor; replyEditFor=null; animRender([id]); }
  if(e.target.id==='resendText' && e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); resendFor=null; animRender([sel]); }
  if(e.target.id==='branchName' && e.key==='Enter'){ e.preventDefault(); renaming=false; renameRef(S.head, e.target.value); animRender([sel]); }
  if(e.target.classList.contains('row') && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); e.target.click(); }
});
const ctxCardEl=document.getElementById('ctxCard');
ctxCardEl.addEventListener('click', e=>{
  const sk=e.target.closest('[data-ctxskip]'); if(sk){ e.stopPropagation(); run('skip', +sk.dataset.ctxskip); return; }
  const cm=e.target.closest('[data-ctxmode]'); if(cm){ e.stopPropagation(); sendMenu(cm, [+cm.dataset.ctxmode], {target:sel}); return; }
  if(e.target.closest('[data-gotoprompts]')){ openSettings('prompts'); return; }
  const be=e.target.closest('[data-bsetedit]'); if(be){ bsetFor=+be.dataset.bsetedit; renderCtx(); const t=document.getElementById('bsSystem'); if(t) t.focus({preventScroll:true}); return; }
  if(e.target.closest('[data-bsetcancel]')){ bsetFor=null; renderCtx(); return; }
  const bs=e.target.closest('[data-bsetsave]'); if(bs){ saveBset(+bs.dataset.bsetsave); return; }
  const bc=e.target.closest('[data-bsetclear]'); if(bc){ const id=+bc.dataset.bsetclear; commit(`Cleared the model settings on #${id}`, ()=>{ delete S.nodes[id].set; }); renderCtx(); return; }
  const bt=e.target.closest('[data-bsthink]'); if(bt){ for(const x of bt.parentElement.children) x.setAttribute('aria-pressed', x===bt); return; }
  if(e.target.closest('[data-openspacefiles]')){ openSpaceFiles(); return; }
  const rf=e.target.closest('[data-rmnodefile]'); if(rf && S.nodes[sel]){ const i=+rf.dataset.rmnodefile, m=S.nodes[sel].files[i]; commit(`Removed ${m.name} from #${sel}`, ()=>{ S.nodes[sel].files.splice(i,1); if(!S.nodes[sel].files.length) delete S.nodes[sel].files; }, {touch:false}); return; }
  const g=e.target.closest('[data-sel]'); if(g){ select(+g.dataset.sel); return; }
  if(e.target.id==='copyCtx') copyText(JSON.stringify(turnsFor(sel, true),null,2));
  if(e.target.id==='copyMd') copyText(pathMarkdown(sel));
  if(e.target.id==='copyPrompt') copyContextPrompt(sel);
  if(e.target.id==='distillCtx') openDistill(sel);
});
let noteBefore=null;
ctxCardEl.addEventListener('focusin', e=>{ if(e.target.id==='editNote') noteBefore=JSON.stringify(S); });
ctxCardEl.addEventListener('input', e=>{
  if(e.target.id!=='editNote' || !S.nodes[sel]) return;
  const n=S.nodes[sel]; if(e.target.value.trim()) n.note=e.target.value; else delete n.note;
  save(); keepDraft(()=>renderTree());
});
ctxCardEl.addEventListener('focusout', e=>{
  if(e.target.id!=='editNote') return;
  if(noteBefore && noteBefore!==JSON.stringify(S)) pushUndo({kind:'tree', sid:DB.current, s:noteBefore});
  noteBefore=null;
});
