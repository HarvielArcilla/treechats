/* Treechats core: the tree, and the context a prompt sends.

   One definition, used by the page and by the server, so what you see in the page is what agents, scheduled tasks
   and Copy as a prompt get. Everything here is pure: it takes the tree (a project's nodes, files and branches) and an
   env with what differs between the two:

   - env.tpl(key)  the wording of a prompt Treechats sends (Settings › Prompts), or its default from DEFAULTS
   - env.file(f)   a file as it's sent: the page has every file's contents; the server reads linked files from disk
   - env.path(id), env.chain(id)  optional: the page passes its memoized versions, since it calls them constantly

   Loaded by the page as a plain script (after sendmodes.js) and imported by the server for its side effect. It sets
   globalThis.TreechatsCore. Types for the server are in treecore.d.ts. */
(function(){
  const Send = globalThis.TreechatsSend;
  if(!Send) throw new Error('treecore.js needs sendmodes.js loaded first');

  /* defaults for the wording the context uses; the page's Settings › Prompts shows these too */
  const DEFAULTS = Object.assign({}, Send.DEFAULTS, {
    instructions: '',
    seam: 'Separately, in a parallel thread that branched off earlier in this conversation, we discussed the following.',
    fileEdits: 'When you change one of these files, write the whole new file in a code block and put its path on the line just before the block (for example `src/app.ts`). Treechats shows it as a proposed change that the person can review and save.',
  });
  /* wording from the person's own prompts, else the default (null means "back to the default") */
  const tplFrom = prompts => k => prompts && prompts[k] != null ? prompts[k] : DEFAULTS[k];

  /* ---- The tree ---- */
  /* every prompt a prompt sends, oldest first: its first parent's path, then what each other parent adds, then itself.
     A post-order walk that skips what it has seen: linear in the ancestors, and iterative so long chats are fine. */
  function path(tree, id){
    const res = [], seen = new Set([id]), stack = [[id, 0]];
    while(stack.length){
      const top = stack[stack.length - 1], n = tree.nodes[top[0]], ps = n ? n.parents : [];
      if(top[1] < ps.length){ const p = ps[top[1]++]; if(!seen.has(p) && tree.nodes[p]){ seen.add(p); stack.push([p, 0]); } continue; }
      stack.pop(); res.push(top[0]);
    }
    return res;
  }
  /* the first-parent line from the root to a prompt */
  function chain(tree, id){ const c = []; let n = tree.nodes[id]; while(n){ c.push(n.id); n = tree.nodes[n.parents[0]]; } return c.reverse(); }
  const pathOf = (tree, env) => env && env.path ? env.path : id => path(tree, id);
  const chainOf = (tree, env) => env && env.chain ? env.chain : id => chain(tree, id);

  /* the path to a prompt in send order, with a merge note before the turns each merge brings in */
  function entries(tree, id, env){
    const P = pathOf(tree, env), p = P(id), seams = new Map();
    for(const m of p){
      const n = tree.nodes[m]; if(!n || n.parents.length < 2) continue;
      const seen = new Set(P(n.parents[0]));
      for(const q of n.parents.slice(1)){
        const idx = P(q).filter(x => !seen.has(x)).map(x => p.indexOf(x)).filter(i => i >= 0);
        if(idx.length){ const at = Math.min(...idx); if(!seams.has(at)) seams.set(at, m); }
        for(const x of P(q)) seen.add(x);
      }
    }
    const out = [];
    p.forEach((x, i) => { if(seams.has(i)){ const m = seams.get(i); out.push({seam:true, merge:m, text:tree.nodes[m].seam || env.tpl('seam')}); } out.push({id:x}); });
    return out;
  }

  /* ---- Model settings ----
     Set on a prompt, used by it and every prompt after it unless a later one sets its own. Each field is inherited on
     its own; null means "back to the default". from says which prompt set each field. */
  const SET_FIELDS = ['system', 'thinking', 'effort', 'temperature', 'maxTokens', 'tools'];
  function settingsFor(tree, id, env){
    const values = {}, from = {};
    for(const x of chainOf(tree, env)(id).reverse()){
      const st = tree.nodes[x] && tree.nodes[x].set; if(!st) continue;
      for(const f of SET_FIELDS) if(!(f in from) && f in st){ from[f] = x; if(st[f] != null) values[f] = st[f]; }
    }
    return {values, from};
  }

  /* ---- What a request sends ----
     User and assistant turns: standing instructions, project files, then each turn on the path (minus what's left
     out, each as its Include as mode sends it), with a note before the turns a merge brings in. Back-to-back turns of
     one role are joined so they alternate. includeLastReply: also send the prompt's own reply (Copy as a prompt,
     agents); without it, this is the request that gets that reply. */
  function filesBlock(files, env){
    const fe = String(env.tpl('fileEdits') || '').trim();
    return 'Files shared in this project:\n\n' + files.map(env.file).join('\n\n') + (fe ? '\n\n' + fe : '');
  }
  function turnsFor(tree, id, env, includeLastReply){
    const raw = [], instr = String(env.tpl('instructions') || '').trim();
    if(instr) raw.push({role:'user', content:instr});
    if(tree.files && tree.files.length) raw.push({role:'user', content:filesBlock(tree.files, env)});
    for(const e of entries(tree, id, env)){
      if(e.seam){ raw.push({role:'user', content:e.text}); continue; }
      const n = tree.nodes[e.id];
      if(n.skip && e.id !== id) continue;
      const fl = (n.files || []).map(env.file).join('\n\n');
      let user = fl ? (fl + (n.text ? '\n\n' + n.text : '')) : (n.text || ''), reply = n.reply && (includeLastReply || e.id !== id) ? n.reply : '';
      /* its Include as mode applies once it's history: always, except to the prompt being sent now */
      if(n.send && (e.id !== id || includeLastReply)) ({user, reply} = Send.apply(n, user, reply, env.tpl));
      if(user) raw.push({role:'user', content:user});
      if(reply) raw.push({role:'assistant', content:reply});
    }
    return joinRoles(raw);
  }
  function joinRoles(raw){
    const out = [];
    for(const t of raw){ const last = out[out.length - 1]; if(last && last.role === t.role) last.content += '\n\n' + t.content; else out.push({...t}); }
    return out;
  }
  /* a new prompt's request: the context up to parent (all of it, with parent's reply), then the prompt; for a new
     chat, the standing instructions and project files with the prompt */
  function turnsForNew(tree, parent, text, env){
    if(parent != null){
      const t = turnsFor(tree, parent, env, true);
      if(t.length && t[t.length - 1].role === 'user') t[t.length - 1].content += '\n\n' + text; else t.push({role:'user', content:text});
      return t;
    }
    const parts = [], instr = String(env.tpl('instructions') || '').trim();
    if(instr) parts.push(instr);
    if(tree.files && tree.files.length) parts.push(filesBlock(tree.files, env));
    parts.push(text);
    return [{role:'user', content:parts.join('\n\n')}];
  }
  /* Copy as a prompt: what a prompt sends (with its reply) as one block to paste anywhere */
  function contextPrompt(tree, id, env){
    const sys = String(settingsFor(tree, id, env).values.system || '').trim();
    const body = (sys ? `<system>\n${sys}\n</system>\n\n` : '') + turnsFor(tree, id, env, true).map(t => `<${t.role}>\n${t.content}\n</${t.role}>`).join('\n\n');
    return `Here is an earlier conversation, for context. Read it, then help with what I ask after it.\n\n<conversation>\n${body}\n</conversation>\n\n`;
  }

  /* ---- Context fingerprint ----
     Each reply remembers exactly what was sent to get it: a short hash per part (system prompt, instructions, each
     project file, merge notes, each prompt and reply, and how each turn is included) and a hash chained over all of
     them. Comparing it with what the prompt would send now says what changed above a reply. Never sent to Claude. */
  function hash53(str, seed = 0){
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for(let i = 0; i < str.length; i++){ const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
  }
  const h5 = str => hash53(str).slice(-5);
  /* hashes of one turn's parts, cached until its text, files or reply change */
  const partCache = new WeakMap();
  function turnParts(n){
    const files = (n.files || []).map(f => f.id + '/' + f.name).join('|');
    let c = partCache.get(n);
    if(!c || c.text !== n.text || c.reply !== n.reply || c.files !== files){
      c = {text:n.text, reply:n.reply, files, q:h5((n.text || '') + '\u0000' + files), r:n.reply ? h5(n.reply) : ''};
      partCache.set(n, c);
    }
    return c;
  }
  /* what a request from this prompt sends, as in turnsFor(id): one entry per part, in order */
  function ctxSig(tree, id, env){
    const at = [], instr = String(env.tpl('instructions') || '').trim(), sys = String(settingsFor(tree, id, env).values.system || '').trim();
    if(sys) at.push('y:' + h5(sys));
    if(instr) at.push('i:' + h5(instr));
    /* one entry per project file, so the marker can say which file changed (an edit gives a file a new id) */
    for(const f of tree.files || []) at.push('f' + h5(f.name) + ':' + h5(f.id));
    const fe = String(env.tpl('fileEdits') || '').trim();
    if(tree.files && tree.files.length && fe) at.push('e:' + h5(fe));
    for(const e of entries(tree, id, env)){
      if(e.seam){ at.push('s' + e.merge + ':' + h5(e.text)); continue; }
      const n = tree.nodes[e.id];
      if(n.kind === 'merge' || (n.skip && e.id !== id)) continue;
      const p = turnParts(n), m = e.id !== id && n.send ? Send.mark(n, env.tpl) : '';
      at.push(e.id + ':' + p.q + (e.id !== id && p.r ? '.' + p.r : '') + (m ? '~' + h5(m) : ''));
    }
    let h = ''; for(const x of at) h = hash53(h + '|' + x);
    return {h:h.slice(-8), at:at.join(',')};
  }
  const sigMap = sig => new Map(sig && sig.at ? sig.at.split(',').map(x => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; }) : []);
  /* What changed above a reply since it was written, oldest first, as {k, what, label}; null when nothing did (or
     nothing was recorded). now: the current fingerprint, if the caller already has it. */
  function ctxChanges(tree, id, env, now){
    const n = tree.nodes[id];
    if(!n || !n.ctx || !n.reply) return null;
    now = now || ctxSig(tree, id, env); if(now.h === n.ctx.h) return null;
    const was = sigMap(n.ctx), is = sigMap(now), out = [], files = tree.files || [];
    const isFile = k => /^f[0-9a-z]{5}$/.test(k), num = k => /^\d+$/.test(k);
    /* replies written before files had an entry each recorded one hash for all of them */
    if(was.has('f')){
      const same = was.get('f') === h5(files.map(f => f.id + '/' + f.name).join('|'));
      was.delete('f'); for(const k of [...is.keys()]) if(isFile(k)) is.delete(k);
      if(!same) out.push({k:'f', what:'changed'});
    }
    if(!was.has('e')) is.delete('e'); /* replies written before this note existed */
    /* files saved from this reply's own proposed changes */
    if(n.applied) for(const f of files){ const k = 'f' + h5(f.name); if(n.applied[f.name] === is.get(k)){ if(was.has(k)) is.set(k, was.get(k)); else is.delete(k); } }
    const fileName = k => { const f = files.find(f => 'f' + h5(f.name) === k); return f ? f.name : 'a project file'; };
    const name = k => k === 'i' ? 'standing instructions' : k === 'e' ? 'how to show file changes' : k === 'f' ? 'project files' : isFile(k) ? fileName(k) : k === 'y' ? 'system prompt' : k[0] === 's' ? `merge note at #${k.slice(1)}` : +k === id ? 'this prompt' : '#' + k;
    const label = mode => Send.LABELS[mode].toLowerCase();
    for(const [k, v] of is){
      if(!was.has(k)){ out.push({k, what: num(k) ? 'back in' : 'added'}); continue; }
      const w = was.get(k); if(w === v) continue;
      const [wp, m0 = ''] = w.split('~'), [vp, m1 = ''] = v.split('~');
      const [q0, r0] = wp.split('.'), [q1, r1] = vp.split('.');
      /* only how the turn is included changed */
      if(wp === vp && num(k)){ const md = tree.nodes[k] ? Send.modeOf(tree.nodes[k]) : 'full'; out.push({k, what: m1 ? (m0 ? `${label(md)} changed` : `now included as ${label(md)}`) : 'included in full again'}); continue; }
      out.push({k, what: num(k) ? (+k === id ? 'edited' : q0 !== q1 && (r0 || '') !== (r1 || '') ? 'edited' : q0 !== q1 ? 'prompt edited' : (r1 && r0 ? 'reply edited' : r1 ? 'reply added' : 'reply removed')) : 'changed'});
    }
    for(const k of was.keys()) if(!is.has(k)) out.push({k, what: num(k) && tree.nodes[k] && tree.nodes[k].skip ? 'left out' : 'removed'});
    if(!out.length) return null;
    const order = [...is.keys(), ...was.keys()];
    out.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
    return out.map(c => ({...c, label:`${name(c.k)} ${c.what}`}));
  }

  globalThis.TreechatsCore = { DEFAULTS, tplFrom, SET_FIELDS, path, chain, entries, settingsFor, turnsFor, turnsForNew, contextPrompt, hash53, h5, turnParts, ctxSig, sigMap, ctxChanges };
})();
