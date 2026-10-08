/* What agents do over MCP, carried out by the server: subagent chats in run projects whose context the agent controls.

   These used to run in the open page (the server relayed each command to it). Now the server owns the document, so
   it makes the changes itself (server/doc.ts), writes replies itself (server/replies.ts), and open pages see every
   step pushed to them. The ✦ tools (replay, judge, combine, review, loop checks, fan out) are the page's own, shared
   in web/public/treeops.js, so an agent's replay works exactly like yours.

   Agents only change their own run projects ("Run: <name>"); their changes stay out of your Undo. Each operation
   returns what it did, for the MCP tool's answer (see report in mcp.ts). */
import { current, mutate, type Doc } from './doc.ts';
import { Core, Ops, envOf, tplOf } from './context.ts';
import { reply as writeReply } from './replies.ts';
import { sample, sampleJSON } from './sample.ts';
import { config } from './config.ts';

export type Done = { project: string; chat?: number; prompt?: number; branch?: string; reply?: string; note?: string; brief?: string; replaced?: number; message?: string; requests?: number };
type A = Record<string, any>;
type T = any; /* a tree, as the page keeps it */

const TIERS = ['quick', 'default', 'complex'];
const tierOf = (m: unknown) => typeof m === 'string' && TIERS.includes(m) ? m : null;
const clip = Ops.clip as (s: string, n: number) => string;
const doc = (): Doc => { if (!current().doc) mutate([], () => {}, 'agent'); return current().doc!; };
const treeOf = (sid: string): T => doc().db.spaces[sid]?.tree;

