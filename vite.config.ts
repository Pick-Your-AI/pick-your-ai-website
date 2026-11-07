/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { computeBuildVersion, versionPlugin } from './scripts/version-plugin.ts';

const version = computeBuildVersion(import.meta.dirname, process.env);

export default defineConfig({
  plugins: [react(), versionPlugin(version)],
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  preview: { port: 4317, strictPort: true },
  test: {
    environment: 'jsdom',
    // The organization bundle validator is plain ESM beside its CLI; Vitest runs its tests here.
    include: ['tests/unit/**/*.test.{ts,tsx}', 'scripts/organization.test.mjs'],
    setupFiles: ['tests/unit/setup.ts'],
    restoreMocks: true,
  },
});
