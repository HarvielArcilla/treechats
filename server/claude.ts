import Anthropic from '@anthropic-ai/sdk';
import { config, type Tier } from './config.ts';
import { runCli } from './cli.ts';
import { caps, costOf, prices, type Usage } from './models.ts';

/* Calls to Claude go through here. The browser never sees the API key: it sends the turns to
   /api/sample and reads the reply back as a stream of newline-separated JSON events:
     {"t":"text","d":"…"}                         a piece of the reply
     {"t":"done","text","truncated","tier","model","usage","notes","thinking"}   usage: tokens and cost; notes: settings the
                                                                       model didn't use; thinking: what the API returned of it
     {"t":"error","code","message"}                                                          */

export type Turn = { role: 'user' | 'assistant'; content: string };
export type SampleRequest = {
  input: string | Turn[];
  modelTier?: Tier;
  images?: { mediaType: string; data: string }[];
  maxTokens?: number;
  /* branch settings (see "Branch settings" in web/index.html) */
  settings?: { system?: string; temperature?: number; thinking?: boolean; effort?: string; maxTokens?: number };
};
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const BUDGET: Record<string, number> = { low: 2048, medium: 6000, high: 12000, xhigh: 24000, max: 32000 };

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
  const model = config.models[tier], c = caps(model), st = req.settings || {}, notes: string[] = [];
  let maxTokens = Math.min(Math.max(256, st.maxTokens || req.maxTokens || config.maxTokens), 128000);
  const params: Record<string, unknown> = { model, messages };
  const system = typeof st.system === 'string' ? st.system.trim() : '';
  if (system) params.system = system;
  const effort = EFFORTS.includes(st.effort || '') ? st.effort! : '';
  if (st.thinking) {
    if (c.thinking === 'adaptive') params.thinking = { type: 'adaptive' };
    else { const budget = BUDGET[effort] || 8000; params.thinking = { type: 'enabled', budget_tokens: budget }; if (maxTokens <= budget + 1024) maxTokens = Math.min(budget + 8000, 128000); }
  }
  if (effort) { if (c.effort) params.output_config = { effort }; else if (!st.thinking) notes.push('effort'); }
  if (typeof st.temperature === 'number' && Number.isFinite(st.temperature)) {
    if (!c.temperature) notes.push('temperature');
    else if (st.thinking) notes.push('temperature (not used while thinking is on)');
    else params.temperature = Math.min(1, Math.max(0, st.temperature));
  }
  params.max_tokens = maxTokens;
  return { tier, model, notes, params: params as unknown as Anthropic.Messages.MessageStreamParams & { messages: Anthropic.Messages.MessageParam[] } };
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

/* Claude Code takes our system prompt (appended to its own), but not the sampling settings */
function cliNotes(req: SampleRequest) {
  const st = req.settings || {}, n: string[] = [];
  if (typeof st.temperature === 'number') n.push('temperature');
  if (st.thinking) n.push('thinking');
  if (st.effort) n.push('effort');
  if (st.maxTokens) n.push('max tokens');
  return n.map((x) => x + ' (not used with Claude Code)');
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
        const { tier, model, params, notes } = buildParams(req);
        if (config.fake) {
          const last = params.messages[params.messages.length - 1];
          const said = (last.content as Block[]).filter((b) => b.type === 'text').map((b) => (b as Anthropic.Messages.TextBlockParam).text).join(' ');
          const reply = (params.system ? '[system prompt set] ' : '') + fakeReply(said);
          for (const piece of reply.match(/.{1,12}/gs) || []) {
            if (signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
            text += piece; send({ t: 'text', d: piece });
            await new Promise((r) => setTimeout(r, config.fakeDelay));
          }
          const input = JSON.stringify(params.messages).length, u: Usage = { input: Math.ceil(input / 4), output: Math.ceil(text.length / 4), cacheWrite: 0, cacheRead: 0 };
          u.cost = costOf(u, prices(model, process.env['TREECHATS_PRICE_' + tier.toUpperCase()]));
          send({ t: 'done', text, truncated: false, tier, model: 'fake', usage: u, notes });
          return;
        }
        if (provider() === 'claude-code') {
          await runCli(req, model, signal, (e) => {
            if (e.t === 'text') { text += e.d; send(e); }
            else if (e.t === 'done') send({ t: 'done', text, truncated: e.truncated, tier, model, usage: e.usage || null, notes: cliNotes(req) });
            else { if (e.code !== 'cancelled') console.warn(`  Claude Code reply failed (${e.code})${e.message ? ': ' + e.message : ''}`); send({ t: 'error', code: e.code, message: e.message, text }); }
          });
          return;
        }
        if (!config.apiKey) throw Object.assign(new Error('No API key.'), { code: 'no_api_key' });
        const stream = getClient().messages.stream(params, { signal });
        let thinking = '';
        stream.on('text', (d) => { text += d; send({ t: 'text', d }); });
        stream.on('thinking', (d) => { thinking += d; });
        const msg = await stream.finalMessage();
        const mu = msg.usage, u: Usage = { input: mu.input_tokens || 0, output: mu.output_tokens || 0, cacheWrite: mu.cache_creation_input_tokens || 0, cacheRead: mu.cache_read_input_tokens || 0 };
        u.cost = costOf(u, prices(model, process.env['TREECHATS_PRICE_' + tier.toUpperCase()]));
        send({ t: 'done', text, truncated: msg.stop_reason === 'max_tokens', tier, model, usage: u, notes, thinking: thinking || undefined });
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
    if (/"best"/.test(said)) { const alts = said.slice(said.indexOf('The alternatives:')).match(/#\d+/g) || []; return JSON.stringify({ best: alts[0] || '', reasons: Object.fromEntries(alts.map((a, i) => [a, i === 0 ? 'Meets the criteria best (test verdict).' : 'Less complete (test verdict).'])), summary: 'A test verdict.' }); }
    if (/"sources"/.test(said)) { const alts = [...new Set(said.slice(said.indexOf('The alternatives:')).match(/#\d+/g) || [])]; return JSON.stringify({ prompt: 'Combine the best of these.', reply: 'A combined test reply.', sources: Object.fromEntries(alts.map((a) => [a, 'Its main point.'])) }); }
    if (/"fits"/.test(said)) return /MISMATCH/.test(said.slice(said.lastIndexOf('The next message:'))) ? '{"fits":false,"reason":"It refers to something the new reply no longer says.","rewrite":"A rewritten follow-up that fits."}' : '{"fits":true,"reason":"","rewrite":""}';
    if (/"options"/.test(said)) return '{"options":[{"title":"First way","prompt":"Let\'s try the first way."},{"title":"Second way","prompt":"Let\'s try the second way."}],"recommended":0}';
    if (/"title"/.test(said)) return '{"title":"Test conversation"}';
    if (/"name"/.test(said)) return '{"name":"test-branch"}';
    if (/JSON array/.test(said)) return '["Another way to ask it","A shorter way to ask it"]';
  }
  return `This is a test reply (TREECHATS_FAKE is on). You said: “${said.slice(0, 160)}”`;
}
