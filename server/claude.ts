import Anthropic from '@anthropic-ai/sdk';
import { config, type Tier } from './config.ts';
import { runCli } from './cli.ts';
import { caps, costOf, prices, type Usage } from './models.ts';

/* Calls to Claude go through here. The browser never sees the API key: it sends the turns to
   /api/sample and reads the reply back as a stream of newline-separated JSON events:
     {"t":"text","d":"…"}                         a piece of the reply
     {"t":"step","d":{id,tool,input}}             Claude used a tool (web search, fetching a page, running code)
     {"t":"stepresult","d":{id,…}}                what came back from it, in brief
     {"t":"done","text","truncated","tier","model","usage","notes","thinking","steps","sources"}   usage: tokens and cost;
                                                  notes: settings the model didn't use; thinking: what the API returned of it;
                                                  steps: the tool steps; sources: the pages its answer cites
     {"t":"error","code","message"}                                                          */

export type Turn = { role: 'user' | 'assistant'; content: string };
export type SampleRequest = {
  input: string | Turn[];
  modelTier?: Tier;
  images?: { mediaType: string; data: string }[];
  maxTokens?: number;
  /* model settings (see "Model settings" in web/index.html) */
  settings?: { system?: string; temperature?: number; thinking?: boolean; effort?: string; maxTokens?: number; tools?: string[] };
};
/* Tools Claude can use in a reply, all run by Anthropic (nothing runs on this computer): searching the web, reading a
   web page, and running code in a sandbox. The newest versions first; a model that doesn't take them gets the first
   versions instead (see streamReply). */
export const TOOL_KEYS = ['search', 'fetch', 'code'] as const;
function toolDefs(keys: string[], legacy = false): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (keys.includes('search')) out.push({ type: legacy ? 'web_search_20250305' : 'web_search_20260318', name: 'web_search', max_uses: 5 });
  if (keys.includes('fetch')) out.push({ type: legacy ? 'web_fetch_20250910' : 'web_fetch_20260318', name: 'web_fetch', max_uses: 5, max_content_tokens: 40000, citations: { enabled: true } });
  if (keys.includes('code')) out.push({ type: legacy ? 'code_execution_20250825' : 'code_execution_20260521', name: 'code_execution' });
  return out;
}
export type Step = { id: string; tool: string; input: Record<string, unknown>; result?: Record<string, unknown> };
const clip = (s: unknown, n: number) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + `\n… ${(t.length - n).toLocaleString()} more characters` : t; };
/* a tool result, in brief: enough to show what happened, not the whole page or output */
function resultOf(b: any): Record<string, unknown> | null {
  const c = b.content;
  if (b.type === 'web_search_tool_result') return Array.isArray(c) ? { results: c.slice(0, 10).map((r: any) => ({ title: r.title, url: r.url })) } : { error: c?.error_code || 'error' };
  if (b.type === 'web_fetch_tool_result') return c?.type === 'web_fetch_result' ? { url: c.url, title: c.content?.title || null } : { error: c?.error_code || 'error' };
  if (b.type === 'code_execution_tool_result' || b.type === 'bash_code_execution_tool_result') return c && 'stdout' in c ? { stdout: clip(c.stdout, 4000), stderr: clip(c.stderr, 2000), code: c.return_code } : { error: c?.error_code || 'error' };
  if (b.type === 'text_editor_code_execution_tool_result') return c?.error_code ? { error: c.error_code } : { ok: true };
  return null;
}
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const BUDGET: Record<string, number> = { low: 2048, medium: 6000, high: 12000, xhigh: 24000, max: 32000 };

