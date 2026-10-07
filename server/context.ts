/* Reads the saved tree on the server side, for the MCP server: spaces, conversations, branches, and the context a
   prompt would send. This mirrors how the page builds a request (path, merge notes, left-out prompts, standing
   instructions) so that "get context" here gives the same text as "Copy as a prompt" there.

   One difference: attached and project files are kept in the browser, not in the saved state, so here they appear
   by name only, except files from a linked folder, which are read from disk. */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve as resolvePath, sep as pathSep } from 'node:path';
import { getValue } from './store.ts';
/* how each turn is sent (full, summary, excerpt, prompt only, reply only): the page's own file, so both build the same
   request */
import '../web/public/sendmodes.js';

type Send = {
  MODES: string[]; LABELS: Record<string, string>; DEFAULTS: Record<string, string>; JOIN: string;
  modeOf(n: Node): string; apply(n: Node, user: string, reply: string, tpl: (k: string) => string): { user: string; reply: string };
  mark(n: Node, tpl: (k: string) => string): string; stale(n: Node, h: (s: string) => string): string[];
  texts(list: unknown): string[]; piecesFromText(text: string, list: string[]): { pieces: { s: number; e: number; t: string }[]; missing: string[] };
};
export const Send = (globalThis as unknown as { TreechatsSend: Send }).TreechatsSend;

type Node = { id: number; parents: number[]; text: string; reply?: string; kind?: string; alt?: number; skip?: boolean; send?: string; sum?: { text?: string; of?: string; pending?: boolean; by?: string }; ex?: { p?: unknown[]; r?: unknown[] }; seam?: string; files?: { id: string; name: string; kind?: string }[]; note?: string; from?: string; into?: string; star?: boolean; ctx?: { h: string; at: string }; set?: Record<string, unknown>; usage?: { input: number; output: number; cost?: number }; thinking?: string; replyEdited?: boolean; combined?: { from: number[] }; reviewOf?: { id: number }; by?: string };
export type Tree = { nodes: Record<string, Node>; refs: Record<string, { name: string; tip: number }>; head?: string | null; active?: Record<string, number>; convs?: Record<string, { title?: string; sel?: number; t?: number }>; files?: { id: string; name: string }[] };
type State = { db: { spaces: Record<string, { id: string; name: string; tree: Tree; sel?: number | null }>; order: string[]; current: string }; opts?: { prompts?: Record<string, string> } };

