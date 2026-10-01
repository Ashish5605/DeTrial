import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), server: { port: 5176, strictPort: true, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] }, proxy: { '/api': 'http://127.0.0.1:3004', '/rpc': { target: 'http://127.0.0.1:9655', rewrite: p => p.replace(/^\/rpc/, '') } } }, build: { outDir: '../../dist', emptyOutDir: true, rollupOptions: { output: { manualChunks: { ethers: ['ethers'], react: ['react', 'react-dom'] } } } } });
