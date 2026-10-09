/* The quick-access bar above the input box, with the operations grouped as they appear. */

/* the quick-access bar above the input box: you choose which operations sit there; the rest are under More */
/* Operations, grouped as they appear: the ones that change a prompt or how it's included sit under the prompt and its
   reply; the bar above the input box holds the ones that change the tree (new branches, merges, moves, removals),
   in these groups. */
const OP_GROUPS=[
  ['prompt','On the prompt','Change a prompt or its reply, or how it\u2019s included in the context, without adding prompts. They sit under the selected prompt and its reply.'],
  ['branch','Branch','Start branches and compare them.'],
  ['merge','Merge','Bring branches or turns together.'],
  ['move','Copy & move','Copy or move prompts to another place in the tree.'],
  ['remove','Remove','Take prompts out of the tree.'],
];
const opGroup = k => (OPS[k] && OPS[k].group) || 'branch';
const opGroupLabel = g => (OP_GROUPS.find(x=>x[0]===g)||[0,''])[1];
/* the operations of each group, in the bar's order (yours, then the rest as defined) */
const groupedOps = keys => OP_GROUPS.map(([g,l])=>[g,l,keys.filter(k=>opGroup(k)===g)]).filter(x=>x[2].length);
const QUICK_DEFAULT=['branch','promote','compare','merge','unmerge','clone','graft','splice','prune'];
const quickList = () => Array.isArray(opts.quick) ? opts.quick.filter(k=>OPS[k] && pinnable(k)) : QUICK_DEFAULT;
const pinnable = k => k!=='cont' && OPS[k] && opGroup(k)!=='prompt';
function opsMoreMenu(anchor, id){
  const q=new Set(quickList());
  const rest=Object.keys(OPS).filter(k=>pinnable(k) && !q.has(k) && available(k,id));
  openMenu(anchor, [
    ...(rest.length ? groupedOps(rest).flatMap(([g,l,ks])=>[{heading:l}, ...ks.map(k=>({label:opLabel(k,id)+(opts.opKeys===false?'':'   '+kk(OPS[k].key)), run:()=>run(k,id)}))]) : [{label:'Everything available is already in the bar', disabled:true}]),
    {sep:true},
    {label:'Choose what’s in the bar…', run:()=>openSettings('bar')}
  ]);
}
function showOpsCard(customize){
  if(!setEl.hidden) closeSettings();
  if(opts.simple){ opts.simple=false; applySimple(); render(true); }
  opts.open.ops=true; save(); renderOpsCard();
  const card=document.getElementById('opsCard');
  if(customize) card.classList.add('flash');
  setTimeout(()=>{ card.scrollIntoView({behavior: Motion.reduced()?'auto':'smooth', block:'start'}); setTimeout(()=>card.classList.remove('flash'), 1600); }, 30);
}
function opsHTML(id){
  const isM=S.nodes[id].kind==='merge', q=new Set(quickList());
  const btn = ([k,o])=>
    `<button class="btn ${o.danger?'danger':''}" data-act="${k}" data-hint="${esc(k==='skip'&&S.nodes[id].skip?'Send this prompt to Claude again.':o.hint)}" ${available(k,id)?'':'disabled title="Already the start of a chat"'}>${opLabel(k,id)}${opts.opKeys===false?'':` <kbd>${kk(o.key)}</kbd>`}</button>`;
  /* the bar, in groups (Branch, Merge, Copy & move, Remove), each labelled */
  const shown=quickList().filter(k=>{ const o=OPS[k]; return (isM||k==='unmerge'||o.hide) ? available(k,id) : true; });
  const btns=groupedOps(shown).map(([g,l,ks])=>`<div class="opgrp" role="group" aria-label="${esc(l)}"><span class="oglab" aria-hidden="true">${esc(l)}</span><span class="opbtns">${ks.map(k=>btn([k,OPS[k]])).join('')}</span></div>`).join('');
  return `<div class="ops" data-key="o${id}"><div class="bar">${btns}<button class="btn more" data-opsmore aria-haspopup="menu" title="Other operations, and choosing what sits in this bar">More ▾</button></div><p class="hint" id="hint">Hover an operation for a quick summary. Full descriptions are in Settings › Operations.</p>${renaming && S.head ? renameFormHTML() : composerHTML(id)}</div>`;
}
