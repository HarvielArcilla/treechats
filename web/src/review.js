/* ✦ Review: a second opinion from a new chat that sees only what you include. */

/* ---- ✦ Review: a second opinion ----
   Starts a new chat that sees only what you include: the prompt and its reply, or the whole conversation up to it.
   A reviewer that didn't write the answer has no reason to defend it. The first prompt is the review prompt (editable
   here and in Settings › Prompts) with that material filled in, so the review chat shows exactly what was sent. The
   reply and its review link to each other. */
let reviewAsk=null;
function reviewMaterial(id, whole){ return Ops.reviewMaterial(S, coreEnv(), id, whole); }
/* adds the review chat to the tree in S; returns its first prompt */
function addReviewChat(id, whole, instructions, by){ return Ops.addReviewChat(S, coreEnv(), id, whole, instructions, by, promptText('review')); }
const reviewsOf = id => all().filter(n=>n.reviewOf && n.reviewOf.id===id);
function openReview(id){
  if(sampleState!=='ready'){ toast('Review needs Claude. Add an API key or sign in to Claude Code, then restart Treechats.'); return; }
  reviewAsk={id, whole:false, text:promptText('review')}; distill=null; fan=null;
  if(sel!==id) select(id); else animRender([id]);
  const el=treeEl.querySelector('.fan.review'); if(el) el.scrollIntoView({block:'nearest', behavior: Motion.reduced()?'auto':'smooth'});
}
function reviewHTML(){
  const r=reviewAsk;
  return `<div class="fan review" data-key="rv${r.id}"><div class="fanhead"><b>${AI}Review</b><span class="note">a new chat, 1 request</span><button class="rmore" data-rvcancel>Cancel</button></div>
    <p class="note">A second opinion from a chat that didn’t write this reply. It sees only what you include.</p>
    <div class="segs" role="group" aria-label="What the reviewer sees"><button class="seg" data-rvwhole="0" aria-pressed="${!r.whole}">This prompt and reply</button><button class="seg" data-rvwhole="1" aria-pressed="${r.whole}">The whole conversation up to it</button></div>
    <label class="flabel" for="reviewText">What to ask the reviewer <span class="flhint">{material} becomes what you include</span></label>
    <textarea id="reviewText" rows="4">${esc(r.text)}</textarea>
    <div class="bar"><button class="btn primary" data-rvgo>${AI}Start review</button><button class="btn" data-rvcancel>Cancel</button></div></div>`;
}
function startReview(){
  const r=reviewAsk; if(!r) return;
  const t=document.getElementById('reviewText'); if(t) r.text=t.value;
  let nid;
  commit(`Started a review of #${r.id} in a new chat`, ()=>{ nid=addReviewChat(r.id, r.whole, r.text); });
  reviewAsk=null;
  wantReplies([nid]);
  animRender([r.id]);
}
/* where a reply's reviews are, and what a review chat reviews */
function reviewLinksHTML(id){
  const rs=reviewsOf(id); if(!rs.length) return '';
  return `<span class="rvlinks">${rs.map(n=>`<button class="linkbtn" data-goto="${n.id}" title="Open the review chat">${AI}Review #${n.id} ↗</button>`).join('')}</span>`;
}
