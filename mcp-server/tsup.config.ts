import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  target: 'node20',
  outExtension: () => ({ js: '.mjs' }),
});
