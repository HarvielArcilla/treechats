/* Reads the saved tree on the server side, for the MCP server: spaces, conversations, branches, and the context a
   prompt would send. This mirrors how the page builds a request (path, merge notes, left-out prompts, standing
   instructions) so that "get context" here gives the same text as "Copy as a prompt" there.

   One difference: attached and space files are kept in the browser, not in the saved state, so here they appear
   by name only. */
import { getValue } from './store.ts';

type Node = { id: number; parents: number[]; text: string; reply?: string; kind?: string; alt?: number; skip?: boolean; seam?: string; files?: { id: string; name: string; kind?: string }[]; note?: string; from?: string; into?: string; star?: boolean; ctx?: { h: string; at: string }; set?: Record<string, unknown> };
export type Pin = { id: number; name: string; text: string; at?: number | null; off?: boolean };
export type Tree = { nodes: Record<string, Node>; refs: Record<string, { name: string; tip: number }>; head?: string | null; active?: Record<string, number>; convs?: Record<string, { title?: string; sel?: number; t?: number }>; files?: { id: string; name: string }[]; pins?: Pin[] };
type State = { db: { spaces: Record<string, { id: string; name: string; tree: Tree; sel?: number | null }>; order: string[]; current: string }; opts?: { prompts?: Record<string, string> } };

export const SEAM = 'Separately, in a parallel thread that branched off earlier in this conversation, we discussed the following.';
const KEY = 'treechats-v1';

export function loadState(raw: string | null = getValue(KEY)): State | null {
  if (!raw) return null;
  try { const d = JSON.parse(raw); return d && d.db && d.db.spaces ? d : null; } catch { return null; }
}

export class TreeView {
  constructor(public t: Tree) {}
  node = (id: number) => this.t.nodes[id];
  all = () => Object.values(this.t.nodes).sort((a, b) => a.id - b.id);
  activeOf(gid: number) {
    const a = this.t.active?.[gid];
    if (a != null && this.t.nodes[a] && this.t.nodes[a].alt === gid) return a;
    const g = this.all().filter((m) => m.alt === gid);
    return g.length ? g[g.length - 1].id : null;
  }
  visible = (n: Node) => n.alt == null || this.activeOf(n.alt) === n.id;
  roots = () => this.all().filter((n) => !n.parents.length && this.visible(n));
  chain(id: number) { const c: number[] = []; let n = this.t.nodes[id]; while (n) { c.push(n.id); n = this.t.nodes[n.parents[0]]; } return c.reverse(); }
  path(id: number, memo = new Map<number, number[]>()): number[] {
    if (memo.has(id)) return memo.get(id)!;
    const res: number[] = [];
    for (const p of this.t.nodes[id].parents) for (const x of this.path(p, memo)) if (!res.includes(x)) res.push(x);
    res.push(id); memo.set(id, res); return res;
  }
  convKey = (r: Node) => r.alt ?? r.id;
  title(r: Node) {
    const t = this.t.convs?.[this.convKey(r)]?.title;
    if (t) return t;
    const first = (r.text || 'Untitled').replace(/\s+/g, ' ').trim();
    return first.length > 80 ? first.slice(0, 79) + '…' : first;
  }
  rootOf = (id: number) => this.t.nodes[this.chain(id)[0]];
  branches(rootId?: number) {
    return Object.entries(this.t.refs || {})
      .filter(([, r]) => this.t.nodes[r.tip] && (rootId == null || this.chain(r.tip)[0] === rootId))
      .map(([rid, r]) => ({ rid, name: r.name, tip: r.tip, head: rid === this.t.head }));
  }
  /* oldest first; a merge note goes before the turns each merge brings in */
  entries(id: number, seamDefault: string) {
    const p = this.path(id), seams = new Map<number, number>();
    for (const m of p) {
      const n = this.t.nodes[m]; if (n.parents.length < 2) continue;
      const seen = new Set(this.path(n.parents[0]));
      for (const q of n.parents.slice(1)) {
        const idx = this.path(q).filter((x) => !seen.has(x)).map((x) => p.indexOf(x)).filter((i) => i >= 0);
        if (idx.length) { const at = Math.min(...idx); if (!seams.has(at)) seams.set(at, m); }
        for (const x of this.path(q)) seen.add(x);
      }
    }
    const out: ({ seam: true; text: string; merge: number } | { seam?: false; id: number })[] = [];
    p.forEach((x, i) => { if (seams.has(i)) { const m = seams.get(i)!; out.push({ seam: true, merge: m, text: this.t.nodes[m].seam || seamDefault }); } out.push({ id: x }); });
    return out;
  }
}

