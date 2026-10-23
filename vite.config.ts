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
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false },
    },
  },
});
