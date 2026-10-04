/* Scheduled tasks: a prompt sent at a set time, once or on a schedule, in a chat or as a new chat each time.

   The tasks themselves are part of the saved state (opts.schedules), set up and changed in the page. The server runs
   them, so they happen while the page is closed too, as long as Treechats is running (and unlocked, with the password
   lock). A run that was due while Treechats was off happens once when it starts again.

   A run sends the prompt with the context of where it goes, the way the page would, and puts the result in an inbox.
   The page adds what's in the inbox to the chat (marked unread if you're elsewhere) and clears it. Keeping the writing
   of the tree in one place, the page, means the two never overwrite each other's changes. */
import { sampleOnce, type SampleRequest } from './claude.ts';
import { loadState, settingsFor, turnsForNew, type Tree } from './context.ts';
import { getValue, putPlainValue } from './store.ts';

export type When = { once: number } | { every: 'hour'; minute: number } | { every: 'day' | 'weekday'; time: string } | { every: 'week'; day: number; time: string };
export type Task = { id: string; name?: string; text: string; sid: string; ref?: string | null; after?: number | null; when: When; tier?: 'quick' | 'default' | 'complex'; paused?: boolean; created: number };
export type Result = { key: string; task: string; name: string; sid: string; parent: number | null; text: string; reply?: string; error?: string; usage?: unknown; model?: string; tier: string; started: number; finished: number };
type Book = { last: Record<string, number>; errors: Record<string, string>; inbox: Result[] };

const KEY = 'treechats-schedule';
const book = (): Book => { try { const v = getValue(KEY); const b = v ? JSON.parse(v) : null; return { last: b?.last || {}, errors: b?.errors || {}, inbox: b?.inbox || [] }; } catch { return { last: {}, errors: {}, inbox: [] }; } };
const keep = (b: Book) => putPlainValue(KEY, JSON.stringify(b));

/* the first time after `after` that the task should run, or null for a one-time task that has run */
export function nextRun(w: When, after: number): number | null {
  if ('once' in w) return w.once > after ? w.once : null;
  if (w.every === 'hour') {
    const t = new Date(after); t.setSeconds(0, 0); t.setMinutes(Math.min(59, Math.max(0, w.minute | 0)));
    if (t.getTime() <= after) t.setHours(t.getHours() + 1);
    return t.getTime();
  }
  const [hh, mm] = String(w.time || '09:00').split(':').map(Number);
  for (let i = 0; i < 9; i++) {
    const t = new Date(after); t.setDate(t.getDate() + i); t.setHours(hh || 0, mm || 0, 0, 0);
    if (t.getTime() <= after) continue;
    const dow = t.getDay();
    if (w.every === 'weekday' && (dow === 0 || dow === 6)) continue;
    if (w.every === 'week' && dow !== w.day) continue;
    return t.getTime();
  }
  return null;
}
/* when it runs next: from its last run, or from when it was made (so a one-time task at a past moment still runs) */
const base = (t: Task, b: Book) => b.last[t.id] ?? (('once' in t.when) ? t.created - 1 : t.created);
const nextOf = (t: Task, b: Book) => t.paused ? null : nextRun(t.when, base(t, b));

function tasks(): { tasks: Task[]; state: ReturnType<typeof loadState> } | null {
  let state; try { state = loadState(); } catch { return null; } /* locked */
  const list = ((state?.opts as { schedules?: Task[] } | undefined)?.schedules || []).filter((t) => t && t.id && t.text && t.when);
  return { tasks: list, state };
}

const running = new Set<string>();
let onResult: (r: Result) => void = () => {};
export function onScheduleResult(fn: (r: Result) => void) { onResult = fn; }

/* where a run goes: the end of the task's branch if it still exists, else the prompt it was set up after, else a new chat */
function placeOf(task: Task, tree: Tree): number | null {
  if (task.ref && tree.refs[task.ref] && tree.nodes[tree.refs[task.ref].tip]) return tree.refs[task.ref].tip;
  if (task.after != null && tree.nodes[task.after]) return task.after;
  return null;
}

export async function runTask(id: string): Promise<Result | null> {
  const got = tasks(); if (!got || !got.state) return null;
  const task = got.tasks.find((t) => t.id === id); if (!task || running.has(id)) return null;
  const sp = got.state.db.spaces[task.sid];
  const b0 = book(); b0.last[id] = Date.now(); delete b0.errors[id]; keep(b0);
  if (!sp) { const b = book(); b.errors[id] = 'Its project is gone.'; keep(b); return null; }
  running.add(id);
  const started = Date.now(), parent = placeOf(task, sp.tree), tier = task.tier || 'default';
  const name = task.name || task.text.split('\n')[0].slice(0, 60);
  let r: Result;
  try {
    const settings = (parent != null ? settingsFor(sp.tree, parent) : {}) as SampleRequest['settings'];
    const out = await sampleOnce({ input: turnsForNew(got.state, sp.tree, parent, task.text), modelTier: tier, settings });
    r = { key: `${id}:${started}`, task: id, name, sid: task.sid, parent, text: task.text, tier, started, finished: Date.now(), ...(out.error ? { error: out.error.message || out.error.code } : { reply: out.text, usage: out.usage, model: out.model }) };
  } catch (e) {
    r = { key: `${id}:${started}`, task: id, name, sid: task.sid, parent, text: task.text, tier, started, finished: Date.now(), error: (e as Error).message };
  } finally { running.delete(id); }
  const b = book(); b.inbox.push(r); if (r.error) b.errors[id] = r.error; keep(b);
  onResult(r);
  return r;
}

/* checks every 20 seconds for tasks that are due */
export function startScheduler() {
  const tick = () => {
    const got = tasks(); if (!got) return;
    const b = book(), now = Date.now();
    for (const t of got.tasks) { const n = nextOf(t, b); if (n != null && n <= now && !running.has(t.id)) runTask(t.id).catch(() => {}); }
  };
  setTimeout(tick, 3000);
  setInterval(tick, 20_000).unref();
}

/* for the page's list: when each task last ran and runs next, and whether it's running now */
export function scheduleStatus() {
  const got = tasks(); const b = book();
  const out: Record<string, { last: number | null; next: number | null; running: boolean; error: string | null }> = {};
  for (const t of got?.tasks || []) out[t.id] = { last: b.last[t.id] ?? null, next: nextOf(t, b), running: running.has(t.id), error: b.errors[t.id] || null };
  return out;
}
export const inbox = () => book().inbox;
export function ack(keys: string[]) { const b = book(), drop = new Set(keys); b.inbox = b.inbox.filter((r) => !drop.has(r.key)); keep(b); }
