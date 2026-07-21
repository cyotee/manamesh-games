# Task 1 Report: `@cyotee/manamesh` stable subpath exports

**Status:** DONE  
**Date:** 2026-07-21  
**Branch:** main  
**Workspace:** `/Users/cyotee/Development/github-cyotee/manamesh-games`

---

## Summary

Expanded `@cyotee/manamesh` (`packages/manamesh/packages/frontend`) package `exports` from root-only to the full set of stable subpaths required by game packages (poker, timestreams, onepiece, mistborn). Added a small loader barrel so a single `@cyotee/manamesh/assets/loader` specifier covers the multi-file deep imports used by One Piece (and types needed by Poker).

No import migration was done (that is Task 2). No `@cyotee/core` package was created.

---

## Step results

### Step 1 — Confirm current exports (before)

```json
{
  ".": {
    "types": "./dist/public-api.d.ts",
    "default": "./dist/public-api.js"
  },
  "./package.json": "./package.json"
}
```

Only `"."` and `"./package.json"`. No subpath keys existed.

### Step 2 — Expand `exports`

Updated `packages/manamesh/packages/frontend/package.json` with source-first dual conditions (`types` + `default` → same `.ts`/`.tsx` paths) for monorepo / Vite consumption.

| Specifier | Resolved path |
|-----------|----------------|
| `@cyotee/manamesh/game/modules` | `./src/game/modules/types.ts` |
| `@cyotee/manamesh/deck` | `./src/deck/types.ts` |
| `@cyotee/manamesh/assets/manifest` | `./src/assets/manifest/types.ts` |
| `@cyotee/manamesh/assets/loader` | `./src/assets/loader/public.ts` |
| `@cyotee/manamesh/hooks/useAssetPack` | `./src/hooks/useAssetPack.ts` |
| `@cyotee/manamesh/hooks/useCardImage` | `./src/hooks/useCardImage.ts` |
| `@cyotee/manamesh/hooks/useCardSettings` | `./src/hooks/useCardSettings.ts` |
| `@cyotee/manamesh/components/CryptoTransparencyPanel` | `./src/components/CryptoTransparencyPanel.tsx` |
| `@cyotee/manamesh/components/CardSettingsPanel` | `./src/components/CardSettingsPanel.tsx` |
| `@cyotee/manamesh/blockchain/wallet` | `./src/blockchain/wallet/index.ts` |
| `@cyotee/manamesh/assets/packs/standard-cards` | `./src/assets/packs/standard-cards.ts` |

**Path correction vs brief example:** Brief suggested `./src/blockchain/wallet.ts`. That file does not exist. Real module is the directory barrel `src/blockchain/wallet/index.ts` (exports `useGameKeys` via context re-exports). Map points at `index.ts`.

**Unchanged:** Root `"."` still points at `dist/public-api.{js,d.ts}`. `build-lib.mjs` was not modified (source subpaths do not require dist emission for monorepo use).

### Step 3 — Loader barrel

Created:

`packages/manamesh/packages/frontend/src/assets/loader/public.ts`

```ts
export { getLoadedPack, getAllLoadedPacks } from "./loader";
export { reloadLocalPack, getAllLocalPacks } from "./local-loader";
export { getAllPackMetadata } from "./cache";
export type { LoadedAssetPack, IPFSZipSource } from "./types";
```

Matches brief re-exports. **Extra vs brief:** also exports `IPFSZipSource` because poker board deep-imports it from `assets/loader/types` (inventory). Keeps Task 2 migration able to use one loader subpath.

Optional barrels (`game/modules/public.ts`, `deck/public.ts`, etc.) were **not** created — leaf `types.ts` files are sufficient.

### Step 4 — Smoke resolution

From monorepo root, Yarn-aware node check:

- All 11 new export keys present on `package.json.exports`
- Each `default` path exists on disk under `packages/manamesh/packages/frontend/`
- Printed `deck export ok { types: './src/deck/types.ts', default: './src/deck/types.ts' }`

Full `yarn workspace @cyotee/manamesh test:run` was **not** run (SPA/test suite is heavier than needed for export-map-only change; brief allows package.json smoke as minimum).

