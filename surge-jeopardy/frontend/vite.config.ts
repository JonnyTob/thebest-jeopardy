import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../backend/src/shared'),
    },
  },
  build: {
    // Build into the backend's public folder so Express can serve it
    outDir: '../backend/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: true, // bind to 0.0.0.0 so LAN devices can reach the dev server
    proxy: {
      '/api': 'http://localhost:3001',
      '/media': 'http://localhost:3001',
    },
  },
});