const fileStub = (f: { name: string; kind?: string }) => f.kind === 'image' ? `[Attached image: ${f.name}]` : `<file name="${f.name}">\n(The contents of this file are kept in the browser, so they aren't included here.)\n</file>`;

/* branch settings in effect at a prompt (page: settingsFor), and the pins it sends (page: pinsFor) */
const SET_FIELDS = ['system', 'thinking', 'effort', 'temperature', 'maxTokens'];
export function settingsFor(tree: Tree, id: number) {
  const v = new TreeView(tree), out: Record<string, unknown> = {}, seen = new Set<string>();
  for (const x of v.chain(id).reverse()) { const st = tree.nodes[x]?.set; if (!st) continue; for (const f of SET_FIELDS) if (!seen.has(f) && f in st) { seen.add(f); if (st[f] != null) out[f] = st[f]; } }
  return out;
}
function pinsFor(tree: Tree, id: number) {
  const top: Pin[] = [], at = new Map<number, Pin[]>(), p = new Set(new TreeView(tree).path(id));
  for (const pin of tree.pins || []) {
    if (pin.off) continue;
    if (pin.at == null) top.push(pin);
    else if (p.has(pin.at)) { if (!at.has(pin.at)) at.set(pin.at, []); at.get(pin.at)!.push(pin); }
  }
  return { top, at };
}
const pinBlock = (pin: Pin) => `<document name="${pin.name}">\n${pin.text}\n</document>`;
const systemOf = (tree: Tree, id: number) => String(settingsFor(tree, id).system ?? '').trim();

/* The turns a request from this prompt sends, including its own reply, as the page's turnsFor(id, true) does */
export function turnsFor(state: State, tree: Tree, id: number) {
  const v = new TreeView(tree), prompts = state.opts?.prompts || {}, pins = pinsFor(tree, id);
  const raw: { role: 'user' | 'assistant'; content: string }[] = [];
  const instr = (prompts.instructions ?? '').trim();
  if (instr) raw.push({ role: 'user', content: instr });
  if (tree.files && tree.files.length) raw.push({ role: 'user', content: 'Files shared in this space:\n\n' + tree.files.map(fileStub).join('\n\n') });
  for (const pin of pins.top) raw.push({ role: 'user', content: pinBlock(pin) });
  for (const e of v.entries(id, prompts.seam ?? SEAM)) {
    if (e.seam) { raw.push({ role: 'user', content: e.text }); continue; }
    for (const pin of pins.at.get(e.id) || []) raw.push({ role: 'user', content: pinBlock(pin) });
    const n = tree.nodes[e.id];
    if (n.skip && e.id !== id) continue;
    const fl = (n.files || []).map(fileStub).join('\n\n');
    if (n.text || fl) raw.push({ role: 'user', content: fl ? fl + (n.text ? '\n\n' + n.text : '') : n.text });
    if (n.reply) raw.push({ role: 'assistant', content: n.reply });
  }
  const out: typeof raw = [];
  for (const t of raw) { const last = out[out.length - 1]; if (last && last.role === t.role) last.content += '\n\n' + t.content; else out.push({ ...t }); }
  return out;
}