/* made again when the key changes (it can be saved to the keychain while Treechats runs) */
let client: Anthropic | null = null, clientKey = '';
const getClient = () => { if (!client || clientKey !== config.apiKey) { client = new Anthropic({ apiKey: config.apiKey }); clientKey = config.apiKey; } return client; };

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
  const tools = (st.tools || []).filter((t) => (TOOL_KEYS as readonly string[]).includes(t));
  if (tools.length) params.tools = toolDefs(tools);
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
  if (st.tools?.includes('code')) n.push('running code');
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
          const fakeTools = req.settings?.tools || [], fsteps: Step[] = [];
          if (fakeTools.includes('search')) { const st: Step = { id: 'fake1', tool: 'web_search', input: { query: said.slice(0, 60) } }; send({ t: 'step', d: st }); st.result = { results: [{ title: 'Example result', url: 'https://example.com/result' }] }; send({ t: 'stepresult', d: { id: 'fake1', ...st.result } }); fsteps.push(st); }
          if (fakeTools.includes('code')) { const st: Step = { id: 'fake2', tool: 'bash_code_execution', input: { command: 'python -c "print(6*7)"' } }; send({ t: 'step', d: st }); st.result = { stdout: '42\n', stderr: '', code: 0 }; send({ t: 'stepresult', d: { id: 'fake2', ...st.result } }); fsteps.push(st); }
          const reply = (params.system ? '[system prompt set] ' : '') + fakeReply(said);
          for (const piece of reply.match(/.{1,12}/gs) || []) {
            if (signal.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
            text += piece; send({ t: 'text', d: piece });
            await new Promise((r) => setTimeout(r, config.fakeDelay));
          }
          const input = JSON.stringify(params.messages).length, u: Usage = { input: Math.ceil(input / 4), output: Math.ceil(text.length / 4), cacheWrite: 0, cacheRead: 0 };
          u.cost = costOf(u, prices(model, process.env['TREECHATS_PRICE_' + tier.toUpperCase()]));
          send({ t: 'done', text, truncated: false, tier, model: 'fake', usage: u, notes, ...(fsteps.length ? { steps: fsteps, sources: fakeTools.includes('search') ? [{ url: 'https://example.com/result', title: 'Example result' }] : undefined } : {}) });
          return;
        }
        if (provider() === 'claude-code') {
          const csteps: Step[] = [];
          await runCli(req, model, signal, (e) => {
            if (e.t === 'text') { text += e.d; send(e); }
            else if (e.t === 'step') { csteps.push({ ...e.d }); send(e); }
            else if (e.t === 'stepresult') { const { id, ...r } = e.d; const st = csteps.find((x) => x.id === id); if (st) st.result = r; send(e); }
            else if (e.t === 'done') send({ t: 'done', text, truncated: e.truncated, tier, model, usage: e.usage || null, notes: cliNotes(req), ...(csteps.length ? { steps: csteps } : {}) });
            else { if (e.code !== 'cancelled') console.warn(`  Claude Code reply failed (${e.code})${e.message ? ': ' + e.message : ''}`); send({ t: 'error', code: e.code, message: e.message, text }); }
          });
          return;
        }
        if (!config.apiKey) throw Object.assign(new Error('No API key.'), { code: 'no_api_key' });
        let thinking = '', messages = params.messages, legacy = false, msg: Anthropic.Messages.Message | null = null;
        const u: Usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, steps: Step[] = [], sources = new Map<string, string>();
        let searches = 0;
        /* With tools, a long turn can pause ("pause_turn"): it is sent back as it is and Claude carries on, up to a limit */
        for (let round = 0; round < 8; round++) {
          const p = { ...params, messages } as typeof params;
          if (legacy && (params as any).tools) (p as any).tools = toolDefs(req.settings?.tools || [], true);
          const stream = getClient().messages.stream(p, { signal });
          stream.on('text', (d) => { text += d; send({ t: 'text', d }); });
          stream.on('thinking', (d) => { thinking += d; });
          stream.on('contentBlock', (b: any) => {
            if (b.type === 'server_tool_use') { const st: Step = { id: b.id, tool: b.name, input: b.input || {} }; steps.push(st); send({ t: 'step', d: st }); }
            else if (b.type === 'text') { for (const c of b.citations || []) if (c.url && !sources.has(c.url)) sources.set(c.url, c.title || c.url); }
            else { const r = resultOf(b); if (r) { const st = steps.find((x) => x.id === b.tool_use_id); if (st) st.result = r; send({ t: 'stepresult', d: { id: b.tool_use_id, ...r } }); } }
          });
          try { msg = await stream.finalMessage(); }
          catch (e) {
            /* a model that doesn't know the newest tool versions gets the first ones, once */
            if (!legacy && (params as any).tools && e instanceof Anthropic.APIError && e.status === 400 && /tool|web_search|web_fetch|code_execution/i.test(e.message || '') && !text) { legacy = true; round--; continue; }
            throw e;
          }
          const mu: any = msg.usage;
          u.input += mu.input_tokens || 0; u.output += mu.output_tokens || 0; u.cacheWrite += mu.cache_creation_input_tokens || 0; u.cacheRead += mu.cache_read_input_tokens || 0;
          searches += mu.server_tool_use?.web_search_requests || 0;
          if (msg.stop_reason !== 'pause_turn') break;
          messages = [...messages, { role: 'assistant', content: msg.content as any }];
          /* code that ran keeps its sandbox (files, installed packages) when the turn carries on */
          const cont = (msg as any).container?.id; if (cont) (params as any).container = cont;
        }
        u.cost = costOf(u, prices(model, process.env['TREECHATS_PRICE_' + tier.toUpperCase()]));
        /* web searches are charged per search ($10 per 1,000), on top of tokens */
        if (searches && u.cost != null) u.cost += searches * 0.01;
        send({ t: 'done', text, truncated: msg?.stop_reason === 'max_tokens', tier, model, usage: u, notes, thinking: thinking || undefined,
          ...(steps.length ? { steps } : {}), ...(sources.size ? { sources: [...sources].map(([url, title]) => ({ url, title })) } : {}) });
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

