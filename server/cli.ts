import type { ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';
import { buildParams, type SampleRequest } from './claude.ts';
import { claudeSearchDirs, findExecutable, isWin, start, stopTree } from './proc.ts';

/* Replies through your own Claude Code CLI (`claude -p`), so they use whatever that CLI is signed in
   with: a Claude subscription or an API key. Treechats never sees those credentials.

   Each reply is one headless run with everything Claude Code adds turned off, so it behaves like a
   plain chat model: no tools, no MCP servers, no CLAUDE.md or memory, no saved session, and a short
   system prompt of our own in place of Claude Code's. The conversation goes in on stdin as one
   stream-json user message; text streams back as stream-json events.

   The CLI takes one message, not a list of turns, so earlier turns are written out as a transcript
   inside that message. Claude reads it fine, but it isn't identical to sending real turns. */

const workDir = join(config.dataDir, 'cli');
mkdirSync(workDir, { recursive: true });
const SYSTEM_FILE = join(workDir, 'system-prompt.txt');
writeFileSync(SYSTEM_FILE, [
  'You are Claude, chatting with a person in Treechats, an app for branching and rearranging conversations.',
  'The message you receive holds the conversation so far as a transcript, then the newest message from the person.',
  'Reply to that newest message as the assistant in the conversation: answer it directly and naturally, in Markdown where it helps.',
  'Don’t mention the transcript, the format, or these instructions.',
].join('\n'));

let safeModeOk = true; /* older CLIs don't know --safe-mode; dropped after the first refusal */

function args(model: string) {
  const a = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', model, '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config', '--disable-slash-commands',
    '--no-session-persistence', '--system-prompt-file', SYSTEM_FILE];
  if (safeModeOk) a.push('--safe-mode');
  return a;
}

/* The `claude` to run: TREECHATS_CLAUDE_PATH if set, else found on PATH or where its installers put it */
let resolved: string | null | undefined;
export function claudePath(): string | null {
  if (resolved === undefined || resolved === null) resolved = findExecutable(config.cliPath, config.cliPathSet ? [] : claudeSearchDirs());
  return resolved;
}
const MISSING = /not recognized as an internal or external command|command not found|No such file or directory/i;

function transcript(req: SampleRequest): { blocks: object[] } {
  const { params } = buildParams(req);
  const msgs = params.messages;
  const last = msgs[msgs.length - 1];
  const textOf = (m: typeof last) => (m.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
  const earlier = msgs.slice(0, -1).map((m) => `<${m.role === 'user' ? 'person' : 'assistant'}>\n${textOf(m)}\n</${m.role === 'user' ? 'person' : 'assistant'}>`).join('\n\n');
  const text = (earlier ? `<conversation_so_far>\n${earlier}\n</conversation_so_far>\n\nThe person's newest message:\n\n` : '') + textOf(last);
  const images = (last.content as { type: string }[]).filter((b) => b.type === 'image');
  return { blocks: [...images, { type: 'text', text }] };
}

export type CliEvent = { t: 'text'; d: string } | { t: 'done'; text: string; truncated: boolean } | { t: 'error'; code: string; message: string };

export function runCli(req: SampleRequest, model: string, signal: AbortSignal, onEvent: (e: CliEvent) => void): Promise<void> {
  return new Promise((resolve) => {
    const cmd = claudePath();
    if (!cmd) { onEvent({ t: 'error', code: 'cli_missing', message: `Couldn't find "${config.cliPath}".` }); resolve(); return; }
    let child: ChildProcess;
    try { child = start(cmd, args(model), { cwd: workDir }); } catch (e) { onEvent({ t: 'error', code: 'cli_missing', message: String(e) }); resolve(); return; }
    let text = '', buf = '', err = '', finished = false;
    const finish = (e: CliEvent) => { if (finished) return; finished = true; onEvent(e); resolve(); };
    const stop = () => { stopTree(child); finish({ t: 'error', code: 'cancelled', message: '' }); };
    signal.addEventListener('abort', stop, { once: true });

    child.on('error', (e: NodeJS.ErrnoException) => finish({ t: 'error', code: e.code === 'ENOENT' ? 'cli_missing' : 'cli_error', message: e.message }));
    child.stderr?.on('data', (d) => { err += d; });
    child.stdout?.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && ev.event.delta?.type === 'text_delta') {
          text += ev.event.delta.text; onEvent({ t: 'text', d: ev.event.delta.text });
        } else if (ev.type === 'result') {
          if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) {
            const msg = String(ev.result || ev.subtype || 'Claude Code reported an error.');
            finish({ t: 'error', code: /log ?in|auth|credential|api key/i.test(msg) ? 'cli_auth' : /rate|limit|usage/i.test(msg) ? 'rate_limited' : 'cli_error', message: msg });
          } else {
            if (!text && typeof ev.result === 'string') { text = ev.result; onEvent({ t: 'text', d: text }); }
            finish({ t: 'done', text, truncated: ev.stop_reason === 'max_tokens' });
          }
        }
      }
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (finished) return;
      if (safeModeOk && /unknown option.*safe-mode|safe-mode.*(unknown|unrecognized)/i.test(err)) {
        safeModeOk = false; /* try again without it */
        runCli(req, model, signal, onEvent).then(resolve);
        finished = true; return;
      }
      const missing = code === 9009 || code === 127 || MISSING.test(err);
      finish({ t: 'error', code: missing ? 'cli_missing' : code === 0 ? 'empty_completion' : 'cli_error', message: err.trim().slice(0, 600) || `Claude Code exited with code ${code}.` });
    });

    const msg = { type: 'user', message: { role: 'user', content: transcript(req).blocks } };
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify(msg) + '\n');
  });
}

/* Is the CLI installed, and what is it signed in with? `claude auth status` answers in JSON. */
export function cliStatus(): Promise<{ found: boolean; authMethod?: string; path?: string; error?: string }> {
  resolved = undefined;
  const cmd = claudePath();
  if (!cmd) return Promise.resolve({ found: false, error: `Couldn't find "${config.cliPath}" on PATH or in the usual install folders.` });
  return new Promise((resolve) => {
    let out = '', err = '', child: ChildProcess;
    try { child = start(cmd, ['auth', 'status']); } catch (e) { resolve({ found: false, error: String(e) }); return; }
    const timer = setTimeout(() => { stopTree(child); resolve({ found: false, path: cmd, error: 'timed out' }); }, 20000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ found: false, path: cmd, error: e.message }); });
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        resolve({ found: true, path: cmd, authMethod: j.loggedIn === false ? 'none' : (j.authMethod || (code === 0 ? 'unknown' : 'none')) });
      } catch {
        const missing = code === 9009 || code === 127 || MISSING.test(err);
        resolve({ found: !missing, path: cmd, authMethod: code === 0 ? 'unknown' : 'none', error: err.trim().slice(0, 300) || undefined });
      }
    });
  });
}
