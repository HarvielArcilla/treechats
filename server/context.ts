/* Reads the saved tree on the server side, for the MCP server and scheduled tasks: spaces, conversations, branches,
   and the context a prompt would send. The context itself is built by web/public/treecore.js, the same code the page
   uses, so "get context" here gives the same text as "Copy as a prompt" there.

   One difference, supplied here as the core's file hook: attached and project files are kept in the browser, not in
   the saved state, so here they appear by name only, except files from a linked folder, which are read from disk. */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve as resolvePath, sep as pathSep } from 'node:path';
import { getValue } from './store.ts';
/* how each turn is sent (full, summary, excerpt, prompt only, reply only): the page's own file, so both build the same
   request */
import '../web/public/sendmodes.js';
/* the tree and the context a prompt sends: the page's own file too */
import '../web/public/treecore.js';

type Send = {
  MODES: string[]; LABELS: Record<string, string>; DEFAULTS: Record<string, string>; JOIN: string;
  modeOf(n: Node): string; apply(n: Node, user: string, reply: string, tpl: (k: string) => string): { user: string; reply: string };
  mark(n: Node, tpl: (k: string) => string): string; stale(n: Node, h: (s: string) => string): string[];
  texts(list: unknown): string[]; exSide(n: Node, side: 'p' | 'r'): { text: string; edited: boolean } | null; piecesFromText(text: string, list: string[]): { pieces: { s: number; e: number; t: string }[]; missing: string[] };
};
export const Send = (globalThis as unknown as { TreechatsSend: Send }).TreechatsSend;

type Node = { id: number; parents: number[]; text: string; reply?: string; kind?: string; alt?: number; skip?: boolean; send?: string; sum?: { text?: string; of?: string; pending?: boolean; by?: string }; ex?: { p?: unknown[]; r?: unknown[]; ed?: { p?: string; r?: string }; edOf?: { p?: string; r?: string } }; seam?: string; files?: { id: string; name: string; kind?: string }[]; note?: string; from?: string; into?: string; star?: boolean; ctx?: { h: string; at: string }; set?: Record<string, unknown>; usage?: { input: number; output: number; cost?: number }; thinking?: string; replyEdited?: boolean; combined?: { from: number[] }; reviewOf?: { id: number }; by?: string };
export type Tree = { nodes: Record<string, Node>; refs: Record<string, { name: string; tip: number }>; head?: string | null; active?: Record<string, number>; convs?: Record<string, { title?: string; sel?: number; t?: number }>; files?: { id: string; name: string }[] };
type State = { db: { spaces: Record<string, { id: string; name: string; tree: Tree; sel?: number | null }>; order: string[]; current: string }; opts?: { prompts?: Record<string, string> } };

type Turn = { role: 'user' | 'assistant'; content: string };
type FileMeta = { id: string; name: string; kind?: string; src?: { root?: string; path?: string }; dirty?: boolean };
export type Env = { tpl: (k: string) => string; file: (f: FileMeta) => string; path?: (id: number) => number[]; chain?: (id: number) => number[] };
type Entry = { seam: true; text: string; merge: number } | { seam?: false; id: number };
export type Change = { k: string; what: string; label: string };
type Core = {
  DEFAULTS: Record<string, string>; SET_FIELDS: string[];
  tplFrom(prompts?: Record<string, string | null>): (k: string) => string;
  path(tree: Tree, id: number): number[]; chain(tree: Tree, id: number): number[];
  entries(tree: Tree, id: number, env: Pick<Env, 'tpl' | 'path'>): Entry[];
  settingsFor(tree: Tree, id: number, env?: Pick<Env, 'chain'>): { values: Record<string, unknown>; from: Record<string, number> };
  turnsFor(tree: Tree, id: number, env: Env, includeLastReply?: boolean): Turn[];
  turnsForNew(tree: Tree, parent: number | null, text: string, env: Env): Turn[];
  contextPrompt(tree: Tree, id: number, env: Env): string;
  hash53(str: string, seed?: number): string; h5(str: string): string;
  ctxSig(tree: Tree, id: number, env: Env): { h: string; at: string };
  ctxChanges(tree: Tree, id: number, env: Env, now?: { h: string; at: string }): Change[] | null;
};
export const Core = (globalThis as unknown as { TreechatsCore: Core }).TreechatsCore;
export const FILE_EDITS = Core.DEFAULTS.fileEdits;
export const SEAM = Core.DEFAULTS.seam;
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
  chain(id: number) { return Core.chain(this.t, id); }
  /* every prompt the context of id is built from, in order (see path in treecore.js) */
  private pathMemo = new Map<number, number[]>();
  path(id: number): number[] {
    const hit = this.pathMemo.get(id); if (hit) return hit;
    const res = Core.path(this.t, id); this.pathMemo.set(id, res); return res;
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
  entries(id: number, seamDefault: string) { return Core.entries(this.t, id, { tpl: (k) => (k === 'seam' ? seamDefault : ''), path: (x) => this.path(x) }); }
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

/* what the core needs from the server: the person's wording, and files as the server can read them */
export const tplOf = (state: State) => Core.tplFrom(state.opts?.prompts);
const envOf = (state: State, tree: Tree): Env => { const v = new TreeView(tree); return { tpl: tplOf(state), file: fileStub, path: (id) => v.path(id), chain: (id) => v.chain(id) }; };

/* model settings in effect at a prompt */
export const settingsFor = (tree: Tree, id: number) => Core.settingsFor(tree, id).values;
/* The turns a request from this prompt sends, including its own reply, as the page's turnsFor(id, true) does */
export const turnsFor = (state: State, tree: Tree, id: number) => Core.turnsFor(tree, id, envOf(state, tree), true);
/* the turns a new prompt sends: the context up to parent (or, for a new chat, the standing instructions and project
   files), then the prompt itself */
export const turnsForNew = (state: State, tree: Tree, parent: number | null, text: string) => Core.turnsForNew(tree, parent, text, envOf(state, tree));
/* the same block as the page's "Copy as a prompt" */
export const contextPrompt = (state: State, tree: Tree, id: number) => Core.contextPrompt(tree, id, envOf(state, tree));
/* The context fingerprint (see treecore.js): what was sent to get each reply, so operators can see what changed
   above a reply since. Never sent to a model. */
export const hash53 = Core.hash53;
export const ctxSig = (state: State, tree: Tree, id: number) => Core.ctxSig(tree, id, envOf(state, tree));
/* what changed above a reply since it was written, in words; null if nothing did or nothing was recorded */
export function ctxChanges(state: State, tree: Tree, id: number): string[] | null {
  const ch = Core.ctxChanges(tree, id, envOf(state, tree));
  return ch ? ch.map((c) => c.label) : null;
}
