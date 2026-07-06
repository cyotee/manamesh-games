# Timestreams Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a P2P, cryptographically-fair, 2–4 player Timestreams game module (`@manamesh/timestreams`) that enforces game *structure* (turn order, six days/eras, draw counts, slot placement) without card effects, ending in placeholder count-scoring, plus a board UI and a frontend lobby with selectable/random home-era assignment.

**2026-06-26 Priority:** Complete the **entire** M1 (Tasks 0–15) before pivoting. See "Recorded Decisions" section.

**Architecture:** A boardgame.io `GameModule` mirroring `@manamesh/onepiece`: a rules-structured state manager whose deck operations are made tamper-proof by the shared mental-poker crypto package. Pure game logic (timeline, scoring, deck factory) lives in small focused modules; the crypto setup flow is adapted from `onepiece/src/crypto.ts`; the React board mirrors `poker/src/components/PokerBoard.tsx`; the lobby mirrors the poker matchmaking module.

**Tech Stack:** TypeScript (ES2022, Bundler resolution), boardgame.io ^0.50.2, `@manamesh/boardgameio-crypto` (SRA mental poker, commit-reveal, shuffle proofs), `@manamesh/frontend` (GameModule types, hooks, lobby), React (JSX), Vitest.

## Global Constraints

- Package name: `@manamesh/timestreams`, `"private": true`, `"type": "module"`, ESM, `main`/`types` → `./src/index.ts`.
- Dependencies: `@manamesh/boardgameio-crypto` (`workspace:*`), `@manamesh/frontend` (`workspace:*`), `boardgame.io` (`^0.50.2`); dev: `typescript ^5`, `vitest`.
- Players: **2–4** only. Draw table: `{ 2: 6, 3: 5, 4: 4 }`. 5–6 player support is out of scope.
- Era order is fixed: `["stone", "medieval", "renaissance", "industrial", "modern", "future"]`. Six days; day _N_ (1-indexed) activates era index _N-1_.
- Default `scoringSlots = 6`, default `deckSize = 36`.
- Cards start with scanned real data (via asset pack after OCR). M1 still has no executable card effects (structure only). Placeholder generation kept only as fallback for unscanned eras. See PRD "Asset Pack & Real Card Data" section for the scan → OCR → pack build tasks.
- Crypto model: full mental-poker reuse (multi-party commit-reveal shuffle so even the owner cannot pre-know deck order; cooperative decryption on draw). Abandonment = minimal `voided` phase + `voteAbortReveal` stub only.
- Home-era assignment: lobby-selected mode `"selectable" | "random"`; turn order derives from home-era chronology. Random assignment runs in the in-game `setup` phase via commit-reveal.
- Test runner: Vitest with `globals: true`, `environment: 'node'`, include `src/**/*.test.ts(x)`. Run a single test file with `yarn workspace @manamesh/timestreams test src/<file>.test.ts`.
- Commit after every task with a `feat:`/`test:`/`chore:` message ending with the repo's `Co-Authored-By` trailer.
- Reference files (read, do not edit): `packages/onepiece/src/{game,crypto,types,zones,visibility,proofChain}.ts`, `packages/poker/src/components/PokerBoard.tsx`, `packages/manamesh/packages/frontend/src/p2p/discovery/matchmaking/poker/poker-lobby.ts`, `packages/manamesh/packages/frontend/src/pages/poker/PokerLobby.tsx`. Spec: `packages/timestreams/PRD.md`.

## Recorded Decisions (2026-06-26)

These were captured when resuming after the prior agent hit its usage limit. They are authoritative for the rest of M1. See the corresponding section in `PRD.md` for full context.

- **Scope & priority:** Complete **full** Timestreams M1 through Task 15 (lobby, board, wiring, docs).
- **Workflow:** Hybrid SDD — strict (briefs + reports + ledger + path-limited commits) for major tasks (Task 11+); lighter for smaller ones.
- **boardgame.io / test constraints:**
  - Local `const INVALID_MOVE = "INVALID_MOVE" as const;`
  - `import type { Game, Ctx } from "boardgame.io";` only (no runtime `boardgame.io/core` values where possible).
  - **Never** import `Client` (or other runtime) from `"boardgame.io/client"` in `*.test.ts` files. Test `TimestreamsGame` structure + direct calls instead.
- `loadDecks` is part of Task 11 `setup` phase (no separate task).
- `voided` phase + `voteAbortReveal` stub **must** be implemented in Task 11.
- **Additional agreed work:** Fix the `sha256Hex` seed commit-binding bug in `packages/poker` **and** `packages/onepiece` (high value for poker on-chain settlement). This is follow-up work surfaced by Timestreams Task 7.
- Commit discipline for timestreams paths remains in effect due to the pre-existing crypto rename staging.

These decisions update the plan in place. Task 11 description and Self-Review below have been aligned.

---

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

### Task 1: Core types & era constants

**Files:**
- Create: `packages/timestreams/src/types.ts`
- Test: `packages/timestreams/src/types.test.ts`

**Interfaces:**
- Consumes: `CoreCard` from `@manamesh/frontend/src/game/modules/types`; `EncryptedCard` from `@manamesh/boardgameio-crypto/mental-poker`.
- Produces:
  - `ERA_ORDER: readonly ["stone","medieval","renaissance","industrial","modern","future"]`
  - `type EraId = (typeof ERA_ORDER)[number]`
  - `interface TimestreamsCard extends CoreCard { ownerId: string; cardType: "invention" | "action"; trait?: "art" | "government"; scoreEffect: string; }`
  - `interface EraState { id: EraId; stack: string[]; }`
  - `interface TimestreamsPlayerState { homeEra: EraId | null; ready: boolean; hand: TimestreamsCard[]; discard: TimestreamsCard[]; scorePile: TimestreamsCard[]; hasPassedThisDay: boolean; publicKey: string | null; hasEncrypted: boolean; hasShuffled: boolean; }`
  - `type TimestreamsPhase = "setup" | "keyExchange" | "encrypt" | "shuffle" | "play" | "scoring" | "gameOver" | "voided"`
  - `interface TimestreamsConfig { scoringSlots: number; deckSize: number; drawTable: Record<number, number>; homeEraAssignment: "selectable" | "random"; deckEncryption: "mental-poker"; proofChainEnabled: boolean; }`
  - `interface ShuffleRngState { phase: "commit" | "reveal" | "ready"; commits: Record<string,string|null>; reveals: Record<string,string|null>; finalSeedHex: string|null; abortVotes: Record<string,boolean>; }`
  - `interface DecryptRequest { id: string; playerId: string; deckOwnerId: string; cardIndex: number; requestedBy: string; requiredLayers: string[]; currentLayer: number; status: "pending" | "partial" | "complete"; }`
  - `type CardVisibilityState = "encrypted" | "owner-known" | "public"`
  - `interface CryptographicProof { transitionId: string; previousProofHash: string | null; action: string; data: Record<string, unknown>; signatures: Record<string, string>; timestamp: number; hash: string; }`
  - `interface TimestreamsState { players: Record<string, TimestreamsPlayerState>; playerOrder: string[]; config: TimestreamsConfig; phase: TimestreamsPhase; timeline: Record<EraId, EraState>; currentDay: number; dayFirstPlayer: string; encryptedDecks: Record<string, EncryptedCard[]>; cardPoints: Record<string, string>; shuffleRng: ShuffleRngState | null; eraAssignmentRng: ShuffleRngState | null; pendingDecryptRequests: DecryptRequest[]; setupPlayerIndex: number; cardVisibility: Record<string, CardVisibilityState>; proofChain: CryptographicProof[]; scores: Record<string, number>; winner: string | null; }`
  - `const DEFAULT_CONFIG: TimestreamsConfig`

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ERA_ORDER, DEFAULT_CONFIG } from "./types";

