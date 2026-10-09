import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { appScript } from './scripts/app-script.ts';

const port = Number(process.env.TREECHATS_PORT || 5178);

export default defineConfig({
  root: 'web',
  /* the page's script: web/src joined into /app.js (see scripts/app-script.ts) */
  plugins: [appScript(resolve(import.meta.dirname, 'web/src'))],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    // `npm run dev`: the page is served by Vite with live reload, and /api goes to the Treechats server.
    port: port + 1,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${port}` },
  },
});
