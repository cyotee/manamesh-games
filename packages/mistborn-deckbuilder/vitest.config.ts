import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
    // snarkjs/web-worker must not mistake a Vitest thread for its own worker.
    pool: 'forks',
    maxWorkers: 2,
    minWorkers: 1,
  },
});
