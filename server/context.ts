/* Reads the saved tree on the server side, for the MCP server: spaces, conversations, branches, and the context a
   prompt would send. This mirrors how the page builds a request (path, merge notes, left-out prompts, standing
   instructions) so that "get context" here gives the same text as "Copy as a prompt" there.

   One difference: attached and space files are kept in the browser, not in the saved state, so here they appear
   by name only. */
import { getValue } from './store.ts';

type Node = { id: number; parents: number[]; text: string; reply?: string; kind?: string; alt?: number; skip?: boolean; seam?: string; files?: { id: string; name: string; kind?: string }[]; note?: string; from?: string; into?: string; star?: boolean };
export type Tree = { nodes: Record<string, Node>; refs: Record<string, { name: string; tip: number }>; head?: string | null; active?: Record<string, number>; convs?: Record<string, { title?: string; sel?: number; t?: number }>; files?: { id: string; name: string }[] };
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
    const out: ({ seam: true; text: string } | { seam?: false; id: number })[] = [];
    p.forEach((x, i) => { if (seams.has(i)) { const m = seams.get(i)!; out.push({ seam: true, text: this.t.nodes[m].seam || seamDefault }); } out.push({ id: x }); });
    return out;
  }
}

const fileStub = (f: { name: string; kind?: string }) => f.kind === 'image' ? `[Attached image: ${f.name}]` : `<file name="${f.name}">\n(The contents of this file are kept in the browser, so they aren't included here.)\n</file>`;

/* The turns a request from this prompt sends, including its own reply, as the page's turnsFor(id, true) does */
export function turnsFor(state: State, tree: Tree, id: number) {
  const v = new TreeView(tree), prompts = state.opts?.prompts || {};
  const raw: { role: 'user' | 'assistant'; content: string }[] = [];
  const instr = (prompts.instructions ?? '').trim();
  if (instr) raw.push({ role: 'user', content: instr });
  if (tree.files && tree.files.length) raw.push({ role: 'user', content: 'Files shared in this space:\n\n' + tree.files.map(fileStub).join('\n\n') });
  for (const e of v.entries(id, prompts.seam ?? SEAM)) {
    if (e.seam) { raw.push({ role: 'user', content: e.text }); continue; }
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
  const body = turnsFor(state, tree, id).map((t) => `<${t.role}>\n${t.content}\n</${t.role}>`).join('\n\n');
  return `Here is an earlier conversation, for context. Read it, then help with what I ask after it.\n\n<conversation>\n${body}\n</conversation>\n\n`;
}
