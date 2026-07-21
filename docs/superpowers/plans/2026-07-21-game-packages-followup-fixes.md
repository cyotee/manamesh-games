# Game Packages Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three remaining gaps found in the crypto/p2p compatibility review: (1) `@cyotee/manamesh` package export surface so game packages can import shared types/helpers without deep `/src/` paths, (2) Mistborn early rules-engine validation + tests so the suite is green, (3) One Piece mental-poker keychain + sk↔pk binding parity with Poker/Timestreams/Mistborn.

**Architecture:** Treat `@cyotee/manamesh` as the platform contract package (no new `@cyotee/core`). Add stable subpath exports that re-export existing modules from the frontend tree, then migrate game packages off `@cyotee/manamesh/src/...`. Mistborn fixes stay inside `packages/mistborn-deckbuilder` (validation semantics + fixtures). One Piece crypto copies the proven Poker/Mistborn keychain admission pattern from `@cyotee/boardgameio-crypto/keychain` without putting private keys on the wire beyond the existing offline encrypt path.

**Tech Stack:** Yarn 4 monorepo / PnP, TypeScript, Vitest, boardgame.io, `@cyotee/boardgameio-crypto` (keychain, mental-poker, secp256k1), nested `@cyotee/manamesh` (`packages/manamesh/packages/frontend`).

## Global Constraints

- Package manager: Yarn 4 (PnP). Do not introduce root `package-lock.json` or `npm install` for workspaces.
- Platform package name: `@cyotee/manamesh` only (nested workspace under `packages/manamesh/packages/frontend`). Do **not** create a separate `@cyotee/core` package (`docs/NPM_PUBLISH_MIGRATION_PLAN.md` §0.1).
- Crypto hard rules: never put private keys in shared `G`; never put private keys in multiplayer move args for production paths; keychain admits **public** keys only under `MENTAL_POKER_KEYCHAIN_POLICY`.
- Prefer smallest package that owns the behavior; do not refactor vendored `boardgame.io` / `boardgameIO-p2p` for these tasks.
- Prefer stable export paths without `/src/` in the public specifier (e.g. `@cyotee/manamesh/game/modules`, not `@cyotee/manamesh/src/game/modules/types`).
- Node `>=20`. Verification commands must use `yarn workspace <name> …`.

---

## File map (what changes where)

| Area | Primary files |
|------|----------------|
| Manamesh export surface | `packages/manamesh/packages/frontend/package.json`, optional thin re-export barrels under `src/` (only if needed), `scripts/build-lib.mjs` if dist must include subpaths |
| Game import migration | `packages/{poker,timestreams,onepiece,mistborn-deckbuilder}/src/**/*.{ts,tsx}` — replace `@cyotee/manamesh/src/...` |
| Mistborn rules | `packages/mistborn-deckbuilder/src/game.ts`, `packages/mistborn-deckbuilder/src/game.test.ts` |
| One Piece crypto parity | `packages/onepiece/src/crypto.ts`, `packages/onepiece/src/crypto.test.ts`, optionally `packages/onepiece/src/types.ts` if `keychain` snapshot field needed |

**Out of scope for this plan:** boardgameIO-p2p channel coverage expansion, frontend SPA UI, real-money features, Timestreams rules engine changes, publishing to npm (export surface is prep only).

---

## Workstream overview

```text
Task 1  @cyotee/manamesh stable subpath exports
   │
   ├─► Task 2  Migrate game packages off /src/ deep imports
   │
Task 3  Mistborn validateMove + game.test green suite
   │
Task 4  One Piece keychain + sk binding (+ adversarial tests)
   │
Task 5  Cross-package verification (all four games + manamesh if applicable)
```

Tasks 1→2 are sequential. Task 3 is independent of 1–2 and can run in parallel after kickoff. Task 4 is independent of 1–3 except it should re-run One Piece tests after Task 2 migrates imports. Task 5 is the final gate.

