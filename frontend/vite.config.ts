import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: [
      'yjs',
      'lit',
      '@lit/reactive-element',
      'lit-element',
      'lit-html',
      '@blocksuite/store',
      '@blocksuite/block-std',
      '@blocksuite/blocks',
      '@blocksuite/presets'
    ],
    alias: {
      'gl-bench': 'gl-bench/dist/gl-bench.module.js'
    }
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: [
      'mermaid',
      'dayjs',
      'extend',
      'lodash.chunk',
      'lodash.clonedeep',
      'lodash.ismatch',
      'lodash.merge',
      'lodash.mergewith'
    ]
  }
});
