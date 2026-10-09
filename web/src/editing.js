/* Editing a prompt or a reply where it is, and Edit & resend. */

/* Editing a reply: fix what Claude said, so everything below builds on the corrected version. Undo brings the original back. */
let replyEditFor=null, promptEditFor=null;
/* Editing a prompt where it is. "Send" (the only choice in Chat view, as in any chat) makes a new version that
   Claude answers, keeping the original and its reply one ‹ › away. "Save in place" just changes the text. */
function openPromptEdit(id){
  if(!S.nodes[id] || S.nodes[id].kind==='merge') return;
  if(sel!==id) select(id);
  promptEditFor=id; replyEditFor=null; resendFor=null;
  animRender([id]);
  const t=document.getElementById('promptEditText'); if(t){ t.focus({preventScroll:true}); t.setSelectionRange(t.value.length, t.value.length); }
}
function finishPromptEdit(how){
  const id=promptEditFor, t=document.getElementById('promptEditText');
  const n=S.nodes[id]; promptEditFor=null;
  if(!n || !t || how==='cancel'){ animRender([id]); return; }
  const v=t.value;
  if(!v.trim()){ promptEditFor=id; toast('Write a prompt first.'); return; }
  if(how==='resend' && sampleState==='ready'){ regenerate(id, v); return; }
  if(v===n.text){ animRender([id]); return; }
  commit(`Edited #${id} in place. Its reply and the prompts below stay as they were.`, ()=>{ n.text=v; if(n.reply) n.stale=true; });
}
function replyEditHTML(id){
  const n=S.nodes[id];
  return `<div class="reply resend" data-key="r${id}"><span class="who">Edit Claude’s reply</span>
    <textarea id="replyEditText" rows="${Math.min(18, Math.max(4, (n.reply||'').split('\n').length+1))}" aria-label="Claude’s reply">${esc(n.reply||'')}</textarea>
    <div class="bar"><button class="btn primary" data-replyedit="save">Save <kbd class="inv">${IS_MAC?'⌘↵':'Ctrl ↵'}</kbd></button><button class="btn" data-replyedit="cancel">Cancel</button></div>
    <p class="note">Prompts below this one will see your version. It’s marked as edited, and Undo brings back the original.</p></div>`;
}
function openReplyEdit(id){ replyEditFor=id; resendFor=null; if(sel!==id) select(id); else animRender([id]); const t=document.getElementById('replyEditText'); if(t){ t.focus({preventScroll:true}); t.setSelectionRange(t.value.length,t.value.length); } }
function saveReplyEdit(){
  const id=replyEditFor, t=document.getElementById('replyEditText'); replyEditFor=null;
  const n=S.nodes[id]; if(!n || !t){ animRender([id]); return; }
  const v=t.value;
  if(v===(n.reply||'')){ animRender([id]); return; }
  commit(`Edited Claude’s reply to #${id}. Prompts below see your version.`, ()=>{ if(v.trim()){ n.reply=v; n.replyEdited=true; } else { delete n.reply; delete n.replyEdited; } });
}
/* Edit & resend, as in Claude: the edited prompt becomes a new version beside the original, which keeps its reply */
let resendFor=null;
function resendHTML(id){
  const n=S.nodes[id];
  return `<div class="reply resend" data-key="r${id}"><span class="who">Edit prompt</span>
    <textarea id="resendText" rows="3" aria-label="Edited prompt">${esc(n.text)}</textarea>
    ${fileChips(n.files, false, 'n'+id)}
    <div class="bar"><button class="btn primary" data-resend="go">Send on a new branch <kbd class="inv">${sendKbd()}</kbd></button><button class="btn" data-resend="cancel">Cancel</button></div>
    <p class="note">The original prompt and its reply stay on their branch. Switch between them with ‹ ›.</p></div>`;
}
