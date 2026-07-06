import { defineConfig } from 'vitest/config';
import path from 'path';

const boardgameRoot = path.resolve(__dirname, '../boardgame.io');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['lib/**', 'node_modules/**', 'out/**', 'cache/**', 'dist/**'],
  },
  resolve: {
    alias: {
      // Fix subpath imports like "boardgame.io/core" for the local vendored boardgame.io (dev without full proxy dirs)
      'boardgame.io/core': path.join(boardgameRoot, 'packages/core.ts'),
      'boardgame.io': path.join(boardgameRoot, 'packages/main.js'),
    },
  },
  // Help ESM resolution for the lib
  ssr: {
    noExternal: ['boardgame.io'],
  },
});
