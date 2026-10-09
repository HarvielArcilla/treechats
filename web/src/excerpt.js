/* The excerpt highlighter: choosing exactly which parts of a turn are sent. */

/* ---- The excerpt highlighter ----
   Shows the prompt and the reply as their Markdown source, so what you highlight is exactly what's sent. Drag over
   any text to add it; click a paragraph, list item or code block to add or remove all of it; click a highlight to
   remove it. Highlights merge where they touch. A side with nothing highlighted is sent whole. Nothing changes until
   you save. */
let exUI=null;
const exEl=()=>document.getElementById('excerptView');
function openExcerpt(id){
  const n=S.nodes[id]; if(!n || n.kind==='merge') return;
  const ranges=(text, list)=>{ let lost=0; const out=[]; for(const pc of Array.isArray(list)?list:[]){ const p=typeof pc==='string'?{s:-1,e:-1,t:pc}:pc; const at=p&&p.t?SM.locate(text, p):null; if(at) out.push(at); else lost++; } return {out, lost}; };
  const ex=n.ex||{}, p=ranges(n.text||'', ex.p), r=ranges(n.reply||'', ex.r);
  const ed=(n.ex && n.send==='excerpt' && n.ex.ed) || {};
  exUI={id, sid:DB.current, p:p.out, r:r.out, lost:p.lost+r.lost, ed:{p:typeof ed.p==='string'?ed.p:null, r:typeof ed.r==='string'?ed.r:null}};
  paintExcerpt(); openPanel(exEl());
  const first=exEl().querySelector('[data-extext]'); if(first) first.focus({preventScroll:true});
}
/* paragraphs, list items, headings and fenced code blocks of Markdown source, as [start, end] */
function exBlocks(text){
  const out=[], lines=text.split('\n'); let at=0, cur=null, fence=null;
  const close=()=>{ if(cur){ out.push(cur); cur=null; } };
  for(const line of lines){
    const s=at, e=at+line.length; at=e+1;
    if(fence){ cur[1]=e; if(/^\s*(```|~~~)/.test(line)){ fence=null; close(); } continue; }
    if(/^\s*(```|~~~)/.test(line)){ close(); cur=[s,e]; fence=true; continue; }
    if(!line.trim()){ close(); continue; }
    if(/^\s*([-*+]|\d+[.)])\s|^\s*#{1,6}\s/.test(line)){ close(); cur=[s,e]; if(/^\s*#/.test(line)) close(); continue; }
    if(cur) cur[1]=e; else cur=[s,e];
  }
  close(); return out;
}
const exMerge = rs => { const a=rs.filter(r=>r[1]>r[0]).map(r=>[r[0],r[1]]).sort((x,y)=>x[0]-y[0]), out=[]; for(const r of a){ const l=out[out.length-1]; if(l && r[0]<=l[1]) l[1]=Math.max(l[1],r[1]); else out.push(r); } return out; };
const exMinus = (rs, [a,b]) => rs.flatMap(([s,e])=> e<=a||s>=b ? [[s,e]] : [[s,Math.min(e,a)],[Math.max(s,b),e]].filter(r=>r[1]>r[0]));
const exCovered = (rs, [a,b]) => { let need=a; for(const [s,e] of exMerge(rs)){ if(s>need) break; if(e>need) need=e; if(need>=b) return true; } return need>=b; };
function exText(side){ const n=S.nodes[exUI.id]; return side==='p' ? (n.text||'') : (n.reply||''); }
function exSideHTML(side){
  const text=exText(side), rs=exMerge(exUI[side]); let h='', at=0;
  rs.forEach(([s,e],i)=>{ h+=esc(text.slice(at,s))+`<mark class="exhl" data-exi="${i}">${esc(text.slice(s,e))}</mark>`; at=e; });
  h+=esc(text.slice(at));
  const kept=rs.reduce((x,[s,e])=>x+e-s,0), what=side==='p'?'Your prompt':'Claude’s reply';
  const state = !text ? 'empty' : rs.length ? `${rs.length} part${rs.length===1?'':'s'} · ${kept.toLocaleString()} of ${text.length.toLocaleString()} characters` : `sent whole · ${text.length.toLocaleString()} characters`;
  const hand=exUI.ed[side]!=null;
  return `<section class="exside ${hand?'handed':''}"><div class="exsidehead"><h3>${what}</h3><span class="note">${hand?'you edited what\u2019s included, below':state}</span><span class="bar">${text?`<button class="btn xs" data-exall="${side}">All</button><button class="btn xs" data-exclear="${side}" ${rs.length?'':'disabled'}>Clear</button>`:''}</span></div>
    ${text?`<div class="extext" data-extext="${side}" tabindex="0" aria-label="${what}: select text, then press Enter or the Highlight button to add it">${h}</div>`:'<p class="note">Nothing here.</p>'}</section>`;
}
/* what a side would include from its highlights alone: the pieces, or the whole text when there are none */
function exComputed(side){ const t=exText(side), ps=SM.piecesFrom(t, exUI[side]); return ps.length ? ps.map(p=>p.t).join(SM.JOIN) : t; }
/* the preview: what each side includes, editable. Typing makes it your own wording for that side. */
function exIncludedHTML(side){
  const n=S.nodes[exUI.id]; if(side==='r' && !n.reply) return '';
  const hand=exUI.ed[side]!=null, v=hand ? exUI.ed[side] : exComputed(side), what=side==='p'?'From your prompt':'From Claude\u2019s reply';
  return `<div class="exinc ${hand?'handed':''}" data-exinc="${side}"><div class="exsidehead"><b>${what}</b><span class="note exst">${hand?'edited by you':exUI[side].length?'from your highlights':'the whole text'}</span>${hand?`<button class="linkbtn" data-exback="${side}">Back to highlights</button>`:''}</div>
    <textarea data-exed="${side}" rows="${Math.min(10, Math.max(3, v.split('\n').length+1))}" aria-label="${what}, as it will be included">${esc(v)}</textarea></div>`;
}
function paintExcerpt(){
  const box=exEl().querySelector('.cmpbox'); if(!exUI){ box.innerHTML=''; return; }
  const n=S.nodes[exUI.id];
  box.innerHTML=`<div class="sethead"><div class="cmptitle"><h2 id="exTitle">Excerpt of #${exUI.id}</h2><p class="note">Highlight what the prompts below should get. Drag over any text, or click a paragraph, list item or code block; click a highlight to remove it. A side with nothing highlighted is sent whole.</p></div>
      <div class="bar"><button class="btn" data-excancel>Cancel</button><button class="btn primary" data-exsave>Save excerpt <kbd class="inv">${IS_MAC?'⌘↵':'Ctrl ↵'}</kbd></button></div></div>
    <div class="exbody">${exUI.lost?`<p class="note warn">${exUI.lost} highlighted part${exUI.lost===1?' is':'s are'} no longer in the text and ${exUI.lost===1?'was':'were'} dropped.</p>`:''}
      ${exSideHTML('p')}${n.reply?exSideHTML('r'):''}
      <div class="exfoot"><button class="btn sm" data-exadd title="Adds the text you've selected (for keyboard and touch: select, then press this)">Highlight selection</button></div>
      <section class="exincs"><h3>What\u2019s included</h3><p class="note">This is what the prompts below get. Type here to word it yourself: it\u2019s then marked as edited by you, since it may say what the original didn\u2019t.</p>${exIncludedHTML('p')}${exIncludedHTML('r')}</section></div>`;
}
/* where a point or a selection boundary is, as an offset into a side's text */
function exOffset(box, node, off){ const r=document.createRange(); r.setStart(box,0); r.setEnd(node,off); return r.toString().length; }
function exAddSelection(){
  const s=getSelection(); if(!s || s.isCollapsed || !s.rangeCount) return false;
  const r=s.getRangeAt(0), a=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentElement, b=r.endContainer.nodeType===1?r.endContainer:r.endContainer.parentElement;
  const box=a && a.closest('[data-extext]'); if(!box || !b || b.closest('[data-extext]')!==box) return false;
  const side=box.dataset.extext;
  if(exUI.ed[side]!=null){ s.removeAllRanges(); toast('You\u2019ve worded this side yourself. Choose Back to highlights to use highlights again.'); return true; }
  const s0=exOffset(box, r.startContainer, r.startOffset), e0=exOffset(box, r.endContainer, r.endOffset);
  if(e0<=s0) return false;
  /* a selection that starts or ends inside a word takes the whole word */
  const t=exText(side), w=c=>/[\p{L}\p{N}_]/u.test(c||''); let a0=s0, b0=e0;
  while(a0>0 && w(t[a0-1]) && w(t[a0])) a0--;
  while(b0<t.length && w(t[b0]) && w(t[b0-1])) b0++;
  exUI[side]=exMerge([...exUI[side], [a0,b0]]); s.removeAllRanges(); paintExcerpt(); refocusSide(side); return true;
}
function exClick(e){
  const box=e.target.closest('[data-extext]'); if(!box) return;
  const side=box.dataset.extext, hl=e.target.closest('mark.exhl');
  if(exUI.ed[side]!=null){ toast('You\u2019ve worded this side yourself. Choose Back to highlights to use highlights again.'); return; }
  if(hl){ const rs=exMerge(exUI[side]); rs.splice(+hl.dataset.exi,1); exUI[side]=rs; paintExcerpt(); refocusSide(side); return; }
  let node=null, off=0;
  if(document.caretRangeFromPoint){ const cr=document.caretRangeFromPoint(e.clientX, e.clientY); if(cr){ node=cr.startContainer; off=cr.startOffset; } }
  else if(document.caretPositionFromPoint){ const cp=document.caretPositionFromPoint(e.clientX, e.clientY); if(cp){ node=cp.offsetNode; off=cp.offset; } }
  if(!node || !box.contains(node)) return;
  const at=exOffset(box, node, off), b=exBlocks(exText(side)).find(([s,en])=>at>=s && at<=en); if(!b) return;
  exUI[side] = exCovered(exUI[side], b) ? exMinus(exMerge(exUI[side]), b) : exMerge([...exUI[side], b]);
  paintExcerpt(); refocusSide(side);
}
const refocusSide = side => { const b=exEl().querySelector(`[data-extext="${side}"]`); if(b) b.focus({preventScroll:true}); };
function closeExcerpt(){ exUI=null; closePanel(exEl()); }
function saveExcerpt(){
  if(!exUI) return; const {id, sid}=exUI;
  if(sid!==DB.current || !S.nodes[id]){ closeExcerpt(); return; }
  const n=S.nodes[id], p=SM.piecesFrom(n.text||'', exUI.p), r=SM.piecesFrom(n.reply||'', exUI.r);
  /* a side typed back to exactly what its highlights give isn't really edited */
  const ed={}, edOf={};
  for(const [side, src] of [['p', n.text||''], ['r', n.reply||'']]){ const v=exUI.ed[side]; if(v!=null && v!==exComputed(side)){ ed[side]=v; edOf[side]=h5(src); } }
  closeExcerpt();
  if(!p.length && !r.length && !Object.keys(ed).length){ if(n.send==='excerpt') setSendMode([id], 'full'); toast(`Nothing was highlighted, so #${id} is included in full.`); return; }
  commit(`#${id} included as an excerpt${Object.keys(ed).length?', worded by you':''}`, ()=>{ delete n.skip; n.send='excerpt'; n.ex={p, r, ...(Object.keys(ed).length?{ed, edOf}:{})}; });
}
function initExcerpt(){
  const el=exEl();
  el.addEventListener('click', e=>{
    if(e.target===el || e.target.closest('[data-excancel]')){ closeExcerpt(); return; }
    if(e.target.closest('[data-exsave]')){ saveExcerpt(); return; }
    if(e.target.closest('[data-exadd]')){ if(!exAddSelection()) toast('Select some text in the prompt or the reply first.'); return; }
    const all=e.target.closest('[data-exall]'); if(all){ const sd=all.dataset.exall; exUI[sd]=[[0, exText(sd).length]]; paintExcerpt(); return; }
    const cl=e.target.closest('[data-exclear]'); if(cl){ exUI[cl.dataset.exclear]=[]; paintExcerpt(); return; }
    const bk=e.target.closest('[data-exback]'); if(bk){ exUI.ed[bk.dataset.exback]=null; paintExcerpt(); return; }
  });
  /* typing in what's included makes it your own wording for that side */
  el.addEventListener('input', e=>{
    const t=e.target.closest('[data-exed]'); if(!t || !exUI) return;
    const side=t.dataset.exed, was=exUI.ed[side]!=null;
    exUI.ed[side]=t.value;
    if(!was){ const pos=t.selectionStart; paintExcerpt(); const t2=exEl().querySelector(`[data-exed="${side}"]`); if(t2){ t2.focus({preventScroll:true}); t2.setSelectionRange(pos,pos); } }
  });
  /* a drag adds what it covered; a click with no drag toggles the block under it (or removes a highlight) */
  let down=null;
  el.addEventListener('pointerdown', e=>{ down = e.target.closest('[data-extext]') ? {x:e.clientX, y:e.clientY} : null; });
  el.addEventListener('pointerup', e=>{
    if(!down || !exUI) return; const moved=Math.hypot(e.clientX-down.x, e.clientY-down.y)>4; down=null;
    setTimeout(()=>{ if(!exUI) return; if(exAddSelection()) return; if(!moved) exClick(e); }, 0);
  });
  el.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeExcerpt(); return; }
    if(e.key==='Enter' && (e.metaKey||e.ctrlKey)){ e.preventDefault(); saveExcerpt(); return; }
    if(e.key==='Enter' && e.target.closest('[data-extext]')){ e.preventDefault(); exAddSelection(); }
  });
}
