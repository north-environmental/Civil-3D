import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2500, target: 'es2022' },
  worker: { format: 'es' },
  server: { proxy: { '/api': 'http://127.0.0.1:4310', '/exports': 'http://127.0.0.1:4310', '/ws': { target: 'ws://127.0.0.1:4310', ws: true } } },
});
