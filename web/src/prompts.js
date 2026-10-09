/* Every piece of text Treechats sends on your behalf (Settings › Prompts), and your saved prompts. */

/* Every piece of text the app sends on your behalf. Each can be edited and reset to its default. */
const PROMPTS = {
  instructions:{label:'Standing instructions', group:'every', def:'', help:'Sent at the start of every request, ahead of the first prompt. Empty sends nothing.',
    placeholder:'For example: This chat comes from a branching tool. Treat earlier replies as your own and answer naturally.'},
  seam:{label:'Merge note', group:'ops', def:SEAM, help:'Sent just before the turns a merge brings in.'},
  summarize:{label:'Summary request', group:'ops', def:'Summarize the conversation below so the summary can stand in for it as context when the discussion continues. Keep decisions, key facts, names, code identifiers and open questions. Write a brief recap in plain prose, under 150 words, with no preamble.\n\n{conversation}',
    help:'What Claude is asked when it writes a summary for Reroot or Squash. {conversation} becomes the turns being summarized.'},
  distill:{label:'Distill request', group:'tools', def:Ops.PROMPTS.distill.def,
    help:'What Claude is asked when you distill a chat into a brief. {conversation} becomes the context up to the prompt you picked.'},
  fan:{label:'Fan out: reading the options', group:'tools', def:Ops.PROMPTS.fan.def,
    help:'What Claude is asked when you fan out a reply. {message} becomes your prompt and {reply} Claude\u2019s reply.',
    fmt:Ops.PROMPTS.fan.fmt},
  wordings:{label:'Variants: suggesting wordings', group:'tools', def:'Rewrite the message below 3 different ways that a person might send it to an assistant. Keep the same request and meaning; vary the wording, framing or level of detail so the replies could reasonably differ.\n\nMessage:\n{message}',
    help:'What Claude is asked by Suggest wordings. {message} becomes the first variant.', fmt:'Reply with only a JSON array of strings.'},
  nameBranch:{label:'Naming branches', group:'naming', def:'Name a branch of a conversation, the way a developer names a git branch: 1 to 3 lowercase words joined by hyphens, at most 24 characters, saying what this branch explores.\n\n{branch}\n\nNames already used here: {used}',
    help:'{branch} becomes the prompt the branch follows, its own prompt and the start of its reply. {used} becomes the names already taken.', fmt:'Reply with only JSON: {"name":"token-bucket"}'},
  nameConv:{label:'Naming chats', group:'naming', def:'Write a short title for a conversation, at most 6 words, no quotes and no ending punctuation, the way a chat app titles a conversation.\n\n{conversation}',
    help:'{conversation} becomes the first message and the start of the first reply.', fmt:'Reply with only JSON: {"title":"Rate limiter design"}'},
  nameSpace:{label:'Naming projects', group:'naming', def:'Name a workspace that holds these conversations, in 1 to 4 words, no quotes.\n\nConversations:\n{titles}',
    help:'{titles} becomes the titles of up to six chats in the project.', fmt:'Reply with only JSON: {"name":"API rate limiting"}'},
  replayCheck:{label:'Replay: does the next prompt still fit?', group:'tools', def:Ops.PROMPTS.replayCheck.def,
    help:'Sent before each prompt after the first when you replay, unless checks are off. {conversation} becomes the latest turns, {original} the reply the prompt was first written after, {message} the prompt.',
    fmt:Ops.PROMPTS.replayCheck.fmt},
  loopCheck:{label:'Loop: is the condition met?', group:'tools', def:Ops.PROMPTS.loopCheck.def,
    help:'Sent after each reply of a /loop that has an until: condition. {condition} becomes the condition, {conversation} the latest turns.',
    fmt:Ops.PROMPTS.loopCheck.fmt},
  fileEdits:{label:'How to show file changes', group:'every', def:Core.DEFAULTS.fileEdits,
    help:'Sent with the project files, when a project has any, so Claude writes changes in a form Treechats can show as a diff. Empty sends nothing; code blocks are still recognized when Claude names the file.'},
  judge:{label:'Compare: judging the follow-ups', group:'tools', def:Ops.PROMPTS.judge.def,
    help:'What Claude is asked by ✦ Judge in Compare. {criteria} becomes what you typed, {conversation} the context up to the prompt they follow, {alternatives} each follow-up with its reply.',
    fmt:Ops.PROMPTS.judge.fmt},
  gridScore:{label:'Grid: scoring the replies', group:'tools', def:"You are scoring alternative replies in a branching conversation. Below is the conversation up to the point where it branched, then each alternative: a follow-up message and the reply to it, labelled with its number. You are not told how each reply was produced; judge only what is written.\n\nScore every reply from 1 to 10 against these criteria: {criteria}\n\nThe conversation up to the branch point:\n{conversation}\n\nThe alternatives:\n{alternatives}",
    help:'What Claude is asked by Score in a comparison grid. {criteria} becomes what you typed, {conversation} the context up to the prompt the grid follows, {alternatives} each follow-up with its reply.',
    fmt:'Reply with only JSON: {"scores":{"#12":{"score":8,"why":"One sentence."},"#14":{"score":6,"why":"One sentence."}},"best":"#12","summary":"One or two sentences on the choice."}\nUse the labels exactly as given, score every alternative with a whole number from 1 to 10, and keep each reason to one sentence.'},
  combine:{label:'Compare: combining the follow-ups', group:'tools', def:Ops.PROMPTS.combine.def,
    help:'What Claude is asked by ✦ Combine in Compare. {instructions} becomes what you typed, {conversation} the context up to the prompt they follow, {alternatives} each follow-up with its reply.',
    fmt:Ops.PROMPTS.combine.fmt},
  review:{label:'Review: second opinion', group:'tools', def:Ops.PROMPTS.review.def,
    help:'The first prompt of the new chat ✦ Review starts. {material} becomes the prompt and reply being reviewed, or the whole conversation up to it if you include it.'},
  summarizeReply:{label:'Summary: writing it', group:'send', def:TreechatsSend.DEFAULTS.summarizeReply, help:'What Claude is asked when a turn is included as a summary. {prompt} becomes the prompt, {reply} the reply it summarizes.'},
  sendSummary:{label:'Summary: how it’s sent', group:'send', def:TreechatsSend.DEFAULTS.sendSummary, help:'Sent in place of the reply of a turn included as a summary. {summary} becomes the summary.'},
  sendExcerptPrompt:{label:'Excerpt: the prompt', group:'send', def:TreechatsSend.DEFAULTS.sendExcerptPrompt, help:'Sent in place of a prompt with highlighted parts. {excerpt} becomes the parts, each separated by a blank line. Add a note around it if you want Claude told it’s an excerpt.'},
  sendExcerptReply:{label:'Excerpt: the reply', group:'send', def:TreechatsSend.DEFAULTS.sendExcerptReply, help:'Sent in place of a reply with highlighted parts. {excerpt} becomes the parts, each separated by a blank line. Add a note around it if you want Claude told it’s an excerpt.'},
  sendNoReply:{label:'Prompt only: where the reply was', group:'send', def:TreechatsSend.DEFAULTS.sendNoReply, help:'Sent in place of the reply of a turn included as its prompt only, so Claude knows one was there. Empty sends nothing.'},
  sendNoPrompt:{label:'Reply only: where the prompt was', group:'send', def:TreechatsSend.DEFAULTS.sendNoPrompt, help:'Sent in place of the prompt of a turn included as its reply only. Empty sends nothing.'},
  reroot:{label:'Reroot summary', group:'ops', def:'Summary of cut context: {context}', help:'Text of the summary root a reroot adds. {context} becomes the cut prompts, joined with arrows.'}
};
/* ---- Saved prompts ----
   Your prompt library: plain text you insert into the input box, never sent until you send it. Words in {braces} are
   placeholders: what you've already typed goes into the first one, and the next one left is selected for you to fill
   in. The starters are common ways of working with a model, written out so you can see and change them. */
