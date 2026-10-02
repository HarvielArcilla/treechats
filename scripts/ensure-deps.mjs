/* Runs before `npm start` and `npm run dev`: installs packages when one is missing or package-lock.json has changed
   (after a git pull, say), so a new version never fails to build for want of `npm install`. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const missing = names.filter((n) => !existsSync(join(root, 'node_modules', n, 'package.json')));
const lock = join(root, 'package-lock.json'), installed = join(root, 'node_modules', '.package-lock.json');
const stale = existsSync(lock) && (!existsSync(installed) || statSync(lock).mtimeMs > statSync(installed).mtimeMs + 1000);

if (missing.length || stale) {
  console.log(missing.length ? `\n  Installing packages Treechats now needs (${missing.join(', ')})...\n` : '\n  Updating packages...\n');
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error('\n  npm install failed. Run it yourself to see why, then try again.\n');
    process.exit(r.status || 1);
  }
}