/* the same block as the page's "Copy as a prompt" */
export function contextPrompt(state: State, tree: Tree, id: number) {
  const sys = systemOf(tree, id);
  const body = (sys ? `<system>\n${sys}\n</system>\n\n` : '') + turnsFor(state, tree, id).map((t) => `<${t.role}>\n${t.content}\n</${t.role}>`).join('\n\n');
  return `Here is an earlier conversation, for context. Read it, then help with what I ask after it.\n\n<conversation>\n${body}\n</conversation>\n\n`;
}

/* The context fingerprint, as the page computes it (see "Context fingerprint" in web/index.html): each reply records
   a hash per part of what was sent, so operators can see what changed above a reply since. Never sent to a model. */
export function hash53(str: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}
const h5 = (str: string) => hash53(str).slice(-5);
export function ctxSig(state: State, tree: Tree, id: number) {
  const v = new TreeView(tree), prompts = state.opts?.prompts || {}, at: string[] = [], pins = pinsFor(tree, id), sys = systemOf(tree, id);
  const instr = (prompts.instructions ?? '').trim();
  if (sys) at.push('y:' + h5(sys));
  if (instr) at.push('i:' + h5(instr));
  if (tree.files && tree.files.length) at.push('f:' + h5(tree.files.map((f) => f.id + '/' + f.name).join('|')));
  const pinSig = (pin: Pin) => at.push('p' + pin.id + ':' + h5(pin.name + '\u0000' + pin.text));
  pins.top.forEach(pinSig);
  for (const e of v.entries(id, prompts.seam ?? SEAM)) {
    if (e.seam) { at.push('s' + e.merge + ':' + h5(e.text)); continue; }
    (pins.at.get(e.id) || []).forEach(pinSig);
    const n = tree.nodes[e.id];
    if (n.kind === 'merge' || (n.skip && e.id !== id)) continue;
    const files = (n.files || []).map((f) => f.id + '/' + f.name).join('|');
    const q = h5((n.text || '') + '\u0000' + files), r = n.reply ? h5(n.reply) : '';
    at.push(e.id + ':' + q + (e.id !== id && r ? '.' + r : ''));
  }
  let h = ''; for (const x of at) h = hash53(h + '|' + x);
  return { h: h.slice(-8), at: at.join(',') };
}
/* what changed above a reply since it was written, in words; null if nothing did or nothing was recorded */
export function ctxChanges(state: State, tree: Tree, id: number): string[] | null {
  const n = tree.nodes[id];
  if (!n || !n.ctx || !n.reply) return null;
  const now = ctxSig(state, tree, id); if (now.h === n.ctx.h) return null;
  const map = (at: string) => new Map(at ? at.split(',').map((x) => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)] as [string, string]; }) : []);
  const was = map(n.ctx.at), is = map(now.at), out: string[] = [];
  const name = (k: string) => k === 'i' ? 'standing instructions' : k === 'f' ? 'project files' : k === 'y' ? 'system prompt' : k[0] === 'p' ? `pinned "${(tree.pins || []).find((x) => 'p' + x.id === k)?.name ?? 'item'}"` : k[0] === 's' ? `merge note at #${k.slice(1)}` : +k === id ? 'this prompt' : '#' + k;
  const num = (k: string) => /^\d+$/.test(k);
  for (const [k, val] of is) {
    if (!was.has(k)) { out.push(`${name(k)} ${num(k) ? 'back in' : 'added'}`); continue; }
    const w = was.get(k)!; if (w === val) continue;
    const [q0, r0 = ''] = w.split('.'), [q1, r1 = ''] = val.split('.');
    out.push(`${name(k)} ${!num(k) ? 'changed' : +k === id || (q0 !== q1 && r0 !== r1) ? 'edited' : q0 !== q1 ? 'prompt edited' : r0 && r1 ? 'reply edited' : r1 ? 'reply added' : 'reply removed'}`);
  }
  for (const k of was.keys()) if (!is.has(k)) out.push(`${name(k)} ${num(k) && tree.nodes[k as unknown as number]?.skip ? 'left out' : 'removed'}`);
  return out.length ? out : null;
}
