/* How much of the request limit the context uses. */

/* ---- Context size ----
   The request limit is on the text sent, so the meter counts bytes of the turns that would go out. */
let promptLimit=262144;
const enc = typeof TextEncoder!=='undefined' ? new TextEncoder() : null;
function ctxBytes(turns){ const t=turns.map(x=>x.content).join(''); return enc ? enc.encode(t).length : t.length; }
function meterHTML(turns, compact){
  const b=ctxBytes(turns), pct=b/promptLimit*100, level = pct>=100 ? 'over' : pct>=75 ? 'high' : '';
  const shown = pct<1 && b>0 ? '<1' : Math.round(pct);
  if(compact) return `<span class="cmeter ${level}" title="The context sent from here is ${fmtSize(b)} of the ${fmtSize(promptLimit)} request limit"><span class="mbar"><span style="width:${Math.min(100,pct)}%"></span></span>${shown}%</span>`;
  return `<div class="meter ${level}"><div class="mbar"><span style="width:${Math.min(100,pct)}%"></span></div>
    <p class="note">${level==='over'?'<b>Too long to send.</b> Squash, reroot, or leave some prompts out. ':''}${fmtSize(b)} of the ${fmtSize(promptLimit)} request limit (${shown}%) · ~${tokens(turns)} tokens</p></div>`;
}