---

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

### Task 2: Migrate game packages off `@cyotee/manamesh/src/...`

**Files:**
- Modify (all deep-import hits from Task 1 inventory), at least:
  - `packages/onepiece/src/deckResolver.ts`
  - `packages/onepiece/src/deckResolver.test.ts`
  - `packages/onepiece/src/{game,crypto,types,zones}.ts`
  - `packages/poker/src/{game,crypto,types,crypto.test,crypto.adversarial,mentalPoker.harness}.ts`
  - `packages/poker/src/components/PokerBoard.tsx`
  - `packages/timestreams/src/{game,crypto,types,zones,deck,deckResolver}.ts`
  - `packages/mistborn-deckbuilder/src/{game,types,assets}.ts`
  - `packages/mistborn-deckbuilder/src/board/MistbornBoard.tsx`
- Test:  
  `yarn workspace @manamesh/onepiece test`  
  `yarn workspace @manamesh/poker test`  
  `yarn workspace @manamesh/timestreams test`  
  `yarn workspace @manamesh/mistborn-deckbuilder test`

**Interfaces:**
- Consumes: Task 1 export map
- Produces: zero remaining `@cyotee/manamesh/src/` imports under `packages/{poker,timestreams,onepiece,mistborn-deckbuilder}`

- [ ] **Step 1: Write a failing grep gate (document expected before/after)**

```bash
rg -n "from ['\"]@cyotee/manamesh/src/" packages --glob '**/*.{ts,tsx}' | wc -l
```

Expected before migration: count > 0. After Task 2: count `0` for the four game packages (frontend may still use relative imports internally).

- [ ] **Step 2: Apply mechanical renames**

Use these replacement rules (exact strings):

| Old | New |
|-----|-----|
| `@cyotee/manamesh/src/game/modules/types` | `@cyotee/manamesh/game/modules` |
| `@cyotee/manamesh/src/deck/types` | `@cyotee/manamesh/deck` |
| `@cyotee/manamesh/src/assets/manifest/types` | `@cyotee/manamesh/assets/manifest` |
| `@cyotee/manamesh/src/assets/loader/loader` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/assets/loader/local-loader` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/assets/loader/cache` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/assets/loader/types` | `@cyotee/manamesh/assets/loader` |
| `@cyotee/manamesh/src/hooks/useAssetPack` | `@cyotee/manamesh/hooks/useAssetPack` |
| `@cyotee/manamesh/src/hooks/useCardImage` | `@cyotee/manamesh/hooks/useCardImage` |
| `@cyotee/manamesh/src/hooks/useCardSettings` | `@cyotee/manamesh/hooks/useCardSettings` |
| `@cyotee/manamesh/src/components/CryptoTransparencyPanel` | `@cyotee/manamesh/components/CryptoTransparencyPanel` |
| `@cyotee/manamesh/src/components/CardSettingsPanel` | `@cyotee/manamesh/components/CardSettingsPanel` |
| `@cyotee/manamesh/src/blockchain/wallet` | `@cyotee/manamesh/blockchain/wallet` |
| `@cyotee/manamesh/src/assets/packs/standard-cards` | `@cyotee/manamesh/assets/packs/standard-cards` |

Example (One Piece deckResolver):

```ts
// before
import type { EnrichedCard } from "@cyotee/manamesh/src/deck/types";
import { enrichCard } from "@cyotee/manamesh/src/deck/types";
import type { DeckList } from "@cyotee/manamesh/src/deck/types";
import { getLoadedPack, getAllLoadedPacks } from "@cyotee/manamesh/src/assets/loader/loader";

