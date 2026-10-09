/* Copy as a prompt, and the Markdown export. */

/* ---- Copy context as a prompt ----
   Exactly what the next request from a prompt would send (standing instructions, space files, merge notes, every
   turn and reply, minus what's left out), as one block to paste into Claude anywhere and ask your question after. */
function contextPrompt(id){ return Core.contextPrompt(S, id, coreEnv()); }
function copyContextPrompt(id){
  if(id==null || !S.nodes[id]){ toast('Select a prompt first. The context runs from the start of its chat to it.'); return; }
  copyText(contextPrompt(id), true).then(ok=>{ if(ok) toast(`Copied the context up to #${id} as a prompt, about ${tokens(turnsFor(id,true)).toLocaleString()} tokens. Paste it and add your question.`); });
}
/* ---- Markdown export ---- */
function turnMd(id, withIds){
  const n=S.nodes[id]; if(!n) return '';
  if(n.kind==='merge') return `*Merged ${n.from||'#'+n.parents[1]} into ${n.into||'#'+n.parents[0]}.*`;
  const files=(n.files||[]).map(f=>`\`${f.name}\``).join(', ');
  let out=`### You${withIds?` · #${id}`:''}${n.skip?' · left out of context':''}\n\n${n.text||''}${files?`\n\nAttached: ${files}`:''}`;
  if(n.reply) out+=`\n\n### Claude\n\n${n.reply}`;
  if(n.note) out+=`\n\n> Note: ${n.note.replace(/\n/g,'\n> ')}`;
  return out;
}
function pathMarkdown(id){
  const r=S.nodes[chain(id)[0]];
  const parts=contextEntries(id).filter(e=>!e.seam).map(e=>turnMd(e.id, false)).filter(Boolean);
  return `# ${convTitle(r)}\n\n${parts.join('\n\n')}\n`;
}
/* the whole conversation: the main line first, then each branch from where it forks */
function treeMarkdown(rootId){
  const tr=new Set(Object.values(S.refs).filter(r=>r.name==='main' && S.nodes[r.tip]).flatMap(r=>chain(r.tip)));
  const out=[`# ${convTitle(S.nodes[rootId])}`], queue=[[rootId,null]];
  while(queue.length){
    const [start, from]=queue.shift();
    if(from!=null){ const nm=refsThrough(start).map(refName)[0]; out.push(`## Branch${nm?' '+nm:''} · from #${from}`); }
    let cur=start;
    while(cur!=null){
      out.push(turnMd(cur, true));
      const ks=vKids(cur), straight=ks.find(k=>tr.has(k.id)) || ks[0];
      for(const k of ks) if(k!==straight) queue.push([k.id, cur]);
      cur = straight ? straight.id : null;
    }
  }
  return out.join('\n\n')+'\n';
}
