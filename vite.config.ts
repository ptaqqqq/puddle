import { sveltekit } from '@sveltejs/kit/vite';
import type { UserConfig } from 'vite';

export default {
  plugins: [sveltekit()],
  server: {
    port: 5173,
    host: true,            // listen on 0.0.0.0 so it’s reachable externally
    strictPort: true,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
        changeOrigin: true,
      }
    }
  }
} satisfies UserConfig;
