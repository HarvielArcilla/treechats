/* The page's script lives in web/src as files by topic, and runs as one script: they are joined, in the order
   web/src/ORDER lists them, into /app.js. Names declared at the top of any file are visible in all of them, the way a
   single <script> works, so the files need no imports. A source map points the browser's errors and debugger back at
   the files themselves.

   In development (npm run dev) /app.js is joined on each request and the page reloads when a file changes; the build
   writes app.js and app.js.map into dist. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function vlq(n: number) {
  let v = n < 0 ? (-n << 1) | 1 : n << 1, out = '';
  do { let d = v & 31; v >>>= 5; if (v) d |= 32; out += B64[d]; } while (v);
  return out;
}

export function joinScript(srcDir: string) {
  const files = readFileSync(join(srcDir, 'ORDER'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const parts = files.map((f) => ({ f, text: readFileSync(join(srcDir, f), 'utf8') }));
  /* each line of app.js maps to the same line of its file */
  const lines: string[] = [];
  let prevSrc = 0, prevLine = 0;
  const code = parts.map(({ text }, i) => {
    const n = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    for (let l = 0; l < n; l++) { lines.push('A' + vlq(i - prevSrc) + vlq(l - prevLine) + 'A'); prevSrc = i; prevLine = l; }
    lines.push(''); /* the blank line between files */
    return text.endsWith('\n') ? text : text + '\n';
  }).join('\n');
  const map = { version: 3, file: 'app.js', sources: files.map((f) => 'src/' + f), sourcesContent: parts.map((p) => p.text), names: [], mappings: lines.join(';') };
  return { code, map: JSON.stringify(map), files };
}

export function appScript(srcDir: string): Plugin {
  return {
    name: 'treechats-app-script',
    configureServer(server) {
      server.watcher.add(srcDir);
      server.watcher.on('change', (f) => { if (f.startsWith(srcDir)) server.ws.send({ type: 'full-reload' }); });
      server.middlewares.use('/app.js', (_req, res) => {
        const { code, map } = joinScript(srcDir);
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.end(code + '\n//# sourceMappingURL=data:application/json;base64,' + Buffer.from(map).toString('base64') + '\n');
      });
    },
    generateBundle() {
      const { code, map } = joinScript(srcDir);
      this.emitFile({ type: 'asset', fileName: 'app.js', source: code + '\n//# sourceMappingURL=app.js.map\n' });
      this.emitFile({ type: 'asset', fileName: 'app.js.map', source: map });
    },
  };
}
