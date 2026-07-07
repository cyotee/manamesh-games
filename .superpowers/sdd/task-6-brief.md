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

