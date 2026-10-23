import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiPort = process.env['PORT'] ?? '4400';

export default defineConfig({
  root: fileURLToPath(new URL('./src/client', import.meta.url)),
  plugins: [react()],
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
