/* Coding sessions from Claude Code and Codex, read from the logs they keep on this computer, as chats for the
   import dialog. Read-only: nothing here writes to those folders.

   Claude Code keeps one JSON-lines file per session under ~/.claude/projects/<folder>/ (CLAUDE_CONFIG_DIR moves
   it). Each line is a record with a uuid and a parentUuid, so a session is already a tree: rewinding or editing a
   message starts a branch. Codex keeps rollout files under ~/.codex/sessions/YYYY/MM/DD/ (CODEX_HOME moves it), one
   line per item, in order.

   Neither format is a published, stable interface, so everything here is forgiving: lines it doesn't understand are
   skipped, and a session that yields no prompts is reported as empty rather than as an error.

   One chat turn here is one thing the person typed, with everything the agent did until the next one: its text,
   and each tool call with a short excerpt of its result. Compaction summaries become turns of their own, marked,
   since that is where an agent's context was rewritten. */
import { createReadStream, existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { costOf, prices, type Usage } from './models.ts';

export type Source = 'claude-code' | 'codex';
export type Turn = { k: number; parent: number | null; text: string; reply?: string; branch?: string | null; model?: string; usage?: Usage; thinking?: string; tag?: string; at?: string; notes?: number };
export type Session = { title: string; source: string; cwd?: string; turns: Turn[]; mainLeaf: number | null; skipped?: number; file?: string };

const claudeDir = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
const codexDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
const base = (s: Source) => (s === 'claude-code' ? claudeDir() : codexDir());
const MAX_FILE = 200 * 1024 * 1024;
const RESULT_CHARS = 1200, RESULT_LINES = 24;

export class SessionError extends Error { constructor(public code: string, message: string) { super(message); } }

/* ---- listing ---- */
async function jsonlFiles(dir: string, depth: number, out: string[] = []): Promise<string[]> {
  let ents; try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth > 0) await jsonlFiles(p, depth - 1, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}
/* the first lines of a file, enough to name it */
async function head(path: string, maxLines = 400): Promise<any[]> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8', end: 4 * 1024 * 1024 }), crlfDelay: Infinity });
  const out: any[] = [];
  for await (const line of rl) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* skip */ } if (out.length >= maxLines) break; }
  rl.close();
  return out;
}
const oneLine = (s: string, n = 90) => { const t = s.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export async function listSessions(limit = 300) {
  const found: { source: Source; file: string; title: string; cwd?: string; updated: number; size: number }[] = [];
  for (const source of ['claude-code', 'codex'] as Source[]) {
    const dir = base(source);
    if (!existsSync(dir)) continue;
    const files = await jsonlFiles(dir, source === 'claude-code' ? 2 : 4);
    const stats = await Promise.all(files.map(async (f) => ({ f, st: await fs.stat(f).catch(() => null) })));
    for (const { f, st } of stats.filter((x) => x.st).sort((a, b) => b.st!.mtimeMs - a.st!.mtimeMs).slice(0, limit)) {
      if (source === 'claude-code' && /(^|[\\/])agent-[^\\/]*\.jsonl$/.test(f)) continue; /* a subagent's own log */
      const lines = await head(f);
      const s = source === 'claude-code' ? claudeTitle(lines) : codexTitle(lines);
      if (!s.title) continue;
      found.push({ source, file: relative(dir, f), title: s.title, cwd: s.cwd, updated: Math.round(st!.mtimeMs), size: st!.size });
    }
  }
  return { sessions: found.sort((a, b) => b.updated - a.updated).slice(0, limit), dirs: { 'claude-code': claudeDir(), codex: codexDir() } };
}

/* ---- reading ---- */
function fileOf(source: Source, rel: string) {
  const dir = resolve(base(source)), abs = resolve(dir, rel);
  if (!abs.startsWith(dir + sep) || !abs.endsWith('.jsonl')) throw new SessionError('outside', 'That isn’t a session file.');
  if (!existsSync(abs)) throw new SessionError('not_found', 'That session file is gone.');
  return abs;
}
async function readLines(path: string): Promise<any[]> {
  const st = await fs.stat(path);
  if (st.size > MAX_FILE) throw new SessionError('too_large', 'That session file is over 200 MB.');
  return parseLines(await fs.readFile(path, 'utf8'));
}
export function parseLines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* skip */ } }
  return out;
}
export async function readSession(source: Source, rel: string): Promise<Session> {
  const path = fileOf(source, rel), lines = await readLines(path);
  const s = source === 'claude-code' ? fromClaudeCode(lines) : fromCodex(lines);
  return { ...s, file: rel };
}
/* a log someone chose or pasted, of either kind */
export function parseSession(text: string): Session {
  const lines = parseLines(text);
  return lines.some((l) => l && (l.type === 'session_meta' || l.type === 'response_item' || l.type === 'event_msg')) ? fromCodex(lines) : fromClaudeCode(lines);
}

