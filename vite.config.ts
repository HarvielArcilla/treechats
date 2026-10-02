import { defineConfig } from 'vite';

const port = Number(process.env.TREECHATS_PORT || 5178);

export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    // `npm run dev`: the page is served by Vite with live reload, and /api goes to the Treechats server.
    port: port + 1,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${port}` },
  },
});
