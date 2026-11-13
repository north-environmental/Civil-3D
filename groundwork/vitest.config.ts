import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['packages/*/src/**/*.test.ts'], environment: 'node', testTimeout: 60_000 },
      },
      {
        test: {
          name: 'e2e',
          include: ['e2e/**/*.e2e.ts'],
          environment: 'node',
          testTimeout: 180_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'mcp',
          include: ['e2e/**/*.mcp.ts'],
          environment: 'node',
          testTimeout: 240_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