### Step 5 — Commits

Because platform code lives in the `packages/manamesh` git submodule:

| Repo | SHA | Subject |
|------|-----|---------|
| `packages/manamesh` (submodule) | `2411d5c` | feat(manamesh): add stable subpath exports for game packages |
| monorepo root | `9e6a143` | feat(manamesh): bump submodule for stable subpath exports |

**Submodule files changed:**

- `packages/frontend/package.json` (exports map)
- `packages/frontend/src/assets/loader/public.ts` (new)

No other task files staged. Unrelated dirty worktree files left untouched.

---

## Inventory coverage (grep baseline)

Deep imports under `@cyotee/manamesh/src/...` observed in game packages all map to a new public subpath:

| Deep path pattern | Public subpath |
|-------------------|----------------|
| `…/src/game/modules/types` | `/game/modules` |
| `…/src/deck/types` | `/deck` |
| `…/src/assets/manifest/types` | `/assets/manifest` |
| `…/src/assets/loader/{loader,local-loader,cache,types}` | `/assets/loader` |
| `…/src/hooks/useAssetPack` | `/hooks/useAssetPack` |
| `…/src/hooks/useCardImage` | `/hooks/useCardImage` |
| `…/src/hooks/useCardSettings` | `/hooks/useCardSettings` |
| `…/src/components/CryptoTransparencyPanel` | `/components/CryptoTransparencyPanel` |
| `…/src/components/CardSettingsPanel` | `/components/CardSettingsPanel` |
| `…/src/blockchain/wallet` | `/blockchain/wallet` |
| `…/src/assets/packs/standard-cards` | `/assets/packs/standard-cards` |

Consumers still use deep `/src/` paths until Task 2 migrates them.

---

## Self-review

### Correctness

- Every export target file exists and was verified by smoke script.
- Wallet path corrected to real module; no invented files.
- Loader barrel symbols match what onepiece `deckResolver` imports today.

### Scope discipline

- Only export map + one barrel file.
- No game package import rewrites.
- No `@cyotee/core`.
- No `build-lib.mjs` change (not required for source-first monorepo resolution).

### Risks / follow-ups (non-blocking)

1. **`files` field** still lists only `dist`, `bin`, `README.md`, `LICENSE`. Published npm tarball would **not** ship `src/` subpaths. Acceptable per brief (“source-first … while SPA remains the primary consumer”). A later publish story should either emit `dist` subpaths or expand `files` / dual conditions.
2. **Deep `/src/` paths remain valid only by Yarn/workspace filesystem luck**, not by package exports. Task 2 should migrate imports to stable subpaths.
3. **Loader barrel is minimal** — only symbols used by current game packages. Broader loader API remains via old deep paths or `assets/loader/index.ts` if ever exported separately.
4. **Submodule push:** outer monorepo commit references submodule SHA `2411d5c`. That commit is local to `packages/manamesh` until pushed to the manamesh remote; CI/clones need the submodule tip available.

### What was not done (by design)

- Task 2 import migration across poker/timestreams/onepiece/mistborn
- `test:run` full Vitest suite
- Dual dist conditions for published builds
- Optional type barrels for game/modules, deck, manifest

---

## Verification commands (repro)

```bash
# Export presence + on-disk targets
yarn node -e "
import fs from 'fs';
const pkg = JSON.parse(fs.readFileSync('packages/manamesh/packages/frontend/package.json','utf8'));
const deck = pkg.exports['./deck'];
if (!deck) throw new Error('missing ./deck export');
console.log('deck export ok', deck);
"

# Inventory (still deep until Task 2)
rg -n \"from ['\\\"]@cyotee/manamesh/\" packages --glob '**/*.{ts,tsx}' | rg -v 'node_modules|dist'
```

---

## Files touched

| Path | Action |
|------|--------|
| `packages/manamesh/packages/frontend/package.json` | Modified (`exports`) |
| `packages/manamesh/packages/frontend/src/assets/loader/public.ts` | Created |
| `packages/manamesh` submodule pointer (monorepo) | Bumped to `2411d5c` |
