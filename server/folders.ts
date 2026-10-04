/* Folders on this computer, for project files. The page lists a folder, reads the files you tick, and can write
   a file back when you save an edit to disk (only in a folder linked to a project). Everything stays inside the folder: paths are resolved
   against it and anything that escapes it (.., symlinks out) is refused. Writes refuse to overwrite a file that
   changed on disk since it was read, unless the page says to.

   Listing uses `git ls-files` when the folder is a git repository, so .gitignore is respected exactly; otherwise
   it walks the folder, skipping the usual build and dependency folders and the patterns in a top-level .gitignore. */
import { execFile } from 'node:child_process';
import { existsSync, promises as fs, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const MAX_FILE = 300 * 1024;
const MAX_LIST = 5000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode', '.turbo', 'vendor']);

export class FolderError extends Error { constructor(public code: string, message: string) { super(message); } }

/* the saved state, for checking which folders are linked to a project */
export type St = { db: { spaces: Record<string, { tree: { files?: { src?: { root?: string } }[] } }> }; opts?: Record<string, unknown> } | null;
function linked(state: St, root: string) {
  if (!state) return false;
  return Object.values(state.db.spaces).some((sp) => (sp.tree.files || []).some((f) => f.src && f.src.root === root));
}
/* changing anything (writing a file, running a command) needs the folder to be linked to a project; listing and
   reading a folder you are choosing files from doesn't */
export function checkLinked(state: St, input: string) {
  const root = folderRoot(input);
  if (!linked(state, root)) throw new FolderError('not_linked', 'That folder isn’t linked to a project. Link it from Project files first.');
  return root;
}

/* "~/code/app" or an absolute path → the real folder, or an error a person can act on */
export function folderRoot(input: string): string {
  let p = String(input || '').trim().replace(/^"(.*)"$/, '$1');
  if (!p) throw new FolderError('bad_path', 'Give the path of a folder on this computer.');
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = join(homedir(), p.slice(1));
  if (!isAbsolute(p)) throw new FolderError('bad_path', 'Use a full path, such as /Users/you/code/app or ~/code/app.');
  if (!existsSync(p)) throw new FolderError('not_found', `There is no folder at ${p}.`);
  const real = realpathSync(p);
  if (!statSync(real).isDirectory()) throw new FolderError('not_folder', `${p} is a file, not a folder.`);
  return real;
}
/* a path inside the folder, or an error */
function inside(root: string, rel: string): string {
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) throw new FolderError('outside', `${rel} is outside the linked folder.`);
  if (existsSync(abs)) { const real = realpathSync(abs); if (real !== root && !real.startsWith(root + sep)) throw new FolderError('outside', `${rel} points outside the linked folder.`); }
  return abs;
}
const posix = (p: string) => p.split(sep).join('/');

function gitFiles(root: string): Promise<string[] | null> {
  return new Promise((res) => {
    execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 15000 }, (err, out) => {
      if (err) return res(null);
      res(out.split('\0').filter(Boolean));
    });
  });
}
/* a small .gitignore reader for folders that aren't repositories: names, *.ext and dir/ patterns */
function ignoreTest(root: string) {
  let pats: RegExp[] = [];
  try {
    const gi = join(root, '.gitignore'), txt = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
    pats = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('!')).map((l) => {
      const anchored = l.startsWith('/'), dir = l.endsWith('/');
      const body = l.replace(/^\//, '').replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
      return new RegExp((anchored ? '^' : '(^|/)') + body + (dir ? '/' : '(/|$)'));
    });
  } catch { /* no .gitignore */ }
  return (rel: string) => pats.some((re) => re.test(rel));
}

async function walk(root: string): Promise<string[]> {
  const ignored = ignoreTest(root), out: string[] = [];
  async function go(dir: string) {
    if (out.length >= MAX_LIST) return;
    let ents; try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = join(dir, e.name), rel = posix(relative(root, abs));
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !ignored(rel)) await go(abs); }
      else if (e.isFile() && !ignored(rel)) out.push(rel);
      if (out.length >= MAX_LIST) return;
    }
  }
  await go(root);
  return out;
}

export type Listed = { path: string; size: number; mtime: number };
export async function listFolder(input: string): Promise<{ root: string; name: string; git: boolean; files: Listed[]; truncated: boolean }> {
  const root = folderRoot(input);
  const fromGit = existsSync(join(root, '.git')) ? await gitFiles(root) : null;
  let rels = fromGit ?? await walk(root);
  /* dependencies are skipped even when a repository forgot to ignore them */
  rels = rels.filter((r) => !r.split('/').some((seg) => seg === '.git' || seg === 'node_modules'));
  const truncated = rels.length > MAX_LIST;
  const files: Listed[] = [];
  for (const rel of rels.slice(0, MAX_LIST)) {
    try { const st = await fs.stat(join(root, rel)); if (st.isFile()) files.push({ path: rel, size: st.size, mtime: Math.round(st.mtimeMs) }); } catch { /* deleted meanwhile */ }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { root, name: root.split(sep).filter(Boolean).pop() || root, git: !!fromGit, files, truncated };
}

/* a file's text, or why it can't be read as text */
export async function readFolderFiles(input: string, paths: string[]) {
  const root = folderRoot(input);
  return Promise.all(paths.slice(0, 500).map(async (rel) => {
    try {
      const abs = inside(root, rel), st = await fs.stat(abs);
      if (st.size > MAX_FILE) return { path: rel, error: `It is ${Math.round(st.size / 1024)} KB; files can be up to ${MAX_FILE / 1024} KB.` };
      const buf = await fs.readFile(abs);
      if (buf.includes(0)) return { path: rel, error: 'It looks like a binary file.' };
      return { path: rel, text: buf.toString('utf8'), size: st.size, mtime: Math.round(st.mtimeMs) };
    } catch (e) { return { path: rel, error: e instanceof FolderError ? e.message : 'It couldn’t be read.' }; }
  }));
}

/* writes one file back; refuses when it changed on disk since `mtime`, unless force */
export async function writeFolderFile(state: St, input: string, rel: string, text: string, mtime: number | null, force: boolean) {
  const root = checkLinked(state, input), abs = inside(root, rel);
  /* case and trailing dots don't matter to macOS and Windows: .GIT and .git. are the same folder there */
  if (relative(root, abs).split(/[\\/]/).some((seg) => seg.replace(/[. ]+$/, '').toLowerCase() === '.git')) throw new FolderError('outside', 'Treechats doesn’t write inside .git.');
  if (Buffer.byteLength(text) > MAX_FILE) throw new FolderError('too_large', `Files can be up to ${MAX_FILE / 1024} KB.`);
  if (existsSync(abs) && !force && mtime != null) {
    const now = Math.round((await fs.stat(abs)).mtimeMs);
    if (Math.abs(now - mtime) > 1) throw new FolderError('changed_on_disk', `${rel} changed on disk since Treechats read it.`);
  }
  await fs.writeFile(abs, text, 'utf8');
  return { path: rel, mtime: Math.round((await fs.stat(abs)).mtimeMs), size: Buffer.byteLength(text) };
}