const SAVED_STARTERS=[
  {id:'plan', name:'Plan first', text:'Before you answer, outline your plan in a few bullet points and wait for me to confirm it.\n\n{task}'},
  {id:'interview', name:'Ask me questions first', text:'Before you start, ask me the questions you need answered to do this well, as one short list.\n\n{task}'},
  {id:'improve', name:'Improve my prompt', text:'Rewrite the prompt below so it is clearer and more specific, keeping my intent. Reply with only the rewritten prompt.\n\n{prompt}'},
  {id:'critique', name:'Critique your answer', text:'Critique your last answer: what is wrong, missing or weakly supported? Be specific, then give a corrected version.'},
  {id:'simpler', name:'Explain more simply', text:'Explain that again more simply, as if I am new to the topic, with one concrete example.'},
  {id:'steps', name:'Step by step', text:'Work through this step by step, then give the final answer on its own line.\n\n{task}'},
  {id:'where', name:'Where are we?', text:'Summarize where we are: decisions made, open questions, and the next step.'},
];
const savedPrompts = () => Array.isArray(opts.saved) ? opts.saved : [];
/* puts a saved prompt into a box: what's typed fills its first placeholder (or goes before it), then the next
   placeholder is selected */
function insertSaved(t, sp){
  const typed=t.value.trim();
  let text=sp.text;
  const ph=text.match(/\{[a-z][a-z _-]*\}/i);
  if(typed) text = ph ? text.replace(ph[0], typed) : typed+'\n\n'+text;
  t.value=text; t.dispatchEvent(new Event('input', {bubbles:true})); t.focus({preventScroll:true});
  const next=text.match(/\{[a-z][a-z _-]*\}/i);
  if(next){ const i=text.indexOf(next[0]); t.setSelectionRange(i, i+next[0].length); } else t.setSelectionRange(text.length, text.length);
}
function savedMenu(anchor, t){
  if(!t) return;
  const list=savedPrompts();
  openMenu(anchor, [
    ...(list.length ? [{heading:'Saved prompts'}, ...list.map(sp=>({label:sp.name, run:()=>insertSaved(t, sp)}))] : [{label:'No saved prompts yet', disabled:true}]),
    {sep:true},
    {label:'Save what’s typed as a prompt', disabled:!t.value.trim() || t.value.trim()==='/', run:()=>{ const text=t.value.trim(); opts.saved=[...savedPrompts(), {id:'u'+Date.now().toString(36), name:clip(text.replace(/\s+/g,' '),40), text}]; save(); toast('Saved. Rename it or add {placeholders} in Settings › Saved prompts.', false, {label:'Open', fn:()=>openSettings('saved')}); }},
    {label:'Manage saved prompts…', run:()=>openSettings('saved')}
  ]);
}
const promptText = k => opts.prompts && opts.prompts[k]!=null ? opts.prompts[k] : PROMPTS[k].def;
/* A prompt with its {placeholders} filled. A value whose placeholder was edited out is added at the end, so Claude
   always gets the material. Tools that need a set answer shape get it appended, since Treechats reads the answer. */
function fillPrompt(k, vars, tpl){ return Ops.fill(tpl ?? promptText(k), vars, PROMPTS[k].fmt); }
