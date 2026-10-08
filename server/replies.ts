/* Replies written by the server: for prompts agents add (and anything else the server asks for). A reply is written
   into the document the way the page writes its own (see finishGen in web/index.html): the text, when it was written,
   the tier that answered, what was sent to get it (the context fingerprint), usage, thinking and tool steps; the chat
   becomes active and unread. While it is being written, open pages are told how far it has got, and can stop it. */
import { mutate, current, type Doc } from './doc.ts';
import { Core, Ops, envOf } from './context.ts';
import { provider } from './claude.ts';
import { config } from './config.ts';
import { sample, SampleError } from './sample.ts';

type Live = { sid: string; id: number; text: string; tier: string; started: number; steps: any[]; ctl: AbortController; stopped?: boolean };
export type LiveEvent = { kind: 'gen'; sid: string; id: number; text: string; tier: string; started: number; steps: any[] } | { kind: 'gendone'; sid: string; id: number; note: string | null };
const live = new Map<string, Live>();
const listeners = new Set<(e: LiveEvent) => void>();
const key = (sid: string, id: number) => sid + ':' + id;
export function onLive(fn: (e: LiveEvent) => void) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (e: LiveEvent) => { for (const fn of listeners) try { fn(e); } catch { /* a closed page */ } };
/* replies being written now, for a page that opens partway through */
export const liveNow = () => [...live.values()].map((g) => ({ kind: 'gen' as const, sid: g.sid, id: g.id, text: g.text, tier: g.tier, started: g.started, steps: g.steps }));
export function stopReply(sid: string, id: number) { const g = live.get(key(sid, id)); if (!g) return false; g.stopped = true; g.ctl.abort(); return true; }

/* a few at a time, like the page */
const MAX_PAR = 3;
let running = 0; const waiting: (() => void)[] = [];
const slot = () => running < MAX_PAR ? (running++, Promise.resolve()) : new Promise<void>((r) => waiting.push(() => { running++; r(); }));
const release = () => { running--; const next = waiting.shift(); if (next) next(); };

const provName = () => config.fake ? 'fake' : provider();

export async function reply(sid: string, id: number): Promise<{ reply?: string; note?: string; error?: string }> {
  await slot();
  try {
    const doc = current().doc as Doc | null, tree = doc?.db.spaces[sid]?.tree, n = tree?.nodes[id];
    if (!doc || !tree || !n) return { error: 'The prompt was deleted before its reply was written.' };
    const env = envOf(doc as any, tree);
    const settings: any = { ...Core.settingsFor(tree, id, env).values };
    /* tools: the branch's own choice if it has one, else the ones picked by the input box */
    if (settings.tools == null) { const t = Ops.toolsFor(doc.opts?.tools, provName()); if (t.length) settings.tools = t; }
    const tier = n.askTier || doc.opts?.model || 'quick';
    const sig = Core.ctxSig(tree, id, env), started = Date.now();
    const g: Live = { sid, id, text: '', tier, started, steps: [], ctl: new AbortController() };
    live.set(key(sid, id), g);
    let last = 0;
    const tell = (force = false) => { const now = Date.now(); if (!force && now - last < 120) return; last = now; emit({ kind: 'gen', sid, id, text: g.text, tier, started, steps: g.steps }); };
    tell(true);
    let r: Awaited<ReturnType<typeof sample>> | null = null, err: SampleError | null = null;
    try {
      r = await sample(Core.turnsFor(tree, id, env, false), { modelTier: tier, settings, signal: g.ctl.signal,
        onText: ({ text }) => { g.text = text; tell(); },
        onStep: (kind, d) => { if (kind === 'step') g.steps.push({ ...d }); else { const st = g.steps.find((x) => x.id === d.id); if (st) { const { id: _, ...res } = d; st.result = res; } } tell(true); } });
    } catch (e) { err = e instanceof SampleError ? e : new SampleError('network', '', (e as Error).message); }
    const text = r ? r.text : (err?.text || '');
    const unused = r && r.notes.length ? `Model settings not used by this model: ${r.notes.join(', ')}.` : null;
    const note = r ? ([r.truncated ? 'Cut short by the length limit.' : (r.modelTierApplied !== tier ? `Your plan served the ${r.modelTierApplied} tier.` : null), unused].filter(Boolean).join(' ') || null)
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
    emit({ kind: 'gendone', sid, id, note });
    return text ? { reply: text, ...(note ? { note } : {}) } : { error: note || 'No reply came back.' };
  } finally { release(); }
}
