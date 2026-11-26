import { execFileSync } from 'node:child_process';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function resolveGitSha(): string {
  const fromEnv = process.env.VITE_GIT_SHA?.trim();
  if (fromEnv) return fromEnv;

  const candidates =
    process.platform === 'win32'
      ? ['git', 'C:\\Program Files\\Git\\cmd\\git.exe']
      : ['git'];

  for (const bin of candidates) {
    try {
      const sha = execFileSync(bin, ['rev-parse', '--short', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (sha) return sha;
    } catch {
      // try next git binary candidate
    }
  }
  return 'dev';
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(resolveGitSha()),
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          tanstack: ['@tanstack/react-router', '@tanstack/react-query'],
        },
      },
    },
  },
});