// after
import type { EnrichedCard, DeckList } from "@cyotee/manamesh/deck";
import { enrichCard } from "@cyotee/manamesh/deck";
import { getLoadedPack, getAllLoadedPacks } from "@cyotee/manamesh/assets/loader";
```

- [ ] **Step 3: Run One Piece tests (primary oracle for deckResolver)**

```bash
yarn workspace @manamesh/onepiece test
```

Expected: `deckResolver.test.ts` loads (no `Missing "./src/deck/types" specifier`); crypto suite still passes. Fix any missed export by returning to Task 1.

- [ ] **Step 4: Run the other three game packages**

```bash
yarn workspace @manamesh/poker test
yarn workspace @manamesh/timestreams test
yarn workspace @manamesh/mistborn-deckbuilder test
```

Expected: no resolution errors on manamesh imports. Mistborn may still have rules assertion failures until Task 3.

- [ ] **Step 5: Grep gate must be zero in game packages**

```bash
rg -n "from ['\"]@cyotee/manamesh/src/" \
  packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder \
  --glob '**/*.{ts,tsx}'
```

Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder
git commit -m "refactor(games): use stable @cyotee/manamesh subpath imports"
```

---

### Task 3: Mistborn early rules engine — green tests

**Files:**
- Modify: `packages/mistborn-deckbuilder/src/game.ts` (`validateMove`, possibly `computeCoins`)
- Modify: `packages/mistborn-deckbuilder/src/game.test.ts`
- Keep: incomplete-pack hardening already in `createInitialState` (filter null starters / market fallback)
- Test: `yarn workspace @manamesh/mistborn-deckbuilder test`

**Interfaces:**
- Consumes: `setPackCardsForValidation`, `createInitialState`, `validateMove`, `computeCoins`
- Produces: deterministic validation for buy/play with mock packs; all tests in `game.test.ts` pass

**Root causes (confirmed 2026-07-21):**

1. **Buy cost check false green:** `createInitialState` sets `boxingsAvailable: 14` → `computeCoins` adds `Math.min(2, floor(14/2)) = 2` even with empty play zone. Funding mock with both `tags: ['coin']` and `cardType: 'funding'` can double-count. Tests that leave default boxings can afford a cost-3 card “for free.”
2. **Sideways play false red:** `validateMove` applies the burn-limit gate to **all** `playCard` moves before sideways short-circuit. Burning one metal with `burnLimit === 1` makes **sideways** fail with `Burn limit reached` even though sideways is defined as “card provides its own metal.”

- [ ] **Step 1: Add focused failing tests (make expectations explicit)**

In `game.test.ts`, replace / extend the two weak cases with fixtures that pin the bugs:

```ts
it("validateMove blocks buy when not enough coins", () => {
  const state = createInitialState({
    numPlayers: 2,
    playerIDs: ["p0", "p1"],
    packCards: mockPackCards as any,
  });
  state.zones.play = { p0: [], p1: [] };
  state.boxingsAvailable = 0;
  state.coinsSpent = { p0: 0, p1: 0 };
  state.market = ["market-foo"];
  state.currentPlayer = "p0";

  const res = validateMove(state, "buyCard", "p0", "market-foo");
  expect(res.valid).toBe(false);
  expect(res.error).toMatch(/coin/i);
});

it("buy respects coinsSpent against cost", () => {
  const state = createInitialState({
    numPlayers: 1,
    playerIDs: ["p0"],
    packCards: mockPackCards as any,
  });
  state.boxingsAvailable = 0;
  state.zones.play = { p0: [{ id: "funding-1" }] };
  state.market = ["market-foo"];
  state.coinsSpent = { p0: 0 };
  state.currentPlayer = "p0";

  // funding-1 alone must be < 3 after Task 3 computeCoins semantics
  expect(computeCoins(state, "p0")).toBeLessThan(3);

  let res = validateMove(state, "buyCard", "p0", "market-foo");
  expect(res.valid).toBe(false);

  state.coinsSpent.p0 = 1;
  res = validateMove(state, "buyCard", "p0", "market-foo");
  expect(res.valid).toBe(false);
});

it("playCard sideways allowed when required metal already burned", () => {
  const state = createInitialState({
    numPlayers: 1,
    playerIDs: ["p0"],
    packCards: mockPackCards as any,
  });
  state.currentPlayer = "p0";
  state.zones.hand.p0 = [{ id: "pewter-card" }];
  const pewter = state.players.p0.metals.find((m: any) => m.metal === "pewter");
  pewter.burned = true;
  // burnLimit stays 1; one metal burned

  const resSide = validateMove(state, "playCard", "p0", "pewter-card", true);
  expect(resSide.valid).toBe(true);

  const resNormal = validateMove(state, "playCard", "p0", "pewter-card", false);
  expect(resNormal.valid).toBe(false);
  expect(resNormal.error).toMatch(/metal|burn/i);
});
```