/* a run's project, made by spawn */
function runSpace(run: string, create = false): string {
  let sid = Object.keys(doc().db.spaces).find((k) => doc().db.spaces[k].agentRun === run);
  if (!sid && create) {
    sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const id = sid;
    mutate([], (d) => {
      d.db.spaces[id] = { id, name: Ops.uniqueSpaceName(d.db, 'Run: ' + run), tree: Ops.emptyTree(), agentRun: run };
      d.db.order.unshift(id);
    }, 'agent');
  }
  if (!sid) throw new Error(`There is no run named "${run}" yet. Start one with spawn.`);
  return sid;
}
/* a change to a run's tree: as after your own changes, a branch whose prompts are gone goes too */
function change<X>(sid: string, fn: (t: T) => X): X {
  return mutate([sid], (d) => {
    const t = d.db.spaces[sid].tree, out = fn(t);
    for (const [rid, r] of Object.entries(t.refs || {}) as [string, any][]) if (!t.nodes[r.tip]) delete t.refs[rid];
    if (t.head && !t.refs[t.head]) t.head = null;
    return out;
  }, 'agent');
}
/* what the shared ✦ tools need from the server */
function io(sid?: string) {
  const d = doc();
  return {
    tpl: tplOf(d as any), env: (t: T) => envOf(d as any, t), sample, json: sampleJSON, model: d.opts?.model || 'quick', tree: treeOf,
    apply: (fn: (t: T) => unknown) => change(sid!, fn), ask: (s: string, id: number) => writeReply(s, id), update() {}, pause: () => Promise.resolve(null),
  };
}
const where = (sid: string, id: number): Done => { const t = treeOf(sid); return { project: doc().db.spaces[sid].name, chat: Core.chain(t, id)[0], branch: Ops.refsAt(t, id).map((r: string) => Ops.refName(t, r))[0] }; };
const need = (t: T, id: number) => { const n = t.nodes[id]; if (!n || n.kind === 'merge') throw new Error(`There is no prompt #${id} in this run.`); return n; };
/* a point to continue from: a prompt, or a merge point (a branch tip after a merge) */
const point = (t: T, id: number) => { const n = t.nodes[id]; if (!n) throw new Error(`There is no prompt #${id} in this run.`); return n; };
const convOf = (t: T, id: number) => Core.chain(t, id)[0];
function agentLine(t: T, from: number, branch?: string) {
  let tip;
  if (branch) { const r: any = Object.values(t.refs).find((r: any) => r.name === branch && t.nodes[r.tip]); if (!r) throw new Error(`No branch named "${branch}" in this run.`); tip = r.tip; }
  else { const rid = Ops.refsThrough(t, from)[0]; tip = rid ? t.refs[rid].tip : Ops.leafOf(t, from); }
  const c = Core.chain(t, tip), i = c.indexOf(from);
  if (i < 0) throw new Error(`#${from} isn’t on branch ${branch}.`);
  return c.slice(i);
}
/* what judge and combine work on: the follow-ups of after, or prompts named anywhere (their shared context) */
function pickedSet(t: T, a: A) {
  if (a.prompts && a.prompts.length) { for (const x of a.prompts) need(t, x); return { ids: a.prompts as number[], parent: a.after ?? Ops.sharedParent(t, a.prompts) }; }
  if (a.after == null) throw new Error('Say which prompts: after (their shared prompt) or prompts (a list).');
  need(t, a.after); return { parent: a.after as number, ids: Ops.cmpKids(t, a.after).map((k: any) => k.id) as number[] };
}
/* the prompts from one to another along a line, both included, skipping merge points */
function stretch(t: T, from: number, until: number) {
  const c = Core.chain(t, until), i = c.indexOf(from);
  if (i < 0) throw new Error(`#${from} isn’t on the line up to #${until}.`);
  return c.slice(i).filter((x) => t.nodes[x].kind !== 'merge');
}
const replayLine = (t: T, a: A) => {
  if (a.until == null) return agentLine(t, a.prompt, a.branch);
  const c = Core.chain(t, a.until), i = c.indexOf(a.prompt);
  if (i < 0) throw new Error(`#${a.prompt} isn’t on the line up to #${a.until}.`);
  return c.slice(i);
};
/* model settings an agent asks for on spawn or fork: they apply to that prompt and the ones after it */
function agentSettings(a: A) {
  const st: A = {};
  if (typeof a.system === 'string' && a.system.trim()) st.system = a.system.trim();
  if (typeof a.thinking === 'boolean') st.thinking = a.thinking;
  if (Ops.EFFORT_OPTS.includes(a.effort)) st.effort = a.effort;
  if (typeof a.temperature === 'number') st.temperature = Math.min(1, Math.max(0, a.temperature));
  if (Number.isFinite(a.max_tokens)) st.maxTokens = Math.round(a.max_tokens);
  return Ops.hasSettings(st) ? st : null;
}
const addTurn = (t: T, parent: number | null, text: string, by: string, tier: string | null): number => Ops.addTurn(t, parent, text, { by, tier });
async function reply(sid: string, id: number, base: Done): Promise<Done> {
  const r = await writeReply(sid, id);
  if (r.error) throw new Error(`#${id} got no reply: ${r.error}`);
  return { ...base, prompt: id, reply: r.reply, note: r.note || undefined };
}
const branchTip = (t: T, a: A, what: string) => {
  let after = a.after;
  if (after == null && a.branch) { const r: any = Object.values(t.refs).find((r: any) => r.name === a.branch && t.nodes[r.tip]); if (!r) throw new Error(`No branch named "${a.branch}" in this run.`); after = r.tip; }
  if (after == null) throw new Error(what);
  point(t, after);
  return after as number;
};
/* the summary that stands in for a reply (Include as › Summary), for agents and for the page (POST /api/summarize):
   the turn is marked as having one on the way, then gets it (or keeps the one it had). tpl: wording for this once */
export async function summarize(sid: string, id: number, tpl?: string | null): Promise<{ summary?: string; error?: string }> {
  const t = treeOf(sid), n = t?.nodes[id]; if (!n || !n.reply) return { error: 'That prompt has no reply to summarize.' };
  const of = Core.h5(n.reply), keep = n.sum && n.sum.text ? { ...n.sum } : null, d = doc();
  change(sid, (tt) => { tt.nodes[id].sum = { ...(keep || {}), pending: true }; });
  try {
    const r = await sample(Ops.fill(tpl != null && String(tpl).trim() ? String(tpl) : tplOf(d as any)('summarizeReply'), { prompt: n.text || '', reply: n.reply }), { modelTier: d.opts?.model || 'quick', cache: false });
    const text = (r.text || '').trim(); if (!text) throw new Error('empty');
    change(sid, (tt) => { if (tt.nodes[id]) tt.nodes[id].sum = { text, of, by: 'claude' }; });
    return { summary: text };
  } catch {
    change(sid, (tt) => { const m = tt.nodes[id]; if (!m) return; if (keep) m.sum = keep; else delete m.sum; });
    return { error: 'Claude couldn’t write the summary.' };
  }
}
let loopSeq = 0;

