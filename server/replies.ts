/* Replies: every reply is written by the server, yours and agents' alike, so it carries on with the page closed.

   Prompts wait in one queue: a few are answered at a time, and a prompt waits for any reply (or summary) still on
   its way above it, since that is part of what it sends. A reply is written into the document: the text, when it
   was written, the tier that answered, what was sent to get it (the context fingerprint), usage, thinking and tool
   steps; the chat becomes active and unread. Open pages are told when a prompt is waiting ("genwait"), how far its
   reply has got ("gen") and when it's done ("gendone", with the revision that holds it), and can stop it. */
import { mutate, current, onChange, revision, type Doc } from './doc.ts';
import { getFile } from './store.ts';
import { Core, Ops, envOf } from './context.ts';
import { provider } from './claude.ts';
import { config } from './config.ts';
import { sample, SampleError } from './sample.ts';

type Live = { sid: string; id: number; text: string; tier: string; started: number; steps: any[]; ctl: AbortController; stopped?: boolean; waiters: ((r: Result) => void)[] };
type Result = { reply?: string; note?: string; error?: string };
export type LiveEvent = { kind: 'genwait'; sid: string; id: number } | { kind: 'gen'; sid: string; id: number; text: string; tier: string; started: number; steps: any[] }
  | { kind: 'gendone'; sid: string; id: number; note: string | null; reply?: string; error?: string; rev: number };
const live = new Map<string, Live>();
const listeners = new Set<(e: LiveEvent) => void>();
const key = (sid: string, id: number) => sid + ':' + id;
export function onLive(fn: (e: LiveEvent) => void) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (e: LiveEvent) => { for (const fn of listeners) try { fn(e); } catch { /* a closed page */ } };
/* what's queued and being written now, for a page that opens partway through */
export const liveNow = (): LiveEvent[] => [...queue.map((q) => ({ kind: 'genwait' as const, sid: q.sid, id: q.id })), ...[...live.values()].map((g) => ({ kind: 'gen' as const, sid: g.sid, id: g.id, text: g.text, tier: g.tier, started: g.started, steps: g.steps }))];

/* ---- the queue ---- */
const MAX_PAR = 3;
type Q = { sid: string; id: number; waiters: ((r: Result) => void)[] };
const queue: Q[] = [];
const treeOf = (sid: string) => (current().doc as Doc | null)?.db.spaces[sid]?.tree;
const finish = (q: Q, r: Result) => { for (const w of q.waiters) w(r); };
/* Ask for replies; each promise resolves when that reply is written (or fails, or is stopped). A prompt already
   waiting or being answered isn't asked twice: its promise waits for the same reply. */
export function want(sid: string, ids: number[]): Promise<Result>[] {
  const out = ids.map((id) => new Promise<Result>((res) => {
    const t = treeOf(sid), n = t?.nodes[id];
    if (!n || n.kind === 'merge') { res({ error: 'That prompt can’t have a reply.' }); return; }
    const g = live.get(key(sid, id)); if (g) { g.waiters.push(res); return; }
    const q = queue.find((x) => x.sid === sid && x.id === id); if (q) { q.waiters.push(res); return; }
    queue.push({ sid, id, waiters: [res] }); emit({ kind: 'genwait', sid, id });
  }));
  pump();
  return out;
}
export const reply = (sid: string, id: number) => want(sid, [id])[0];
/* the prompt above this one that still has a reply or summary on the way, 'gone' if it was deleted, else null */
function waitingOn(q: Q): number | 'gone' | null {
  const t = treeOf(q.sid); if (!t || !t.nodes[q.id]) return 'gone';
  for (const x of Core.path(t, q.id)) {
    if (x === q.id) continue;
    if (live.has(key(q.sid, x)) || t.nodes[x].pending || queue.some((o) => o !== q && o.sid === q.sid && o.id === x)) return x;
  }
  return null;
}
function pump() {
  for (let i = 0; i < queue.length && live.size < MAX_PAR;) {
    const q = queue[i], w = waitingOn(q);
    if (w === 'gone') { queue.splice(i, 1); finish(q, { error: 'The prompt was deleted before its reply was written.' }); emit({ kind: 'gendone', sid: q.sid, id: q.id, note: null, error: 'The prompt was deleted before its reply was written.', rev: revision() }); continue; }
    if (w != null) { i++; continue; }
    queue.splice(i, 1); start(q);
  }
}
/* the prompts waiting below one that was stopped are cancelled too */
function dropWaiting(sid: string, id: number) {
  const t = treeOf(sid);
  for (let i = queue.length - 1; i >= 0; i--) {
    const q = queue[i];
    if (q.sid === sid && (q.id === id || (t && t.nodes[q.id] && Core.path(t, q.id).includes(id)))) { queue.splice(i, 1); finish(q, { error: 'The reply was cancelled.' }); emit({ kind: 'gendone', sid, id: q.id, note: null, error: 'The reply was cancelled.', rev: revision() }); }
  }
}
/* Stop: a reply being written stops (what came so far is kept); a waiting one is cancelled, with what waits below it */
export function stopReply(sid: string, id: number) {
  const g = live.get(key(sid, id));
  if (g) { g.stopped = true; g.ctl.abort(); return true; }
  if (queue.some((q) => q.sid === sid && q.id === id)) { dropWaiting(sid, id); pump(); return true; }
  return false;
}
/* after any change: a prompt that's gone stops its reply, and a summary that finished lets prompts below go on */
onChange(() => {
  for (const g of live.values()) { const t = treeOf(g.sid); if (!t || !t.nodes[g.id]) { g.stopped = true; g.ctl.abort(); } }
  pump();
});

