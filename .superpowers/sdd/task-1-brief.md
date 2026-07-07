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