/* the page's "How to show file changes" prompt, as it is by default */
export const FILE_EDITS = "When you change one of these files, write the whole new file in a code block and put its path on the line just before the block (for example `src/app.ts`). Treechats shows it as a proposed change that the person can review and save.";
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
  /* every prompt the context of id is built from, in order: a post-order walk of its parents. Iterative, so long
     chats can't overflow the stack, and linear thanks to the seen set. */
  private pathMemo = new Map<number, number[]>();
  path(id: number): number[] {
    const hit = this.pathMemo.get(id); if (hit) return hit;
    const res: number[] = [], seen = new Set<number>([id]), stack: [number, number][] = [[id, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1], ps = this.t.nodes[top[0]]?.parents || [];
      if (top[1] < ps.length) { const p = ps[top[1]++]; if (!seen.has(p) && this.t.nodes[p]) { seen.add(p); stack.push([p, 0]); } continue; }
      stack.pop(); res.push(top[0]);
    }
    this.pathMemo.set(id, res);
    return res;
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

/* A file's contents live in the browser, except for files from a linked folder, which are read from disk here
   (unless they were edited in Treechats and not saved, in which case the browser's copy is the true one). */
function linkedText(f: { src?: { root?: string; path?: string }; dirty?: boolean }): string | null {
  if (!f.src || !f.src.root || !f.src.path || f.dirty) return null;
  try {
    const root = realpathSync(f.src.root), abs = resolvePath(root, f.src.path);
    if (!abs.startsWith(root + pathSep)) return null;
    const st = statSync(abs); if (!st.isFile() || st.size > 300 * 1024) return null;
    const buf = readFileSync(abs); return buf.includes(0) ? null : buf.toString('utf8');
  } catch { return null; }
}
const fileStub = (f: { name: string; kind?: string; src?: { root?: string; path?: string }; dirty?: boolean }) => {
  if (f.kind === 'image') return `[Attached image: ${f.name}]`;
  const t = linkedText(f);
  return t != null ? `<file name="${f.name}">\n${t}\n</file>` : `<file name="${f.name}">\n(The contents of this file are kept in the browser, so they aren't included here.)\n</file>`;
};

/* model settings in effect at a prompt (page: settingsFor) */
const SET_FIELDS = ['system', 'thinking', 'effort', 'temperature', 'maxTokens', 'tools'];
export function settingsFor(tree: Tree, id: number) {
  const v = new TreeView(tree), out: Record<string, unknown> = {}, seen = new Set<string>();
  for (const x of v.chain(id).reverse()) { const st = tree.nodes[x]?.set; if (!st) continue; for (const f of SET_FIELDS) if (!seen.has(f) && f in st) { seen.add(f); if (st[f] != null) out[f] = st[f]; } }
  return out;
}
const systemOf = (tree: Tree, id: number) => String(settingsFor(tree, id).system ?? '').trim();

/* the wording of a send mode: the person's own from Settings › Prompts, else the default */
export const tplOf = (state: State) => (k: string) => state.opts?.prompts?.[k] ?? Send.DEFAULTS[k];

/* The turns a request from this prompt sends, including its own reply, as the page's turnsFor(id, true) does */
export function turnsFor(state: State, tree: Tree, id: number) {
  const v = new TreeView(tree), prompts = state.opts?.prompts || {};
  const raw: { role: 'user' | 'assistant'; content: string }[] = [];
  const instr = (prompts.instructions ?? '').trim();
  if (instr) raw.push({ role: 'user', content: instr });
  if (tree.files && tree.files.length) { const fe = (prompts.fileEdits ?? FILE_EDITS).trim(); raw.push({ role: 'user', content: 'Files shared in this project:\n\n' + tree.files.map(fileStub).join('\n\n') + (fe ? '\n\n' + fe : '') }); }
  for (const e of v.entries(id, prompts.seam ?? SEAM)) {
    if (e.seam) { raw.push({ role: 'user', content: e.text }); continue; }
    const n = tree.nodes[e.id];
    if (n.skip && e.id !== id) continue;
    const fl = (n.files || []).map(fileStub).join('\n\n');
    let user = fl ? fl + (n.text ? '\n\n' + n.text : '') : (n.text || ''), reply = n.reply || '';
    if (n.send) ({ user, reply } = Send.apply(n, user, reply, tplOf(state)));
    if (user) raw.push({ role: 'user', content: user });
    if (reply) raw.push({ role: 'assistant', content: reply });
  }
  const out: typeof raw = [];
  for (const t of raw) { const last = out[out.length - 1]; if (last && last.role === t.role) last.content += '\n\n' + t.content; else out.push({ ...t }); }
  return out;
}

/* the turns a new prompt sends: the context up to parent (or, for a new chat, the standing instructions and project
   files), then the prompt itself */
export function turnsForNew(state: State, tree: Tree, parent: number | null, text: string) {
  if (parent != null) {
    const t = turnsFor(state, tree, parent);
    if (t.length && t[t.length - 1].role === 'user') t[t.length - 1].content += '\n\n' + text; else t.push({ role: 'user', content: text });
    return t;
  }
  const prompts = state.opts?.prompts || {}, out: { role: 'user' | 'assistant'; content: string }[] = [];
  const parts: string[] = [];
  const instr = (prompts.instructions ?? '').trim(); if (instr) parts.push(instr);
  if (tree.files && tree.files.length) { const fe = (prompts.fileEdits ?? FILE_EDITS).trim(); parts.push('Files shared in this project:\n\n' + tree.files.map(fileStub).join('\n\n') + (fe ? '\n\n' + fe : '')); }
  parts.push(text);
  out.push({ role: 'user', content: parts.join('\n\n') });
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
  const v = new TreeView(tree), prompts = state.opts?.prompts || {}, at: string[] = [], sys = systemOf(tree, id);
  const instr = (prompts.instructions ?? '').trim();
  if (sys) at.push('y:' + h5(sys));
  if (instr) at.push('i:' + h5(instr));
  for (const f of tree.files || []) at.push('f' + h5(f.name) + ':' + h5(f.id));
  const fe = (prompts.fileEdits ?? FILE_EDITS).trim();
  if (tree.files && tree.files.length && fe) at.push('e:' + h5(fe));
  for (const e of v.entries(id, prompts.seam ?? SEAM)) {
    if (e.seam) { at.push('s' + e.merge + ':' + h5(e.text)); continue; }
    const n = tree.nodes[e.id];
    if (n.kind === 'merge' || (n.skip && e.id !== id)) continue;
    const files = (n.files || []).map((f) => f.id + '/' + f.name).join('|');
    const q = h5((n.text || '') + '\u0000' + files), r = n.reply ? h5(n.reply) : '', m = e.id !== id && n.send ? Send.mark(n, tplOf(state)) : '';
    at.push(e.id + ':' + q + (e.id !== id && r ? '.' + r : '') + (m ? '~' + h5(m) : ''));
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
  const isFile = (k: string) => /^f[0-9a-z]{5}$/.test(k);
  if (was.has('f')) {
    const same = was.get('f') === h5((tree.files || []).map((f) => f.id + '/' + f.name).join('|'));
    was.delete('f'); for (const k of [...is.keys()]) if (isFile(k)) is.delete(k);
    if (!same) out.push('project files changed');
  }
  if (!was.has('e')) is.delete('e');
  const fileName = (k: string) => (tree.files || []).find((f) => 'f' + h5(f.name) === k)?.name || 'a project file';
  const name = (k: string) => k === 'i' ? 'standing instructions' : k === 'e' ? 'how to show file changes' : k === 'f' ? 'project files' : isFile(k) ? fileName(k) : k === 'y' ? 'system prompt' : k[0] === 's' ? `merge note at #${k.slice(1)}` : +k === id ? 'this prompt' : '#' + k;
  const num = (k: string) => /^\d+$/.test(k);
  for (const [k, val] of is) {
    if (!was.has(k)) { out.push(`${name(k)} ${num(k) ? 'back in' : 'added'}`); continue; }
    const w = was.get(k)!; if (w === val) continue;
    const [wp, m0 = ''] = w.split('~'), [vp, m1 = ''] = val.split('~');
    if (wp === vp && num(k)) { const md = Send.LABELS[tree.nodes[k as unknown as number] ? Send.modeOf(tree.nodes[k as unknown as number]) : 'full'].toLowerCase(); out.push(`${name(k)} ${m1 ? (m0 ? `${md} changed` : `now sent as ${md}`) : 'sent in full again'}`); continue; }
    const [q0, r0 = ''] = wp.split('.'), [q1, r1 = ''] = vp.split('.');
    out.push(`${name(k)} ${!num(k) ? 'changed' : +k === id || (q0 !== q1 && r0 !== r1) ? 'edited' : q0 !== q1 ? 'prompt edited' : r0 && r1 ? 'reply edited' : r1 ? 'reply added' : 'reply removed'}`);
  }
  for (const k of was.keys()) if (!is.has(k)) out.push(`${name(k)} ${num(k) && tree.nodes[k as unknown as number]?.skip ? 'left out' : 'removed'}`);
  return out.length ? out : null;
}
