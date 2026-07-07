### Task 0: Package scaffolding

**Files:**
- Create: `packages/timestreams/package.json`
- Create: `packages/timestreams/tsconfig.json`
- Create: `packages/timestreams/vitest.config.ts`
- Create: `packages/timestreams/src/index.ts`
- Test: `packages/timestreams/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable, testable workspace package `@manamesh/timestreams`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PACKAGE_NAME } from "./index";

describe("package scaffolding", () => {
  it("exports the package name", () => {
    expect(PACKAGE_NAME).toBe("@manamesh/timestreams");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/smoke.test.ts`
Expected: FAIL — cannot resolve `./index` / `PACKAGE_NAME` undefined.

- [ ] **Step 3: Create the package files**

`packages/timestreams/package.json` (mirror `packages/onepiece/package.json`):
```json
{
  "name": "@manamesh/timestreams",
  "version": "0.1.0",
  "description": "Timestreams game module for ManaMesh — structured rules-free P2P play with mental-poker deck fairness.",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts",
    "./zones": "./src/zones.ts",
    "./timeline": "./src/timeline.ts",
    "./game": "./src/game.ts",
    "./crypto": "./src/crypto.ts",
    "./scoring": "./src/scoring.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@manamesh/boardgameio-crypto": "workspace:*",
    "@manamesh/frontend": "workspace:*",
    "boardgame.io": "^0.50.2"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

`packages/timestreams/tsconfig.json` (copy from `packages/onepiece/tsconfig.json` verbatim):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"]
}
```

`packages/timestreams/vitest.config.ts` (copy from `packages/onepiece/vitest.config.ts`):
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
```

`packages/timestreams/src/index.ts`:
```ts
export const PACKAGE_NAME = "@manamesh/timestreams";
```

- [ ] **Step 4: Install workspace + run test**

Run: `yarn install && yarn workspace @manamesh/timestreams test src/smoke.test.ts`
Expected: PASS (1 test). If `yarn install` is unnecessary because PnP already resolves it, the test command alone passing is sufficient.

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/package.json packages/timestreams/tsconfig.json packages/timestreams/vitest.config.ts packages/timestreams/src/index.ts packages/timestreams/src/smoke.test.ts
git commit -m "chore(timestreams): scaffold @manamesh/timestreams package"
```

---

