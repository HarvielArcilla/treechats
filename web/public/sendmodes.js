/* Include as (send modes): how much of one turn (a prompt and its reply) goes into the requests after it.

   - full: the prompt and the reply, as they are
   - summary: the prompt, and a summary in place of the reply
   - excerpt: only the highlighted parts of the prompt and of the reply (a side with nothing highlighted goes whole)
   - prompt: only the prompt, with a short note where the reply was
   - reply: only the reply, with a short note where the prompt was
   - out: neither (leave out, stored as n.skip so it keeps working everywhere it did)

   Nothing is deleted: the turn keeps its text and reply, and switching back to Full sends them again. The summary and
   excerpt are stored on the turn (n.sum, n.ex), with a hash of the text they were made from, so they can say when the
   reply has changed since.

   This one file is loaded by the page (as a plain script) and by the server (imported for its side effect), so both
   build the same request. It sets globalThis.TreechatsSend. */
(function(){
  const MODES = ['full', 'summary', 'excerpt', 'prompt', 'reply', 'out'];
  const LABELS = { full:'Full', summary:'Summary', excerpt:'Excerpt', prompt:'Prompt only', reply:'Reply only', out:'Left out' };
  const HINTS = {
    full:'The prompt and the reply, as they are.',
    summary:'The prompt, and a short summary instead of the reply.',
    excerpt:'Only the parts you highlight, from the prompt, the reply or both.',
    prompt:'The prompt, without the reply.',
    reply:'The reply, without the prompt.',
    out:'Nothing from this turn.',
  };
  /* the wording sent for each mode; all of it is editable in Settings › Prompts */
  const DEFAULTS = {
    summarizeReply:'Summarize the reply below so the summary can stand in for it when the conversation continues. Keep what was decided or concluded, key facts, names, numbers and code identifiers, and anything the person may refer back to. If the reply was a dead end, say what was tried and why it didn’t work. Write it as the assistant who gave the reply, in plain prose under 120 words, with no preamble.\n\nThe message it answered:\n{prompt}\n\nThe reply:\n{reply}',
    sendSummary:'(Shortened: a summary of my original reply.)\n\n{summary}',
    sendExcerptPrompt:'{excerpt}',
    sendExcerptReply:'{excerpt}',
    sendNoReply:'(My reply to this message is left out of the conversation.)',
    sendNoPrompt:'(The message this reply answered is left out of the conversation.)',
  };
  /* pieces of an excerpt are separated by a blank line */
  const JOIN = '\n\n';

  const modeOf = n => n.skip ? 'out' : (n.send && MODES.includes(n.send) ? n.send : 'full');
  /* an excerpt's pieces are {s, e, t}: where they were and the text itself; the text is what's sent */
  const texts = list => (Array.isArray(list) ? list : []).map(p => typeof p === 'string' ? p : p && p.t).filter(t => typeof t === 'string' && t.trim());
  const fill = (tpl, vars) => { let t = String(tpl == null ? '' : tpl); for(const [k, v] of Object.entries(vars)) t = t.split('{' + k + '}').join(v); return t; };
  const hasSummary = n => !!(n.sum && typeof n.sum.text === 'string' && n.sum.text.trim() && !n.sum.pending);

  /* What a turn sends under its mode. user is the prompt as it would go out in full (attached files and text), reply the
     reply ('' when it isn't sent anyway); tpl(key) gives the current wording. Returns {user, reply}: '' means nothing. */
  function apply(n, user, reply, tpl){
    const m = modeOf(n);
    if(m === 'summary'){ if(reply && hasSummary(n)) reply = fill(tpl('sendSummary'), { summary:n.sum.text.trim() }).trim(); }
    else if(m === 'excerpt'){
      const ex = n.ex || {}, p = texts(ex.p), r = texts(ex.r);
      if(user && p.length) user = fill(tpl('sendExcerptPrompt'), { excerpt:p.join(JOIN) }).trim();
      if(reply && r.length) reply = fill(tpl('sendExcerptReply'), { excerpt:r.join(JOIN) }).trim();
    }
    else if(m === 'prompt'){ if(reply) reply = String(tpl('sendNoReply') || '').trim(); }
    else if(m === 'reply'){ if(user && reply) user = String(tpl('sendNoPrompt') || '').trim(); }
    return { user, reply };
  }
  /* what the mode changes, as one string the fingerprint hashes ('' for full), so the "context changed" marker notices
     a turn switched to a summary or an edited excerpt */
  function mark(n, tpl){
    const m = modeOf(n);
    if(m === 'full' || m === 'out') return '';
    if(m === 'summary') return hasSummary(n) ? 'summary|' + n.sum.text.trim() + '|' + tpl('sendSummary') : '';
    if(m === 'excerpt'){ const ex = n.ex || {}, p = texts(ex.p), r = texts(ex.r); return p.length || r.length ? 'excerpt|' + p.join(JOIN) + '|' + r.join(JOIN) + '|' + tpl('sendExcerptPrompt') + '|' + tpl('sendExcerptReply') : ''; }
    if(m === 'prompt') return n.reply ? 'prompt|' + tpl('sendNoReply') : '';
    if(m === 'reply') return n.reply ? 'reply|' + tpl('sendNoPrompt') : '';
    return '';
  }
  /* has the text a summary or excerpt was made from changed since? h is the caller's hash function */
  function stale(n, h){
    const m = modeOf(n), out = [];
    if(m === 'summary' && hasSummary(n) && n.sum.of && n.sum.of !== h(n.reply || '')) out.push('reply');
    if(m === 'excerpt' && n.ex){
      if(texts(n.ex.p).some(t => !(n.text || '').includes(t))) out.push('prompt');
      if(texts(n.ex.r).some(t => !(n.reply || '').includes(t))) out.push('reply');
    }
    return out;
  }
  /* pieces for a side, from ranges in its text: sorted, overlaps merged, empty ones dropped */
  function piecesFrom(text, ranges){
    const rs = (ranges || []).map(r => [Math.max(0, Math.min(r[0], r[1])), Math.min(text.length, Math.max(r[0], r[1]))]).filter(r => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for(const r of rs){ const last = out[out.length - 1]; if(last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]); }
    return out.map(([s, e]) => { const t = text.slice(s, e); const a = t.length - t.trimStart().length, b = t.length - t.trimEnd().length; return { s:s + a, e:e - b, t:t.trim() }; }).filter(p => p.t);
  }
  /* where a stored piece is in the text now: at its old place if the text there is unchanged, else the first match */
  function locate(text, p){
    if(text.slice(p.s, p.e) === p.t) return [p.s, p.e];
    const i = text.indexOf(p.t); return i >= 0 ? [i, i + p.t.length] : null;
  }
  /* pieces from exact text (MCP): each must appear in the side's text */
  function piecesFromText(text, list){
    const ranges = [], missing = [];
    for(const t of list || []){ const s = String(t); const i = text.indexOf(s); if(i < 0 || !s.trim()) missing.push(s); else ranges.push([i, i + s.length]); }
    return { pieces:piecesFrom(text, ranges), missing };
  }

  globalThis.TreechatsSend = { MODES, LABELS, HINTS, DEFAULTS, JOIN, modeOf, apply, mark, stale, texts, fill, hasSummary, piecesFrom, piecesFromText, locate };
})();