const provName = () => config.fake ? 'fake' : provider();

async function start(q: Q) {
  const { sid, id } = q;
  const doc = current().doc as Doc | null, tree = doc?.db.spaces[sid]?.tree, n = tree?.nodes[id];
  let result: Result = { error: 'The prompt was deleted before its reply was written.' }, note: string | null = null;
  try {
    if (!doc || !tree || !n) return;
    const env = envOf(doc as any, tree);
    const settings: any = { ...Core.settingsFor(tree, id, env).values };
    /* tools: the branch's own choice if it has one, else the ones picked by the input box */
    if (settings.tools == null) { const t = Ops.toolsFor(doc.opts?.tools, provName()); if (t.length) settings.tools = t; }
    const tier = n.askTier || doc.opts?.model || 'quick';
    const sig = Core.ctxSig(tree, id, env), started = Date.now();
    const g: Live = { sid, id, text: '', tier, started, steps: [], ctl: new AbortController(), waiters: q.waiters };
    live.set(key(sid, id), g);
    /* images travel with the prompt being answered; earlier ones are described by name */
    const images = (n.files || []).filter((f: any) => f.kind === 'image').map((f: any) => getFile(f.id)).filter((r: any) => r && r.data).slice(0, 20).map((r: any) => ({ mediaType: r.type || 'image/png', data: r.data }));
    let last = 0;
    const tell = (force = false) => { const now = Date.now(); if (!force && now - last < 120) return; last = now; emit({ kind: 'gen', sid, id, text: g.text, tier, started, steps: g.steps }); };
    tell(true);
    let r: Awaited<ReturnType<typeof sample>> | null = null, err: SampleError | null = null;
    try {
      r = await sample(Core.turnsFor(tree, id, env, false), { modelTier: tier, settings, signal: g.ctl.signal, ...(images.length ? { images } : {}),
        onText: ({ text }) => { g.text = text; tell(); },
        onStep: (kind, d) => { if (kind === 'step') g.steps.push({ ...d }); else { const st = g.steps.find((x) => x.id === d.id); if (st) { const { id: _, ...res } = d; st.result = res; } } tell(true); } });
    } catch (e) { err = e instanceof SampleError ? e : new SampleError('network', '', (e as Error).message); }
    const text = r ? r.text : (err?.text || '');
    const unused = r && r.notes.length ? `Model settings not used by this model: ${r.notes.join(', ')}.` : null;
    note = r ? ([r.truncated ? 'Cut short by the length limit.' : (r.modelTierApplied !== tier ? `Your plan served the ${r.modelTierApplied} tier.` : null), unused].filter(Boolean).join(' ') || null)
      : err!.code === 'cancelled' ? (text ? 'Stopped early.' : null) : Ops.errCopy(err!.code);
    const tierApplied = r ? r.modelTierApplied : null;
    mutate([sid], (d) => {
      const t = d.db.spaces[sid]?.tree, m = t?.nodes[id]; if (!m) return;
      if (text) {
        m.reply = text; m.rt = [started, Date.now()]; delete m.stale; delete m.replyEdited;
        if (tierApplied) m.model = tierApplied; else delete m.model;
        m.ctx = sig;
        if (r?.usage) m.usage = r.usage; else delete m.usage;
        if (r?.thinking) m.thinking = r.thinking; else delete m.thinking;
        const steps = r?.steps || g.steps; if (steps && steps.length) m.steps = steps; else delete m.steps;
        if (r?.sources && r.sources.length) m.sources = r.sources; else delete m.sources;
        /* the chat is active now, and unread until someone looks (an open page showing it clears that) */
        const k = Ops.convKeyOf(t, id);
        if (k != null) { t.convs = t.convs || {}; t.convs[k] = { ...(t.convs[k] || {}), t: Date.now(), unread: true }; }
      }
      delete m.askTier;
    });
    live.delete(key(sid, id));
    result = text ? { reply: text, ...(note ? { note } : {}) } : { error: note || 'No reply came back.' };
    /* stopping a reply also cancels the prompts below it that were waiting for it */
    if (g.stopped) dropWaiting(sid, id);
  } catch (e) {
    live.delete(key(sid, id));
    result = { error: (e as Error).message || 'No reply came back.' };
  } finally {
    emit({ kind: 'gendone', sid, id, note, ...(result.reply != null ? { reply: result.reply } : { error: result.error }), rev: revision() });
    for (const w of (live.get(key(sid, id))?.waiters || q.waiters)) w(result);
    pump();
  }
}
