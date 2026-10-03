/* Commands and git in linked folders, so their output can go into a prompt.

   Running commands is off until it is turned on in Settings › System, and works only in folders linked to a
   project. Both are checked here against the saved state, not taken from the request, so a page can't widen them.
   A command runs in a shell in that folder, with a time limit; its output (stdout and stderr together, in order)
   is kept up to a size limit, the end being what matters most for errors. Stopping the request stops the command.

   Git reads (status and diffs) change nothing, so they only need the folder to be linked. */
import { spawn } from 'node:child_process';
import { folderRoot, FolderError } from './folders.ts';

const MAX_OUT = 400 * 1024;
type St = { db: { spaces: Record<string, { tree: { files?: { src?: { root?: string } }[] } }> }; opts?: Record<string, unknown> } | null;

function linked(state: St, root: string) {
  if (!state) return false;
  return Object.values(state.db.spaces).some((sp) => (sp.tree.files || []).some((f) => f.src && f.src.root === root));
}
function checkLinked(state: St, input: string) {
  const root = folderRoot(input);
  if (!linked(state, root)) throw new FolderError('not_linked', 'That folder isn’t linked to a project. Link it from Project files first.');
  return root;
}

export async function runCommand(state: St, input: string, command: string, timeoutSec: number, signal: AbortSignal): Promise<{ command: string; code: number | null; signal: string | null; output: string; ms: number; truncated: boolean; timedOut: boolean }> {
  if (!state || state.opts?.allowCommands !== true) throw new FolderError('commands_off', 'Running commands is off. Turn it on in Settings › System.');
  const root = checkLinked(state, input);
  const cmd = String(command || '').trim();
  if (!cmd) throw new FolderError('bad_command', 'Give a command to run.');
  const limit = Math.min(600, Math.max(5, Number(timeoutSec) || 120)) * 1000;
  return new Promise((resolve) => {
    const started = Date.now(), win = process.platform === 'win32';
    const child = spawn(win ? 'cmd.exe' : '/bin/sh', win ? ['/d', '/s', '/c', cmd] : ['-c', cmd], { cwd: root, env: { ...process.env, CI: process.env.CI || '1', FORCE_COLOR: '0' }, detached: !win, windowsHide: true });
    let out = '', dropped = 0, timedOut = false;
    const add = (b: Buffer) => { out += b.toString('utf8'); if (out.length > MAX_OUT * 2) { dropped += out.length - MAX_OUT; out = out.slice(out.length - MAX_OUT); } };
    child.stdout.on('data', add); child.stderr.on('data', add);
    const kill = () => { try { if (!win && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, limit);
    signal.addEventListener('abort', kill, { once: true });
    const done = (code: number | null, sig: string | null) => {
      clearTimeout(timer);
      if (out.length > MAX_OUT) { dropped += out.length - MAX_OUT; out = out.slice(out.length - MAX_OUT); }
      const head = dropped ? `… the first ${dropped.toLocaleString()} characters of output were cut\n` : '';
      resolve({ command: cmd, code, signal: sig, output: head + out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''), ms: Date.now() - started, truncated: dropped > 0, timedOut });
    };
    child.on('close', done);
    child.on('error', (e) => { out += `\n${e.message}`; done(null, null); });
  });
}

function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: root, env: { ...process.env, GIT_PAGER: 'cat', LC_ALL: 'C' } });
    let out = '', err = '';
    child.stdout.on('data', (b) => { if (out.length < MAX_OUT * 2) out += b; });
    child.stderr.on('data', (b) => { err += b; });
    child.on('error', () => reject(new FolderError('no_git', 'Git isn’t installed, or isn’t on the PATH.')));
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new FolderError('git_failed', err.trim().split('\n')[0] || `git ${args[0]} failed.`)));
  });
}
export async function gitStatus(state: St, input: string) {
  const root = checkLinked(state, input);
  const out = await git(root, ['status', '--porcelain=v1', '-b', '--untracked-files=normal']).catch((e) => { if (/not a git repository/i.test(e.message)) return null; throw e; });
  if (out == null) return { root, git: false };
  const lines = out.split('\n').filter(Boolean), head = lines[0]?.startsWith('## ') ? lines.shift()!.slice(3) : '';
  const branch = head.replace(/^No commits yet on /, '').split('...')[0];
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] || 0), behind = Number(head.match(/behind (\d+)/)?.[1] || 0);
  const changed = lines.map((l) => ({ status: l.slice(0, 2).trim() || '?', path: l.slice(3) }));
  return { root, git: true, branch, ahead, behind, changed };
}
/* what: "working" (everything not committed, against HEAD), "staged", "last" (the latest commit), or a commit */
export async function gitDiff(state: St, input: string, what: string) {
  const root = checkLinked(state, input);
  let args: string[], label: string;
  if (what === 'staged') { args = ['diff', '--cached']; label = 'staged changes'; }
  else if (what === 'last') { args = ['show', '--patch', '--stat', 'HEAD']; label = 'the latest commit'; }
  else if (what === 'working' || !what) { args = ['diff', 'HEAD']; label = 'changes not committed'; }
  else if (/^[\w./~^-]{1,80}$/.test(what) && !what.startsWith('-')) { args = ['show', '--patch', '--stat', what]; label = `commit ${what}`; }
  else throw new FolderError('bad_ref', 'Name a commit, a branch, or one of: working, staged, last.');
  let text = await git(root, args).catch(async (e) => { if (what === 'working' && /unknown revision|bad revision|ambiguous argument 'HEAD'/i.test(e.message)) return git(root, ['diff']); throw e; });
  let untracked: string[] = [];
  if (what === 'working' || !what) untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean);
  const truncated = text.length > MAX_OUT;
  if (truncated) text = text.slice(0, MAX_OUT) + '\n… the rest of the diff was cut';
  return { root, label, text, untracked, truncated };
}
