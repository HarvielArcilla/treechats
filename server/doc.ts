/* The saved document, owned by the server.

   The server keeps the document ({db, opts}: every project, chat and setting) in memory and in the database, and is
   the only place it changes. Writers send changes, never the whole document:

   - the page sends the ops between the last revision it saw and what it has now (patch); the server applies them
     unless another writer changed the same unit since that revision (a conflict: the page catches up and resends)
   - the server's own writers (scheduled tasks, agents) change it with mutate(), which works out the ops itself

   Every change gets the next revision number and is pushed to every open page (onChange), which applies it in place.
   The units and ops are defined in web/public/docsync.js, shared with the page. */
import '../web/public/docsync.js';
import { getValue, metaValue, putValue, setMetaValue } from './store.ts';

export type Path = (string | number)[];
export type Op = { p: Path; v?: unknown; d?: 1 };
export type Doc = { db: { spaces: Record<string, any>; order: string[]; current: string | null; nextSpace: number; [k: string]: unknown }; opts: Record<string, any> };
type DocLib = {
  key(p: Path): string; isContainer(p: Path): boolean; isCounter(p: Path): boolean;
  units(doc: unknown, sids?: string[]): Map<string, string | undefined>; diff(a: Map<string, string | undefined>, b: Map<string, string | undefined>): Op[];
  apply(doc: unknown, ops: Op[]): Set<string>; get(doc: unknown, p: Path): unknown; clone<T>(v: T): T;
};
export const D = (globalThis as unknown as { TreechatsDoc: DocLib }).TreechatsDoc;

export const STATE_KEY = 'treechats-v1';
const LOG_KEPT = 2000;

let doc: Doc | null = null, loaded = false, rev = 0;
/* the revision each unit last changed at, and the recent changes, so a writer that is behind can catch up */
const unitRev = new Map<string, number>();
const log: { rev: number; ops: Op[]; tab: string }[] = [];
const listeners = new Set<(e: { rev: number; ops?: Op[]; tab: string; reload?: boolean }) => void>();

/* the document, read from the database the first time (throws while locked) */
function ensure(): Doc | null {
  if (!loaded) {
    const raw = getValue(STATE_KEY);
    doc = raw ? JSON.parse(raw) : null;
    rev = Number(metaValue('rev') || 0);
    loaded = true;
  }
  return doc;
}
export function current(): { doc: Doc | null; rev: number } { return { doc: ensure(), rev }; }
export const revision = () => { ensure(); return rev; };
/* the lock was turned on or Treechats locked: forget the readable copy */
export function forget() { doc = null; loaded = false; unitRev.clear(); log.length = 0; }
export function onChange(fn: (e: { rev: number; ops?: Op[]; tab: string; reload?: boolean }) => void) { listeners.add(fn); return () => listeners.delete(fn); }

function persist() { putValue(STATE_KEY, JSON.stringify(doc)); setMetaValue('rev', String(rev)); }
function commit(ops: Op[], tab: string) {
  rev++;
  /* counters merged by taking the larger value: what's logged and pushed is the value the document now has */
  const logged = ops.map((o) => D.isCounter(o.p) && !o.d ? { p: o.p, v: D.get(doc, o.p) } : o);
  for (const o of logged) if (!D.isContainer(o.p)) unitRev.set(D.key(o.p), rev);
  log.push({ rev, ops: logged, tab }); if (log.length > LOG_KEPT) log.splice(0, log.length - LOG_KEPT);
  persist();
  for (const fn of listeners) try { fn({ rev, ops: logged, tab }); } catch { /* a closed page */ }
}

/* the changes after base, or null if they're no longer all known (the writer has to load the document again) */
export function since(base: number, tab?: string): { rev: number; ops: Op[] }[] | null {
  ensure();
  if (base === rev) return [];
  if (base > rev || !log.length || log[0].rev > base + 1) return null;
  return log.filter((e) => e.rev > base && e.tab !== tab).map((e) => ({ rev: e.rev, ops: e.ops }));
}

export type PatchResult = { ok: true; rev: number; missed: { rev: number; ops: Op[] }[] } | { ok: false; rev: number; reload?: true; conflicts?: string[]; missed?: { rev: number; ops: Op[] }[] };
/* a page's changes, made from what it saw at base */
export function patch(base: number, ops: Op[], tab: string): PatchResult {
  ensure();
  const missed = since(base, tab);
  if (missed == null) return { ok: false, rev, reload: true };
  const conflicts = ops.filter((o) => !D.isContainer(o.p) && !D.isCounter(o.p) && (unitRev.get(D.key(o.p)) || 0) > base).map((o) => D.key(o.p));
  if (conflicts.length) return { ok: false, rev, conflicts, missed };
  if (!ops.length) return { ok: true, rev, missed };
  if (!doc) doc = { db: { spaces: {}, order: [], current: null, nextSpace: 1 }, opts: {} };
  D.apply(doc, ops);
  commit(ops, tab);
  return { ok: true, rev, missed };
}
/* the whole document at once (the first save, or restoring a snapshot): every page loads it again */
export function replace(next: Doc, tab: string) {
  ensure();
  doc = next; rev++; unitRev.clear(); log.length = 0;
  persist();
  for (const fn of listeners) try { fn({ rev, tab, reload: true }); } catch { /* a closed page */ }
  return rev;
}
/* A change by the server itself (a scheduled task, an agent): fn edits the document; the ops are worked out from what
   changed in the projects it names (and any it adds), so this stays quick however big the document is. */
export function mutate<T>(sids: string[] | null, fn: (doc: Doc) => T, tab = 'server'): T {
  /* nothing saved yet (an agent before the page was ever opened): start an empty document */
  if (!ensure()) doc = { db: { spaces: {}, order: [], current: null, nextSpace: 1 }, opts: {} };
  const d = doc!;
  const spacesBefore = new Set(Object.keys(d.db.spaces || {}));
  const top = (x: Doc) => D.units({ db: { ...x.db, spaces: {} }, opts: x.opts });
  const scope = sids ? [...sids] : null;
  const before = scope ? new Map([...top(d), ...D.units(d, scope)]) : D.units(d);
  const out = fn(d);
  let after;
  if (scope) {
    const added = Object.keys(d.db.spaces || {}).filter((s) => !spacesBefore.has(s));
    after = new Map([...top(d), ...D.units(d, [...scope, ...added])]);
  } else after = D.units(d);
  const ops = D.diff(before, after);
  if (ops.length) commit(ops, tab);
  return out;
}
