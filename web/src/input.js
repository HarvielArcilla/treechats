/* The input box: sending a prompt, / commands (/btw, /loop, /rewind…), the command popup, and the model picker. */

/* ---- Commands ----
   Typing / at the start of the input box offers commands, then your saved prompts. A command does something in
   Treechats instead of being sent to Claude. Each maps onto a tool that also has a button, and none of them sends
   anything you can't see: /btw and the /loop check are ordinary requests whose prompts are under Settings › Prompts. */
const COMMANDS=[
  {name:'btw', args:'question', need:true, desc:'Ask a side question. Claude answers from this chat’s context, and nothing is added to the chat unless you keep it.'},
  {name:'loop', args:'[times] [every 10m] prompt [until: condition]', need:true, desc:'Send the same prompt again after each reply: a set number of times, or until a condition is met.'},
  {name:'context', desc:'What your next prompt will send, part by part, and how much of the limit it uses.'},
  {name:'cost', desc:'Tokens and cost of the replies on this line, and in the whole chat.'},
  {name:'model', args:'[quick | default | complex]', desc:'The model for your next replies.', root:true},
  {name:'rewind', desc:'Go back to an earlier prompt on this line and continue from there. What came after stays on its branch.'},
  {name:'compact', desc:'Distill the context into a brief, then start a fresh chat from it. Same as ✦ Distill.'},
  {name:'review', args:'[what to check]', desc:'A fresh chat reviews the last reply. Same as ✦ Review.'},
  {name:'branch', args:'name', need:true, desc:'Rename the branch you’re on, or name a new one from here.'},
  {name:'clear', desc:'Start a new chat. This one stays as it is.', root:true},
  {name:'run', args:'command', need:true, desc:'Run a command in a linked folder (tests, a build, a script) and attach its output to your next prompt. Turn it on in Settings › System.'},
  {name:'diff', args:'[working | staged | last | a commit]', desc:'Attach what changed in a linked folder, from git: not committed (the default), staged, the latest commit, or any commit.'},
  {name:'folder', desc:'Add files from a folder to the project or to your next prompt, or link a folder on this computer.', root:true},
  {name:'memory', desc:'Edit the standing instructions sent at the start of every request, and see the project’s files.', root:true},
  {name:'search', args:'words', need:true, desc:'Find prompts and replies in this project.', root:true},
  {name:'settings', desc:'Open Settings.', root:true},
  {name:'schedule', args:'[prompt]', desc:'Send a prompt at a set time, once or on a schedule, here or as a new chat each time. Without a prompt, lists your scheduled tasks.'},
  {name:'grid', args:'[prompt]', desc:'A comparison grid: one or more wordings against several setups (models, thinking, effort, tools), each its own fork, side by side with cost and time.'},
  {name:'export', desc:'Copy this line as Markdown.'},
  {name:'help', desc:'Every command and what it does.', root:true},
];
function parseCommand(text){
  const m=String(text||'').match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i); if(!m) return null;
  const cmd=COMMANDS.find(c=>c.name===m[1].toLowerCase());
  return cmd ? {cmd, arg:(m[2]||'').trim()} : null;
}
/* the input box's text, or a command run from it */
function submitPrompt(parent, text){
  const c=parseCommand(text.trim());
  if(!c){ addPrompt(parent, text); return; }
  closeSlash();
  if(parent==null && !c.cmd.root){ toast(`/${c.cmd.name} works inside a chat. Start one first.`); return; }
  if(c.cmd.need && !c.arg){ toast(`Write what goes after /${c.cmd.name}: /${c.cmd.name} ${c.cmd.args}`); return; }
  if(parent==null) draftRoot=''; else draft='';
  const box=document.getElementById(parent==null ? 'composeText' : 'contText'); if(box) box.value='';
  runCommand(c.cmd.name, c.arg, parent);
}
let cmdPanel=null;
function runCommand(name, arg, at){
  const ready = () => { if(sampleState==='ready') return true; toast('This needs Claude. Add an API key to .env or sign in to Claude Code, then restart Treechats.'); return false; };
  if(name==='help'){ cmdPanel={kind:'help'}; return paintCmds(at); }
  if(name==='grid'){ openGridBuilder(at, arg||''); return; }
  if(name==='schedule'){ if(arg && arg.trim()) openSchedules(schedFormFor(at, arg.trim())); else openSchedules(); return; }
  if(name==='context'){ cmdPanel={kind:'context', at}; return paintCmds(at); }
  if(name==='cost'){ cmdPanel={kind:'cost', at}; return paintCmds(at); }
  if(name==='model'){
    if(!arg){ toast(`Replies use ${tierLabel(opts.model)}. Choose with /model ${TIERS.map(t=>t[0]).join(' | ')}, or the Model menu.`); return; }
    const low=arg.toLowerCase(), t=TIERS.find(([v,l])=>v===low || l.toLowerCase().startsWith(low));
    if(!t){ toast(`No model called “${arg}”. Choose ${TIERS.map(t=>t[0]).join(', ')}.`); return; }
    opts.model=t[0]; save(); keepDraft(()=>animRender([at])); toast(`Next replies use ${tierLabel(t[0])}.`); return;
  }
  if(name==='btw'){ if(ready()) askSide(at, arg); return; }
  if(name==='loop'){ if(ready()) startLoop(at, arg); return; }
  if(name==='rewind'){ return rewindMenu(at); }
  if(name==='compact'){ if(ready()) openDistill(at); return; }
  if(name==='review'){ if(!ready()) return; if(!S.nodes[at].reply){ toast(`#${at} has no reply to review yet.`); return; } openReview(at); if(arg && reviewAsk){ reviewAsk.text=arg+'\n\n{material}'; animRender([at]); } return; }
  if(name==='branch'){
    const name2=arg.trim();
    if(!NAME_RE.test(name2)){ toast('Use letters, numbers, dots, dashes, slashes or underscores (no spaces).'); return; }
    const onTip = S.head && S.refs[S.head] && S.refs[S.head].tip===at;
    if(onTip) return renameRef(S.head, name2);
    if(namesIn(convOf(at)).has(name2)){ toast(`This chat already has a branch named ${name2}.`); return; }
    commit(`Started branch ${name2} at #${at}`, ()=>{ S.head=newRef(name2, at); });
    return;
  }
  if(name==='clear'){ closeDrawers(); pick=null; composeFor='root'; render(); const t=document.getElementById('composeText'); if(t) t.focus({preventScroll:true}); return; }
  if(name==='folder'){ openFolder('space'); return; }
  if(name==='run'){ chooseRoot(document.getElementById('contText'), root=>startRun(root, arg, at)); return; }
  if(name==='diff'){ chooseRoot(document.getElementById('contText'), root=>attachDiff(root, arg || 'working', at)); return; }
  if(name==='memory'){ openSettings('prompts'); setTimeout(()=>{ const f=document.querySelector('#settings textarea'); if(f) f.focus({preventScroll:true}); }, 50); if(S.files && S.files.length) toast(`This project also sends ${S.files.length} file${S.files.length===1?'':'s'} with every chat (Project files, in the sidebar).`); return; }
  if(name==='settings'){ openSettings(); return; }
  if(name==='search'){ convFilterEl.value=arg; convFilterEl.dispatchEvent(new Event('input', {bubbles:true})); convFilterEl.focus({preventScroll:true}); return; }
  if(name==='export'){ copyText(pathMarkdown(at), true).then(ok=>{ if(ok) toast(`Copied the line up to #${at} as Markdown.`); }); return; }
}
const tierLabel = v => (TIERS.find(t=>t[0]===v)||[v,v])[1].replace(/ \(.*\)/,'');
/* cards above the input box: a side answer, a running loop, and the panels from /help, /context and /cost */
function cmdCardsHTML(forId){
  let h='';
  if(loop && loop.sid===DB.current) h+=loopHTML();
  if(side && side.sid===DB.current) h+=sideHTML();
  if(cmdPanel && (cmdPanel.at==null || S.nodes[cmdPanel.at])) h+=panelHTML(forId);
  return h;
}
function paintCmds(at){ keepDraft(()=>animRender([at ?? sel])); }
function panelHTML(forId){
  const p=cmdPanel, at=p.at ?? forId, close='<button class="rmore" data-cmdclose>Close</button>';
  if(p.kind==='help') return `<div class="fan cmdcard" data-key="cmdhelp"><div class="fanhead"><b>Commands</b><span class="note">type / in the input box</span>${close}</div>
    <table class="cmdtable">${COMMANDS.map(c=>`<tr><td><code>/${c.name}</code>${c.args?` <span class="note">${esc(c.args)}</span>`:''}</td><td>${esc(c.desc)}</td></tr>`).join('')}</table>
    <p class="note">Your saved prompts are listed after the commands. Anything else that starts with / is sent as written.</p></div>`;
  if(p.kind==='run') return runPanelHTML(p);
  if(at==null || !S.nodes[at]) return '';
  if(p.kind==='context'){
    const ents=contextEntries(at), parts=[], add=(label, text, extra='')=>{ if(text) parts.push({label, b:enc?enc.encode(text).length:text.length, t:Math.ceil(text.length/4), extra}); };
    add('System prompt (model settings)', (settingsFor(at).values.system||'').trim());
    add('Standing instructions', promptText('instructions').trim());
    if(S.files && S.files.length){ add(`Project files (${S.files.length})`, S.files.map(fileBlock).join('\n\n')); add('How to show file changes', promptText('fileEdits').trim()); }
    const turns=[]; let pText='', rText='', fText='', seams=0, skipped=0, np=0, nr=0, moded=0;
    for(const e of ents){
      if(e.seam){ seams++; pText+=e.text; continue; }
      const n=S.nodes[e.id]; if(n.kind==='merge') continue;
      if(n.skip && e.id!==at){ skipped++; continue; }
      const fl=(n.files||[]).map(fileBlock).join('\n\n');
      /* as its send mode sends it: a summary, an excerpt or one side counts what actually goes */
      if(n.send && SM.modeOf(n)!=='full'){ const {sent}=sentOf(n); if(sent.user){ pText+=sent.user; np++; } if(sent.reply){ rText+=sent.reply; nr++; } moded++; turns.push({id:e.id, size:sent.user.length+sent.reply.length}); continue; }
      fText+=fl;
      if(n.text){ pText+=n.text; np++; } if(n.reply){ rText+=n.reply; nr++; }
      turns.push({id:e.id, size:(n.text||'').length+(n.reply||'').length+fl.length});
    }
    add(`Your prompts (${np})${seams?` and ${seams} merge note${seams===1?'':'s'}`:''}`, pText);
    add(`Claude’s replies (${nr})`, rText);
    add('Attached files', fText);
    const big=turns.sort((a,b)=>b.size-a.size).slice(0,3).filter(x=>x.size>2000);
    return `<div class="fan cmdcard" data-key="cmdctx"><div class="fanhead"><b>Context from #${at}</b><span class="note">what your next prompt sends, before you type it</span>${close}</div>
      <table class="cmdtable">${parts.map(x=>`<tr><td>${esc(x.label)}</td><td class="num">${fmtSize(x.b)}</td><td class="num">~${x.t.toLocaleString()} tok</td></tr>`).join('')}</table>
      ${meterHTML(turnsFor(at,true))}
      ${skipped?`<p class="note">${skipped} prompt${skipped===1?' is':'s are'} left out and not sent.</p>`:''}
      ${moded?`<p class="note">${moded} turn${moded===1?' is':'s are'} included as a summary, an excerpt or one side only, and counted that way.</p>`:''}
      ${big.length?`<p class="note">Largest turns: ${big.map(x=>`<button class="rmore" data-goto="${x.id}">#${x.id}</button> ${fmtSize(x.size)}`).join(' · ')}. Include one as a summary or an excerpt, or leave it out, to send less.</p>`:''}</div>`;
  }
  if(p.kind==='cost'){
    const sum=ids=>{ const o={n:0, input:0, output:0, cacheRead:0, cacheWrite:0, cost:0, anyCost:false}; for(const x of ids){ const u=S.nodes[x] && S.nodes[x].usage; if(!u) continue; o.n++; o.input+=u.input||0; o.output+=u.output||0; o.cacheRead+=u.cacheRead||0; o.cacheWrite+=u.cacheWrite||0; if(u.cost!=null){ o.cost+=u.cost; o.anyCost=true; } } return o; };
    const root=convOf(at), line=sum(path(at)), chat=sum(all().filter(n=>convOf(n.id)===root).map(n=>n.id));
    const row=(l,o)=>`<tr><td>${l}</td><td class="num">${o.n}</td><td class="num">${o.input.toLocaleString()}${o.cacheRead?` <span class="note">+${o.cacheRead.toLocaleString()} cached</span>`:''}</td><td class="num">${o.output.toLocaleString()}</td><td class="num">${o.anyCost?fmtCost(o.cost):'—'}</td></tr>`;
    return `<div class="fan cmdcard" data-key="cmdcost"><div class="fanhead"><b>Cost</b><span class="note">as each reply reported it</span>${close}</div>
      <table class="cmdtable"><tr class="note"><td></td><td class="num">Replies</td><td class="num">Tokens in</td><td class="num">Out</td><td class="num">Cost</td></tr>${row(`This line, up to #${at}`, line)}${row('The whole chat, every branch', chat)}</table>
      <p class="note">Replies written before Treechats recorded usage, and side questions you didn’t keep, aren’t counted. Cost uses each model’s published price.</p></div>`;
  }
  return '';
}

/* /btw: a side question. It sends the context of the prompt you're on plus the question, shows the answer here,
   and adds nothing to the tree unless you keep it, which makes it a branch with the question and answer. */
let side=null;
async function askSide(at, q){
  if(side && side.ctl) side.ctl.abort();
  const n=S.nodes[at];
  const s={sid:DB.current, at, q, text:'', status:'loading', ctl:new AbortController(), tier:opts.model, sig:ctxSig(at), partial: !!liveGen(at)};
  side=s; cmdPanel=null; paintCmds(at);
  const turns=turnsFor(at, true).concat({role:'user', content:q});
  try{
    const r=await sampleFn(turns, {modelTier:s.tier, cache:false, signal:s.ctl.signal, settings:settingsFor(at).values, onText:({text})=>{ if(side!==s) return; s.text=text; const b=document.querySelector('.sidecard .rbody'); if(b) b.innerHTML=md(text); }});
    if(side!==s) return;
    s.text=r.text; s.usage=r.usage||null; s.model=r.modelTierApplied; s.status='done';
  }catch(e){
    if(side!==s) return;
    s.status = e && e.code==='cancelled' ? (s.text ? 'done' : 'stopped') : 'error'; s.error=errCopy(e && e.code);
  }
  s.ctl=null; if(s.sid===DB.current) paintCmds(s.at);
}
function sideHTML(){
  const s=side;
  const acts = s.status==='loading' ? '<button class="btn" data-sidestop>Stop</button>'
    : `${s.text?`<button class="btn" data-sidekeep title="Adds the question and this answer as a new branch from #${s.at}. You stay where you are.">Keep as a branch</button><button class="btn" data-sidecopy>Copy</button>`:''}<button class="btn" data-sideclose>Close</button>`;
  return `<div class="fan cmdcard sidecard" data-key="side"><div class="fanhead"><b>By the way</b><span class="note">from #${s.at}’s context · not added to the chat</span></div>
    <p class="sideq">${esc(s.q)}</p>
    <div class="rbody">${s.text ? md(s.text) : s.status==='loading' ? '<em class="thinking">Claude is answering…</em>' : ''}</div>
    ${s.status==='error'?`<p class="note">${esc(s.error||'No answer came back.')}</p>`:''}${s.partial?'<p class="note">The reply to #'+s.at+' was still being written, so Claude didn’t see it.</p>':''}${s.usage&&s.usage.cost!=null?`<p class="note">${fmtCost(s.usage.cost)}</p>`:''}
    <div class="bar">${acts}</div></div>`;
}
function keepSide(){
  const s=side; if(!s || !s.text || !S.nodes[s.at] || s.sid!==DB.current) return;
  const nid=S.nextId; let name='';
  commit('', ()=>{
    S.nextId++; S.nodes[nid]={id:nid, parents:[s.at], text:s.q, reply:s.text, btw:true};
    if(s.sig) S.nodes[nid].ctx=s.sig; if(s.usage) S.nodes[nid].usage=s.usage; if(s.model) S.nodes[nid].model=s.model;
    name=slugName('btw', convOf(s.at)); newRef(name, nid);
  }, {quiet:true});
  side=null; paintCmds(s.at);
  toast(`Kept the side question as #${nid} on a new branch, ${name}.`, true, {label:'Go to it', fn:()=>{ simpleTip=null; select(nid); }});
}

/* /loop: sends the same prompt again after each reply. It stops after a set number of times, when an optional
   condition is met (one quick request after each reply asks whether it is, and the answer is noted under that
   reply), or when you stop it. With "every", it waits between sends, for as long as Treechats stays open. */
let loop=null, loopSeq=0;
function parseLoop(arg){
  let rest=arg.trim(), times=null, every=null, until=null, m;
  if((m=rest.match(/(?:^|\s)until:\s*([\s\S]+)$/i))){ until=m[1].trim(); rest=rest.slice(0, m.index).trim(); }
  for(;;){
    if(times==null && (m=rest.match(/^(\d{1,3})\s*(?:x|times)?\s+/i))){ times=+m[1]; rest=rest.slice(m[0].length); continue; }
    if(every==null && (m=rest.match(/^(?:every\s+)?(\d+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)\b\s*/i))){ const k=m[2][0].toLowerCase(); every=+m[1]*(k==='s'?1e3:k==='m'?6e4:36e5); rest=rest.slice(m[0].length); continue; }
    break;
  }
  return {prompt:rest.trim(), times, every, until};
}
const fmtDur = ms => ms>=36e5 && ms%36e5===0 ? `${ms/36e5} h` : ms>=6e4 && ms%6e4===0 ? `${ms/6e4} min` : `${Math.round(ms/1000)} s`;
function startLoop(at, arg){
  if(loop){ toast('A loop is already running. Stop it before starting another.'); return; }
  const p=parseLoop(arg);
  if(!p.prompt){ toast('Say what to send: /loop 3 Make it shorter, or /loop Improve it until: under 100 words.'); return; }
  if(p.every!=null && p.every<10e3){ toast('Wait at least 10 seconds between sends.'); return; }
  const times=Math.min(50, Math.max(1, p.times ?? (p.every ? 12 : p.until ? 10 : 3)));
  const L={id:++loopSeq, sid:DB.current, tip:at, prompt:p.prompt, times, every:p.every, until:p.until, done:0, status:'starting', stop:false};
  loop=L; cmdPanel=null;
  runLoop(L).catch(e=>{ L.end=`Loop stopped: ${e && e.message || e}`; }).finally(()=>{
    if(loop===L) loop=null;
    if(L.sid===DB.current) paintCmds(sel);
    toast(L.end || `Loop finished after ${L.done} of ${L.times}.`);
  });
}
function loopApply(L, fn, msg){
  let out;
  if(L.sid===DB.current){
    const follow = sel===L.tip || composeParent()===L.tip;
    if(msg) commit(msg, ()=>{ out=fn(); if(out!=null && follow){ sel=out; if(opts.simple) simpleTip=null; } }, {quiet:true});
    else { out=fn(); save(); render(); }
  } else { out=withTree(treeOf(L.sid), fn); save(); }
  return out;
}
function loopSleep(L, ms){
  return new Promise(res=>{
    L.next=Date.now()+ms;
    const tick=setInterval(()=>{ if(L.stop){ clearInterval(tick); clearTimeout(L.timer); res(false); return; } const el=document.querySelector('.loopbar .loopwhen'); if(el) el.textContent=loopWhen(L); }, 1000);
    L.wake=()=>{ clearInterval(tick); clearTimeout(L.timer); res(!L.stop); };
    L.timer=setTimeout(()=>{ clearInterval(tick); res(!L.stop); }, ms);
  });
}
function loopWhen(L){
  if(L.status==='waiting'){ const s=Math.max(0, Math.round((L.next-Date.now())/1000)); return `Next send in ${s>=60?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:`${s} s`}`; }
  if(L.status==='sending') return `Waiting for the reply to #${L.cur}…`;
  if(L.status==='checking') return `Checking whether the condition is met…`;
  return 'Starting…';
}
async function runLoop(L){
  const t=()=>treeOf(L.sid);
  while(!L.stop){
    if(L.done>=L.times){ L.end=`Loop finished: sent ${L.times} time${L.times===1?'':'s'}.`; return; }
    if(!t() || !t().nodes[L.tip]){ L.end='Loop stopped: the prompt it was continuing from was deleted.'; return; }
    if(L.done>0 && L.every){ L.status='waiting'; paintLoop(L); if(!await loopSleep(L, L.every)) break; }
    const i=L.done+1;
    const nid=loopApply(L, ()=>{
      const nid=Ops.addTurn(S, L.tip, L.prompt); S.nodes[nid].loop={id:L.id, i, of:L.times, ...(L.until?{until:L.until}:{})};
      Ops.extend(S, L.tip, nid, true);
      return nid;
    }, `Loop: sent ${i} of ${L.times}`);
    L.cur=nid; L.status='sending'; paintLoop(L);
    const wait=awaitReply(L.sid, nid); wantReplies([nid], L.sid);
    const res=await wait;
    if(res.error){ L.end=`Loop stopped at #${nid}: ${res.error}`; return; }
    L.tip=nid; L.done=i;
    if(L.until && !L.stop){
      L.status='checking'; paintLoop(L);
      const c=await loopCheck(L, nid);
      loopApply(L, ()=>{ const n=S.nodes[nid]; if(n) n.loopCheck=c; return null; }, null);
      if(c.met){ L.end=`Loop finished after ${i}: the condition is met. ${c.why||''}`.trim(); return; }
    }
  }
  L.end=`Loop stopped after ${L.done} of ${L.times}.`;
}
function loopCheck(L, id){ return Ops.loopCheck(opsIo(), treeOf(L.sid), L.until, id); }
function paintLoop(L){ if(L.sid!==DB.current) return; const el=document.querySelector('.loopbar'); if(el) el.outerHTML=loopHTML(); else paintCmds(sel); }
function loopHTML(){
  const L=loop;
  return `<div class="fan cmdcard loopbar" data-key="loop"><div class="fanhead"><b>Loop · ${L.done} of ${L.times} sent</b><span class="note loopwhen">${loopWhen(L)}</span><button class="rmore" data-loopstop title="Nothing more is sent. A reply already on its way still arrives.">Stop</button></div>
    <p class="note">Sending “${esc(clip(L.prompt, 140))}”${L.until?`, until: ${esc(clip(L.until, 120))}`:''}${L.every?`, every ${fmtDur(L.every)} while Treechats is open`:''}.</p></div>`;
}
function stopLoop(){ const L=loop; if(!L) return; L.stop=true; if(L.wake) L.wake(); paintLoop(L); }

/* /rewind: the prompts on this line, newest first. Choosing one continues from it, so what you send next forks
   there; what came after stays on its branch, one ‹ › away. */
function rewindMenu(at){
  const box=document.getElementById('contText'); if(!box) return;
  const line=chain(at).filter(x=>S.nodes[x].kind!=='merge').reverse().slice(1);
  if(!line.length){ toast('This is the first prompt of the chat, so there’s nothing to go back to.'); return; }
  openMenu(box, [{heading:'Continue from'}, ...line.slice(0, 30).map(x=>({label:`#${x} · ${clip(plainText(S.nodes[x].text||'').replace(/\s+/g,' '), 60)}`, run:()=>rewindTo(x)}))]);
}
function rewindTo(id){
  if(!S.nodes[id]) return;
  if(opts.simple){ sel=id; simpleTip=id; setActivePath(id); render(); }
  else select(id);
  const t=document.getElementById('contText'); if(t) t.focus({preventScroll:true});
  toast(`Continuing from #${id}. What you send next starts a new branch; what came after stays on its own.`);
}

/* the list that opens under the input box while you type a command */
let slash=null;
function slashItems(q, root){
  const low=q.toLowerCase(), out=[];
  for(const c of COMMANDS) if((!root || c.root) && c.name.startsWith(low)) out.push({cmd:c});
  if(low.length) for(const c of COMMANDS) if((!root || c.root) && !c.name.startsWith(low) && fuzzy(low, c.name+' '+c.desc)>0) out.push({cmd:c});
  const saved=savedPrompts().filter(sp=>!low || fuzzy(low, sp.name)>0).slice(0, 8);
  if(saved.length) out.push({heading:'Saved prompts'}, ...saved.map(sp=>({saved:sp})));
  return out;
}
function updateSlash(box){
  const v=box.value, root=box.id==='composeText';
  let items=null, hint=false;
  const m=v.match(/^\/([a-z]*)$/i);
  if(m) items=slashItems(m[1], root);
  else { const m2=v.match(/^\/([a-z]+)\s/i), c=m2 && COMMANDS.find(x=>x.name===m2[1].toLowerCase()); if(c && c.args && !v.includes('\n')){ items=[{cmd:c}]; hint=true; } }
  if(!items || !items.some(x=>!x.heading)){ closeSlash(); return; }
  const keep = slash && slash.box===box && !hint ? slash.i : 0;
  slash={box, items, hint, i:Math.min(keep, items.length-1)};
  if(slash.items[slash.i].heading) slash.i=slash.items.findIndex(x=>!x.heading);
  paintSlash();
}
function paintSlash(){
  const s=slash; let el=document.getElementById('slashPop');
  if(!el){ el=document.createElement('div'); el.id='slashPop'; el.className='slashpop'; el.setAttribute('role','listbox'); el.addEventListener('pointerdown', e=>e.preventDefault()); el.addEventListener('click', e=>{ const b=e.target.closest('[data-slashi]'); if(b && slash){ slash.i=+b.dataset.slashi; acceptSlash(true); } }); document.body.append(el); }
  el.innerHTML = s.items.map((x,i)=>x.heading ? `<div class="mh">${esc(x.heading)}</div>`
    : x.cmd ? `<button type="button" role="option" data-slashi="${i}" class="${i===s.i?'on':''}" aria-selected="${i===s.i}"><code>/${x.cmd.name}</code>${x.cmd.args?`<span class="sargs">${esc(x.cmd.args)}</span>`:''}<span class="sdesc">${esc(x.cmd.desc)}</span></button>`
    : `<button type="button" role="option" data-slashi="${i}" class="${i===s.i?'on':''}" aria-selected="${i===s.i}"><b>${esc(x.saved.name)}</b><span class="sdesc">${esc(clip(x.saved.text.replace(/\s+/g,' '), 90))}</span></button>`).join('')
    + (s.hint ? '' : '<p class="shelp">↑↓ to choose · Tab to fill in · Enter to run</p>');
  const r=s.box.getBoundingClientRect(), w=Math.min(Math.max(Math.min(r.width, 620), 360), innerWidth-16);
  el.style.width=w+'px'; el.style.left=Math.max(8, Math.min(r.left, innerWidth-w-8))+'px';
  const h=el.offsetHeight, above=r.top-6-h;
  el.style.top=(above>8 && (r.bottom+6+h>innerHeight-8 || opts.simple) ? above : Math.min(r.bottom+6, innerHeight-h-8))+'px';
  const on=el.querySelector('.on'); if(on) on.scrollIntoView({block:'nearest'});
}
function closeSlash(){ slash=null; const el=document.getElementById('slashPop'); if(el) el.remove(); }
function moveSlash(d){ const s=slash, n=s.items.length; let i=s.i; do{ i=(i+d+n)%n; } while(s.items[i].heading); s.i=i; paintSlash(); }
/* run: Enter or a click; otherwise Tab, which only fills in */
function acceptSlash(run){
  const s=slash; if(!s) return false; const x=s.items[s.i], box=s.box; if(!x) return false;
  if(x.saved){ box.value=''; closeSlash(); insertSaved(box, x.saved); return true; }
  if(s.hint) return false; /* the command is typed with its words: Enter sends it */
  const c=x.cmd;
  if(run && !c.need){ const parent = box.id==='composeText' ? null : composeParent(); box.value='/'+c.name; submitPrompt(parent, '/'+c.name); return true; }
  box.value='/'+c.name+' '; box.dispatchEvent(new Event('input', {bubbles:true})); box.focus({preventScroll:true}); box.setSelectionRange(box.value.length, box.value.length);
  return true;
}
function composerHTML(forId){
  if(forId!=='root' && variants) return variantsHTML(forId);
  if(forId==='root') return `<div class="composer root">
    ${cmdCardsHTML(null)}
    <textarea id="composeText" placeholder="First prompt of a new chat (type / for commands)" aria-label="First prompt">${esc(draftRoot)}</textarea>
    ${fileChips(pendingFiles, true, 'p')}
    <div class="bar"><button class="btn primary" data-compose="add-root">Start chat <kbd class="inv">${sendKbd()}</kbd></button><button class="btn" data-attach aria-haspopup="menu" title="Attach text, code or image files, or files from a folder. You can also drop or paste files.">Attach ▾</button><button class="btn" data-savedmenu="composeText" aria-haspopup="menu" title="Insert one of your saved prompts (or type / in the box)">Saved prompts</button>${vRoots().length?'<button class="btn" data-compose="cancel-root">Cancel</button>':''}${modelPicker('modelSelRoot')}${toolsPicker()}</div>
    <p class="note">${sendNote()} Have a chat elsewhere? <button class="rmore" data-openimport>Import it</button>.</p></div>`;
  const onTip = S.head && S.refs[S.head] && S.refs[S.head].tip===forId;
  const here = refsAt(forId);
  const which = here.length>1
    ? `<select id="headSel" aria-label="Branch to continue on">${here.map(rid=>`<option value="${rid}" ${rid===S.head?'selected':''}>${esc(refName(rid))}</option>`).join('')}</select>`
    : `<b>${esc(refName(S.head))}</b>`;
  pruneAlso();
  const label = onTip ? `Continue on ${which} <button class="rmore" data-renamehead>Rename</button>`
    : `Continue from #${forId}: ${vKids(forId).length?'forks here and starts':'starts'} <b>${esc(autoName(convOf(forId)))}</b>`;
  const many = alsoTargets.size>0;
  const also = many
    ? `<div class="alsobar"><span class="fchip">#${forId}</span>${[...alsoTargets].map(x=>`<span class="fchip">#${x}<button class="fx" data-unalso="${x}" aria-label="Don\u2019t reply to #${x}">×</button></span>`).join('')}<button class="rmore" data-alsopick>+ Add more</button><button class="rmore" data-alsocompare title="Read these prompts and their replies side by side, with ✦ Judge and ✦ Combine">Compare these</button><button class="rmore" data-alsoclear>Clear</button></div>`
    : `<p class="note alsohint"><button class="rmore" data-alsopick title="Send this message to other prompts too, each in its own branch">Reply to several…</button> or Ctrl/⌘-click other prompts to send this to them too (Shift-click selects a stretch of the line). <button class="rmore" data-variants title="${esc(OPS.variants.hint)}">Variants…</button></p>`;
  return `<div class="composer">
    <p class="contLabel">${many ? `Reply to <b>${alsoTargets.size+1} prompts</b>, each in its own branch` : label}</p>
    ${also}
    ${cmdCardsHTML(forId)}
    <textarea id="contText" placeholder="Your next prompt (type / for commands)" rows="2" aria-label="Next prompt">${esc(draft)}</textarea>
    ${fileChips(pendingFiles, true, 'p')}
    <div class="bar"><button class="btn primary" data-compose="cont">${alsoTargets.size?`Send to ${alsoTargets.size+1}`:'Send'} <kbd class="inv">${sendKbd()}</kbd></button><button class="btn" data-attach aria-haspopup="menu" title="Attach text, code or image files, or files from a folder. You can also drop or paste files.">Attach ▾</button><button class="btn" data-savedmenu="contText" aria-haspopup="menu" title="Insert one of your saved prompts (or type / in the box)">Saved prompts</button>${modelPicker()}${toolsPicker()}${meterHTML(turnsFor(forId,true), true)}</div>
    ${replyBusy(forId)?'<p class="note">You can send now. Claude answers it as soon as the reply above is done.</p>':''}
    ${sampleState==='off'?'<p class="note">To get replies, add an API key to .env or sign in to Claude Code (run claude once), then restart Treechats. Prompts still get added.</p>':''}</div>`;
}
function modelPicker(id='modelSel'){
  return `<label class="model"><span>Model</span><select id="${id}" data-model>${TIERS.map(([v,l])=>`<option value="${v}" ${opts.model===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
}
