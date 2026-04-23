import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  root: 'renderer',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    reportCompressedSize: false,
    cssMinify: true,
  },
  esbuild: {
    legalComments: 'none',
    drop: mode === 'production' ? ['debugger'] : [],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer/src'),
    },
  },
}));
