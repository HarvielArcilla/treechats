import Anthropic from '@anthropic-ai/sdk';
import { config, type Tier } from './config.ts';
import { runCli } from './cli.ts';

/* Calls to Claude go through here. The browser never sees the API key: it sends the turns to
   /api/sample and reads the reply back as a stream of newline-separated JSON events:
     {"t":"text","d":"…"}                         a piece of the reply
     {"t":"done","text","truncated","tier","model","usage"}
     {"t":"error","code","message"}                                                          */

export type Turn = { role: 'user' | 'assistant'; content: string };
export type SampleRequest = {
  input: string | Turn[];
  modelTier?: Tier;
  images?: { mediaType: string; data: string }[];
  maxTokens?: number;
};

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ apiKey: config.apiKey }));

const TIERS: Tier[] = ['quick', 'default', 'complex'];

/* Turns must alternate and start and end with the user; back-to-back turns of one role are joined. */
export function toMessages(input: string | Turn[]): Turn[] {
  const raw: Turn[] = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
  const out: Turn[] = [];
  for (const t of raw) {
    if (!t || (t.role !== 'user' && t.role !== 'assistant') || typeof t.content !== 'string' || !t.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += '\n\n' + t.content;
    else out.push({ role: t.role, content: t.content });
  }
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: '(The conversation continues.)' });
  if (out.length && out[out.length - 1].role !== 'user') out.push({ role: 'user', content: 'Please continue.' });
  return out;
}

type Block = Anthropic.Messages.ContentBlockParam;

/* Branches share their beginnings, so the whole prompt is marked for caching: the next request from the
   same path reads the shared part back at a fraction of the cost. Short prompts are left alone, since
   there is a minimum size below which nothing is cached. */
export function buildParams(req: SampleRequest) {
  const tier: Tier = TIERS.includes(req.modelTier as Tier) ? (req.modelTier as Tier) : 'default';
  const turns = toMessages(req.input);
  if (!turns.length) throw Object.assign(new Error('Nothing to send.'), { code: 'empty_prompt' });
  const total = turns.reduce((n, t) => n + t.content.length, 0);
  const messages: Anthropic.Messages.MessageParam[] = turns.map((t, i) => {
    const last = i === turns.length - 1;
    const blocks: Block[] = [];
    if (last && req.images?.length) {
      for (const im of req.images) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType as 'image/png', data: im.data } });
      }
    }
    blocks.push({ type: 'text', text: t.content, ...(last && total > 6000 ? { cache_control: { type: 'ephemeral' as const } } : {}) });
    return { role: t.role, content: blocks };
  });
  const maxTokens = Math.min(Math.max(256, req.maxTokens || config.maxTokens), 128000);
  return { tier, model: config.models[tier], params: { model: config.models[tier], max_tokens: maxTokens, messages } };
}

export function errorCode(e: unknown): { code: string; message: string } {
  if (e instanceof Anthropic.APIError) {
    const msg = e.message || '';
    if (e.status === 401) return { code: 'auth', message: 'The API key was rejected.' };
    if (e.status === 403) return { code: 'permission', message: msg };
    if (e.status === 429) return { code: 'rate_limited', message: msg };
    if (e.status === 529 || /overloaded/i.test(msg)) return { code: 'overloaded', message: msg };
    if (e.status === 400 && /too long|too many tokens|context/i.test(msg)) return { code: 'prompt_too_large', message: msg };
    if (e.status === 404 && /model/i.test(msg)) return { code: 'unknown_model', message: msg };
    return { code: 'api_error', message: msg };
  }
  const err = e as { code?: string; message?: string; name?: string };
  if (err?.name === 'APIUserAbortError' || err?.name === 'AbortError') return { code: 'cancelled', message: '' };
  if (err?.code) return { code: err.code, message: err.message || '' };
  return { code: 'network', message: err?.message || String(e) };
}

export const provider = (): 'api' | 'claude-code' => config.provider === 'auto' ? (config.apiKey ? 'api' : 'claude-code') : config.provider;

/* Streams one reply as NDJSON. `signal` fires when the browser stops the request (Stop, or closing the page). */
export function streamReply(req: SampleRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(ctl) {
      const send = (o: object) => ctl.enqueue(enc.encode(JSON.stringify(o) + '\n'));
      let text = '';
      try {
        const { tier, model, params } = buildParams(req);
        if (config.fake) {
          const last = params.messages[params.messages.length - 1];
          const said = (last.content as Block[]).filter((b) => b.type === 'text').map((b) => (b as Anthropic.Messages.TextBlockParam).text).join(' ');
          const reply = fakeReply(said);
          for (const piece of reply.match(/.{1,12}/gs) || []) {
            if (signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
            text += piece; send({ t: 'text', d: piece });
            await new Promise((r) => setTimeout(r, config.fakeDelay));
          }
          send({ t: 'done', text, truncated: false, tier, model: 'fake', usage: null });
          return;
        }
        if (provider() === 'claude-code') {
          await runCli(req, model, signal, (e) => {
            if (e.t === 'text') { text += e.d; send(e); }
            else if (e.t === 'done') send({ t: 'done', text, truncated: e.truncated, tier, model, usage: null });
            else { if (e.code !== 'cancelled') console.warn(`  Claude Code reply failed (${e.code})${e.message ? ': ' + e.message : ''}`); send({ t: 'error', code: e.code, message: e.message, text }); }
          });
          return;
        }
        if (!config.apiKey) throw Object.assign(new Error('No API key.'), { code: 'no_api_key' });
        const stream = getClient().messages.stream(params, { signal });
        stream.on('text', (d) => { text += d; send({ t: 'text', d }); });
        const msg = await stream.finalMessage();
        send({ t: 'done', text, truncated: msg.stop_reason === 'max_tokens', tier, model, usage: msg.usage });
      } catch (e) {
        const { code, message } = errorCode(e);
        if (code !== 'cancelled') console.warn(`  Reply failed (${code})${message ? ': ' + message : ''}`);
        send({ t: 'error', code, message, text });
      } finally {
        ctl.close();
      }
    },
  });
}

/* Canned replies for TREECHATS_FAKE=1. Asks for JSON get JSON back, so naming and fan-out work offline. */
function fakeReply(said: string): string {
  if (/Reply with only (a )?JSON/i.test(said)) {
    if (/"options"/.test(said)) return '{"options":[{"title":"First way","prompt":"Let\'s try the first way."},{"title":"Second way","prompt":"Let\'s try the second way."}],"recommended":0}';
    if (/"title"/.test(said)) return '{"title":"Test conversation"}';
    if (/"name"/.test(said)) return '{"name":"test-branch"}';
    if (/JSON array/.test(said)) return '["Another way to ask it","A shorter way to ask it"]';
  }
  return `This is a test reply (TREECHATS_FAKE is on). You said: “${said.slice(0, 160)}”`;
}