/* One reply as a whole, for the server's own use (MCP's btw): reads the same stream the page reads. */
export async function sampleOnce(req: SampleRequest, signal: AbortSignal = new AbortController().signal): Promise<{ text: string; usage?: Usage | null; model?: string; error?: { code: string; message: string } }> {
  const reader = streamReply(req, signal).getReader(), dec = new TextDecoder();
  let buf = '', out: { text: string; usage?: Usage | null; model?: string; error?: { code: string; message: string } } = { text: '' };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.t === 'text') out.text += e.d;
      else if (e.t === 'done') out = { text: e.text, usage: e.usage, model: e.model };
      else if (e.t === 'error') out = { text: e.text || out.text, error: { code: e.code, message: e.message } };
    }
    if (done) return out;
  }
}

/* Canned replies for TREECHATS_FAKE=1. Asks for JSON get JSON back, so naming and fan-out work offline. */
function fakeReply(said: string): string {
  if (/Reply with only (a )?JSON/i.test(said)) {
    if (/"scores"/.test(said)) { const alts = [...new Set(said.slice(said.indexOf('The alternatives:')).match(/#\d+/g) || [])]; return JSON.stringify({ scores: Object.fromEntries(alts.map((a, i) => [a, { score: 9 - (i % 5), why: 'Test reason.' }])), best: alts[0] || '', summary: 'Test summary: the first one is best.' }); }
    if (/"best"/.test(said)) { const alts = said.slice(said.indexOf('The alternatives:')).match(/#\d+/g) || []; return JSON.stringify({ best: alts[0] || '', reasons: Object.fromEntries(alts.map((a, i) => [a, i === 0 ? 'Meets the criteria best (test verdict).' : 'Less complete (test verdict).'])), summary: 'A test verdict.' }); }
    if (/"sources"/.test(said)) { const alts = [...new Set(said.slice(said.indexOf('The alternatives:')).match(/#\d+/g) || [])]; return JSON.stringify({ prompt: 'Combine the best of these.', reply: 'A combined test reply.', sources: Object.fromEntries(alts.map((a) => [a, 'Its main point.'])) }); }
    if (/"answers"/.test(said)) { const n = (said.match(/^Reply \d+:$/gm) || []).length; return JSON.stringify({ answers: Array.from({ length: n }, () => ({ yes: true, why: 'Test check.' })) }); }
    if (/"fits"/.test(said)) return /MISMATCH/.test(said.slice(said.lastIndexOf('The next message:'))) ? '{"fits":false,"reason":"It refers to something the new reply no longer says.","rewrite":"A rewritten follow-up that fits."}' : '{"fits":true,"reason":"","rewrite":""}';
    if (/"met"/.test(said)) return /condition is met now: always/i.test(said) ? '{"met":true,"why":"The latest reply meets it (test verdict)."}' : '{"met":false,"why":"Not yet (test verdict)."}';
    if (/"options"/.test(said)) return '{"options":[{"title":"First way","prompt":"Let\'s try the first way."},{"title":"Second way","prompt":"Let\'s try the second way."}],"recommended":0}';
    if (/"title"/.test(said)) return '{"title":"Test conversation"}';
    if (/"name"/.test(said)) return '{"name":"test-branch"}';
    if (/JSON array/.test(said)) return '["Another way to ask it","A shorter way to ask it"]';
  }
  return `This is a test reply (TREECHATS_FAKE is on). You said: “${said.slice(0, 160)}”`;
}
