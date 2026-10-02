import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

/* Starting other programs the same way on Windows, macOS and Linux. */

export const isWin = process.platform === 'win32';

const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };

/* Finds a command the way a terminal would: on PATH (with .exe/.cmd on Windows), then in the places the
   Claude Code installers put it, since a PATH change made by an installer may not have reached this
   process yet. Returns null when it can't be found. */
export function findExecutable(name: string, extra: string[] = []): string | null {
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) return isFile(name) ? name : null;
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean).map((e) => e.toLowerCase()) : [''];
  const dirs = (process.env.PATH || process.env.Path || '').split(delimiter).filter(Boolean);
  for (const dir of [...dirs, ...extra]) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (isFile(p)) return p;
    }
  }
  return null;
}

/* Where the Claude Code installers put `claude` when it isn't on PATH */
export function claudeSearchDirs(): string[] {
  const home = homedir();
  if (isWin) {
    return [
      join(home, '.local', 'bin'),
      process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
      process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'claude') : '',
    ].filter(Boolean);
  }
  return [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin')];
}

/* Windows can only start .cmd and .bat files (an npm-installed CLI is claude.cmd) through cmd.exe.
   Then every argument is quoted; nothing user-written ever goes on the command line, only fixed flags,
   model names and file paths. Everything else is started directly. */
export function start(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
  const base: SpawnOptions = { windowsHide: true, env: process.env, ...opts };
  if (isWin && /\.(cmd|bat)$/i.test(cmd)) {
    const q = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    return spawn([q(cmd), ...args.map(q)].join(' '), { ...base, shell: true });
  }
  return spawn(cmd, args, base);
}

/* Stops a program and anything it started. On Windows, killing a process started through cmd.exe would
   only stop cmd.exe and leave the real program running, so the whole tree is ended with taskkill. */
export function stopTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode != null) return;
  if (isWin) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {}
  } else {
    try { child.kill('SIGINT'); } catch {}
    setTimeout(() => { try { if (child.exitCode == null) child.kill('SIGKILL'); } catch {} }, 3000).unref();
  }
}

/* Opens a page in the default browser. */
export function openBrowser(url: string): void {
  try {
    if (isWin) spawn('cmd', ['/c', 'start', '""', url], { windowsHide: true, stdio: 'ignore', detached: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

export { existsSync };
