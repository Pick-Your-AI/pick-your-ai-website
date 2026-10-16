/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { computeBuildVersion, versionPlugin } from './scripts/version-plugin.ts';

const version = computeBuildVersion(import.meta.dirname, process.env);

export default defineConfig({
  plugins: [react(), tailwindcss(), versionPlugin(version)],
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  preview: { port: 4317, strictPort: true },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
    restoreMocks: true,
  },
});
