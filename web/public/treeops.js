/* Treechats operations: the tree helpers and the ✦ tools that both the page and the server use.

   The page uses them for what you do (Replay, Compare's Judge and Combine, ✦ Review, /loop, Fan out); the server uses
   them for what agents do over MCP. One definition each, so an agent's replay or judge works exactly like yours.

   Everything takes the tree it works on (t) explicitly. Tree helpers take an optional index (ix: the page's per-redraw
   graph cache) so the page stays fast. The ✦ tools take an io with what differs between the page and the server:
   - io.tpl(key)              the wording of a request (Settings › Prompts), else its default here
   - io.env(t)                the core's env for building context in t (treecore.js)
   - io.sample(input, o)      a request to Claude: {text, ...}; io.json(input, o) the reply parsed as JSON
   - io.model                 the tier tools use (the model picked in the page)
   - io.apply(fn, msg)        make a change: fn(t) edits the tree the operation works in, returns what fn returns
   - io.ask(sid, id)          get a reply to a prompt: resolves to {reply, note} or {error}
   Loaded by the page as a plain script (after treecore.js) and imported by the server. Sets globalThis.TreechatsOps. */
(function(){
  const Core = globalThis.TreechatsCore;
  if(!Core) throw new Error('treeops.js needs treecore.js loaded first');

  /* ---- wording of the ✦ requests agents can make too (the page's Settings › Prompts shows and edits them) ---- */
  const PROMPTS = {
    distill:{def:'Distill the conversation below into a brief that can start a fresh conversation with the same understanding. Write Markdown with these sections, leaving out any that would be empty: Goal, Decisions (each with its reason), Key facts and names (exact identifiers, values, file paths), Constraints, Open questions, Next step. Be specific and concise. No preamble.\n\n{conversation}'},
    review:{def:"Review the answer below with fresh eyes. Point out anything wrong, missing, unclear or weakly supported, most important first, and say what you would change. If it holds up, say so plainly.\n\n{material}"},
    judge:{def:"You are judging alternative follow-ups in a branching conversation. Below is the conversation up to the point where it branched, then each alternative: the follow-up message and the reply to it, labelled with its number.\n\nJudge them only against these criteria: {criteria}\n\nThe conversation up to the branch point:\n{conversation}\n\nThe alternatives:\n{alternatives}", fmt:'Reply with only JSON: {"best":"#12","reasons":{"#12":"One sentence on how it meets the criteria.","#14":"One sentence."},"summary":"One or two sentences on the choice."}\nUse the labels exactly as given, and give a reason for every alternative.'},
    combine:{def:"Below is a conversation that branched into alternatives: each is a follow-up message and the reply to it, labelled with its number. Write one reply that combines the best parts of the alternative replies, following these instructions: {instructions}\n\nAlso write the follow-up message that the combined reply answers, in the person's voice, so the pair reads naturally after the conversation. Say which parts came from which alternative.\n\nThe conversation up to the branch point:\n{conversation}\n\nThe alternatives:\n{alternatives}", fmt:'Reply with only JSON: {"prompt":"The follow-up message, in the person\'s voice.","reply":"The combined reply, in Markdown.","sources":{"#12":"What came from it.","#14":"What came from it."}}'},
    fan:{def:"You are helping someone branch a conversation into one thread per option.\n\nBelow are their message and the assistant's reply. If the reply offers several distinct options, approaches or directions to choose between, list each one. For each, give a short title of 2 to 4 words, and a follow-up message they could send to pursue only that option: written in their voice, one or two sentences, making sense on its own. Also say which option the reply recommends, if it clearly recommends one.\n\nTheir message:\n{message}\n\nThe assistant's reply:\n{reply}", fmt:'Reply with only JSON in this shape:\n{"options":[{"title":"Token bucket","prompt":"Let\'s go with the token bucket. Walk me through implementing it."}],"recommended":0}\nUse "recommended": null when nothing is clearly recommended, and "options": [] when the reply doesn\'t offer a choice.'},
    replayCheck:{def:"Someone is re-running a conversation after changing something earlier in it, so the replies may now differ from the ones their messages were written for. Decide whether their next message still makes sense as the next message after the conversation as it now stands. It fits if it reads naturally, even if the reply before it is worded differently or reaches a different conclusion that the message doesn't depend on. It doesn't fit if it refers to something the new reply no longer says, answers a question that is no longer asked, or assumes a choice that was no longer made.\n\nThe conversation as it now stands (most recent part):\n{conversation}\n\nThe reply the message was originally written after:\n{original}\n\nThe next message:\n{message}", fmt:'Reply with only JSON: {"fits":true,"reason":"","rewrite":""}\nWhen it doesn\'t fit, give a one-sentence reason, and a rewrite of the message that keeps its intent and voice but fits the conversation as it now stands. When it fits, leave reason and rewrite empty.'},
    loopCheck:{def:"Someone is sending the same message to Claude again after each reply, until a condition is met. Read the latest turns of the conversation and decide whether this condition is met now: {condition}\n\nThe conversation (most recent part):\n{conversation}", fmt:'Reply with only JSON: {"met":false,"why":"One short sentence."}\nmet is true only when the condition is clearly met by the latest reply.'}
  };
  const JUDGE_DEFAULT = 'Most correct and useful for what the person is trying to do.';
  const COMBINE_DEFAULT = 'Keep what is correct and useful from each. Resolve contradictions. Don’t add new claims.';
  /* A request with its {placeholders} filled. A value whose placeholder was edited out is added at the end, so Claude
     always gets the material. Tools that need a set answer shape get it appended (fmt), since Treechats reads it. */
  function fill(tpl, vars, fmt){
    let t = tpl; const rest = [];
    for(const [name, val] of Object.entries(vars)){ const tag = '{' + name + '}'; if(t.includes(tag)) t = t.split(tag).join(val); else if(val) rest.push(val); }
    if(rest.length) t += '\n\n' + rest.join('\n\n');
    return fmt ? t + '\n\n' + fmt : t;
  }
  const req = (io, k, vars, tpl) => fill(tpl != null ? tpl : io.tpl(k), vars, PROMPTS[k] && PROMPTS[k].fmt);
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
  const clone = o => JSON.parse(JSON.stringify(o));
  const transcript = (turns, n) => clip(turns.map(x => `${x.role === 'user' ? 'User' : 'Claude'}: ${x.content}`).join('\n\n'), n);

  /* ---- the tree ---- */
  const emptyTree = () => ({nextId:1, nextRef:1, nodes:{}, refs:{}, head:null, active:{}, convs:{}, fold:{}, files:[], views:[]});
  const all = (t, ix) => ix ? ix.all : Object.values(t.nodes).sort((a, b) => a.id - b.id);
  const kids = (t, id, ix) => ix ? (ix.kids.get(id) || []) : all(t).filter(n => n.parents.includes(id));
  const primaryKids = (t, id, ix) => ix ? (ix.prim.get(id) || []) : all(t).filter(n => n.parents[0] === id);
  /* reply versions: regenerating adds a sibling with the same prompt; only the active one is drawn */
  function activeOf(t, gid, ix){
    const a = t.active && t.active[gid];
    if(a != null && t.nodes[a] && t.nodes[a].alt === gid) return a;
    const g = ix ? (ix.alt.get(gid) || []) : all(t).filter(m => m.alt === gid); return g.length ? g[g.length - 1].id : null;
  }
  const visible = (t, n, ix) => n.alt == null || activeOf(t, n.alt, ix) === n.id;
  const vKids = (t, id, ix) => primaryKids(t, id, ix).filter(n => visible(t, n, ix));
  function desc(t, id, ix){
    if(ix && ix.desc.has(id)) return new Set(ix.desc.get(id));
    const out = new Set(), st = [id]; while(st.length){ const c = st.pop(); for(const k of kids(t, c, ix)) if(!out.has(k.id)){ out.add(k.id); st.push(k.id); } }
    if(ix) ix.desc.set(id, out); return new Set(out);
  }
  const convKey = r => r.alt ?? r.id;
  const convOf = (t, id, chain) => (chain ? chain(id) : Core.chain(t, id))[0];
  const convKeyOf = (t, id, chain) => id != null && t.nodes[id] ? convKey(t.nodes[convOf(t, id, chain)]) : null;
  /* every prompt from here to its root follows its versions: the ones on this path become the active ones */
  function setActivePath(t, id, path){ if(id == null || !t.nodes[id]) return; for(const i of (path ? path(id) : Core.path(t, id))){ const n = t.nodes[i]; if(n.alt != null) t.active[n.alt] = i; } }

  /* ---- branches: labels on tips, scoped to their chat so each can have its own main ---- */
  function refsAt(t, id, ix){ const r = ix ? (ix.tips.get(id) || []).filter(rid => t.refs[rid] && t.refs[rid].tip === id) : Object.keys(t.refs).filter(rid => t.refs[rid].tip === id); return r.sort((a, b) => (b === t.head) - (a === t.head)); }
  const refName = (t, rid) => t.refs[rid] ? t.refs[rid].name : '';
  const NAME_RE = /^[A-Za-z0-9._\/-]{1,40}$/;
  function namesIn(t, root, exceptRid, chain){ return new Set(Object.entries(t.refs).filter(([rid, r]) => rid !== exceptRid && t.nodes[r.tip] && convOf(t, r.tip, chain) === root).map(([, r]) => r.name)); }
  function autoName(t, root, chain){ const used = namesIn(t, root, undefined, chain); let k = 1; while(used.has(`branch-${k}`)) k++; return `branch-${k}`; }
  function newRef(t, name, tip){ const rid = 'r' + (t.nextRef++); t.refs[rid] = {name, tip}; return rid; }
  function slugName(t, title, conv, chain){
    let b = title.toLowerCase().replace(/^(option|approach)\s+\w+:\s*/, '').replace(/[^a-z0-9._\/-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'option';
    const used = namesIn(t, conv, undefined, chain); if(!used.has(b)) return b;
    let k = 2; while(used.has(`${b}-${k}`)) k++; return `${b}-${k}`;
  }
  function leafOf(t, id, ix){ let cur = id; for(;;){ const k = vKids(t, cur, ix); if(!k.length) return cur; cur = k[0].id; } }
  function refsThrough(t, id, chain){ const C = chain || (x => Core.chain(t, x)); return Object.keys(t.refs).filter(rid => t.nodes[t.refs[rid].tip] && C(t.refs[rid].tip).includes(id)); }
  /* the deepest prompt every one of ids follows: their shared context (null when they're in different chats) */
  function sharedParent(t, ids, path){
    const P = path || (x => Core.path(t, x));
    const ps = ids.filter(i => t.nodes[i]).map(i => P(i)); if(!ps.length) return null;
    const common = ps[0].filter(x => !ids.includes(x) && ps.every(p => p.includes(x)));
    return common.length ? common[common.length - 1] : null;
  }
  const cmpKids = (t, id, ix) => vKids(t, id, ix).filter(k => k.kind !== 'merge');
  function uniqueSpaceName(db, base){ const used = new Set(db.order.filter(id => db.spaces[id]).map(id => db.spaces[id].name)); if(!used.has(base)) return base; let k = 2; while(used.has(`${base} ${k}`)) k++; return `${base} ${k}`; }

  /* ---- reading options from a reply (Fan out without Claude) ---- */
  const stripMd = t => t.replace(/\*\*|__|`/g, '').replace(/^\s*#+\s*/, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
  function shortTitle(line){
    const b = line.match(/^\s*\*\*([^*]{2,60})\*\*/); if(b) return stripMd(b[1]).replace(/[:.\s–—-]+$/, '');
    let t = stripMd(line).replace(/^(option|approach|choice|alternative)\s*[A-Z0-9]{0,2}\s*[:.)–—-]\s+(?=\S)/i, '');
    const cut = t.search(/(:\s| [–—-] |\.\s|\(| because | so that )/);
    if(cut > 3) t = t.slice(0, cut);
    return clip(t.replace(/[:.,;\s]+$/, ''), 48);
  }
  /* numbered and bulleted lists, or headings, at the top level of the reply */
  function listOptions(reply){
    const body = reply.replace(/```[\s\S]*?```/g, ''), lines = body.split('\n');
    const groups = {head:[], num:[], bullet:[]};
    for(const l of lines){
      let m;
      if((m = l.match(/^#{2,4}\s+(.+)$/))) groups.head.push(m[1]);
      else if((m = l.match(/^(\d+)[.)]\s+(.+)$/))) groups.num.push(m[2]);
      else if((m = l.match(/^[-*•]\s+(.+)$/))) groups.bullet.push(m[1]);
    }
    const optHeads = groups.head.filter(h => /^(\*\*)?(option|approach|choice|alternative|path|plan)\b/i.test(h));
    const pickFrom = optHeads.length >= 2 ? optHeads : groups.num.length >= 2 ? groups.num : groups.head.length >= 2 && groups.head.length <= 6 ? groups.head : groups.bullet.length >= 2 && groups.bullet.length <= 8 ? groups.bullet : [];
    const options = pickFrom.slice(0, 8).map(l => { const title = shortTitle(l); return {title, prompt:`Let's go with ${title}. Walk me through it.`}; }).filter(o => o.title);
    let recommended = null;
    const rec = lines.find(l => /\b(recommend|i'd go with|i would go with|i'd pick|i'd start with|best (fit|choice|option|bet))\b/i.test(l));
    if(rec){ const low = rec.toLowerCase(); const i = options.findIndex(o => o.title.length > 2 && low.includes(o.title.toLowerCase())); if(i >= 0) recommended = i; }
    return {options, recommended};
  }
  /* ✦ Fan out: the options Claude reads in a reply */
  const fanAsk = (io, text, reply, tpl) => req(io, 'fan', {message:clip(text || '', 4000), reply:clip(reply, 24000)}, tpl);

  /* ---- Replay ---- */
  /* one prompt of the line, copied under parent (or beside the original as a new version) */
  function copyOne(t, o, parent, asVersion, by, text, rewrite){
    const nid = t.nextId++, c = {id:nid, text: text ?? (o.text || '')};
    for(const k of ['kind', 'files', 'skip', 'note', 'from', 'into', 'seam', 'set']) if(o[k] != null) c[k] = clone(o[k]);
    if(o.model) c.askTier = o.model;
    if(by) c.by = by;
    if(rewrite) c.rewritten = rewrite;
    if(asVersion){ const gid = o.alt ?? o.id; o.alt = gid; c.alt = gid; c.parents = [...o.parents]; t.active[gid] = nid; }
    else c.parents = [parent, ...o.parents.slice(1)];
    t.nodes[nid] = c; setActivePath(t, nid);
    return nid;
  }
  const replayCount = (t, line) => line.filter(x => t.nodes[x] && t.nodes[x].kind !== 'merge').length;
  /* ✦ does this prompt still make sense after the conversation as it now stands? */
  async function checkFit(io, t, afterId, o, original){
    const conversation = transcript(Core.turnsFor(t, afterId, io.env(t), true).slice(-6), 16000);
    try{
      const d = await io.json(req(io, 'replayCheck', {conversation, original:clip(original || '(none)', 6000), message:clip(o.text || '', 4000)}), {modelTier:'quick', cache:false});
      if(!d || typeof d.fits !== 'boolean') return {fits:true, unchecked:true};
      return {fits:d.fits, reason:String(d.reason || '').trim(), rewrite:String(d.rewrite || '').trim()};
    }catch(e){ return {fits:true, unchecked:true}; }
  }
  /* The replay itself: r = {sid, line, onto, by, firstText, mode: 'stop'|'rewrite'|'off'}. io.tree(sid) is the tree;
     io.pause(info) resolves to {text} to send, or null to stop; io.update() redraws. Returns what happened. */
  async function runReplay(r, io){
    const t = io.tree(r.sid), made = [], line = r.line;
    let parent = r.onto, requests = 0, stoppedAt = null, why = null, rewrites = 0;
    for(const [i, id] of line.entries()){
      if(r.stop){ stoppedAt = id; why = 'stopped'; break; }
      const o = t.nodes[id]; if(!o){ stoppedAt = id; why = 'gone'; break; }
      if(parent != null && !t.nodes[parent]){ stoppedAt = id; why = 'gone'; break; }
      let text = i === 0 && r.firstText != null ? r.firstText : o.text, rewrite = null;
      const lastAsk = [...made].reverse().find(x => t.nodes[x] && t.nodes[x].kind !== 'merge' && t.nodes[x].reply);
      const prevOld = i > 0 ? t.nodes[line[i - 1]] : (r.onto != null ? t.nodes[t.nodes[line[0]].parents[0]] : null);
      if(o.kind !== 'merge' && r.mode !== 'off' && (lastAsk != null || (i === 0 && r.onto != null && t.nodes[r.onto] && t.nodes[r.onto].reply)) && !(i === 0 && r.firstText != null)){
        r.status = {what:'checking', id}; io.update();
        const v = await checkFit(io, t, lastAsk ?? r.onto, o, prevOld && prevOld.reply); requests++;
        if(r.stop){ stoppedAt = id; why = 'stopped'; break; }
        if(!v.fits){
          if(r.mode === 'rewrite' && v.rewrite){ text = v.rewrite; rewrite = {from:o.text, by:'claude', why:v.reason}; rewrites++; }
          else {
            r.status = {what:'paused', id, reason:v.reason, suggest:v.rewrite}; io.update();
            const ans = await io.pause({id, reason:v.reason, rewrite:v.rewrite});
            if(!ans){ stoppedAt = id; why = 'mismatch'; r.mismatch = {id, reason:v.reason, rewrite:v.rewrite}; break; }
            text = ans.text; if(text !== o.text) rewrite = {from:o.text, by: text === v.rewrite ? 'claude' : 'you', why:v.reason};
          }
        }
      }
      const asVersion = i === 0 && r.onto == null;
      const nid = io.apply(tt => copyOne(tt, o, parent, asVersion, r.by, text, rewrite), `Replay: #${id} re-sent as #${t.nextId}`);
      made.push(nid); parent = nid; r.at = nid;
      if(o.kind === 'merge') continue;
      r.status = {what:'sending', id:nid}; io.update();
      requests++;
      const res = await io.ask(r.sid, nid);
      if(res.error){ stoppedAt = id; why = r.stop ? 'stopped' : 'error'; r.error = res.error; break; }
    }
    /* finished the whole line: branches that ended at the old tip carry on from the new one */
    if(stoppedAt == null && made.length) io.apply(tt => { for(const rid of refsAt(tt, line[line.length - 1])) tt.refs[rid].tip = made[made.length - 1]; return null; }, null);
    r.done = true; r.status = null;
    return {made, requests, stoppedAt, why, rewrites, mismatch:r.mismatch, error:r.error};
  }

  /* ---- ✦ Judge and ✦ Combine: alternatives side by side, with the context they share ---- */
  function compareMaterial(t, env, parent, ids){
    const alts = ids.map(i => t.nodes[i]).filter(n => n && n.reply);
    if(alts.length < 2) throw new Error('Needs at least two follow-ups with replies.');
    const conversation = parent == null ? '(They come from different chats, with no shared context.)' : transcript(Core.turnsFor(t, parent, env, true), 24000);
    const alternatives = alts.map(n => `#${n.id}\nFollow-up: ${clip(n.text || '', 3000)}\nReply: ${clip(n.reply, 9000)}`).join('\n\n---\n\n');
    return {conversation, alternatives, ids:alts.map(n => n.id)};
  }
  const num = x => +String(x || '').replace(/[^\d]/g, '');
  async function judge(io, t, parent, ids, criteria){
    const m = compareMaterial(t, io.env(t), parent, ids);
    const d = await io.json(req(io, 'judge', {criteria:criteria || JUDGE_DEFAULT, conversation:m.conversation, alternatives:m.alternatives}), {modelTier:io.model, cache:false});
    const best = m.ids.includes(num(d && d.best)) ? num(d.best) : null, reasons = {};
    for(const [k, v] of Object.entries((d && d.reasons) || {})){ const id = num(k); if(m.ids.includes(id)) reasons[id] = String(v); }
    return {best, reasons, summary:String((d && d.summary) || '').trim(), criteria:criteria || JUDGE_DEFAULT, ids:m.ids};
  }
  async function combine(io, t, parent, ids, instructions){
    const m = compareMaterial(t, io.env(t), parent, ids);
    const d = await io.json(req(io, 'combine', {instructions:instructions || COMBINE_DEFAULT, conversation:m.conversation, alternatives:m.alternatives}), {modelTier:io.model, cache:false});
    if(!d || !String(d.reply || '').trim()) throw new Error('Claude didn’t return a combined reply.');
    const sources = {};
    for(const [k, v] of Object.entries(d.sources || {})){ const id = num(k); if(m.ids.includes(id)) sources[id] = String(v); }
    return {prompt:String(d.prompt || '').trim() || 'Combine the best of these.', reply:String(d.reply).trim(), sources, ids:m.ids, tier:io.model};
  }
  /* a combined reply as a new follow-up to parent, on its own branch */
  function addCombined(t, env, parent, c, by){
    const nid = t.nextId++;
    t.nodes[nid] = {id:nid, parents:[parent], text:c.prompt, reply:c.reply, model:c.tier, combined:{from:c.ids, sources:c.sources}};
    if(by) t.nodes[nid].by = by;
    newRef(t, slugName(t, 'combined', convOf(t, parent)), nid);
    t.nodes[nid].ctx = Core.ctxSig(t, nid, env);
    return nid;
  }

  /* ---- ✦ Review: a new chat that sees only what you include ---- */
  function reviewMaterial(t, env, id, whole){
    const n = t.nodes[id];
    if(whole) return `The conversation:\n\n${Core.turnsFor(t, id, env, true).map(x => `${x.role === 'user' ? 'User' : 'Assistant'}: ${x.content}`).join('\n\n')}`;
    return `The question:\n${n.text || ''}\n\nThe answer:\n${n.reply || ''}`;
  }
  /* adds the review chat; returns its first prompt */
  function addReviewChat(t, env, id, whole, instructions, by, tpl){
    let text = (instructions != null && instructions.trim() ? instructions : tpl);
    const material = reviewMaterial(t, env, id, whole);
    text = text.includes('{material}') ? text.split('{material}').join(material) : text + '\n\n' + material;
    const nid = t.nextId++;
    t.nodes[nid] = {id:nid, parents:[], text, reviewOf:{id, whole:!!whole}};
    if(by) t.nodes[nid].by = by;
    newRef(t, 'main', nid);
    t.convs[nid] = Object.assign(t.convs[nid] || {}, {title:`Review of #${id}`});
    return nid;
  }

  /* ---- /loop: is the condition met? ---- */
  async function loopCheck(io, t, until, id){
    const conversation = transcript(Core.turnsFor(t, id, io.env(t), true).slice(-4), 16000);
    try{
      const d = await io.json(req(io, 'loopCheck', {condition:until, conversation}), {modelTier:'quick', cache:false});
      if(!d || typeof d.met !== 'boolean') return {met:false, why:'The check didn’t give a clear answer, so the loop carries on.', unclear:true};
      return {met:d.met, why:String(d.why || '').trim()};
    }catch(e){ return {met:false, why:'The check failed, so the loop carries on.', unclear:true}; }
  }

  /* ---- model settings: the ones an agent or the inspector can set, in words ---- */
  const EFFORT_OPTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const hasSettings = st => !!st && Core.SET_FIELDS.some(f => f in st);
  function setSummary(st){
    const v = st || {}, out = [];
    if('system' in v) out.push(v.system ? `system prompt “${clip(v.system, 40)}”` : 'no system prompt');
    if('thinking' in v) out.push(v.thinking ? 'thinking on' : 'thinking off');
    if('effort' in v) out.push(v.effort ? `effort ${v.effort}` : 'model’s default effort');
    if('temperature' in v) out.push(v.temperature != null ? `temperature ${v.temperature}` : 'default temperature');
    if('maxTokens' in v) out.push(v.maxTokens ? `up to ${v.maxTokens.toLocaleString()} tokens` : 'default reply length');
    return out.join(', ');
  }
  /* the tools a reply may use: the ones picked by the input box that this way of replying offers (with Claude Code,
     running code needs the API, since it would run on this computer) */
  const TOOLS = ['search', 'fetch', 'code'];
  const toolsFor = (picked, provider) => Array.isArray(picked) && ['api', 'fake', 'claude-code'].includes(provider) ? picked.filter(t => TOOLS.includes(t) && !(provider === 'claude-code' && t === 'code')) : [];

  /* ---- what a failed request means, in words ---- */
  const PERMANENT = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  function errCopy(code){
    return ({
      rate_limited:'Too many requests, or your usage limit was reached. Try again later.',
      session_expired:'Sign in to Claude again, then retry.',
      refused:'Claude declined this prompt. Try rewording it.',
      empty_completion:'No reply came back. Try a simpler prompt.',
      prompt_too_large:'This context path is too long to send. Squash or reroot to shorten it.',
      no_api_key:'Add your Anthropic API key to the .env file, then restart Treechats.',
      cli_missing:'Couldn’t find Claude Code. Install it, or set TREECHATS_CLAUDE_PATH in .env, then restart Treechats.',
      cli_auth:'Claude Code isn’t signed in. Run claude in a terminal and sign in, then try again.',
      cli_error:'Claude Code stopped with an error. Try again, or check the Treechats window for details.',
      auth:'The API key was rejected. Check ANTHROPIC_API_KEY in .env, then restart Treechats.',
      permission:'This API key isn’t allowed to use that model. Pick another model or check your key.',
      unknown_model:'That model name wasn’t recognized. Check the TREECHATS_MODEL_ settings in .env.',
      overloaded:'Claude is busy right now. Try again in a moment.',
      network:'Couldn’t reach the Treechats server or Claude. Check that Treechats is still running and you’re online.'
    })[code] || (PERMANENT.includes(code) ? 'Replies are turned off. Check your API key or Claude Code sign-in, then restart Treechats.' : 'The reply was interrupted. Try again.');
  }

  globalThis.TreechatsOps = {
    PROMPTS, JUDGE_DEFAULT, COMBINE_DEFAULT, fill, clip, NAME_RE, PERMANENT, errCopy, EFFORT_OPTS, hasSettings, setSummary, TOOLS, toolsFor,
    emptyTree, all, kids, primaryKids, activeOf, visible, vKids, desc, convKey, convOf, convKeyOf, setActivePath,
    refsAt, refName, namesIn, autoName, newRef, slugName, leafOf, refsThrough, sharedParent, cmpKids, uniqueSpaceName,
    stripMd, shortTitle, listOptions, fanAsk,
    copyOne, replayCount, checkFit, runReplay, compareMaterial, judge, combine, addCombined, reviewMaterial, addReviewChat, loopCheck,
  };
})();
