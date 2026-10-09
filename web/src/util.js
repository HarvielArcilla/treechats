/* Small helpers used everywhere: copying, clipping and escaping text, sizes and costs, the clipboard. */

const clone = o => JSON.parse(JSON.stringify(o));
const clip = (s,n) => s.length>n ? s.slice(0,n-1).trimEnd()+'…' : s;
const esc = s => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokens = turns => Math.ceil(turns.reduce((a,t)=>a+t.content.length,0)/4);
const fmtSize = b => b<1024 ? b+' B' : b<1048576 ? Math.round(b/1024)+' KB' : (b/1048576).toFixed(1)+' MB';
/* tokens and cost, as the API (or Claude Code) reported them for each reply */
const fmtCost = c => c==null ? '' : c<0.01 ? '<$0.01' : '$'+c.toFixed(c<1?3:2);
async function copyText(text, quiet){
  try{ await navigator.clipboard.writeText(text); if(!quiet) toast('Copied to the clipboard'); return true; }
  catch(e){
    openIo(text);
    toast('Copy blocked here. The text is selected below: copy it with Ctrl/⌘ C.');
  }
}
