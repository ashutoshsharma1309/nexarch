/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vitest (`npm test`): component/hook/store tests under src/**/*.test.ts(x),
  // run in jsdom with Testing Library matchers loaded once in the setup file.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Coverage measures the shipped sources only: the test files, the jsdom
    // setup and the entry point would otherwise report as covered and inflate
    // the percentages with code that is not under test.
    //
    // No thresholds are set yet. The suite currently covers a minority of the
    // client, so any threshold honest enough to pass today would be too low to
    // mean anything, and a threshold set where we want coverage to be would
    // fail every run and get deleted. Raise coverage first, then ratchet.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      // Report even when tests fail: coverage is diagnostic, and the run that
      // most needs the numbers is the one where something broke.
      reportOnFailure: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/vite-env.d.ts', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The client never hardcodes the API host: same-origin `/api` requests
    // are proxied to the server in development and by nginx in production.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', 'axios', 'zustand'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