const ops: Record<string, (a: A) => Promise<any> | any> = {
  async spawn(a) {
    const sid = runSpace(a.run, true), by = a.agent || 'agent';
    const text = (a.context ? `${String(a.context).trim()}\n\n---\n\n` : '') + a.prompt;
    const id = change(sid, (t) => {
      const nid = addTurn(t, null, text, by, tierOf(a.model));
      const st = agentSettings(a); if (st) t.nodes[nid].set = st;
      const rid = Ops.newRef(t, 'main', nid); t.head = rid;
      if (a.title) t.convs[nid] = { title: String(a.title).slice(0, 80) };
      return nid;
    });
    return reply(sid, id, { ...where(sid, id), message: 'Started a subagent' });
  },
  async ask(a) {
    const sid = runSpace(a.run), t = treeOf(sid), by = a.agent || 'agent';
    const after = branchTip(t, a, 'Say where to continue: after (a prompt number) or branch.');
    const id = change(sid, (tt) => {
      const nid = addTurn(tt, after, a.prompt, by, tierOf(a.model));
      Ops.extend(tt, after, nid);
      return nid;
    });
    return reply(sid, id, { ...where(sid, id), message: 'Asked' });
  },
  /* /loop for agents: the same prompt again after each reply, up to times, or until a quick check says the condition
     is met (that verdict is noted under the reply, as in the page) */
  async loop(a) {
    const sid = runSpace(a.run), t = treeOf(sid), by = a.agent || 'agent';
    let after = branchTip(t, a, 'Say where to loop from: after (a prompt number) or branch.');
    const times = Math.min(20, Math.max(1, a.times || 3)), L = { id: 'a' + (++loopSeq), until: a.until || null };
    let requests = 0, last: number | null = null, lastReply = '', met: any = null, sent = 0, stopNote = '';
    for (let i = 1; i <= times; i++) {
      const from = after;
      const nid = change(sid, (tt) => {
        const nid = addTurn(tt, from, a.prompt, by, tierOf(a.model)); tt.nodes[nid].loop = { id: L.id, i, of: times, ...(L.until ? { until: L.until } : {}) };
        Ops.extend(tt, from, nid, true);
        return nid;
      });
      const r = await writeReply(sid, nid); requests++;
      if (r.error) { stopNote = ` Stopped at #${nid}: ${r.error}`; last = nid; break; }
      after = nid; last = nid; lastReply = r.reply || ''; sent = i;
      if (L.until) { const c = await Ops.loopCheck(io(sid), treeOf(sid), L.until, nid); requests++; change(sid, (tt) => { if (tt.nodes[nid]) tt.nodes[nid].loopCheck = c; }); if (c.met) { met = c; break; } }
    }
    const msg = met ? `Looped ${sent} time${sent === 1 ? '' : 's'}; the condition is met at #${last}${met.why ? ` (${met.why.replace(/\.$/, '')})` : ''}`
      : `Looped ${sent} time${sent === 1 ? '' : 's'}${L.until ? ' and the condition wasn’t met' : ''}`;
    return { ...where(sid, last!), prompt: last, reply: lastReply, requests, message: msg + stopNote };
  },
  async fork(a) {
    const sid = runSpace(a.run), t = treeOf(sid), by = a.agent || 'agent';
    point(t, a.at);
    const id = change(sid, (tt) => {
      const nid = addTurn(tt, a.at, a.prompt, by, tierOf(a.model));
      const st = agentSettings(a); if (st) tt.nodes[nid].set = st;
      Ops.newRef(tt, Ops.nameFor(tt, convOf(tt, a.at), a.name, 'fork'), nid);
      return nid;
    });
    return reply(sid, id, { ...where(sid, id), message: `Forked after #${a.at}` });
  },
  leave_out(a) {
    const sid = runSpace(a.run), t = treeOf(sid), on = a.left_out !== false; need(t, a.prompt);
    const ids = a.until != null ? stretch(t, a.prompt, a.until) : [a.prompt];
    change(sid, (tt) => { for (const x of ids) { const n = tt.nodes[x]; if (on) n.skip = true; else delete n.skip; } });
    const which = ids.length > 1 ? `#${ids[0]}–#${ids[ids.length - 1]} (${ids.length} prompts) are` : `#${a.prompt} is`;
    return { ...where(sid, a.prompt), prompt: a.prompt, message: on ? `${which} left out of what later prompts send` : `${which} included again` };
  },
  async include_as(a) {
    const SM = (globalThis as any).TreechatsSend;
    const sid = runSpace(a.run), t = treeOf(sid); need(t, a.prompt);
    const mode = ({ full: 'full', summary: 'summary', excerpt: 'excerpt', prompt_only: 'prompt', reply_only: 'reply', left_out: 'out' } as Record<string, string>)[a.mode];
    if (!mode) throw new Error(`Unknown mode "${a.mode}".`);
    const ids = a.until != null ? stretch(t, a.prompt, a.until) : [a.prompt];
    if (mode === 'excerpt' && ids.length > 1) throw new Error('An excerpt is for one prompt at a time; leave out until.');
    if (['summary', 'prompt', 'reply'].includes(mode)) { const no = ids.filter((x) => !t.nodes[x].reply); if (no.length) throw new Error(`${no.map((x) => '#' + x).join(', ')} ${no.length === 1 ? 'has' : 'have'} no reply, so ${SM.LABELS[mode].toLowerCase()} doesn’t apply.`); }
    let ex: A | null = null;
    if (mode === 'excerpt') {
      const n = t.nodes[a.prompt], e = a.excerpt || {}, p = SM.piecesFromText(n.text || '', e.prompt || []), r = SM.piecesFromText(n.reply || '', e.reply || []);
      const ed: A = {}, edOf: A = {}; if (typeof e.prompt_text === 'string') { ed.p = e.prompt_text; edOf.p = Core.h5(n.text || ''); } if (typeof e.reply_text === 'string') { ed.r = e.reply_text; edOf.r = Core.h5(n.reply || ''); }
      const miss = [...p.missing.map((x: string) => 'prompt: "' + clip(x, 60) + '"'), ...r.missing.map((x: string) => 'reply: "' + clip(x, 60) + '"')];
      if (miss.length) throw new Error(`These pieces aren’t in #${a.prompt} exactly as given, so nothing changed: ${miss.join('; ')}. Copy them from get_prompt.`);
      if (!p.pieces.length && !r.pieces.length && !Object.keys(ed).length) throw new Error('Pass the pieces to keep in excerpt.prompt and/or excerpt.reply, or your own wording in excerpt.prompt_text or excerpt.reply_text.');
      ex = { p: p.pieces, r: r.pieces, ...(Object.keys(ed).length ? { ed, edOf } : {}) };
    }
    const by = a.agent || 'agent';
    change(sid, (tt) => {
      for (const x of ids) {
        const n = tt.nodes[x];
        if (mode === 'out') { n.skip = true; continue; }
        delete n.skip;
        if (mode === 'full') delete n.send; else n.send = mode;
        if (ex) n.ex = ex;
        if (mode === 'summary' && a.summary && String(a.summary).trim()) n.sum = { text: String(a.summary).trim(), of: Core.h5(n.reply || ''), by };
      }
    });
    let requests = 0; const failed: number[] = [];
    if (mode === 'summary' && !(a.summary && String(a.summary).trim())) {
      for (const x of ids) { const n = treeOf(sid).nodes[x]; if (SM.hasSummary(n) && !SM.stale(n, Core.h5).length) continue; const r = await summarize(sid, x); requests++; if (r.error) failed.push(x); }
    }
    const which = ids.length > 1 ? `#${ids[0]}–#${ids[ids.length - 1]} (${ids.length} prompts) are` : `#${a.prompt} is`;
    const msg = mode === 'full' ? `${which} included in full again` : mode === 'out' ? `${which} left out of what later prompts send` : `${which} included as ${SM.LABELS[mode].toLowerCase()} by later prompts`;
    return { ...where(sid, a.prompt), prompt: a.prompt, requests, message: msg + (failed.length ? `. Claude couldn’t write the summary of ${failed.map((x) => '#' + x).join(', ')}, so ${failed.length === 1 ? 'its' : 'their'} full reply is still sent` : '') };
  },
  edit_reply(a) {
    const sid = runSpace(a.run), t = treeOf(sid); need(t, a.prompt);
    change(sid, (tt) => { const n = tt.nodes[a.prompt]; n.reply = String(a.reply); n.replyEdited = true; n.editedBy = a.agent || 'agent'; });
    return { ...where(sid, a.prompt), prompt: a.prompt, message: `Replaced the reply to #${a.prompt}; prompts after it see this version` };
  },
  async regenerate(a) {
    const sid = runSpace(a.run), t = treeOf(sid), by = a.agent || 'agent'; need(t, a.prompt);
    const id = change(sid, (tt) => Ops.newVersion(tt, a.prompt, { by, tier: tierOf(a.model) || tt.nodes[a.prompt].model }).nid);
    return reply(sid, id, { ...where(sid, id), replaced: a.prompt, message: `New version of #${a.prompt} (the old one is kept)` });
  },
  /* replay: the line from a prompt to the end of a branch (or to the end of the line), one prompt at a time, as new
     versions; onto carries it under another prompt (to continue after a stop), first_prompt replaces the first */
  replay_plan(a) {
    const sid = runSpace(a.run), t = treeOf(sid); need(t, a.prompt); if (a.onto != null) need(t, a.onto);
    const line = replayLine(t, a), n = Ops.replayCount(t, line);
    return { count: n + (a.on_mismatch === 'ignore' ? 0 : Math.max(0, n - 1) + (a.onto != null ? 1 : 0)) };
  },
  async replay(a) {
    const sid = runSpace(a.run), t = treeOf(sid); need(t, a.prompt); if (a.onto != null) need(t, a.onto);
    const line = replayLine(t, a);
    const r = { sid, from: a.prompt, onto: a.onto ?? null, line, by: a.agent || 'agent', firstText: a.first_prompt ?? null,
      mode: a.on_mismatch === 'rewrite' ? 'rewrite' : a.on_mismatch === 'ignore' ? 'off' : 'stop', done: false };
    const out = await Ops.runReplay(r, io(sid));
    const tt = treeOf(sid), asks = out.made.filter((x: number) => tt.nodes[x] && tt.nodes[x].kind !== 'merge'), last = asks[asks.length - 1];
    const lastReply = last != null ? tt.nodes[last].reply : undefined;
    let message = asks.length ? `Replayed ${asks.length} prompt${asks.length === 1 ? '' : 's'} as new versions (#${asks[0]}${asks.length > 1 ? `–#${last}` : ''}); the old ones are kept` : 'Nothing was re-sent';
    if (out.rewrites) message += `. ${out.rewrites} rewritten to fit`;
    if (out.why === 'mismatch') {
      const m = out.mismatch;
      message += `. Stopped before #${m.id}, which no longer fits: ${m.reason || 'the new reply went a different way'}${m.rewrite ? ` Suggested rewrite: "${m.rewrite}"` : ''} To go on, call replay with prompt ${m.id}, onto ${last ?? (a.onto ?? '(the prompt before it)')}, and first_prompt set to your version (or ask after #${last} yourself).`;
    } else if (out.why === 'error') message += `. Stopped: ${out.error}`;
    return { ...(last != null ? where(sid, last) : where(sid, a.prompt)), prompt: last, reply: lastReply, requests: out.requests, message };
  },
  /* an edited prompt: a new version on its own branch, with a reply (as Edit does for people) */
  async edit_prompt(a) {
    const sid = runSpace(a.run), t = treeOf(sid), by = a.agent || 'agent'; need(t, a.prompt);
    if (!String(a.text || '').trim()) throw new Error('Give the new text of the prompt.');
    let name = '';
    const id = change(sid, (tt) => { const r = Ops.newVersion(tt, a.prompt, { text: String(a.text), by, tier: tierOf(a.model) || tt.nodes[a.prompt].model }); name = r.name; return r.nid; });
    return reply(sid, id, { ...where(sid, id), replaced: a.prompt, message: `Edited #${a.prompt} as #${id} on a new branch, ${name}; the original keeps its branch and what followed` });
  },
  /* fan out: the options a reply offers, one branch each. Reading them is one request (unless you give them) */
  async fan_plan(a) {
    const sid = runSpace(a.run), t = treeOf(sid), n = need(t, a.prompt);
    if (!n.reply) throw new Error(`#${a.prompt} has no reply to fan out yet.`);
    if (Array.isArray(a.options) && a.options.length) return { options: a.options.map((o: A) => ({ title: String(o.title || o.prompt || 'option').slice(0, 40), prompt: String(o.prompt || o.title || '') })).filter((o: A) => o.prompt.trim()), read: false };
    let opts2: A[] = [];
    try { const d = await sampleJSON(Ops.fanAsk(io(sid), n.text, n.reply), { modelTier: 'quick', cache: false }); opts2 = (d && d.options || []).map((o: A) => ({ title: String(o.title || '').slice(0, 40), prompt: String(o.prompt || '') })).filter((o: A) => o.prompt.trim()); } catch { /* read the lists instead */ }
    if (!opts2.length) opts2 = Ops.listOptions(n.reply).options.map((o: A) => ({ title: o.title, prompt: o.prompt }));
    if (!opts2.length) throw new Error(`#${a.prompt}'s reply doesn't offer options to fan out. Use fork to try a direction yourself.`);
    return { options: opts2, read: true };
  },
  async fan_out(a) {
    const sid = runSpace(a.run), t = treeOf(sid), by = a.agent || 'agent'; need(t, a.prompt);
    const options = (a.options || []).filter((o: A) => o && String(o.prompt || '').trim());
    if (!options.length) throw new Error('No options to fan out.');
    const made: number[] = change(sid, (tt) => options.map((o: A) => { const nid = addTurn(tt, a.prompt, String(o.prompt), by, tierOf(a.model)); Ops.newRef(tt, Ops.slugName(tt, o.title || 'option', convOf(tt, a.prompt)), nid); return nid; }));
    if (a.replies === false) return { ...where(sid, a.prompt), prompt: a.prompt, message: `Fanned out #${a.prompt} into ${made.length} branches: ${made.map((x, i) => `#${x} ${options[i].title || ''}`).join(', ')}. No replies requested.` };
    const rs = await Promise.all(made.map((x) => writeReply(sid, x)));
    const lines = made.map((x, i) => `#${x} (${options[i].title || 'option'}): ${rs[i].error ? 'no reply: ' + rs[i].error : clip(rs[i].reply || '', 1200)}`).join('\n\n');
    return { ...where(sid, a.prompt), prompt: a.prompt, message: `Fanned out #${a.prompt} into ${made.length} branches, each answered. Use judge after ${a.prompt} to pick, or distill one.\n\n${lines}` };
  },
  /* everything else, by name; describe lists them */
  operate(a) {
    const sid = runSpace(a.run), op = a.op, by = a.agent || 'agent';
    let msg = '', at = a.prompt;
    change(sid, (S) => {
      const want = (id: number, what = 'prompt') => { if (id == null) throw new Error(`"${op}" needs ${what}.`); return need(S, id); };
      const lineBetween = (from: number, until: number) => { if (until == null) return [from]; const c = Core.chain(S, until); const i = c.indexOf(from); if (i < 0) throw new Error(`#${from} isn’t on the line up to #${until}.`); return c.slice(i); };
      const convOfS = (id: number) => convOf(S, id);
      if (op === 'star') { const n = want(a.prompt); const on = a.value !== false; if (on) n.star = true; else delete n.star; msg = on ? `Starred #${a.prompt}` : `Unstarred #${a.prompt}`; }
      else if (op === 'note') { const n = want(a.prompt); const txt = String(a.text || '').trim(); if (a.value === false || !txt) { delete n.note; msg = `Cleared the note on #${a.prompt}`; } else { n.note = a.append && n.note ? n.note + '\n\n' + txt : txt; msg = `Noted on #${a.prompt} (never sent to the model)`; } }
      else if (op === 'branch') { want(a.prompt); const name = Ops.nameFor(S, convOfS(a.prompt), a.name, 'branch'); Ops.newRef(S, name, a.prompt); msg = `Started branch ${name} at #${a.prompt}`; }
      else if (op === 'rename_branch') { const rid = Object.keys(S.refs).find((r) => S.refs[r].name === a.branch && S.nodes[S.refs[r].tip]); if (!rid) throw new Error(`No branch named "${a.branch}".`); const why = a.name ? Ops.renameError(S, rid, a.name) : 'invalid'; if (why === 'invalid') throw new Error('Give a new name: up to 40 letters, numbers, dots, dashes, slashes or underscores, with no spaces.'); if (why === 'taken') throw new Error(`This chat already has a branch named ${a.name}.`); msg = `Renamed ${S.refs[rid].name} to ${a.name}`; S.refs[rid].name = a.name; }
      else if (op === 'make_mainline') { want(a.prompt); Ops.makeMainline(S, a.prompt); msg = `The line through #${a.prompt} is now main`; }
      else if (op === 'merge') { want(a.prompt, 'prompt (the branch tip to merge)'); want(a.onto, 'onto (the prompt to merge into)'); const why = Ops.mergeError(S, a.prompt, a.onto); if (why) throw new Error(why); const r = Ops.merge(S, a.prompt, a.onto, by); at = r.mid; msg = `Merged ${r.from} into ${r.into} at #${r.mid}`; }
      else if (op === 'unmerge') { const n = S.nodes[a.prompt]; if (!n) throw new Error(`There is no #${a.prompt} in this run.`); if (n.kind !== 'merge') throw new Error(`#${a.prompt} isn’t a merge point.`); at = Ops.unmerge(S, a.prompt); msg = `Removed the merge at #${a.prompt}`; }
      else if (op === 'reroot') { want(a.prompt); const text = String(a.text || '').trim(); const r = Ops.reroot(S, a.prompt, text ? { text, by } : null, false); msg = `#${a.prompt} now starts its own chat${r.summary != null ? `, after a summary (#${r.summary})` : ''}`; }
      else if (op === 'squash') { want(a.prompt); want(a.until, 'until (the last prompt to include)'); const why = Ops.squashError(S, a.prompt, a.until); if (why) throw new Error(why); const seg = Ops.squash(S, a.prompt, a.until, false); msg = `Squashed #${seg[0]}–#${seg[seg.length - 1]} into #${a.prompt}`; }
      else if (op === 'splice') { want(a.prompt); const seg = lineBetween(a.prompt, a.until).filter((x) => S.nodes[x].kind !== 'merge'); const top = Ops.splice(S, seg); at = top; msg = `Spliced out ${seg.map((x) => '#' + x).join(', ')}; what followed now follows #${top ?? 'nothing'}`; }
      else if (op === 'delete') { want(a.prompt); const r = Ops.prune(S, a.prompt); at = r.up; msg = `Deleted ${r.deleted.size} prompt${r.deleted.size === 1 ? '' : 's'} from #${a.prompt}`; }
      else if (op === 'rebase') { want(a.prompt); want(a.onto, 'onto (the new parent)'); const why = Ops.rebaseError(S, a.prompt, a.onto); if (why) throw new Error(why); Ops.rebase(S, a.prompt, a.onto); msg = `Moved #${a.prompt} and what follows under #${a.onto}; their replies stay as they were (see get_prompt for context changes)`; }
      else if (op === 'cherry_pick') { want(a.prompt); want(a.onto, 'onto (where the copy goes)'); const nid = Ops.cherryPick(S, a.prompt, a.onto, by); at = nid; msg = `Copied #${a.prompt}'s text under #${a.onto} as #${nid}, without a reply (ask regenerate for one)`; }
      else if (op === 'rename_chat') { want(a.prompt); const name = String(a.name || '').trim(); if (!name) throw new Error('Give the new title as name.'); const k = Ops.convKeyOf(S, a.prompt); S.convs[k] = Object.assign(S.convs[k] || {}, { title: name.slice(0, 80) }); msg = `Renamed the chat to "${name.slice(0, 80)}"`; }
      else if (op === 'model_settings') { const n = want(a.prompt); if (a.value === false) { delete n.set; msg = `Cleared the model settings on #${a.prompt}`; } else { const st = agentSettings(a); if (!st) throw new Error('Give at least one of system, thinking, effort, temperature, max_tokens (or value: false to clear).'); n.set = Object.assign(n.set || {}, st); msg = `Model settings from #${a.prompt}: ${Ops.setSummary(n.set)}`; } }
      else throw new Error(`Unknown operation "${op}". Call describe to see them.`);
    });
    const t = treeOf(sid);
    return { ...(at != null && t.nodes[at] ? where(sid, at) : { project: doc().db.spaces[sid].name }), prompt: at != null && t.nodes[at] ? at : undefined, message: msg };
  },
  /* a second opinion: a new chat in the run that sees only the reply (or the conversation up to it) */
  async review(a) {
    const sid = runSpace(a.run), t = treeOf(sid); need(t, a.prompt);
    if (!t.nodes[a.prompt].reply) throw new Error(`#${a.prompt} has no reply to review yet.`);
    const d = doc();
    const id = change(sid, (tt) => Ops.addReviewChat(tt, envOf(d as any, tt), a.prompt, !!a.include_conversation, a.instructions, a.agent || 'agent', tplOf(d as any)('review')));
    return reply(sid, id, { ...where(sid, id), message: `Reviewed #${a.prompt} in a new chat, which saw ${a.include_conversation ? 'the conversation up to it' : 'only that prompt and reply'}` });
  },
  /* the follow-ups of a prompt (or the ones named), judged or combined as in Compare */
  async judge(a) {
    const sid = runSpace(a.run), t = treeOf(sid);
    const { parent, ids } = pickedSet(t, a);
    const r = await Ops.judge(io(sid), t, parent, ids, a.criteria);
    const lines = r.ids.map((i: number) => `#${i}${i === r.best ? ' (pick)' : ''}: ${r.reasons[i] || 'no reason given'}`).join('\n');
    return { ...where(sid, r.best ?? ids[0]), prompt: r.best ?? undefined, message: `Judged ${r.ids.length} ${parent != null && a.after != null ? `follow-ups to #${a.after}` : 'prompts'} against "${r.criteria}". ${r.best ? `Pick: #${r.best}.` : 'No pick.'} ${r.summary}\n${lines}\nNothing was changed.` };
  },
  async combine(a) {
    const sid = runSpace(a.run), t = treeOf(sid);
    const { parent, ids } = pickedSet(t, a);
    if (parent == null) throw new Error('These prompts share no context, so there is nowhere to add a combined reply.');
    const c = await Ops.combine(io(sid), t, parent, ids, a.instructions);
    const d = doc();
    const nid = change(sid, (tt) => Ops.addCombined(tt, envOf(d as any, tt), parent, c, a.agent || 'agent'));
    return { ...where(sid, nid), prompt: nid, reply: c.reply, message: `Combined ${c.ids.map((x: number) => '#' + x).join(', ')} into #${nid}, a new follow-up to #${parent}, marked as combined. Sources: ${Object.entries(c.sources).map(([k, v]) => `#${k} ${v}`).join('; ') || 'not given'}` };
  },
  async distill(a) {
    const sid = runSpace(a.run), t = treeOf(sid), d = doc();
    let id = a.prompt;
    if (id == null && a.branch) { const r: any = Object.values(t.refs).find((r: any) => r.name === a.branch && t.nodes[r.tip]); if (!r) throw new Error(`No branch named "${a.branch}" in this run.`); id = r.tip; }
    if (id == null) throw new Error('Say what to distill: prompt (a number) or branch.');
    if (point(t, id).kind === 'merge' && a.save_as_note) throw new Error(`#${id} is a merge point, which can’t hold a note. Distill the prompt before it.`);
    const convo = Core.turnsFor(t, id, envOf(d as any, t), true).map((x) => `${x.role === 'user' ? 'User' : 'Claude'}: ${x.content}`).join('\n\n');
    const r = await sample(Ops.fill(tplOf(d as any)('distill'), { conversation: convo }, Ops.PROMPTS.distill.fmt), { modelTier: d.opts?.model || 'quick', cache: false });
    const brief = r.text.trim();
    if (a.save_as_note) change(sid, (tt) => { const n = tt.nodes[id]; n.note = (n.note && n.note.trim() ? n.note.trim() + '\n\n' : '') + brief; });
    return { ...where(sid, id), prompt: id, brief, message: 'Distilled' };
  },
};

export class AgentError extends Error {}

/* each run may spend a limited number of model requests, so a looping agent can't run up cost */
const spent = new Map<string, number>();
export function refund(run: string, n = 1) { spent.set(run, Math.max(0, (spent.get(run) || 0) - n)); }
export function spend(run: string, n = 1) {
  const used = spent.get(run) || 0;
  if (used + n > config.agentMaxRequests) throw new AgentError(`Run "${run}" has used its ${config.agentMaxRequests} requests. Start a new run, or raise TREECHATS_AGENT_MAX_REQUESTS in .env and restart Treechats.`);
  spent.set(run, used + n);
  return config.agentMaxRequests - used - n;
}
/* runs an operation by name; errors meant for the agent come back as AgentError */
export async function run(op: string, args: A): Promise<any> {
  const f = ops[op]; if (!f) throw new AgentError(`Unknown operation "${op}".`);
  try { return await f(args || {}); }
  catch (e) { throw e instanceof AgentError ? e : new AgentError((e as Error).message); }
}
