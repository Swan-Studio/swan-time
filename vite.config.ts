import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true }
});
