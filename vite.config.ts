import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: { ignored: ['**/.local/**', '**/dist/**', '**/dist-server/**', '**/dist-competition/**', '**/test-results/**', '**/playwright-report/**', '**/artifacts/**'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/server/**', '**/prisma/**', '**/dist-server/**', '**/*.db*'] },
    proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  preview: { proxy: { '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001', changeOrigin: false } } },
});
