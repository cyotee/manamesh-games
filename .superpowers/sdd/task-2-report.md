# Task 2 Report: Migrate game packages off `@cyotee/manamesh/src/` deep imports

**Status:** DONE_WITH_CONCERNS  
**Commit:** `7c4a6ec` — `refactor(games): use stable @cyotee/manamesh subpath imports`  
**Date:** 2026-07-21

---

## Summary

Migrated all `@cyotee/manamesh/src/...` deep imports in the four game packages onto the Task 1 stable subpath export map. Grep gate is **zero** matches under:

- `packages/poker`
- `packages/timestreams`
- `packages/onepiece`
- `packages/mistborn-deckbuilder`

---

## Step results

### Step 1 — Failing grep gate (before)

Before migration, `rg` found **~41** deep imports across the four packages.

### Step 2 — Mechanical renames

Applied the brief’s exact old→new table:

| Old | New |
|-----|-----|
| `@cyotee/manamesh/src/game/modules/types` | `@cyotee/manamesh/game/modules` |
| `@cyotee/manamesh/src/deck/types` | `@cyotee/manamesh/deck` |
| `@cyotee/manamesh/src/assets/manifest/types` | `@cyotee/manamesh/assets/manifest` |
| `@cyotee/manamesh/src/assets/loader/{loader,local-loader,cache,types}` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/hooks/useAssetPack` | `@cyotee/manamesh/hooks/useAssetPack` |
| `@cyotee/manamesh/src/hooks/useCardImage` | `@cyotee/manamesh/hooks/useCardImage` |
| `@cyotee/manamesh/src/hooks/useCardSettings` | `@cyotee/manamesh/hooks/useCardSettings` |
| `@cyotee/manamesh/src/components/CryptoTransparencyPanel` | `@cyotee/manamesh/components/CryptoTransparencyPanel` |
| `@cyotee/manamesh/src/components/CardSettingsPanel` | `@cyotee/manamesh/components/CardSettingsPanel` |
| `@cyotee/manamesh/src/blockchain/wallet` | `@cyotee/manamesh/blockchain/wallet` |
| `@cyotee/manamesh/src/assets/packs/standard-cards` | `@cyotee/manamesh/assets/packs/standard-cards` |

**Extra correction (beyond pure path rename):** Timestreams had historically imported `CardManifestEntry` / `LoadedAssetPack` from `game/modules/types`, but those symbols live under:

- `CardManifestEntry` → `@cyotee/manamesh/assets/manifest`
- `LoadedAssetPack` → `@cyotee/manamesh/assets/loader`

Updated:

- `packages/timestreams/src/deck.ts`
- `packages/timestreams/src/deckResolver.ts`

**Loader consolidation:** One Piece `deckResolver.ts` now imports all loader APIs from a single `@cyotee/manamesh/assets/loader` barrel (and deck types consolidated onto `@cyotee/manamesh/deck`).

**Test mock update (required for resolution to work in tests):**  
`packages/onepiece/src/deckResolver.test.ts` previously mocked relative non-package paths (`../../../assets/loader/*`). After subpath migration those mocks no longer intercept real loader code (tests hit IndexedDB). Mocks were rewritten to:

```ts
vi.mock('@cyotee/manamesh/assets/loader', () => ({ ... }));
```

### Step 3 — One Piece tests (primary oracle)

```
yarn workspace @manamesh/onepiece test
```

**Result:** 8 files / **234 passed** (including `deckResolver.test.ts` 26/26). No `Missing "./src/..."` specifier errors.

### Step 4 — Other packages

| Package | Result |
|---------|--------|
| `@manamesh/onepiece` | **234/234 pass** (full suite) |
| `@manamesh/poker` | Targeted (crypto, adversarial, game, hands, betting): **113/113 pass**. Full suite timed out at 5m while still green mid-run (mental-poker adversarial continuing). No import resolution failures observed. |
| `@manamesh/timestreams` | Targeted (lifecycle, crypto, deck, types, deckResolver.pack): **all pass**. Full suite timed out mid-run after many greens; no import resolution failures. |
| `@manamesh/mistborn-deckbuilder` | **6 pass / 2 fail** — rules assertion failures only (`buyCard` / sideways `playCard`). **No manamesh import resolution errors.** Expected residual for Task 3. |

### Step 5 — Grep gate (after)

```bash
rg -n "from ['\"]@cyotee/manamesh/src/" \
  packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder \
  --glob '**/*.{ts,tsx}'
```

**Result:** zero matches.

### Step 6 — Commit

```
7c4a6ec refactor(games): use stable @cyotee/manamesh subpath imports
```

**23 files** staged (import migration only). Explicitly **not** committed:

- `packages/*/node_modules/.vite/vitest/results.json`
- `packages/onepiece/src/crypto.test.ts` (prior-session WIP: `./boardgameio-crypto` → `./crypto`)
- `packages/poker/src/mentalPoker.gaps.adversarial.test.ts` (prior-session keychain WIP)
- Mistborn `createInitialState` pack-hardening WIP remains **unstaged** on `packages/mistborn-deckbuilder/src/game.ts` (index has import-only change; working tree still has WIP)

---

## Files changed (committed)

### poker
- `src/game.ts`, `src/crypto.ts`, `src/types.ts`, `src/crypto.test.ts`, `src/crypto.adversarial.test.ts`, `src/mentalPoker.harness.ts`, `src/components/PokerBoard.tsx`

### timestreams
- `src/game.ts`, `src/crypto.ts`, `src/types.ts`, `src/zones.ts`, `src/deck.ts`, `src/deckResolver.ts`

### onepiece
- `src/game.ts`, `src/crypto.ts`, `src/types.ts`, `src/zones.ts`, `src/deckResolver.ts`, `src/deckResolver.test.ts`

### mistborn-deckbuilder
- `src/game.ts` (import lines only in commit), `src/types.ts`, `src/assets.ts`, `src/board/MistbornBoard.tsx`

---

## Concerns

1. **Mistborn rules failures** remain (Task 3): 2 tests in `game.test.ts` fail on coin/metal rules assertions; not import-related.
2. **Full poker / timestreams suites** were not completed end-to-end (tool timeout ~5m). Import-sensitive subsets and mid-run full-suite progress showed no resolution errors. Recommend a full local run if CI does not cover them.
3. **Pre-existing WIP left uncommitted** as instructed: onepiece `crypto.test.ts`, poker `mentalPoker.gaps.adversarial.test.ts`, mistborn `createInitialState` hardening (working tree only).
4. **Timestreams symbol re-homing:** `CardManifestEntry` / `LoadedAssetPack` were never actually exported from `game/modules/types`; mapping them to manifest/loader subpaths is correct for Task 1 exports but is a slight deviation from pure string replace of that one table row.

---

## Acceptance checklist

- [x] Zero `@cyotee/manamesh/src/` imports in four game packages
- [x] Loader consumers use `@cyotee/manamesh/assets/loader`
- [x] One Piece full suite green (primary deckResolver oracle)
- [x] No manamesh resolution errors in poker / timestreams / mistborn exercised tests
- [x] Migration-only commit; WIP/results.json excluded
