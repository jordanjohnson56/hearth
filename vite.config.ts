import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { loadConfig } from './src/server/config.js';
import { injectZone } from './src/server/index-html.js';

const apiPort = process.env['PORT'] ?? '4400';

/**
 * `npm run dev` only: Vite serves index.html, not Express, so inject the
 * configured zone here the same way the server does. It reads the same
 * environment through the same loader as the dev server started beside it.
 * If the config is invalid the dev server refuses to start and says why;
 * the page then has no zone and the clock falls back to the browser's.
 */
function hearthZone(): Plugin {
  let zone: string | undefined;
  return {
    name: 'hearth-zone',
    apply: 'serve',
    configResolved() {
      const result = loadConfig(process.env, { cwd: process.cwd() });
      zone = result.ok ? result.config.zone : undefined;
    },
    transformIndexHtml(html) {
      return zone === undefined ? html : injectZone(html, zone);
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  plugins: [react(), hearthZone()],
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: false,
        configure: (proxy) => {
          // When the API server stops mid-response (tsx watch restarts it on
          // every save), drop the browser's side too. Otherwise the proxy
          // holds an open /api/events stream that will never carry another
          // hint, and the client never knows to reconnect.
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            proxyRes.on('close', () => {
              if (!proxyRes.complete) res.destroy();
            });
          });
        },
      },
    },
  },
});
