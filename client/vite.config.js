import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During dev, proxy /api calls to the Express server on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
