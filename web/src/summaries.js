/* Summaries Claude writes for Reroot and Squash. */

/* ---- Claude-written summaries (Reroot, Squash) ----
   The node is created right away and fills in as Claude writes. If Claude isn't available or fails,
   the node falls back to what the template or plain join would have produced. */
let sumGen=null;
const canSummarize = () => sampleState==='ready' && !sumGen;
function summaryUnavailable(){ toast(sumGen ? 'Claude is busy with another request, so the plain version was used.' : 'Claude isn\u2019t available here, so the plain version was used.'); }
function transcript(ids){
  const out=[];
  for(const i of ids){ const n=S.nodes[i]; if(!n) continue; if(n.text) out.push('User: '+n.text); if(n.reply) out.push('Claude: '+n.reply); }
  return out.join('\n\n');
}
function paintSummary(id){
  const n=S.nodes[id]; if(!n) return;
  const el=treeEl.querySelector(`.row[data-id="${id}"] .txt`);
  if(el) el.innerHTML = n.text ? esc(n.text) : '<em class="thinking">Claude is summarizing…</em>';
  const ed=document.getElementById('edit'); if(ed && editorFor===id && document.activeElement!==ed) ed.value=n.text;
}
async function summarizeInto(id, conversation, fallback){
  const tpl=await askTemplate('summarize', {conversation}, 'Summary');
  if(tpl==null){ const n=S.nodes[id]; if(n){ n.text=fallback.text; if(fallback.reply) n.reply=fallback.reply; delete n.pending; } save(); render(editorFor===id); toast('No summary was written; the plain version was kept.'); return; }
  const input=fillPrompt('summarize', {conversation}, tpl);
  const ctl=new AbortController(); sumGen={id, ctl};
  paintSummary(id);
  let failed=null;
  try{
    const r=await sampleFn(input, {modelTier:opts.model, cache:false, signal:ctl.signal, onText:({text})=>{ const n=S.nodes[id]; if(n){ n.text=text; paintSummary(id); } }});
    const n=S.nodes[id]; if(n){ n.text=r.text.trim(); delete n.pending; }
  }catch(e){
    failed = e && e.code;
    const n=S.nodes[id]; if(n){ n.text=fallback.text; if(fallback.reply) n.reply=fallback.reply; delete n.pending; }
  }
  sumGen=null; save(); setTimeout(()=>typeof pumpNames==='function' && pumpNames(), 0);
  render(editorFor===id);
  if(failed) toast(failed==='cancelled' ? 'Summary stopped. The plain version was kept.' : 'Claude couldn\u2019t write the summary, so the plain version was kept.');
}