- [ ] **Step 2: Run tests — expect sideways and/or buy still failing before code fix**

```bash
yarn workspace @manamesh/mistborn-deckbuilder test src/game.test.ts
```

Expected: at least one FAIL on sideways and/or buy until Step 3–4 land.

- [ ] **Step 3: Fix `validateMove` burn-limit scope**

In `packages/mistborn-deckbuilder/src/game.ts`, change the early burn-limit gate so sideways `playCard` is not blocked by already-burned metals (sideways uses the card as metal and does not consume an additional burn slot in Phase 1):

```ts
// BEFORE (blocks sideways after any burn when burnLimit is 1)
if (move === "burnMetal" || move === "playCard" || move === "useAsMetal") {
  const currentBurns = (player.metals || []).filter((m: any) => m.burned).length;
  if (currentBurns >= (player.burnLimit || 1)) {
    return { valid: false, error: `Burn limit reached (${player.burnLimit})` };
  }
}

// AFTER
if (move === "burnMetal" || move === "useAsMetal") {
  const currentBurns = (player.metals || []).filter((m: any) => m.burned).length;
  if (currentBurns >= (player.burnLimit || 1)) {
    return { valid: false, error: `Burn limit reached (${player.burnLimit})` };
  }
}

if (move === "playCard") {
  const cardId = args[0];
  const sideways = !!args[1];
  // ... existing meta lookup ...

  if (sideways) {
    // Card provides its own metal; do not require unburned metal and do not
    // treat existing burns as "burn limit reached" for this play style.
    return { valid: true };
  }

  // Vertical play: still respect burn limit if this play would burn a metal.
  // Phase 1: if any metal is already at limit and card requires metal, reject
  // missing metal (existing check) — optional: also reject if burning would
  // exceed limit when implementation starts burning on play.
  // Keep requiredMetal check as today.
}
```

Ensure the **sideways branch still runs after** any turn/player checks, and that vertical `playCard` with missing metal still fails.

- [ ] **Step 4: Fix `computeCoins` double-count + keep boxings explicit in tests**

Prefer test fixtures setting `boxingsAvailable = 0` (Step 1). Additionally fix double-count so a funding card with a `coin` tag does not grant both the coin-tag value and a second funding +1 unless intentional:

```ts
// In computeCoins forEach:
let added = 0;
if (tags.includes("coin") || effect.includes("coin") || /gain\s+\d*\s*coin/.test(effect)) {
  added += meta.coinValue ?? (meta.cost && meta.cost > 0 ? meta.cost : 1);
}
// Funding contributes 1 only if not already counted as a coin card
if ((tags.includes("funding") || cardType === "funding") && added === 0) {
  added += 1;
}
coins += added;
```

Document the rule in a one-line comment above the loop. With this semantics, `funding-1` with only coin tag yields **1** coin when boxings are 0 — insufficient for cost 3.

- [ ] **Step 5: Run full Mistborn package tests**

```bash
yarn workspace @manamesh/mistborn-deckbuilder test
```

Expected:

```text
Test Files  2 passed
Tests       8 passed (or higher if new cases added)
```

