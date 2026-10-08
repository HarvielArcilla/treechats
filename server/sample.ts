/* Asking Claude from the server, with the same result the page gets from its sampler (web/public/local-shim.js), so
   the shared ✦ tools (web/public/treeops.js) and the reply engine work the same in both places. */
import { streamReply, type SampleRequest } from './claude.ts';
import type { Usage } from './models.ts';

type Turn = { role: 'user' | 'assistant'; content: string };
export type SampleOpts = { modelTier?: string; settings?: SampleRequest['settings']; maxTokens?: number; signal?: AbortSignal; cache?: boolean;
  onText?: (t: { text: string; delta: string }) => void; onStep?: (kind: 'step' | 'stepresult', d: any) => void };
export type SampleResult = { text: string; truncated: boolean; modelTierApplied: string; model?: string; usage?: Usage | null; notes: string[]; thinking: string; steps: any[] | null; sources: any[] | null };

/* a failed request: code is one of the codes the page knows (see errCopy in treeops.js); text is what came before */
export class SampleError extends Error { constructor(public code: string, public text = '', message = '') { super(message || code); } }

export async function sample(input: string | Turn[], o: SampleOpts = {}): Promise<SampleResult> {
  const reader = streamReply({ input, modelTier: o.modelTier as SampleRequest['modelTier'], maxTokens: o.maxTokens, settings: o.settings }, o.signal || new AbortController().signal).getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', done: any = null;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.value) buf += dec.decode(chunk.value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.t === 'text') { text += ev.d; o.onText?.({ text, delta: ev.d }); }
        else if (ev.t === 'step' || ev.t === 'stepresult') o.onStep?.(ev.t, ev.d);
        else if (ev.t === 'done') done = ev;
        else if (ev.t === 'error') throw new SampleError(ev.code, ev.text || text, ev.message);
      }
      if (chunk.done) break;
    }
  } catch (e) {
    if (e instanceof SampleError) throw e;
    if (o.signal?.aborted) throw new SampleError('cancelled', text);
    throw new SampleError('network', text, (e as Error)?.message);
  }
  if (!done) throw new SampleError(o.signal?.aborted ? 'cancelled' : 'network', text, 'The reply ended early.');
  return { text: done.text, truncated: !!done.truncated, modelTierApplied: done.tier, model: done.model, usage: done.usage, notes: done.notes || [], thinking: done.thinking || '', steps: done.steps || null, sources: done.sources || null };
}

/* the reply as JSON: the whole reply, else a code fence, else from the first { or [ to the last } or ] */
function parseLoose(t: string) {
  const s = String(t).trim();
  try { return JSON.parse(s); } catch { /* next */ }
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) { try { return JSON.parse(f[1]); } catch { /* next */ } }
  const a = s.search(/[[{]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* next */ } }
  throw new SampleError('invalid_json', t, 'The reply was not JSON.');
}
export async function sampleJSON(input: string | Turn[], o: SampleOpts = {}) {
  const hint = '\n\nYour reply will be read by a program: reply with the JSON only.';
  const inp = typeof input === 'string' ? input + hint : input.map((t, i) => i === input.length - 1 ? { role: t.role, content: t.content + hint } : t);
  const r = await sample(inp, o);
  if (r.truncated) throw new SampleError('invalid_json', r.text, 'The reply was cut short.');
  return parseLoose(r.text);
}