/* ---- shared ---- */
const textOf = (c: any): string => typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : b && (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') ? b.text : '')).filter(Boolean).join('\n\n') : '';
function excerpt(s: string) {
  const lines = s.replace(/\r/g, '').split('\n');
  let out = lines.slice(0, RESULT_LINES).join('\n');
  if (out.length > RESULT_CHARS) out = out.slice(0, RESULT_CHARS);
  const more = s.length - out.length;
  return out.replace(/```/g, '`​``') + (more > 0 ? `\n… ${more.toLocaleString()} more characters` : '');
}
/* the one detail that says what a tool call did */
function gist(name: string, input: any): string {
  if (!input || typeof input !== 'object') return '';
  const v = input.file_path || input.path || input.notebook_path || input.command || input.cmd || input.pattern || input.url || input.query || input.description || input.prompt || input.subject;
  const s = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
  return s ? oneLine(s, 140) : '';
}
const toolMd = (name: string, input: any, result: string | null, error = false) =>
  `**⚙ ${name}**${gist(name, input) ? ' `' + gist(name, input).replace(/`/g, "'") + '`' : ''}${error ? ' · failed' : ''}` + (result != null && result.trim() ? '\n```text\n' + excerpt(result) + '\n```' : '');
function addUsage(t: Turn, model: string | undefined, u: any) {
  if (!u) return;
  const a: Usage = { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || u.cached_input_tokens || 0 };
  const was = t.usage || { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const sum: Usage = { input: was.input + a.input, output: was.output + a.output, cacheWrite: was.cacheWrite + a.cacheWrite, cacheRead: was.cacheRead + a.cacheRead };
  const c = model ? costOf(a, prices(model)) : undefined;
  if (c != null || was.cost != null) sum.cost = (was.cost || 0) + (c || 0);
  t.usage = sum;
}

/* ---- Claude Code ---- */
function claudeTitle(lines: any[]) {
  const first = lines.find((l) => isHuman(l) && !l.isCompactSummary);
  const sum = lines.find((l) => l.type === 'summary' && l.summary);
  const cwd = lines.find((l) => l.cwd)?.cwd;
  return { title: sum ? oneLine(sum.summary) : first ? oneLine(textOf(first.message.content)) : '', cwd };
}
/* something the person typed, as opposed to tool results and the agent's own notes */
function isHuman(l: any) {
  if (!l || l.type !== 'user' || l.isSidechain || l.isMeta || !l.message) return false;
  const c = l.message.content;
  if (typeof c === 'string') return !!c.trim();
  return Array.isArray(c) && c.some((b) => b && b.type === 'text' && b.text && b.text.trim()) && !c.some((b) => b && b.type === 'tool_result');
}
export function fromClaudeCode(lines: any[]): Omit<Session, 'file'> {
  /* every record with an id is a link in the chain (attachments, system notes…), even the ones not shown */
  const byId = new Map(lines.filter((l) => l && l.uuid).map((r) => [r.uuid, r]));
  const recs = lines.filter((l) => l && l.uuid && (l.type === 'user' || l.type === 'assistant'));
  const humanTurn = new Map<string, Turn>(), turns: Turn[] = [];
  let k = 0, skipped = 0;
  const up = (r: any) => byId.get(r.parentUuid ?? r.logicalParentUuid);
  /* the person's message a record answers to: its nearest ancestor that is one */
  const memo = new Map<string, any>();
  const ownerOf = (r: any): any => {
    const path: any[] = []; let cur = up(r), found: any = null;
    while (cur) { if (memo.has(cur.uuid)) { found = memo.get(cur.uuid); break; } if (isHuman(cur)) { found = cur; break; } path.push(cur); cur = up(cur); }
    for (const p of path) memo.set(p.uuid, found);
    return found;
  };
  for (const r of recs) {
    if (!isHuman(r)) continue;
    const owner = ownerOf(r), parent = owner ? humanTurn.get(owner.uuid) : null;
    /* notes Claude Code adds to a message (the time, reminders) are left out, and counted, so the prompt reads as typed */
    const raw = textOf(r.message.content), notes = (raw.match(/<system-reminder>[\s\S]*?<\/system-reminder>/g) || []).length;
    const t: Turn = { k: k++, parent: parent ? parent.k : null, text: raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, '').trim() || raw.trim(), at: r.timestamp };
    if (notes) t.notes = notes;
    if (r.isCompactSummary) t.tag = 'compaction summary';
    humanTurn.set(r.uuid, t); turns.push(t);
  }
  /* what the agent did for each: text, tool calls with their results, thinking, usage */
  const results = new Map<string, { text: string; error: boolean }>();
  for (const r of recs) if (r.type === 'user' && Array.isArray(r.message?.content)) for (const b of r.message.content) if (b && b.type === 'tool_result') results.set(b.tool_use_id, { text: textOf(b.content), error: !!b.is_error });
  const parts = new Map<number, string[]>(), seenUsage = new Set<string>();
  for (const r of recs) {
    if (r.type !== 'assistant' || !r.message) continue;
    if (r.isSidechain) { skipped++; continue; }
    const owner = ownerOf(r), t = owner && humanTurn.get(owner.uuid); if (!t) { skipped++; continue; }
    const m = r.message, list = parts.get(t.k) || [];
    if (m.model && m.model !== '<synthetic>') t.model = m.model;
    for (const b of Array.isArray(m.content) ? m.content : [{ type: 'text', text: textOf(m.content) }]) {
      if (!b) continue;
      if (b.type === 'text' && b.text && b.text.trim()) list.push(b.text.trim());
      else if (b.type === 'tool_use') { const res = results.get(b.id); list.push(toolMd(b.name, b.input, res ? res.text : null, res?.error)); }
      else if (b.type === 'thinking' && b.thinking && b.thinking.trim()) t.thinking = (t.thinking ? t.thinking + '\n\n' : '') + b.thinking.trim();
    }
    /* one API response is split over several records; count its usage once */
    if (m.usage && m.id && !seenUsage.has(m.id)) { seenUsage.add(m.id); addUsage(t, m.model, m.usage); }
    parts.set(t.k, list);
  }
  for (const t of turns) { const p = parts.get(t.k); if (p && p.length) t.reply = p.join('\n\n'); }
  const leaf = [...turns].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0];
  const title = claudeTitle(lines).title || 'Claude Code session';
  return { title, source: 'Claude Code', cwd: lines.find((l) => l && l.cwd)?.cwd, turns, mainLeaf: leaf ? leaf.k : null, skipped };
}

/* ---- Codex ---- */
function codexTitle(lines: any[]) {
  const meta = lines.find((l) => l && l.type === 'session_meta')?.payload;
  const first = codexItems(lines).find((i) => i.kind === 'user');
  return { title: first ? oneLine(first.text) : '', cwd: meta?.cwd };
}
type CItem = { kind: 'user' | 'assistant' | 'call' | 'output' | 'reasoning'; text: string; name?: string; input?: any; id?: string; model?: string; usage?: any };
/* Codex writes each item twice (as a response item and as an event); response items are used when present */
function codexItems(lines: any[]): CItem[] {
  const items: CItem[] = [], hasResponse = lines.some((l) => l && l.type === 'response_item');
  let model: string | undefined;
  for (const l of lines) {
    if (!l) continue;
    const p = l.payload || l;
    if (l.type === 'turn_context' && p.model) model = p.model;
    if (hasResponse ? l.type === 'response_item' : (l.type === 'event_msg' || l.type === 'message')) {
      const t = p.type;
      if (t === 'message' || (!t && p.role)) {
        const text = textOf(p.content).trim();
        if (!text || /^<(environment_context|user_instructions|permissions)/.test(text)) continue; /* context Codex adds itself */
        items.push({ kind: p.role === 'user' ? 'user' : 'assistant', text, model });
      } else if (t === 'function_call' || t === 'custom_tool_call' || t === 'local_shell_call') {
        let input = p.arguments ?? p.input ?? p.action; if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = { command: input }; } }
        items.push({ kind: 'call', name: p.name || (t === 'local_shell_call' ? 'shell' : 'tool'), input, id: p.call_id || p.id, text: '' });
      } else if (t === 'function_call_output' || t === 'custom_tool_call_output') {
        let out = p.output; if (out && typeof out === 'object') out = out.content ?? out.output ?? JSON.stringify(out);
        if (typeof out === 'string') { try { const j = JSON.parse(out); if (j && typeof j.output === 'string') out = j.output; } catch { /* plain text */ } }
        items.push({ kind: 'output', id: p.call_id, text: String(out ?? '') });
      } else if (t === 'reasoning') {
        const s = Array.isArray(p.summary) ? p.summary.map((x: any) => x.text || '').join('\n') : '';
        if (s.trim()) items.push({ kind: 'reasoning', text: s.trim() });
      } else if (t === 'user_message' && p.message) items.push({ kind: 'user', text: String(p.message) });
      else if (t === 'agent_message' && p.message) items.push({ kind: 'assistant', text: String(p.message), model });
    }
    if (l.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) items.push({ kind: 'reasoning', text: '', usage: p.info.last_token_usage, model });
  }
  return items;
}
export function fromCodex(lines: any[]): Omit<Session, 'file'> {
  const items = codexItems(lines), turns: Turn[] = [];
  const outputs = new Map(items.filter((i) => i.kind === 'output').map((i) => [i.id, i.text]));
  let cur: Turn | null = null, parts: string[] = [];
  const close = () => { if (cur && parts.length) cur.reply = parts.join('\n\n'); parts = []; };
  for (const i of items) {
    if (i.kind === 'user') { close(); cur = { k: turns.length, parent: cur ? cur.k : null, text: i.text }; turns.push(cur); continue; }
    if (!cur) continue;
    if (i.model) cur.model = i.model;
    if (i.usage) addUsage(cur, i.model, { input_tokens: i.usage.input_tokens, output_tokens: i.usage.output_tokens, cached_input_tokens: i.usage.cached_input_tokens });
    if (i.kind === 'assistant') parts.push(i.text);
    else if (i.kind === 'call') parts.push(toolMd(i.name || 'tool', i.input, outputs.get(i.id) ?? null));
    else if (i.kind === 'reasoning' && i.text) cur.thinking = (cur.thinking ? cur.thinking + '\n\n' : '') + i.text;
  }
  close();
  const meta = lines.find((l) => l && l.type === 'session_meta')?.payload;
  return { title: codexTitle(lines).title || 'Codex session', source: 'Codex', cwd: meta?.cwd, turns, mainLeaf: turns.length ? turns[turns.length - 1].k : null };
}