Crypto tests must remain green (`src/crypto.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/mistborn-deckbuilder/src/game.ts packages/mistborn-deckbuilder/src/game.test.ts
git commit -m "fix(mistborn): burn-limit/sideways and coin validation for early rules tests"
```

---

### Task 4: One Piece mental-poker keychain + sk↔pk binding

**Files:**
- Modify: `packages/onepiece/src/crypto.ts` (`submitPublicKey`, `encryptDeck`; optionally shuffle if it takes sk)
- Modify: `packages/onepiece/src/crypto.test.ts`
- Modify (if storing snapshot): `packages/onepiece/src/types.ts` — ensure `G.crypto` can hold optional `keychain` like other games
- Reference implementations (read-only patterns):  
  - `packages/poker/src/crypto.ts` (`submitPublicKey`, `encryptDeck`)  
  - `packages/mistborn-deckbuilder/src/crypto.ts`  
  - `packages/timestreams/src/crypto.ts`  
  - `.grok/skills/boardgameio-crypto/SKILL.md`
- Test: `yarn workspace @manamesh/onepiece test src/crypto.test.ts` then full package test

**Interfaces:**
- Consumes from `@cyotee/boardgameio-crypto/keychain`:
  - `keychainFromRecord`, `keychainAdd`, `MENTAL_POKER_KEYCHAIN_POLICY`, `requirePrivateKeyMatchesPublished`, `publicKeysEqual` (optional idempotent same-key)
- Consumes from `@cyotee/boardgameio-crypto/secp256k1`:
  - `validatePlayerIdentity` (bind `ctx.playerID` to `playerId` arg)
- Produces: reject invalid/duplicate keys; reject encrypt with mismatched sk; store **canonical compressed** public keys

- [ ] **Step 1: Add failing adversarial tests first (TDD)**

Append to `packages/onepiece/src/crypto.test.ts`:

```ts
import {
  keychainAdd,
  MENTAL_POKER_KEYCHAIN_POLICY,
  normalizeSecp256k1PublicKey,
} from "@cyotee/boardgameio-crypto/keychain";

describe("OnePiece keychain admission", () => {
  it("rejects invalid public key", () => {
    const G = createCryptoState();
    const res = submitPublicKey(
      G,
      createMockCtx("0", "keyExchange"),
      "0",
      "not-a-point",
    );
    expect(res).toBe(INVALID_MOVE);
    expect(G.players["0"].publicKey).toBeNull();
  });

  it("rejects duplicate public key across seats", () => {
    const G = createCryptoState();
    const { publicKey } = generateKeyPair();
    expect(
      submitPublicKey(G, createMockCtx("0", "keyExchange"), "0", publicKey),
    ).toBe(G);
    const dup = submitPublicKey(
      G,
      createMockCtx("1", "keyExchange"),
      "1",
      publicKey,
    );
    expect(dup).toBe(INVALID_MOVE);
  });

  it("stores canonical compressed public key", () => {
    const G = createCryptoState();
    const { publicKey } = generateKeyPair();
    submitPublicKey(G, createMockCtx("0", "keyExchange"), "0", publicKey);
    const canonical = normalizeSecp256k1PublicKey(publicKey);
    expect(G.players["0"].publicKey).toBe(canonical);
    expect(G.crypto.publicKeys["0"]).toBe(canonical);
  });

  it("encryptDeck rejects sk that does not match published pk", () => {
    const G = createCryptoState();
    const k0 = generateKeyPair();
    const k1 = generateKeyPair();
    const bad = generateKeyPair();
    submitPublicKey(G, createMockCtx("0", "keyExchange"), "0", k0.publicKey);
    submitPublicKey(G, createMockCtx("1", "keyExchange"), "1", k1.publicKey);
    G.deckCardIds["0"] = ["c0"];
    G.deckCardIds["1"] = ["c1"];
    G.lifeDeckIds["0"] = ["l0"];
    G.lifeDeckIds["1"] = ["l1"];

    expect(
      encryptDeck(G, createMockCtx("0", "encrypt"), "0", k0.privateKey),
    ).toBe(G);
    const rejected = encryptDeck(
      G,
      createMockCtx("1", "encrypt"),
      "1",
      bad.privateKey,
    );
    expect(rejected).toBe(INVALID_MOVE);
    expect(G.players["1"].hasEncrypted).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run tests — expect new cases to fail**

```bash
yarn workspace @manamesh/onepiece test src/crypto.test.ts
```

Expected: new keychain cases FAIL (invalid key currently accepted; wrong sk currently accepted).

- [ ] **Step 3: Wire keychain into `submitPublicKey`**

In `packages/onepiece/src/crypto.ts`, add imports:

```ts
import {
  keychainFromRecord,
  keychainAdd,
  MENTAL_POKER_KEYCHAIN_POLICY,
  requirePrivateKeyMatchesPublished,
  publicKeysEqual,
} from "@cyotee/boardgameio-crypto/keychain";
import { validatePlayerIdentity } from "@cyotee/boardgameio-crypto/secp256k1";
```

Replace the body of `submitPublicKey` (keep phase / player existence checks) with Poker-style admission:

```ts
if (!validatePlayerIdentity(ctx.playerID, playerId)) {
  return INVALID_MOVE;
}
const player = G.players[playerId];
if (!player) return INVALID_MOVE;
if (player.publicKey) {
  if (publicKeysEqual(player.publicKey, publicKey)) return G; // idempotent same key
  return INVALID_MOVE;
}

const prior = keychainFromRecord(
  G.crypto.publicKeys ?? {},
  MENTAL_POKER_KEYCHAIN_POLICY,
);
const admitted = keychainAdd(
  prior,
  playerId,
  publicKey,
  MENTAL_POKER_KEYCHAIN_POLICY,
);
if (!admitted.ok) return INVALID_MOVE;

const canonical = admitted.entry.publicKey;
player.publicKey = canonical;
G.crypto.publicKeys[playerId] = canonical;
(G.crypto as any).keychain = admitted.keychain;

// existing allSubmitted → encrypt transition
```

**Important:** Existing tests compare `G.players["0"].publicKey` to the raw `pub0` from `generateKeyPair()`. After canonicalization, update those expectations to `normalizeSecp256k1PublicKey(pub0)` (or compare via `publicKeysEqual`).

- [ ] **Step 4: Bind sk in `encryptDeck`**

After turn-order / `hasEncrypted` checks, before encryption:

```ts
if (!validatePlayerIdentity(ctx.playerID, playerId)) {
  return INVALID_MOVE;
}
const published =
  player.publicKey ?? G.crypto.publicKeys[playerId] ?? null;
if (!requirePrivateKeyMatchesPublished(privateKey, published)) {
  return INVALID_MOVE;
}
```

Do **not** store `privateKey` on `G` or on player state.

- [ ] **Step 5: Update existing crypto tests for canonical keys**

In the happy-path key exchange test:

```ts
import { normalizeSecp256k1PublicKey } from "@cyotee/boardgameio-crypto/keychain";
// ...
expect(G.players["0"].publicKey).toBe(normalizeSecp256k1PublicKey(pub0));
```

Keep encrypt/shuffle happy paths using matching key pairs.

- [ ] **Step 6: Run One Piece full suite**

```bash
yarn workspace @manamesh/onepiece test
```

Expected: crypto + game + deckResolver (after Task 2) all pass. If board/UI still submits sk via moves, document as known offline/test path (same as Poker today); do not expand to full `prepareEncryptionLayer` client refactor in this task unless encrypt already has a preEncrypted overload — YAGNI.

- [ ] **Step 7: Commit**

```bash
git add packages/onepiece/src/crypto.ts packages/onepiece/src/crypto.test.ts packages/onepiece/src/types.ts
git commit -m "feat(onepiece): keychain admission and encrypt sk binding"
```

---

### Task 5: Cross-package verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run dependency and game suites**

```bash
yarn workspace @cyotee/boardgameio-crypto test
yarn workspace @manamesh/poker test
yarn workspace @manamesh/timestreams test
yarn workspace @manamesh/onepiece test
yarn workspace @manamesh/mistborn-deckbuilder test
```

Expected all exit 0.

- [ ] **Step 2: Regression greps**

```bash
# No deep src imports in game packages
rg -n "from ['\"]@cyotee/manamesh/src/" \
  packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder \
  --glob '**/*.{ts,tsx}'

# One Piece uses keychain APIs
rg -n "keychainAdd|requirePrivateKeyMatchesPublished|MENTAL_POKER_KEYCHAIN_POLICY" \
  packages/onepiece/src/crypto.ts
```

Expected: first command empty; second command ≥ 1 hit each pattern.

- [ ] **Step 3: Optional frontend smoke (only if export changes break SPA)**

```bash
yarn workspace @cyotee/manamesh test:run
# or a single targeted vitest if full suite is heavy
```

If SPA build is required for publish readiness:

```bash
yarn workspace @cyotee/manamesh build
```

Only run build if Task 1 touched dist generation; skip if source-only exports.

- [ ] **Step 4: Final commit only if verification fixed stragglers; else stop**

No empty commits. If greps/tests fail, fix in the owning task and re-run this gate.

---

## Testing matrix (definition of done)

| Check | Command | Pass criteria |
|-------|---------|---------------|
| Crypto leaf | `yarn workspace @cyotee/boardgameio-crypto test` | all pass |
| Poker | `yarn workspace @manamesh/poker test` | all pass |
| Timestreams | `yarn workspace @manamesh/timestreams test` | all pass |
| One Piece | `yarn workspace @manamesh/onepiece test` | all pass, including deckResolver + keychain cases |
| Mistborn | `yarn workspace @manamesh/mistborn-deckbuilder test` | all pass (crypto + rules) |
| Import hygiene | grep `@cyotee/manamesh/src/` in four games | zero hits |
| Keychain parity | grep keychain APIs in onepiece crypto | present |

---

## Risk notes

| Risk | Mitigation |
|------|------------|
| Subpath exports work in monorepo but not in published `dist` | Task 1 can stay source-mapped for monorepo; follow-up publish task can dual-map `import`→dist and `types`→.d.ts without changing public specifier names |
| PokerBoard deep imports pull React/UI into typecheck of pure packages | Prefer type-only imports where possible; do not move board files into crypto packages |
| Canonical pubkey breaks equality checks in One Piece UI | Prefer `publicKeysEqual` / normalize at boundaries; update tests in Task 4 Step 5 |
| Mistborn coin semantics change gameplay balance | Keep Phase 1 simple; document funding-vs-coin rule in comment; tests pin behavior |

---

## Self-review (plan quality)

1. **Spec coverage:** Export surface + migration + Mistborn rules failures + One Piece keychain lag + final verification — each has a task.
2. **Placeholders:** None intentional; export paths must be confirmed against real files in Task 1 Step 2 (adjust map if filenames differ).
3. **Type consistency:** Keychain APIs use the same names as Poker/Mistborn (`keychainAdd`, `MENTAL_POKER_KEYCHAIN_POLICY`, `requirePrivateKeyMatchesPublished`). Manamesh subpaths use stable names without `/src/`.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-21-game-packages-followup-fixes.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration (`superpowers:subagent-driven-development`)
2. **Inline Execution** — execute tasks in this session with checkpoints (`superpowers:executing-plans`)

**Suggested order if parallelizing humans/agents:** Task 3 (Mistborn) can run in parallel with Task 1; Task 2 waits on Task 1; Task 4 can start after Task 2’s One Piece import migration (or in parallel if imports already resolve); Task 5 last.