describe("era constants & defaults", () => {
  it("has six eras in chronological order", () => {
    expect(ERA_ORDER).toEqual([
      "stone", "medieval", "renaissance", "industrial", "modern", "future",
    ]);
    expect(ERA_ORDER).toHaveLength(6);
  });

  it("default config matches the spec", () => {
    expect(DEFAULT_CONFIG.scoringSlots).toBe(6);
    expect(DEFAULT_CONFIG.deckSize).toBe(36);
    expect(DEFAULT_CONFIG.drawTable).toEqual({ 2: 6, 3: 5, 4: 4 });
    expect(DEFAULT_CONFIG.homeEraAssignment).toBe("selectable");
    expect(DEFAULT_CONFIG.deckEncryption).toBe("mental-poker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write `src/types.ts`**

Implement every interface/type listed in the Produces block above, plus:
```ts
import type { CoreCard } from "@manamesh/frontend/src/game/modules/types";
import type { EncryptedCard } from "@manamesh/boardgameio-crypto/mental-poker";

export const ERA_ORDER = [
  "stone", "medieval", "renaissance", "industrial", "modern", "future",
] as const;
export type EraId = (typeof ERA_ORDER)[number];

// ... all interfaces/types from the Produces block ...

export const DEFAULT_CONFIG: TimestreamsConfig = {
  scoringSlots: 6,
  deckSize: 36,
  drawTable: { 2: 6, 3: 5, 4: 4 },
  homeEraAssignment: "selectable",
  deckEncryption: "mental-poker",
  proofChainEnabled: true,
};
```
(Write out the full interface bodies exactly as specified in Interfaces → Produces.)

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/types.ts packages/timestreams/src/types.test.ts
git commit -m "feat(timestreams): core state types and era constants"
```

---

### Task 2: Timeline helpers (pure)

**Files:**
- Create: `packages/timestreams/src/timeline.ts`
- Test: `packages/timestreams/src/timeline.test.ts`

**Interfaces:**
- Consumes: `ERA_ORDER`, `EraId`, `EraState`, `TimestreamsState`, `TimestreamsConfig` from `./types`.
- Produces:
  - `createTimeline(): Record<EraId, EraState>` — every era with an empty `stack`.
  - `eraForDay(day: number): EraId` — `day` is 1-indexed; throws `RangeError` if `day < 1 || day > 6`.
  - `dayForEra(era: EraId): number` — inverse, 1-indexed.
  - `appendToEra(timeline: Record<EraId, EraState>, era: EraId, cardId: string): void` — pushes onto `stack`.
  - `scoringSlotCardIds(era: EraState, scoringSlots: number): string[]` — first `scoringSlots` ids of `stack`.
  - `isLastDay(day: number): boolean` — `day === 6`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/timeline.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  createTimeline, eraForDay, dayForEra, appendToEra, scoringSlotCardIds, isLastDay,
} from "./timeline";

describe("timeline helpers", () => {
  it("creates six empty era stacks", () => {
    const t = createTimeline();
    expect(Object.keys(t)).toHaveLength(6);
    expect(t.stone.stack).toEqual([]);
    expect(t.future.id).toBe("future");
  });

  it("maps days to eras 1-indexed", () => {
    expect(eraForDay(1)).toBe("stone");
    expect(eraForDay(6)).toBe("future");
    expect(dayForEra("renaissance")).toBe(3);
    expect(() => eraForDay(0)).toThrow(RangeError);
    expect(() => eraForDay(7)).toThrow(RangeError);
  });

  it("appends cards and reads scoring slots", () => {
    const t = createTimeline();
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) appendToEra(t, "stone", id);
    expect(t.stone.stack).toHaveLength(7);
    expect(scoringSlotCardIds(t.stone, 6)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("flags the last day", () => {
    expect(isLastDay(6)).toBe(true);
    expect(isLastDay(5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/timeline.test.ts`
Expected: FAIL — cannot resolve `./timeline`.

- [ ] **Step 3: Write `src/timeline.ts`**

```ts
import { ERA_ORDER, type EraId, type EraState } from "./types";

export function createTimeline(): Record<EraId, EraState> {
  const t = {} as Record<EraId, EraState>;
  for (const id of ERA_ORDER) t[id] = { id, stack: [] };
  return t;
}

export function eraForDay(day: number): EraId {
  if (day < 1 || day > ERA_ORDER.length) {
    throw new RangeError(`day out of range: ${day}`);
  }
  return ERA_ORDER[day - 1];
}

export function dayForEra(era: EraId): number {
  return ERA_ORDER.indexOf(era) + 1;
}

export function appendToEra(
  timeline: Record<EraId, EraState>, era: EraId, cardId: string,
): void {
  timeline[era].stack.push(cardId);
}

export function scoringSlotCardIds(era: EraState, scoringSlots: number): string[] {
  return era.stack.slice(0, scoringSlots);
}

export function isLastDay(day: number): boolean {
  return day === ERA_ORDER.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/timeline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/timeline.ts packages/timestreams/src/timeline.test.ts
git commit -m "feat(timestreams): pure timeline/era helpers"
```

---

### Task 3: Deck factory & card schema (initially placeholders; migrate to real asset pack)

**Files:**
- Create: `packages/timestreams/src/deck.ts`
- Test: `packages/timestreams/src/deck.test.ts`

**Interfaces:**
- Consumes: `TimestreamsCard` from `./types`; `CardSchema` from `@manamesh/frontend/src/game/modules/types`; later `LoadedAssetPack` from frontend asset loader.
- Produces:
  - `createPlaceholderDeck(...)` (fallback for unscanned eras) + real deck loaders from asset pack sets (stone_age, future_tech, ...). Real cards carry metadata from pack manifest (name, effect text, cardType, etc.).
  - `timestreamsCardSchema: CardSchema<TimestreamsCard>` — `validate`, `create`, `getAssetKey` (returns `card.id` for asset lookup).
  - (See PRD Asset Pack section for full OCR + manifest + integration tasks.)

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/deck.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createPlaceholderDeck, timestreamsCardSchema } from "./deck";

describe("placeholder deck factory", () => {
  it("creates owned cards titled 'Score 1 Point'", () => {
    const deck = createPlaceholderDeck("0", 36);
    expect(deck).toHaveLength(36);
    expect(deck[0]).toMatchObject({
      id: "0-card-0", ownerId: "0", name: "Score 1 Point",
      cardType: "invention", scoreEffect: "Score 1 Point",
    });
    expect(new Set(deck.map((c) => c.id)).size).toBe(36);
  });

  it("includes a few inert action cards", () => {
    const deck = createPlaceholderDeck("0", 36, 6);
    const actions = deck.filter((c) => c.cardType === "action");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThan(deck.length);
  });

  it("schema validates and round-trips", () => {
    const card = timestreamsCardSchema.create({ id: "x", name: "Score 1 Point", ownerId: "0" });
    expect(timestreamsCardSchema.validate(card)).toBe(true);
    expect(timestreamsCardSchema.validate({ id: "y" })).toBe(false);
    expect(timestreamsCardSchema.getAssetKey(card)).toBe("x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/deck.test.ts`
Expected: FAIL — cannot resolve `./deck`.

- [ ] **Step 3: Write `src/deck.ts`**

```ts
import type { CardSchema } from "@manamesh/frontend/src/game/modules/types";
import type { TimestreamsCard } from "./types";

export function createPlaceholderDeck(
  ownerId: string, size: number, actionEvery = 6,
): TimestreamsCard[] {
  const deck: TimestreamsCard[] = [];
  for (let i = 0; i < size; i++) {
    const isAction = actionEvery > 0 && i > 0 && i % actionEvery === 0;
    deck.push({
      id: `${ownerId}-card-${i}`,
      name: "Score 1 Point",
      ownerId,
      cardType: isAction ? "action" : "invention",
      scoreEffect: "Score 1 Point",
    });
  }
  return deck;
}

export const timestreamsCardSchema: CardSchema<TimestreamsCard> = {
  validate: (card): card is TimestreamsCard =>
    typeof card === "object" && card !== null &&
    "id" in card && "name" in card && "ownerId" in card && "cardType" in card &&
    ["invention", "action"].includes((card as TimestreamsCard).cardType),
  create: (data) => ({
    id: data.id,
    name: data.name,
    ownerId: (data as Partial<TimestreamsCard>).ownerId ?? "",
    cardType: (data as Partial<TimestreamsCard>).cardType ?? "invention",
    trait: (data as Partial<TimestreamsCard>).trait,
    scoreEffect: (data as Partial<TimestreamsCard>).scoreEffect ?? "Score 1 Point",
  }),
  getAssetKey: (card) => card.id,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/deck.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/deck.ts packages/timestreams/src/deck.test.ts
git commit -m "feat(timestreams): placeholder deck factory and card schema"
```

---

### Task 4: Zone definitions

**Files:**
- Create: `packages/timestreams/src/zones.ts`
- Test: `packages/timestreams/src/zones.test.ts`

**Interfaces:**
- Consumes: `ZoneDefinition` from `@manamesh/frontend/src/game/modules/types`.
- Produces:
  - `TIMESTREAMS_ZONES: ZoneDefinition[]` — `deck` (hidden, ordered, `["shuffle","draw"]`), `hand` (owner-only, `["play","reveal"]`), `timeline` (public, shared, ordered, `["play"]`), `discard` (public, ordered, `["search"]`), `scorePile` (public, `[]`).
  - `ZONE_IDS` const map; `getZoneById(id: string): ZoneDefinition | undefined`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/zones.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TIMESTREAMS_ZONES, ZONE_IDS, getZoneById } from "./zones";

describe("zones", () => {
  it("defines the five timestreams zones", () => {
    expect(TIMESTREAMS_ZONES.map((z) => z.id).sort()).toEqual(
      ["deck", "discard", "hand", "scorePile", "timeline"],
    );
  });
  it("deck is hidden and ordered; timeline is public and shared", () => {
    expect(getZoneById("deck")).toMatchObject({ visibility: "hidden", ordered: true });
    expect(getZoneById("timeline")).toMatchObject({ visibility: "public", shared: true });
  });
  it("exposes ZONE_IDS constants", () => {
    expect(ZONE_IDS.DECK).toBe("deck");
    expect(ZONE_IDS.TIMELINE).toBe("timeline");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/zones.test.ts`
Expected: FAIL — cannot resolve `./zones`.

- [ ] **Step 3: Write `src/zones.ts`**

Mirror `packages/onepiece/src/zones.ts`. Define `TIMESTREAMS_ZONES` with the five zones above, the `ZONE_IDS` const (`DECK`, `HAND`, `TIMELINE`, `DISCARD`, `SCORE_PILE`), and `getZoneById`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/zones.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/zones.ts packages/timestreams/src/zones.test.ts
git commit -m "feat(timestreams): zone definitions"
```

---

### Task 5: Visibility & proof-chain helpers (adapt from onepiece)

**Files:**
- Create: `packages/timestreams/src/visibility.ts`
- Create: `packages/timestreams/src/proofChain.ts`
- Test: `packages/timestreams/src/visibility.test.ts`
- Test: `packages/timestreams/src/proofChain.test.ts`

**Interfaces:**
- Consumes: `TimestreamsState`, `CardVisibilityState`, `CryptographicProof` from `./types`.
- Produces:
  - `visibility.ts`: `initializeCardVisibility(state, cardIds, initial?)`, `transitionCardVisibility(state, cardId, to, initiatedBy, action, data?)`, `getCardVisibility(state, cardId)`, `isCardVisibleTo(visibility, viewerIsOwner)`, `isValidTransition(from, to)`.
  - `proofChain.ts`: `createProof(action, data, previousProofHash)`, `appendProof(state, proof)`, `getLatestProofHash(state)`, `verifyProofChain(state)`.

Adapt from `packages/onepiece/src/visibility.ts` and `packages/onepiece/src/proofChain.ts` with these exact changes:
1. Replace `OnePieceState` with `TimestreamsState` throughout.
2. Reduce `CardVisibilityState` to `"encrypted" | "owner-known" | "public"`; allowed transitions: `encrypted → owner-known`, `encrypted → public`, `owner-known → public`. Drop `secret`/`opponent-known`/`all-known` branches.
3. Keep `createProof`/`appendProof`/`getLatestProofHash`/`verifyProofChain` signatures identical (they only touch `state.proofChain` and pure hashing).

- [ ] **Step 1: Write the failing tests**

`packages/timestreams/src/visibility.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  initializeCardVisibility, transitionCardVisibility, getCardVisibility,
  isCardVisibleTo, isValidTransition,
} from "./visibility";

function blankState(): any {
  return { cardVisibility: {}, proofChain: [] };
}

describe("visibility state machine", () => {
  it("initializes cards as encrypted", () => {
    const s = blankState();
    initializeCardVisibility(s, ["a", "b"]);
    expect(getCardVisibility(s, "a")).toBe("encrypted");
  });
  it("allows encrypted -> owner-known -> public", () => {
    expect(isValidTransition("encrypted", "owner-known")).toBe(true);
    expect(isValidTransition("owner-known", "public")).toBe(true);
    expect(isValidTransition("public", "encrypted")).toBe(false);
  });
  it("transitions and records visibility", () => {
    const s = blankState();
    initializeCardVisibility(s, ["a"]);
    transitionCardVisibility(s, "a", "owner-known", "0", "draw");
    expect(getCardVisibility(s, "a")).toBe("owner-known");
  });
  it("computes viewer visibility", () => {
    expect(isCardVisibleTo("public", false)).toBe(true);
    expect(isCardVisibleTo("owner-known", true)).toBe(true);
    expect(isCardVisibleTo("owner-known", false)).toBe(false);
    expect(isCardVisibleTo("encrypted", true)).toBe(false);
  });
});
```

`packages/timestreams/src/proofChain.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createProof, appendProof, getLatestProofHash, verifyProofChain } from "./proofChain";

describe("proof chain", () => {
  it("links proofs by previous hash and verifies", () => {
    const s: any = { proofChain: [] };
    const p1 = createProof("draw", { card: "a" }, null);
    appendProof(s, p1);
    const p2 = createProof("play", { card: "b" }, getLatestProofHash(s));
    appendProof(s, p2);
    expect(s.proofChain).toHaveLength(2);
    expect(p2.previousProofHash).toBe(p1.hash);
    expect(verifyProofChain(s).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @manamesh/timestreams test src/visibility.test.ts src/proofChain.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/visibility.ts` and `src/proofChain.ts`**

Copy the two onepiece files and apply the three adaptation changes above. Ensure `verifyProofChain` returns an object with a `valid: boolean` field (match onepiece's `ProofChainVerification` shape).

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @manamesh/timestreams test src/visibility.test.ts src/proofChain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/visibility.ts packages/timestreams/src/proofChain.ts packages/timestreams/src/visibility.test.ts packages/timestreams/src/proofChain.test.ts
git commit -m "feat(timestreams): visibility state machine and proof chain"
```

---

### Task 6: Crypto initial state + key exchange

**Files:**
- Create: `packages/timestreams/src/crypto.ts`
- Test: `packages/timestreams/src/crypto.test.ts`

**Interfaces:**
- Consumes: `createPlaceholderDeck` (`./deck`); `createTimeline` (`./timeline`); `initializeCardVisibility` (`./visibility`); `buildCardPointLookup`, `generateKeyPair` from `@manamesh/boardgameio-crypto/mental-poker`; `getCurrentSetupPlayer`, `advanceSetupPlayer`, `resetSetupPlayer` from `@manamesh/boardgameio-crypto`; `GameConfig` from `@manamesh/frontend/src/game/modules/types`; types from `./types`.
- Produces:
  - `createCryptoInitialState(config: GameConfig, moduleConfig?: Partial<TimestreamsConfig>): TimestreamsState` — builds players, empty `timeline`, `phase: "keyExchange"`, `encryptedDecks` empty, `cardPoints` = card-id→point lookup for all players' placeholder decks, `setupPlayerIndex: 0`, `currentDay: 1`.
  - `submitPublicKey(G, ctx, playerId, publicKey): TimestreamsState | typeof INVALID_MOVE` — records key; when all players have submitted, advances `phase` to `"encrypt"` and `resetSetupPlayer(G)`.

Adapt from `packages/onepiece/src/crypto.ts` `createCryptoInitialState` (lines 114+) and `submitPublicKey` (lines 230+), keying decks per player via `G.encryptedDecks[playerId]` instead of onepiece's shared `encryptedZones`. Build per-player plaintext decks with `createPlaceholderDeck(playerId, deckSize)` and store `cardPoints` via `await buildCardPointLookup(allCardIds)` — note `buildCardPointLookup` is async, so compute it eagerly in `createCryptoInitialState` is not possible synchronously; instead generate points deterministically: store the plaintext card-id list per player in `G.encryptedDecks[playerId]` as `{ ciphertext: cardId, layers: 0 }` placeholders and defer point mapping to the encrypt step. (See onepiece encrypt step for the established pattern.)

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/crypto.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx } from "boardgame.io";
import { createCryptoInitialState, submitPublicKey } from "./crypto";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";

function ctx(player = "0", phase = "keyExchange"): Ctx {
  return { currentPlayer: player, numPlayers: 2, playOrder: ["0", "1"], phase, turn: 0, numMoves: 0 } as unknown as Ctx;
}
function state(ids = ["0", "1"]) {
  return createCryptoInitialState({ numPlayers: ids.length, playerIDs: ids } as any);
}

describe("crypto setup — initial state & key exchange", () => {
  let G: any;
  beforeEach(() => { G = state(); });

  it("starts in keyExchange with null public keys and an empty timeline", () => {
    expect(G.phase).toBe("keyExchange");
    expect(G.players["0"].publicKey).toBeNull();
    expect(Object.keys(G.timeline)).toHaveLength(6);
    expect(G.currentDay).toBe(1);
  });

  it("advances to encrypt once both keys are submitted", () => {
    const k0 = generateKeyPair(); const k1 = generateKeyPair();
    submitPublicKey(G, ctx("0"), "0", k0.publicKey);
    expect(G.phase).toBe("keyExchange");
    submitPublicKey(G, ctx("1"), "1", k1.publicKey);
    expect(G.phase).toBe("encrypt");
    expect(G.players["0"].publicKey).toBe(k0.publicKey);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/crypto.test.ts`
Expected: FAIL — `./crypto` not found.

- [ ] **Step 3: Implement `createCryptoInitialState` + `submitPublicKey`**

Adapt the two onepiece functions per the Interfaces note. Use `getCurrentSetupPlayer`/`advanceSetupPlayer`/`resetSetupPlayer` from `@manamesh/boardgameio-crypto` for the sequential-player bookkeeping. Initialize `shuffleRng: null`, `eraAssignmentRng: null`, `pendingDecryptRequests: []`, `proofChain: []`, `scores: {}`, `winner: null`, and seed `cardVisibility` via `initializeCardVisibility(G, allCardIds)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/crypto.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/crypto.ts packages/timestreams/src/crypto.test.ts
git commit -m "feat(timestreams): crypto initial state and key exchange"
```

---

### Task 7: Encrypt + commit-reveal shuffle, with cooperative-decryption draw

**Files:**
- Modify: `packages/timestreams/src/crypto.ts`
- Test: `packages/timestreams/src/crypto.test.ts` (extend)

**Interfaces:**
- Consumes: `encrypt`, `decrypt`, `reencryptDeck`, `decryptToCardId`, `EncryptedCard` from `@manamesh/boardgameio-crypto/mental-poker`; `sha256Hex`, `deterministicShuffle` from `@manamesh/boardgameio-crypto`; `getCurrentSetupPlayer`, `advanceSetupPlayer`, `resetSetupPlayer`.
- Produces (all `(G, ctx, ...) => TimestreamsState | typeof INVALID_MOVE` unless noted):
  - `encryptDeck(G, ctx, playerId, privateKey)` — current setup player applies their SRA layer to **every** player's deck; after the last player, advance to `shuffle` and `resetSetupPlayer`.
  - `commitShuffleSeed(G, ctx, playerId, commitHashHex, callerId?)`, `revealShuffleSeed(G, ctx, playerId, seedHex, callerId?)` — populate `G.shuffleRng`; finalize seed when all revealed.
  - `shuffleEncryptedDeck(G, ctx, playerId, events?)` — current setup player permutes every deck with `deterministicShuffle(deck, finalSeedHex + playerId)` and re-encrypts; after the last player, advance to `play` and call `dealForDay(G, 1)`.
  - `requestDraw(G, ownerId, cardIndex, requestedBy): void` — push a `DecryptRequest` requiring layers from all non-owner players.
  - `submitDecryptionShare(G, ctx, playerId, requestId, share)` — strip one layer; when all non-owner layers stripped, mark `complete`.
  - `dealForDay(G, day): void` — for each player, create draw requests for `drawTable[numPlayers]` top cards (helper used by play phase; cooperative shares resolve them).

Adapt directly from onepiece `crypto.ts`: `encryptDeck` (277), `commitShuffleSeed` (376), `revealShuffleSeed` (415), `shuffleEncryptedDeck` (462), `dealStartingHands` (537, → `dealForDay`), `submitDecryptionShare` (585). Replace shared-deck logic with the per-player `G.encryptedDecks[playerId]` map.

- [ ] **Step 1: Write the failing test (full setup round-trip)**

Append to `packages/timestreams/src/crypto.test.ts`:
```ts
import {
  encryptDeck, commitShuffleSeed, revealShuffleSeed, shuffleEncryptedDeck,
} from "./crypto";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";
import { sha256Hex } from "@manamesh/boardgameio-crypto";

describe("crypto setup — encrypt & shuffle round-trip", () => {
  it("runs keyExchange -> encrypt -> shuffle -> play deterministically", () => {
    const ids = ["0", "1"];
    const G: any = createCryptoInitialState({ numPlayers: 2, playerIDs: ids } as any);
    const keys: Record<string, any> = { "0": generateKeyPair(), "1": generateKeyPair() };

    submitPublicKey(G, ctx("0"), "0", keys["0"].publicKey);
    submitPublicKey(G, ctx("1"), "1", keys["1"].publicKey);
    expect(G.phase).toBe("encrypt");

    encryptDeck(G, ctx("0", "encrypt"), "0", keys["0"].privateKey);
    encryptDeck(G, ctx("1", "encrypt"), "1", keys["1"].privateKey);
    expect(G.phase).toBe("shuffle");

    const seeds: Record<string, string> = { "0": "aa".repeat(32), "1": "bb".repeat(32) };
    for (const id of ids) commitShuffleSeed(G, ctx(id, "shuffle"), id, sha256Hex(seeds[id]));
    for (const id of ids) revealShuffleSeed(G, ctx(id, "shuffle"), id, seeds[id]);
    shuffleEncryptedDeck(G, ctx("0", "shuffle"), "0");
    shuffleEncryptedDeck(G, ctx("1", "shuffle"), "1");

    expect(G.phase).toBe("play");
    // every player's deck is fully layered (encrypted by both players)
    expect(G.encryptedDecks["0"].every((c: any) => c.layers === 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/crypto.test.ts`
Expected: FAIL — `encryptDeck` etc. not exported.

- [ ] **Step 3: Implement the encrypt/shuffle/draw functions**

Port the named onepiece functions with per-player deck keying. Drive sequential turns with `getCurrentSetupPlayer`/`advanceSetupPlayer`. On the final shuffle player, set `G.phase = "play"` and call `dealForDay(G, 1)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/crypto.test.ts`
Expected: PASS (all crypto tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/crypto.ts packages/timestreams/src/crypto.test.ts
git commit -m "feat(timestreams): mental-poker encrypt, shuffle, and cooperative draw"
```

---

### Task 8: Home-era assignment (selectable + cryptographically-fair random)

**Files:**
- Create: `packages/timestreams/src/homeEra.ts`
- Test: `packages/timestreams/src/homeEra.test.ts`

**Interfaces:**
- Consumes: `ERA_ORDER`, `EraId`, `TimestreamsState` from `./types`; `deterministicShuffle`, `sha256Hex` from `@manamesh/boardgameio-crypto`.
- Produces:
  - `claimHomeEra(G, playerId, era): boolean` — selectable mode; rejects (returns false) if `era` already claimed by another player or player is `ready`; otherwise sets `players[playerId].homeEra = era`.
  - `setReady(G, playerId, ready): void`.
  - `allReadyWithDistinctEras(G): boolean` — true iff every player `ready` and home eras are all set and distinct.
  - `assignRandomHomeEras(G, finalSeedHex): void` — `deterministicShuffle(ERA_ORDER.slice(), finalSeedHex)` then assign the first `playerOrder.length` distinct eras to players in `playerOrder` order.
  - `homeEraTurnOrder(G): string[]` — player ids sorted by `ERA_ORDER.indexOf(homeEra)` ascending.
  - `dayFirstPlayer(G, day): string` — `order = homeEraTurnOrder(G); return order[(day - 1) % order.length]`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/homeEra.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  claimHomeEra, setReady, allReadyWithDistinctEras,
  assignRandomHomeEras, homeEraTurnOrder, dayFirstPlayer,
} from "./homeEra";

function G(ids = ["0", "1", "2"]) {
  const players: any = {};
  for (const id of ids) players[id] = { homeEra: null, ready: false };
  return { players, playerOrder: ids } as any;
}

describe("home-era assignment", () => {
  it("selectable: prevents duplicate claims", () => {
    const g = G(["0", "1"]);
    expect(claimHomeEra(g, "0", "stone")).toBe(true);
    expect(claimHomeEra(g, "1", "stone")).toBe(false);
    expect(claimHomeEra(g, "1", "future")).toBe(true);
  });

  it("selectable: claims editable until ready", () => {
    const g = G(["0", "1"]);
    claimHomeEra(g, "0", "stone");
    expect(claimHomeEra(g, "0", "medieval")).toBe(true);
    setReady(g, "0", true);
    expect(claimHomeEra(g, "0", "future")).toBe(false);
  });

  it("detects all-ready-with-distinct-eras", () => {
    const g = G(["0", "1"]);
    claimHomeEra(g, "0", "stone"); claimHomeEra(g, "1", "future");
    setReady(g, "0", true); setReady(g, "1", true);
    expect(allReadyWithDistinctEras(g)).toBe(true);
  });

  it("random: deterministic distinct assignment from a seed", () => {
    const a = G(["0", "1", "2"]); const b = G(["0", "1", "2"]);
    assignRandomHomeEras(a, "ab".repeat(32));
    assignRandomHomeEras(b, "ab".repeat(32));
    const eras = Object.values(a.players).map((p: any) => p.homeEra);
    expect(new Set(eras).size).toBe(3);
    expect(Object.values(b.players).map((p: any) => p.homeEra)).toEqual(eras);
  });

  it("turn order follows era chronology and rotates by day", () => {
    const g = G(["0", "1"]);
    g.players["0"].homeEra = "future";
    g.players["1"].homeEra = "stone";
    expect(homeEraTurnOrder(g)).toEqual(["1", "0"]);
    expect(dayFirstPlayer(g, 1)).toBe("1");
    expect(dayFirstPlayer(g, 2)).toBe("0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/homeEra.test.ts`
Expected: FAIL — `./homeEra` not found.

- [ ] **Step 3: Write `src/homeEra.ts`**

Implement each Produces function exactly as specified. `assignRandomHomeEras` uses `deterministicShuffle([...ERA_ORDER], finalSeedHex)` and assigns `shuffled[i]` to `playerOrder[i]`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/homeEra.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/homeEra.ts packages/timestreams/src/homeEra.test.ts
git commit -m "feat(timestreams): selectable + cryptographically-fair home-era assignment"
```

---

### Task 9: Play-phase moves (play / action / pass / day advance)

**Files:**
- Create: `packages/timestreams/src/play.ts`
- Test: `packages/timestreams/src/play.test.ts`

**Interfaces:**
- Consumes: `eraForDay`, `appendToEra`, `isLastDay` (`./timeline`); `transitionCardVisibility` (`./visibility`); `dayFirstPlayer`, `homeEraTurnOrder` (`./homeEra`); `dealForDay` (`./crypto`); `INVALID_MOVE` from `boardgame.io/core`; types from `./types`.
- Produces (all `(G, ctx, ...) => TimestreamsState | typeof INVALID_MOVE`):
  - `playInvention(G, ctx, playerId, cardId)` — guards: `phase==="play"`, `ctx.currentPlayer===playerId`, card is an `invention` in `players[playerId].hand`. Moves card from hand, `appendToEra(G.timeline, eraForDay(G.currentDay), cardId)`, sets visibility `public`, clears `hasPassedThisDay` for the player.
  - `playAction(G, ctx, playerId, cardId)` — guards as above but card is an `action`; moves card to `players[playerId].discard` (no effect in M1); visibility `public`.
  - `pass(G, ctx, playerId)` — sets `players[playerId].hasPassedThisDay = true`. If **all** players have passed, call `endDay(G)`.
  - `endDay(G): void` — if `isLastDay(G.currentDay)` set `phase="scoring"`; else increment `currentDay`, reset all `hasPassedThisDay=false`, set `dayFirstPlayer` for the new day, and `dealForDay(G, G.currentDay)`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/play.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import { playInvention, playAction, pass } from "./play";
import { createTimeline } from "./timeline";

function ctx(player: string) {
  return { currentPlayer: player, numPlayers: 2, playOrder: ["0", "1"], phase: "play" } as any;
}
function G() {
  return {
    phase: "play", currentDay: 1, playerOrder: ["0", "1"],
    timeline: createTimeline(), cardVisibility: {}, proofChain: [],
    config: { scoringSlots: 6, drawTable: { 2: 6 } },
    players: {
      "0": { homeEra: "stone", hand: [
        { id: "0-i", ownerId: "0", name: "Score 1 Point", cardType: "invention", scoreEffect: "Score 1 Point" },
        { id: "0-a", ownerId: "0", name: "Score 1 Point", cardType: "action", scoreEffect: "Score 1 Point" },
      ], discard: [], scorePile: [], hasPassedThisDay: false },
      "1": { homeEra: "future", hand: [], discard: [], scorePile: [], hasPassedThisDay: false },
    },
  } as any;
}

describe("play-phase moves", () => {
  it("plays an invention into the current era", () => {
    const g = G();
    playInvention(g, ctx("0"), "0", "0-i");
    expect(g.timeline.stone.stack).toEqual(["0-i"]);
    expect(g.players["0"].hand.map((c: any) => c.id)).toEqual(["0-a"]);
    expect(g.cardVisibility["0-i"]).toBe("public");
  });

  it("rejects playing an action via playInvention", () => {
    const g = G();
    expect(playInvention(g, ctx("0"), "0", "0-a")).toBe(INVALID_MOVE);
  });

  it("action goes to discard with no effect", () => {
    const g = G();
    playAction(g, ctx("0"), "0", "0-a");
    expect(g.players["0"].discard.map((c: any) => c.id)).toEqual(["0-a"]);
  });

  it("rejects a non-current player", () => {
    const g = G();
    expect(playInvention(g, ctx("1"), "0", "0-i")).toBe(INVALID_MOVE);
  });

  it("advances the day when all players pass", () => {
    const g = G();
    pass(g, ctx("0"), "0");
    expect(g.currentDay).toBe(1);
    pass(g, ctx("1"), "1");
    expect(g.currentDay).toBe(2);
    expect(g.players["0"].hasPassedThisDay).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/play.test.ts`
Expected: FAIL — `./play` not found.

- [ ] **Step 3: Write `src/play.ts`**

Implement the five Produces functions. In `endDay`, when advancing, call `dealForDay(G, G.currentDay)` (imported from `./crypto`). Note: the test above does not exercise `dealForDay` reaching crypto internals because day 2's deal will create decrypt requests; keep `dealForDay` tolerant of empty `encryptedDecks` (guard: skip if a player's deck is empty) so unit tests with no crypto state don't throw.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/play.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/play.ts packages/timestreams/src/play.test.ts
git commit -m "feat(timestreams): play-phase moves and day advancement"
```

---

### Task 10: Placeholder scoring

**Files:**
- Create: `packages/timestreams/src/scoring.ts`
- Test: `packages/timestreams/src/scoring.test.ts`

**Interfaces:**
- Consumes: `ERA_ORDER` (`./types`); `scoringSlotCardIds` (`./timeline`); types from `./types`.
- Produces:
  - `cardOwner(cardId: string): string` — parses `${ownerId}-card-${i}` → `ownerId` (split on `-card-`).
  - `resolveScoring(G): void` — for each era, for each card id in `scoringSlotCardIds(era, config.scoringSlots)`, award `+1` to `scores[cardOwner(id)]`. Set `G.winner` to the highest scorer (ties → lowest era-chronology player via `homeEraTurnOrder`); set `phase="gameOver"`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/scoring.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveScoring, cardOwner } from "./scoring";
import { createTimeline } from "./timeline";

describe("placeholder scoring", () => {
  it("derives owner from card id", () => {
    expect(cardOwner("0-card-12")).toBe("0");
    expect(cardOwner("1-card-3")).toBe("1");
  });

  it("awards 1 point per owned card in a scoring slot and picks a winner", () => {
    const timeline = createTimeline();
    timeline.stone.stack = ["0-card-1", "0-card-2", "1-card-1"];
    timeline.future.stack = ["1-card-2"];
    const G: any = {
      phase: "scoring", timeline, playerOrder: ["0", "1"],
      players: { "0": { homeEra: "stone" }, "1": { homeEra: "future" } },
      config: { scoringSlots: 6 }, scores: { "0": 0, "1": 0 }, winner: null,
    };
    resolveScoring(G);
    expect(G.scores).toEqual({ "0": 2, "1": 2 });
    expect(G.winner).toBe("0"); // tie broken by era chronology (stone < future)
    expect(G.phase).toBe("gameOver");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/scoring.test.ts`
Expected: FAIL — `./scoring` not found.

- [ ] **Step 3: Write `src/scoring.ts`**

Implement `cardOwner` (split on `"-card-"`) and `resolveScoring` as specified, importing `homeEraTurnOrder` from `./homeEra` for tie-breaking.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/scoring.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/scoring.ts packages/timestreams/src/scoring.test.ts
git commit -m "feat(timestreams): placeholder count-scoring"
```

---

### Task 11: boardgame.io Game definition + module export

**Files:**
- Create: `packages/timestreams/src/game.ts`
- Modify: `packages/timestreams/src/index.ts`
- Test: `packages/timestreams/src/game.test.ts`

**Interfaces:**
- Consumes: every prior module; `Game`, `Ctx` from `boardgame.io`; `INVALID_MOVE` from `boardgame.io/core`; `GameModule`/`GameConfig`/`MoveValidation` from `@manamesh/frontend/src/game/modules/types`.
- Produces:
  - `TimestreamsGame: Game<TimestreamsState>` — phases `setup → keyExchange → encrypt → shuffle → play → scoring → gameOver` (+ `voided`); each phase exposes the relevant moves with `client: false`; `setup` phase includes `claimHomeEra`/`setReady` (selectable) and `commitEraSeed`/`revealEraSeed` (random) plus `loadDecks` (per 2026-06-26 decision); `scoring` phase runs `resolveScoring` in `onBegin`; turn order in `play` derived from `homeEraTurnOrder`.
  - **Important (per Recorded Decisions):** Use only type imports for boardgame.io. Do **not** import `Client` from "boardgame.io/client" in `game.test.ts`. Declare and wire the `voided` phase + `voteAbortReveal` stub here. `INVALID_MOVE` must be the local const.
  - `TimestreamsModule: GameModule<TimestreamsCard, TimestreamsState>` — `id: "timestreams"`, `cardSchema`, `zones: TIMESTREAMS_ZONES`, `assetRequirements`, `initialState`, `validateMove`, `getBoardgameIOGame: () => TimestreamsGame`, `zoneLayout`.
  - `index.ts` re-exports the module, game, types, and key helpers.

- [ ] **Step 1: Write the failing test (full scripted game)**

`packages/timestreams/src/game.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Client } from "boardgame.io/client";
import { TimestreamsGame } from "./game";

describe("TimestreamsGame integration", () => {
  it("exposes a boardgame.io game with the expected phases and name", () => {
    expect(TimestreamsGame.name).toBe("timestreams");
    expect(Object.keys(TimestreamsGame.phases ?? {})).toEqual(
      expect.arrayContaining(["setup", "keyExchange", "encrypt", "shuffle", "play", "scoring", "gameOver", "voided"]),
    );
  });

  it("boots a 2-player client in the setup phase", () => {
    const client = Client({ game: TimestreamsGame, numPlayers: 2 });
    client.start();
    const { G, ctx } = client.getState()!;
    expect(ctx.phase).toBe("setup");
    expect(Object.keys((G as any).players)).toHaveLength(2);
    client.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/game.test.ts`
Expected: FAIL — `./game` not found.

- [ ] **Step 3: Write `src/game.ts` and update `index.ts`**

Mirror `packages/onepiece/src/game.ts` `OnePieceGame`/`OnePieceModule` structure. Wire each move from the prior tasks into the matching phase with `client: false`. Add `validateMove` returning `{ valid: true }` by default (mirror onepiece). Add `zoneLayout` (reuse onepiece's percentages as a starting point; six era columns can be laid out under `timeline`). Re-export from `index.ts`:
```ts
export { TimestreamsModule, TimestreamsGame } from "./game";
export { default } from "./game";
export * from "./types";
export { TIMESTREAMS_ZONES, ZONE_IDS, getZoneById } from "./zones";
export { createCryptoInitialState } from "./crypto";
export const PACKAGE_NAME = "@manamesh/timestreams";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test`
Expected: PASS — all suites green, including the full `game.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/game.ts packages/timestreams/src/index.ts packages/timestreams/src/game.test.ts
git commit -m "feat(timestreams): boardgame.io game definition and module export"
```

---

### Task 12: Scripted end-to-end game test (2/3/4 players)

**Files:**
- Test: `packages/timestreams/src/e2e.test.ts`

**Interfaces:**
- Consumes: `TimestreamsGame` (`./game`); the crypto/play/scoring move functions for direct-call scripting.
- Produces: confidence that setup → six days → scoring runs end-to-end with verifiable proofs.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createCryptoInitialState, submitPublicKey, encryptDeck, commitShuffleSeed, revealShuffleSeed, shuffleEncryptedDeck } from "./crypto";
import { pass } from "./play";
import { resolveScoring } from "./scoring";
import { assignRandomHomeEras } from "./homeEra";
import { verifyProofChain } from "./proofChain";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";
import { sha256Hex } from "@manamesh/boardgameio-crypto";

function ctx(p: string, n: number, phase: string) {
  return { currentPlayer: p, numPlayers: n, playOrder: Array.from({ length: n }, (_, i) => String(i)), phase, turn: 0, numMoves: 0 } as any;
}

describe.each([2, 3, 4])("end-to-end %i-player game", (n) => {
  it("runs setup through scoring to a winner", () => {
    const ids = Array.from({ length: n }, (_, i) => String(i));
    const G: any = createCryptoInitialState({ numPlayers: n, playerIDs: ids } as any);
    assignRandomHomeEras(G, "cd".repeat(32));
    const keys: Record<string, any> = {};
    for (const id of ids) { keys[id] = generateKeyPair(); submitPublicKey(G, ctx(id, n, "keyExchange"), id, keys[id].publicKey); }
    for (const id of ids) encryptDeck(G, ctx(id, n, "encrypt"), id, keys[id].privateKey);
    const seeds: Record<string, string> = {};
    for (const id of ids) { seeds[id] = (id + "e").repeat(32).slice(0, 64); commitShuffleSeed(G, ctx(id, n, "shuffle"), id, sha256Hex(seeds[id])); }
    for (const id of ids) revealShuffleSeed(G, ctx(id, n, "shuffle"), id, seeds[id]);
    for (const id of ids) shuffleEncryptedDeck(G, ctx(id, n, "shuffle"), id);
    expect(G.phase).toBe("play");

    // All players pass every day (no plays); six days end the play phase.
    for (let day = 1; day <= 6; day++) {
      for (const id of ids) pass(G, ctx(id, n, "play"), id);
    }
    expect(G.phase).toBe("scoring");
    resolveScoring(G);
    expect(G.phase).toBe("gameOver");
    expect(ids).toContain(G.winner);
    expect(verifyProofChain(G).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (then drives fixes)**

Run: `yarn workspace @manamesh/timestreams test src/e2e.test.ts`
Expected: Initially may FAIL if `pass`/`dealForDay` interplay needs hardening for 3–4 players. Fix `endDay`/`dealForDay` until green. (Use superpowers:systematic-debugging for any failure.)

- [ ] **Step 3: Make it pass**

Adjust `dealForDay`/`endDay` as needed so all-pass days advance correctly for 2, 3, and 4 players.

- [ ] **Step 4: Run the full suite**

Run: `yarn workspace @manamesh/timestreams test`
Expected: PASS — every suite.

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/e2e.test.ts packages/timestreams/src/crypto.ts packages/timestreams/src/play.ts
git commit -m "test(timestreams): scripted 2/3/4-player end-to-end game"
```

---

### Task 13: Board UI component

**Files:**
- Create: `packages/timestreams/src/board/TimestreamsBoard.tsx`
- Test: `packages/timestreams/src/board/TimestreamsBoard.test.tsx`

**Interfaces:**
- Consumes: `BoardProps` from `boardgame.io/react`; `TimestreamsState`, `EraId`, `ERA_ORDER` from `../types`; `CryptoTransparencyPanel` from `@manamesh/frontend/src/components/CryptoTransparencyPanel`; React.
- Produces: `TimestreamsBoard: React.FC<BoardProps<TimestreamsState>>` — renders six era columns with their stacks and scoring-slot markers, a day/active-era indicator, current-player highlight, the local player's hand, and `Play`/`Pass` buttons wired to `moves.playInvention`/`moves.playAction`/`moves.pass`. Prompt text is a stubbed `<p className="ts-prompt">` placeholder (filled in M2/M3).

**Note:** Testing React requires a DOM environment. Add `// @vitest-environment jsdom` at the top of the test file (vitest reads per-file environment directives even though the global config is `node`). If `@testing-library/react` is unavailable in the workspace, assert against `renderToStaticMarkup` from `react-dom/server` instead (no extra dependency).

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/board/TimestreamsBoard.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TimestreamsBoard } from "./TimestreamsBoard";
import { createTimeline } from "../timeline";

function props(overrides: any = {}) {
  return {
    G: {
      phase: "play", currentDay: 1, dayFirstPlayer: "0", playerOrder: ["0", "1"],
      timeline: createTimeline(), config: { scoringSlots: 6 },
      players: { "0": { homeEra: "stone", hand: [], discard: [], scorePile: [] }, "1": { homeEra: "future", hand: [], discard: [], scorePile: [] } },
      scores: { "0": 0, "1": 0 }, winner: null, proofChain: [],
    },
    ctx: { currentPlayer: "0", phase: "play", numPlayers: 2 },
    moves: { playInvention: () => {}, playAction: () => {}, pass: () => {} },
    playerID: "0",
    ...overrides,
  } as any;
}

describe("TimestreamsBoard", () => {
  it("renders six era columns and a day indicator", () => {
    const html = renderToStaticMarkup(<TimestreamsBoard {...props()} />);
    expect(html).toContain("Stone");
    expect(html).toContain("Future");
    expect(html.match(/ts-era-column/g) ?? []).toHaveLength(6);
    expect(html).toContain("Day 1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/board/TimestreamsBoard.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `TimestreamsBoard.tsx`**

Implement the component per the Interfaces description. Render `ERA_ORDER.map(...)` into `<div className="ts-era-column">` blocks with a human label map (`stone→"Stone Age"`, etc.), the active era (index `currentDay-1`) highlighted, scoring-slot markers for the first `config.scoringSlots`, a `Day {currentDay}` indicator, the local hand, and `Play`/`Pass` buttons. Keep styling inline/minimal; mirror structure from `packages/poker/src/components/PokerBoard.tsx`. Add the stubbed prompt element.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/board/TimestreamsBoard.test.tsx`
Expected: PASS. If `jsdom` is not installed in the workspace, switch the test to `environment: node` and rely solely on `renderToStaticMarkup` (no DOM needed) — remove the directive.

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/board/TimestreamsBoard.tsx packages/timestreams/src/board/TimestreamsBoard.test.tsx
git commit -m "feat(timestreams): interactive timeline board component"
```

---

### Task 14: Frontend lobby config + page

**Files:**
- Create: `packages/manamesh/packages/frontend/src/p2p/discovery/matchmaking/timestreams/timestreams-lobby.ts`
- Create: `packages/manamesh/packages/frontend/src/pages/timestreams/TimestreamsLobby.tsx`
- Test: `packages/manamesh/packages/frontend/src/p2p/discovery/matchmaking/timestreams/timestreams-lobby.test.ts`

**Interfaces:**
- Consumes: `MatchmakingConfig`, `MatchmakingEvents` from `../MatchmakingService` (see poker's import); React; the poker lobby page as a structural template.
- Produces:
  - `interface TimestreamsMatchmakingConfig extends MatchmakingConfig { gameType: "timestreams"; homeEraAssignment: "selectable" | "random"; maxPlayers: number; }`
  - `createTimestreamsMatchmakingConfig(displayName, options): TimestreamsMatchmakingConfig` — defaults `homeEraAssignment: "selectable"`, `maxPlayers: 4`, mirroring `createPokerMatchmakingConfig`.
  - `isTimestreamsConfig(config): config is TimestreamsMatchmakingConfig`.
  - `TimestreamsLobby` page component (mirror `PokerLobby.tsx`) exposing a `homeEraAssignment` selector and, in `selectable` mode, the era-claim UI.

- [ ] **Step 1: Write the failing test**

`.../timestreams/timestreams-lobby.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createTimestreamsMatchmakingConfig, isTimestreamsConfig } from "./timestreams-lobby";

describe("timestreams matchmaking config", () => {
  it("defaults to selectable assignment and 4 max players", () => {
    const cfg = createTimestreamsMatchmakingConfig("alice", { isHost: true });
    expect(cfg.gameType).toBe("timestreams");
    expect(cfg.homeEraAssignment).toBe("selectable");
    expect(cfg.maxPlayers).toBe(4);
    expect(isTimestreamsConfig(cfg)).toBe(true);
  });
  it("honors a random assignment option", () => {
    const cfg = createTimestreamsMatchmakingConfig("bob", { isHost: true, homeEraAssignment: "random", maxPlayers: 3 });
    expect(cfg.homeEraAssignment).toBe("random");
    expect(cfg.maxPlayers).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/frontend test src/p2p/discovery/matchmaking/timestreams/timestreams-lobby.test.ts`
Expected: FAIL — module not found. (Heed the dual-root Yarn gotcha in project memory when running frontend tests.)

- [ ] **Step 3: Write the lobby config + page**

Implement `timestreams-lobby.ts` mirroring `poker-lobby.ts` exactly, swapping poker options for `homeEraAssignment`/`maxPlayers`. Implement `TimestreamsLobby.tsx` mirroring `PokerLobby.tsx`: same connection lifecycle, plus a `<select>` for `homeEraAssignment` (host-only) and, when `selectable`, an era-claim row per the `claimHomeEra` semantics (claims editable until ready).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/frontend test src/p2p/discovery/matchmaking/timestreams/timestreams-lobby.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/manamesh/packages/frontend/src/p2p/discovery/matchmaking/timestreams/ packages/manamesh/packages/frontend/src/pages/timestreams/
git commit -m "feat(timestreams): frontend matchmaking config and lobby page"
```

---

### Task 15: Module README + root wiring

**Files:**
- Create: `packages/timestreams/README.md`
- Modify: `packages/timestreams/src/index.ts` (ensure all public exports present)

**Interfaces:**
- Consumes: everything built.
- Produces: developer-facing docs and a clean public surface.

- [ ] **Step 1: Write `README.md`**

Document: what the module is (M1 scope), how to run tests (`yarn workspace @manamesh/timestreams test`), the phase flow, the home-era assignment modes, and a pointer to `PRD.md`/`RULES.md`. No code logic to test here.

- [ ] **Step 2: Verify the public surface compiles**

Run: `yarn workspace @manamesh/timestreams test`
Expected: PASS — full suite still green.

- [ ] **Step 3: Commit**

```bash
git add packages/timestreams/README.md packages/timestreams/src/index.ts
git commit -m "docs(timestreams): module README and public exports"
```

---

## Self-Review

**Spec coverage (PRD → task):**
- §2 board/timeline model → Tasks 1, 2. Draw table → Tasks 1, 7, 9.
- §3.1 GameModule contract → Tasks 3 (schema), 11 (module). §3.2 crypto → Tasks 6, 7. §3.3 auditability → Task 5. §3.4 UI → Task 13. §3.5 lobby + home-era → Tasks 8, 14.
- §4 state model → Task 1. Zones → Task 4.
- §5 phases & moves → Tasks 6, 7, 9, 11. Structural enforcement → Task 9. `voided`/`voteAbortReveal` stub → Task 11 (declare phase + stub move).
- §6 scoring (M1 placeholder) → Task 10. §7 M1 deliverables → all tasks. §9 testing → Tasks throughout + 12.

**Gap found & closed:** The PRD lists a `voted`/abandonment `voteAbortReveal` stub; Task 11 must declare the `voided` phase and a no-op `voteAbortReveal` move — added explicitly to Task 11's Produces (reinforced by 2026-06-26 decisions). The `loadDecks` setup move (binding each player's placeholder deck into `encryptedDecks` plaintext before keyExchange) is folded into Task 11's `setup` phase wiring; the plaintext decks themselves come from `createCryptoInitialState` (Task 6), so no separate task is required.

**2026-06-26 Decisions incorporated:**
- Full M1 completion through Task 15 is priority.
- Hybrid SDD workflow.
- boardgame.io test constraints, local INVALID_MOVE, no `Client` runtime import in game.test.ts.
- voided phase + voteAbortReveal explicitly required in Task 11.
- sha256Hex binding bug to be fixed in poker + onepiece (follow-up).

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" remain; crypto-adaptation tasks cite exact source files and enumerate the precise edits, with full test code provided.

**Type consistency:** `TimestreamsState`, `EncryptedCard`, `EraId`, `DecryptRequest`, `ShuffleRngState`, `dealForDay`, `homeEraTurnOrder`, `dayFirstPlayer`, `resolveScoring`, `cardOwner` names are used identically across Tasks 1, 6–12. 

**Metadata shape (final):** No top-level `effectText`. 
- `addlCardText?: string` for text that doesn't fit Play/Score/React.
- `flavorText?: string` optional for flavor (shown when appropriate, not in main composition).
- Full card text composed via `composeCardText()` in order: addlCardText, playEffectText, scoreEffectText, reactEffectText.
- Boolean `has*` flags kept for fast detection.
- `reactText` renamed to `reactEffectText`.
See PRD for details. Card id format uses pack ids (e.g. `stone-age-cloth`).

**Asset pack work:** New PRD section "Asset Pack & Real Card Data" defines OCR + build + integration tasks (prereq to full non-placeholder UI). Decks treated as sets per ManaMesh standard. See PRD for details; these will drive updates to deck loading and board rendering.

**Open risks for the implementer:**
- `buildCardPointLookup` is async; Task 6 notes deferring point mapping to the encrypt step (matching onepiece) rather than awaiting in `createCryptoInitialState`.
- `jsdom` availability for Task 13 — fallback to `renderToStaticMarkup` under `node` is specified.
- Frontend tests (Task 14) require the dual-root Yarn handling recorded in project memory.
