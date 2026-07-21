### Task 1: `@cyotee/manamesh` stable subpath exports

**Files:**
- Modify: `packages/manamesh/packages/frontend/package.json`
- Modify (only if build must emit subpath dist files): `packages/manamesh/packages/frontend/scripts/build-lib.mjs`
- Optional create (only if a clean barrel is cleaner than pointing exports at leaf files):  
  - `packages/manamesh/packages/frontend/src/game/modules/public.ts`  
  - `packages/manamesh/packages/frontend/src/deck/public.ts`  
  - `packages/manamesh/packages/frontend/src/assets/manifest/public.ts`  
  - `packages/manamesh/packages/frontend/src/assets/loader/public.ts`
- Test: resolution check via workspace game import (Task 2) +  
  `yarn workspace @cyotee/manamesh test:run` if lightweight; at minimum a Node/Yarn resolution smoke (below)

**Interfaces:**
- Consumes: existing modules already imported by games (see inventory below)
- Produces: package.json `exports` entries so these specifiers resolve under Yarn PnP:

| New public specifier | Maps to (source; monorepo / Vite) |
|----------------------|-----------------------------------|
| `@cyotee/manamesh/game/modules` | `./src/game/modules/types.ts` (or barrel re-exporting types) |
| `@cyotee/manamesh/deck` | `./src/deck/types.ts` (exports `DeckList`, `EnrichedCard`, `enrichCard`, …) |
| `@cyotee/manamesh/assets/manifest` | `./src/assets/manifest/types.ts` |
| `@cyotee/manamesh/assets/loader` | barrel of `loader.ts`, `local-loader.ts`, `cache.ts`, `types.ts` |
| `@cyotee/manamesh/hooks/useAssetPack` | `./src/hooks/useAssetPack.ts` (or `./hooks` barrel) |
| `@cyotee/manamesh/hooks/useCardImage` | `./src/hooks/useCardImage.ts` |
| `@cyotee/manamesh/hooks/useCardSettings` | `./src/hooks/useCardSettings.ts` |
| `@cyotee/manamesh/components/CryptoTransparencyPanel` | existing component path |
| `@cyotee/manamesh/components/CardSettingsPanel` | existing component path |
| `@cyotee/manamesh/blockchain/wallet` | path exporting `useGameKeys` |
| `@cyotee/manamesh/assets/packs/standard-cards` | path exporting `CARD_BACK_ID` |

**Inventory of deep imports to cover** (grep baseline — keep this list complete when implementing):

```bash
# From monorepo root
rg -n "from ['\"]@cyotee/manamesh/" packages --glob '**/*.{ts,tsx}' | rg -v 'node_modules|dist'
```

As of 2026-07-21 review, consumers use at least:

- `…/src/game/modules/types` — poker, timestreams, onepiece, mistborn
- `…/src/deck/types` — onepiece deckResolver (+ tests)
- `…/src/assets/manifest/types` — mistborn
- `…/src/assets/loader/{loader,local-loader,cache,types}` — onepiece
- `…/src/hooks/{useAssetPack,useCardImage,useCardSettings}` — poker, mistborn boards
- `…/src/components/{CryptoTransparencyPanel,CardSettingsPanel}` — poker board
- `…/src/blockchain/wallet` — poker board
- `…/src/assets/packs/standard-cards` — poker board

- [ ] **Step 1: Confirm current package exports are root-only**

```bash
node -e "const p=require('./packages/manamesh/packages/frontend/package.json'); console.log(JSON.stringify(p.exports,null,2))"
```

Expected: only `"."` and `"./package.json"` (or equivalent). Document any extra keys already present.

- [ ] **Step 2: Expand `exports` in `@cyotee/manamesh` package.json**

Prefer dual conditions so workspace TypeScript/Vite can hit source while publish can hit `dist` later. Minimum monorepo-working shape (source-first is acceptable while SPA remains the primary consumer):

```json
"exports": {
  ".": {
    "types": "./dist/public-api.d.ts",
    "default": "./dist/public-api.js"
  },
  "./package.json": "./package.json",
  "./game/modules": {
    "types": "./src/game/modules/types.ts",
    "default": "./src/game/modules/types.ts"
  },
  "./deck": {
    "types": "./src/deck/types.ts",
    "default": "./src/deck/types.ts"
  },
  "./assets/manifest": {
    "types": "./src/assets/manifest/types.ts",
    "default": "./src/assets/manifest/types.ts"
  },
  "./assets/loader": {
    "types": "./src/assets/loader/public.ts",
    "default": "./src/assets/loader/public.ts"
  },
  "./hooks/useAssetPack": {
    "types": "./src/hooks/useAssetPack.ts",
    "default": "./src/hooks/useAssetPack.ts"
  },
  "./hooks/useCardImage": {
    "types": "./src/hooks/useCardImage.ts",
    "default": "./src/hooks/useCardImage.ts"
  },
  "./hooks/useCardSettings": {
    "types": "./src/hooks/useCardSettings.ts",
    "default": "./src/hooks/useCardSettings.ts"
  },
  "./components/CryptoTransparencyPanel": {
    "types": "./src/components/CryptoTransparencyPanel.tsx",
    "default": "./src/components/CryptoTransparencyPanel.tsx"
  },
  "./components/CardSettingsPanel": {
    "types": "./src/components/CardSettingsPanel.tsx",
    "default": "./src/components/CardSettingsPanel.tsx"
  },
  "./blockchain/wallet": {
    "types": "./src/blockchain/wallet.ts",
    "default": "./src/blockchain/wallet.ts"
  },
  "./assets/packs/standard-cards": {
    "types": "./src/assets/packs/standard-cards.ts",
    "default": "./src/assets/packs/standard-cards.ts"
  }
}
```

If a leaf path differs on disk, fix the map to the real file (do not invent modules).

- [ ] **Step 3: Add loader barrel if needed**

Create `packages/manamesh/packages/frontend/src/assets/loader/public.ts` only if a single subpath is cleaner than four exports:

```ts
export { getLoadedPack, getAllLoadedPacks } from "./loader";
export { reloadLocalPack, getAllLocalPacks } from "./local-loader";
export { getAllPackMetadata } from "./cache";
export type { LoadedAssetPack } from "./types";
```

- [ ] **Step 4: Smoke-resolve a previously broken import**

From monorepo root (Yarn PnP-aware):

```bash
yarn node -e "
import { createRequire } from 'module';
const r = createRequire(import.meta.url);
// For TS-only paths, prefer resolving package exports via package.json:
import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync('packages/manamesh/packages/frontend/package.json','utf8'));
const deck = pkg.exports['./deck'];
if (!deck) throw new Error('missing ./deck export');
console.log('deck export ok', deck);
"
```

Expected: prints `deck export ok` with the mapped path. If Yarn blocks, alternatively start Task 2 and use One Piece test failure/success as the oracle.

- [ ] **Step 5: Commit**

```bash
git add packages/manamesh/packages/frontend/package.json \
  packages/manamesh/packages/frontend/src/assets/loader/public.ts 2>/dev/null
git commit -m "feat(manamesh): add stable subpath exports for game packages"
```

---

