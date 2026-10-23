import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { CONFIG_DEFAULTS, loadConfig } from './src/server/config.js';
import type { Config } from './src/server/config.js';
import { injectZone } from './src/server/index-html.js';

/**
 * `npm run dev` only: Vite serves index.html, not Express, so inject the
 * configured zone here the same way the server does. If the config is
 * invalid the dev API server refuses to start and says why; the page then
 * has no zone and the clock falls back to the browser's.
 */
function hearthZone(config: Config | undefined): Plugin {
  return {
    name: 'hearth-zone',
    apply: 'serve',
    transformIndexHtml(html) {
      return config === undefined ? html : injectZone(html, config.zone);
    },
  };
}

export default defineConfig(({ command }) => {
  // The same environment through the same loader as the dev API server
  // started beside Vite, so the proxy targets the port it listens on (an
  // empty PORT means the default there too). Only when serving: the loader
  // creates DATA_DIR, which a build has no use for.
  const result =
    command === 'serve' ? loadConfig(process.env, { cwd: process.cwd() }) : undefined;
  const config = result?.ok === true ? result.config : undefined;
  const apiPort = config?.port ?? Number(CONFIG_DEFAULTS.PORT);

  return {
    root: fileURLToPath(new URL('./src/client', import.meta.url)),
    plugins: [react(), hearthZone(config)],
    build: {
      outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': {
          target: `http://localhost:${String(apiPort)}`,
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
  };
});
