/* Entry point. Checks the Node version before anything that needs a newer one is loaded, so an old Node
   gets a clear message instead of a crash, then starts the server from the project folder. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n  Treechats needs Node.js 22.13 or newer, and this is ${process.versions.node}.`);
  console.error('  Install the current LTS from https://nodejs.org, then run npm start again.\n');
  process.exit(1);
}

/* files Treechats creates (the database, its journal, the token) are readable only by your account */
if (process.platform !== 'win32') process.umask(0o077);
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
await import('./index.ts');
