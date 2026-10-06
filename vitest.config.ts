import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['extension/src/**/*.test.ts', 'mcp-server/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
