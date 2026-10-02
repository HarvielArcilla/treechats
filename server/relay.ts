/* Agent commands from MCP are carried out by the open Treechats page (Phase 1 shortcut, see docs/ROADMAP.md): the
   page holds the tree and already implements every operation, so the server only passes commands along and waits
   for the result. The page listens on GET /api/agent/events (server-sent events) and answers on
   POST /api/agent/result. The most recently opened tab does the work. */
import { config } from './config.ts';

type Page = { id: number; send: (data: string) => void };
type Waiter = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

const pages: Page[] = [];
const waiting = new Map<string, Waiter>();
let nextPage = 1, nextCmd = 1;

export function attachPage(send: (data: string) => void) {
  const page = { id: nextPage++, send };
  pages.push(page);
  return () => { const i = pages.indexOf(page); if (i >= 0) pages.splice(i, 1); };
}
export const pageOpen = () => pages.length > 0;

export class RelayError extends Error {}

/* sends one command to the page and resolves with its result */
export function relay(op: string, args: Record<string, unknown>, timeoutMs = 15 * 60_000): Promise<any> {
  const page = pages[pages.length - 1];
  if (!page) return Promise.reject(new RelayError('Treechats isn’t open in a browser. Open it (npm start opens it for you), then try again: agent tools run through the open page for now.'));
  const id = 'c' + nextCmd++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new RelayError(`Treechats didn’t finish "${op}" within ${Math.round(timeoutMs / 60000)} minutes.`)); }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    page.send(JSON.stringify({ id, op, args }));
  });
}

export function settle(body: { id?: string; ok?: boolean; result?: unknown; error?: string }) {
  const w = body.id ? waiting.get(body.id) : null;
  if (!w) return false;
  waiting.delete(body.id!); clearTimeout(w.timer);
  if (body.ok) w.resolve(body.result); else w.reject(new RelayError(body.error || 'The operation failed.'));
  return true;
}

/* each run may spend a limited number of model requests, so a looping agent can't run up cost */
const spent = new Map<string, number>();
export function refund(run: string, n = 1) { spent.set(run, Math.max(0, (spent.get(run) || 0) - n)); }
export function spend(run: string, n = 1) {
  const used = spent.get(run) || 0;
  if (used + n > config.agentMaxRequests) throw new RelayError(`Run "${run}" has used its ${config.agentMaxRequests} requests. Start a new run, or raise TREECHATS_AGENT_MAX_REQUESTS in .env and restart Treechats.`);
  spent.set(run, used + n);
  return config.agentMaxRequests - used - n;
}
