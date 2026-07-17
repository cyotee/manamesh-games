# Mental Poker Adversarial Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Phase 1 **complete** (M1–M12, G1–G7, R1–R6 offline models; 2–5 players).  
**Next wave:** Multi-street settlement, peel/concurrent, key-exchange, etc. in  
[`2026-07-15-poker-adversarial-next-wave.md`](./2026-07-15-poker-adversarial-next-wave.md) (**S1–S3, S7, S10** primarily).

**Goal:** Prove that ManaMesh mental poker is real and privacy-preserving: multi-party SRA encryption works end-to-end in the poker game path, cooperative reveal recovers correct cards, and a single player (or outsider) cannot learn another player’s hole cards or undealt deck cards.

**Architecture:** Three layers of tests, all driving shipped code (no theater): (1) primitive guarantees in `@manamesh/boardgameio-crypto` already exist — keep them as foundation and add missing **privacy-negative** primitive cases; (2) a new **workflow harness** that runs real keys + real `encryptDeck` / `reencryptDeck` / shuffle / deal / cooperative decrypt through poker handlers; (3) **adversarial privacy** cases that attempt illegal peeks with only the attacker’s key and assert failure. Prefer exported production handlers (same pattern as `voteAbortDecrypt` / `submitDecryptedShare`) over reimplemented bodies.

**Tech Stack:** Vitest, TypeScript, `@manamesh/boardgameio-crypto` (SRA, `decryptToCardId`, shuffle), `@manamesh/poker` (`crypto.ts` moves), boardgame.io `INVALID_MOVE` / optional `Client` for integration.

**Related docs / prior work:**
- `packages/poker/docs/GAME_FLOW_AND_SECURITY.md` — intended security model
- `packages/poker/docs/ADVERSARIAL_TESTS.md` — settlement A1–A14 / crypto C1–C4 (move identity, not workflow privacy)
- `docs/superpowers/plans/2026-07-15-poker-adversarial-tests.md` — settlement adversarial plan
- Existing green foundations: `boardgameio-crypto/.../sra.test.ts`, `crypto-plugin.test.ts` full cycle

## Global Constraints

- **No theater:** Tests must call shipped encrypt/decrypt/move functions with real key material. Do not hard-code `encryptedZones` ciphertexts unless also proving they were produced by `encrypt`/`reencryptDeck`.
- **No reimplementation:** Do not copy decrypt-layer loops into the test; call `encrypt`/`decrypt`/`decryptToCardId`/`encryptDeck`/`reencryptDeck` and exported poker handlers.
- **Private keys never in shared G:** Assert after setup that `G.players[*]` and `G.crypto` do not contain private keys (only public keys / encrypted material).
- **Fixture players:** 2-player first (Alice/Bob keys); extend to 3-player once 2p is green.
- **Export only what production already uses:** If a poker move is private, export it the same way `voteAbortDecrypt` was extracted (handler used by `CryptoPokerGame.moves`).
- Package tests: `yarn workspace @manamesh/boardgameio-crypto test` and `yarn workspace @manamesh/poker test`.
- Update `packages/poker/docs/ADVERSARIAL_TESTS.md` with threat IDs **M1–Mn** (mental-poker) when done.
- Do not expand scope to P2P transport MITM, ZK shuffle soundness proofs beyond existing commit-reveal, or on-chain settlement.

---

## Threat model (mental poker)

| ID | Claim (must hold) | Attack if false |
|----|-------------------|-----------------|
| **M1** | After full multi-player encrypt, ciphertext ≠ plaintext card id / point | Agent stubs “encrypt” as identity |
| **M2** | Single player’s key alone cannot recover card id from fully layered card | Collusion-free privacy broken |
| **M3** | All layers removed (any order) recovers original card id | Broken decrypt / wrong layer accounting |
| **M4** | Poker setup path: keyExchange → encrypt×N → shuffle → deal produces layered cards in hand zones | Game never wires real SRA |
| **M5** | Player B cannot complete reveal of `hand:A` without A’s decrypt share | Cross-hand peek |
| **M6** | Undealt deck (and other hand zones) remain unreadable with only one key after deal | Deck peeping |
| **M7** | Cooperative path for **own** hand succeeds and yields consistent card ids | Workflow is fake even for honest players |
| **M8** | `peekHoleCards` only creates coop requests for **own** zone `hand:${playerId}` | Zone confusion |
| **M9** | Invalid / partial shares do not mark opponent hand fully revealed | Share forgery |
| **M10** | Private keys not stored in shared game state after setup | Key leakage via G |
| **M11** | Shuffle permutes encrypted deck without reducing layers | “Shuffle” drops encryption |
| **M12** (stretch) | 3-player: any proper subset of keys insufficient to recover id | Threshold privacy |

---

## File map

| Path | Responsibility |
|------|----------------|
| `packages/boardgameio-crypto/src/mental-poker/sra.privacy.test.ts` | Primitive privacy-negatives (M1–M3, M12 subset) on pure SRA |
| `packages/poker/src/mentalPoker.harness.ts` | Test-only helpers: generate keys, run setup encrypt/shuffle via **exported** handlers, deal, attempt decrypt |
| `packages/poker/src/mentalPoker.workflow.test.ts` | Happy path M4, M7, M10, M11 through real poker path |
| `packages/poker/src/mentalPoker.privacy.adversarial.test.ts` | Adversarial M2, M5, M6, M8, M9 |
| `packages/poker/src/crypto.ts` | Export `encryptDeck`, `shuffleEncryptedDeck`, `dealHoleCards` (or thin wrappers) if not already public; keep wired to `CryptoPokerGame` |
| `packages/poker/src/index.ts` | Re-export harness-facing APIs only if package consumers need them (prefer test imports from `./crypto`) |
| `packages/poker/docs/ADVERSARIAL_TESTS.md` | Add M1–M12 section |
| `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md` | Link plan + suite |
| `docs/superpowers/plans/2026-07-15-mental-poker-adversarial-suite.md` | This plan |

---

### Task 1: Inventory & export poker workflow surface

**Files:**
- Modify: `packages/poker/src/crypto.ts`
- Read: `dealHoleCards`, `encryptDeck`, `shuffleEncryptedDeck`, `peekHoleCards`, `approveDecrypt`

**Produces:**
- Exported functions (same as game moves call):
  - `encryptDeck(G, ctx, playerId, privateKey)`
  - `shuffleEncryptedDeck(G, ctx, playerId, privateKey, events?)`
  - `dealHoleCards` — export if currently private, or export `runDealAfterShuffle(G)` used at end of shuffle
  - Already exported: `submitDecryptedShare`, `approveDecrypt`, `voteAbortDecrypt`, `createCryptoInitialState`, `canAbortDecryptNow`

- [ ] **Step 1: Export the production handlers**

Change `function encryptDeck` / `function shuffleEncryptedDeck` / `function dealHoleCards` to `export function …` (no logic change). Confirm `CryptoPokerGame.moves` still call these same functions.

- [ ] **Step 2: Smoke import from a scratch test file**

```typescript
import {
  createCryptoInitialState,
  encryptDeck,
  shuffleEncryptedDeck,
} from "./crypto";
```

- [ ] **Step 3: Run existing poker tests (no regression)**

```bash
yarn workspace @manamesh/poker test
```

Expected: all existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/poker/src/crypto.ts
git commit -m "test(poker): export mental-poker workflow handlers for adversarial suite"
```

---

### Task 2: Primitive privacy negatives in boardgameio-crypto (M1–M3)

**Files:**
- Create: `packages/boardgameio-crypto/src/mental-poker/sra.privacy.test.ts`

**Why:** Pin the crypto claim independent of poker wiring so a future poker stub cannot hide behind “SRA unit tests only checked happy path.”

- [ ] **Step 1: Write failing tests that attack single-key recovery**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeyPair,
  encrypt,
  decrypt,
  encryptDeck,
  reencryptDeck,
  decryptToCardId,
  buildCardPointLookup,
  getCardPoint,
} from "./sra";

describe("SRA privacy (adversarial)", () => {
  let keyA: ReturnType<typeof generateKeyPair>;
  let keyB: ReturnType<typeof generateKeyPair>;

  beforeAll(() => {
    keyA = generateKeyPair();
    keyB = generateKeyPair();
  });

  it("M1: ciphertext is not the plaintext card id or point", async () => {
    const cardId = "ace-of-spades";
    const point = await getCardPoint(cardId);
    const enc = encrypt(cardId, keyA.privateKey);
    expect(enc.ciphertext).not.toBe(cardId);
    expect(enc.ciphertext).not.toBe(point);
    expect(enc.layers).toBe(1);
  });

  it("M2: with two layers, holder of only keyA cannot recover card id", async () => {
    const cardIds = ["ace-spades", "king-hearts", "queen-diamonds"];
    const lookup = await buildCardPointLookup(cardIds);
    const cardId = "king-hearts";

    const layer1 = encrypt(cardId, keyA.privateKey);
    const layer2 = encrypt(layer1, keyB.privateKey);
    expect(layer2.layers).toBe(2);

    // Attacker A peels only their layer
    const peeledByA = decrypt(layer2, keyA.privateKey);
    expect(peeledByA.layers).toBe(1);
    // Still not plaintext recovery via decryptToCardId with A's key alone on full ciphertext
    expect(decryptToCardId(layer2, keyA.privateKey, lookup)).toBeNull();
    // After only A's peel, B's layer remains — still must not equal original point
    const original = await getCardPoint(cardId);
    expect(peeledByA.ciphertext).not.toBe(original);
  });

  it("M3: both keys recover original card id", async () => {
    const cardIds = ["ace-spades", "king-hearts"];
    const lookup = await buildCardPointLookup(cardIds);
    const cardId = "ace-spades";
    const original = await getCardPoint(cardId);

    let c = encrypt(cardId, keyA.privateKey);
    c = encrypt(c, keyB.privateKey);

    c = decrypt(c, keyB.privateKey);
    c = decrypt(c, keyA.privateKey);
    expect(c.layers).toBe(0);
    expect(c.ciphertext).toBe(original);

    // Or full path via decryptToCardId after peeling to one layer then last key
    let d = encrypt(cardId, keyA.privateKey);
    d = encrypt(d, keyB.privateKey);
    d = decrypt(d, keyA.privateKey);
    expect(decryptToCardId(d, keyB.privateKey, lookup)).toBe(cardId);
  });

  it("M2-deck: reencrypted deck unreadable with single key", async () => {
    const ids = ["c0", "c1", "c2", "c3"];
    const lookup = await buildCardPointLookup(ids);
    let deck = encryptDeck(ids, keyA.privateKey);
    deck = reencryptDeck(deck, keyB.privateKey);
    for (const card of deck) {
      expect(card.layers).toBe(2);
      expect(decryptToCardId(card, keyA.privateKey, lookup)).toBeNull();
      expect(decryptToCardId(card, keyB.privateKey, lookup)).toBeNull();
    }
  });
});
```

Adjust expectations to match actual `decryptToCardId` semantics (it may require exactly 1 layer — if so, assert explicitly that fully layered cards return null and that partial peel leaves non-matching point).

- [ ] **Step 2: Run**

```bash
yarn workspace @manamesh/boardgameio-crypto test src/mental-poker/sra.privacy.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/boardgameio-crypto/src/mental-poker/sra.privacy.test.ts
git commit -m "test(crypto): SRA privacy adversarial cases M1-M3"
```

---

### Task 3: Poker mental-poker harness (real keys + setup path)

**Files:**
- Create: `packages/poker/src/mentalPoker.harness.ts`

**Produces:** pure helpers used by workflow + privacy tests.

```typescript
import type { Ctx } from "boardgame.io";
import {
  createCryptoInitialState,
  encryptDeck,
  shuffleEncryptedDeck,
  // dealHoleCards if exported
} from "./crypto";
import {
  generateKeyPair,
  decrypt,
  decryptToCardId,
  buildCardPointLookup,
  type CryptoKeyPair,
} from "@manamesh/boardgameio-crypto/mental-poker";
import type { CryptoPokerState } from "./types";

export function mockCtx(playerID: string, numMoves = 0): Ctx { /* same pattern as crypto.adversarial.test.ts */ }

export type PlayerKeys = { id: string; keys: CryptoKeyPair };

/** Run keyExchange → encrypt all players → shuffle all players → deal (if auto). */
export async function runMentalPokerSetup(opts?: {
  numPlayers?: number;
  seedKeys?: boolean;
}): Promise<{
  G: CryptoPokerState;
  players: PlayerKeys[];
  lookup: Map<string, string>;
}> {
  // 1. createCryptoInitialState
  // 2. For each player: generateKeyPair (or deterministic seed for debug)
  // 3. Phase keyExchange: submitPublicKey for each (export if needed)
  // 4. Phase encrypt: encryptDeck(G, mockCtx(id), id, sk) in setup order
  // 5. Phase shuffle: shuffleEncryptedDeck(...) until deal triggers
  // 6. Assert deck/hands have layers === numPlayers
  // 7. Return G + keys + lookup from G.cardIds
}

/** Try to recover a card id using only a subset of private keys (peel in any order). */
export function tryRecoverWithKeys(
  card: { ciphertext: string; layers: number },
  keys: string[],
  lookup: Map<string, string>,
): string | null {
  // Peel with each key once (or all permutations if small);
  // return decryptToCardId result only if layers reach 0 / id found; else null
}

export function assertNoPrivateKeysInSharedState(G: CryptoPokerState): void {
  // JSON.stringify(G) must not contain any player privateKey strings
}
```

Implementation notes:
- Read `encryptDeck` / `submitPublicKey` / shuffle completion in `crypto.ts` to match phase transitions exactly.
- If `submitPublicKey` is not exported, export it (Task 1 scope).
- `dealHoleCards` runs inside last shuffle — harness should not reimplement deal; call shuffle until phase leaves setup.

- [ ] **Step 1: Implement harness against live `crypto.ts`.**

- [ ] **Step 2: Tiny self-check in workflow test file (Task 4) that setup returns layered hands.**

- [ ] **Step 3: Commit**

```bash
git add packages/poker/src/mentalPoker.harness.ts packages/poker/src/crypto.ts
git commit -m "test(poker): mental-poker setup harness with real SRA keys"
```

---

### Task 4: Workflow correctness tests (M4, M7, M10, M11)

**Files:**
- Create: `packages/poker/src/mentalPoker.workflow.test.ts`
- Uses: `mentalPoker.harness.ts`

- [ ] **Step 1: Write tests**

```typescript
describe("Mental poker workflow (honest path)", () => {
  it("M4: setup produces N-layer encrypted deck then deals hole zones", async () => {
    const { G, players } = await runMentalPokerSetup({ numPlayers: 2 });
    expect(players).toHaveLength(2);

    const deck = G.crypto.encryptedZones["deck"];
    // After deal, deck has fewer cards; hole zones exist
    expect(G.crypto.encryptedZones["hand:0"]?.length).toBe(2);
    expect(G.crypto.encryptedZones["hand:1"]?.length).toBe(2);
    for (const c of G.crypto.encryptedZones["hand:0"]!) {
      expect(c.layers).toBe(2);
    }
    // Phase should be preflop (or post-setup betting)
    expect(["preflop", "flop", "play"]).toContain(G.phase); // match actual
  });

  it("M10: private keys are not in shared G", async () => {
    const { G, players } = await runMentalPokerSetup();
    assertNoPrivateKeysInSharedState(G);
    for (const p of players) {
      expect(JSON.stringify(G)).not.toContain(p.keys.privateKey);
    }
  });

  it("M11: after encrypt+shuffle, layers still equal numPlayers", async () => {
    // If harness can snapshot mid-shuffle, assert layers never drop due to shuffle
    // quickShuffle must not strip layers
  });

  it("M7: cooperative decrypt of own hole card recovers a deck card id", async () => {
    const { G, players, lookup } = await runMentalPokerSetup();
    const [p0, p1] = players;
    const card = { ...G.crypto.encryptedZones["hand:0"]![0] };

    // Peel with both keys (order B then A)
    let cur = decrypt(card, p1.keys.privateKey);
    cur = decrypt(cur, p0.keys.privateKey);
    expect(cur.layers).toBe(0);
    // Map point → card id via lookup built from G.cardIds
    const id = [...lookup.entries()].find(([, pt]) => pt === cur.ciphertext)?.[0];
    expect(id).toBeDefined();
    expect(G.cardIds).toContain(id);
  });
});
```

- [ ] **Step 2: Run**

```bash
yarn workspace @manamesh/poker test src/mentalPoker.workflow.test.ts
```

- [ ] **Step 3: If deal/phase differs from expectations, fix harness only (not weaken asserts to match stubs).**

- [ ] **Step 4: Commit**

```bash
git add packages/poker/src/mentalPoker.workflow.test.ts
git commit -m "test(poker): mental-poker honest workflow M4 M7 M10 M11"
```

---

### Task 5: Privacy adversarial tests (M2, M5, M6, M8, M9)

**Files:**
- Create: `packages/poker/src/mentalPoker.privacy.adversarial.test.ts`
- Uses: harness + exported `peekHoleCards` / `approveDecrypt` / `submitDecryptedShare`

- [ ] **Step 1: Cross-hand and deck peeks**

```typescript
describe("Mental poker privacy (adversarial)", () => {
  it("M5: player1 cannot recover hand:0 with only their private key", async () => {
    const { G, players, lookup } = await runMentalPokerSetup();
    const attacker = players[1];
    for (const card of G.crypto.encryptedZones["hand:0"]!) {
      expect(tryRecoverWithKeys(card, [attacker.keys.privateKey], lookup)).toBeNull();
      // Also: peeling only attacker key leaves layers >= 1 and point not in lookup as full id
      const peeled = decrypt(card, attacker.keys.privateKey);
      expect(peeled.layers).toBeGreaterThan(0);
    }
  });

  it("M6: undealt deck cards unreadable with single key", async () => {
    const { G, players, lookup } = await runMentalPokerSetup();
    const deck = G.crypto.encryptedZones["deck"] ?? [];
    expect(deck.length).toBeGreaterThan(0);
    for (const card of deck) {
      expect(tryRecoverWithKeys(card, [players[0].keys.privateKey], lookup)).toBeNull();
      expect(tryRecoverWithKeys(card, [players[1].keys.privateKey], lookup)).toBeNull();
    }
  });

  it("M5b: approveDecrypt of opponent hand with only self-share does not complete reveal", async () => {
    // Create decrypt request for hand:0; player1 submits only their peel
    // Assert request not completed / hand:0 still layered / peekedCards empty for player0
  });

  it("M8: peekHoleCards for player0 only targets hand:0", async () => {
    // Call exported peekHoleCards; inspect decryptRequests[0].zoneId === 'hand:0'
  });

  it("M9: garbage share on opponent zone is INVALID_MOVE and does not reduce layers in zone", async () => {
    // Snapshot hand:1 layers; submitDecryptedShare with bad ciphertext; assert INVALID_MOVE + layers unchanged
  });

  it("M2+M7 consistency: full key set recovers; any singleton fails", async () => {
    const { G, players, lookup } = await runMentalPokerSetup();
    const card = G.crypto.encryptedZones["hand:1"]![0];
    expect(tryRecoverWithKeys(card, [players[0].keys.privateKey], lookup)).toBeNull();
    expect(tryRecoverWithKeys(card, [players[1].keys.privateKey], lookup)).toBeNull();
    const both = tryRecoverWithKeys(
      card,
      [players[0].keys.privateKey, players[1].keys.privateKey],
      lookup,
    );
    expect(both).not.toBeNull();
    expect(G.cardIds).toContain(both!);
  });
});
```

- [ ] **Step 2: Run**

```bash
yarn workspace @manamesh/poker test src/mentalPoker.privacy.adversarial.test.ts
```

- [ ] **Step 3: If a test fails due to a real product bug (e.g. plaintext deal), fix production code in `crypto.ts` and re-run — do not delete the test.**

- [ ] **Step 4: Commit**

```bash
git add packages/poker/src/mentalPoker.privacy.adversarial.test.ts packages/poker/src/crypto.ts
git commit -m "test(poker): mental-poker privacy adversarial M5-M9"
```

---

### Task 6: Cooperative reveal path through poker moves (integration)

**Files:**
- Modify: `packages/poker/src/mentalPoker.workflow.test.ts` (or new `mentalPoker.coopReveal.test.ts`)

**Goal:** Honest player peeks own hand via **move handlers**, not manual double-decrypt only.

- [ ] **Step 1: Integration test**

1. `runMentalPokerSetup()`
2. Mark betting complete so peek is allowed
3. `peekHoleCards(G, mockCtx("0"), "0")` → creates pending request for `hand:0`
4. For each layer/player, local `decrypt(...)` then `approveDecrypt` / share submission as production UI would
5. Assert `G.players["0"].peekedCards` length 2 and ids ∈ `G.cardIds`
6. Assert `G.players["1"].peekedCards` still empty

- [ ] **Step 2: Run full poker package tests**

```bash
yarn workspace @manamesh/poker test
yarn workspace @manamesh/boardgameio-crypto test
```

- [ ] **Step 3: Commit**

```bash
git commit -am "test(poker): cooperative own-hand reveal via real moves"
```

---

### Task 7: Optional 3-player stretch (M12)

**Files:** harness + privacy tests with `numPlayers: 3`

- [ ] **Step 1:** Only after 2p suite is green.
- [ ] **Step 2:** Assert any 1-key and any 2-key subset fails full recovery; all 3 succeed.
- [ ] **Step 3:** Commit if implemented; else document as residual in ADVERSARIAL_TESTS.md.

---

### Task 8: Documentation

**Files:**
- Modify: `packages/poker/docs/ADVERSARIAL_TESTS.md`
- Modify: `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md`
- Modify: `packages/poker/README.md` (one line under testing)

**ADVERSARIAL_TESTS.md section:**

```markdown
## Mental poker workflow & privacy (M1–M12)

| ID | Claim | Test file |
|----|-------|-----------|
| M1–M3 | Primitive privacy | boardgameio-crypto sra.privacy.test.ts |
| M4,M7,M10,M11 | Poker setup workflow | mentalPoker.workflow.test.ts |
| M5,M6,M8,M9 | Privacy adversarial | mentalPoker.privacy.adversarial.test.ts |
...
```

Residual: transport MITM, true ZK shuffle, network observation of timing, etc.

- [ ] **Step 1: Write docs.**
- [ ] **Step 2: Final verification**

```bash
yarn workspace @manamesh/boardgameio-crypto test
yarn workspace @manamesh/poker test
```

Expected: zero failures; new mental-poker files all green.

- [ ] **Step 3: Commit**

```bash
git add packages/poker/docs packages/poker/README.md
git commit -m "docs(poker): mental-poker adversarial threat map M1-M12"
```

---

## Acceptance criteria (plan complete when)

- [ ] **M1–M3** green on real SRA primitives (single-key cannot recover; full keys can).
- [ ] **M4** green: poker setup uses real encrypt/reencrypt/shuffle/deal; hole cards have `layers === numPlayers`.
- [ ] **M5–M6** green: attacker with only own key cannot recover opponent hole cards or undealt deck cards.
- [ ] **M7** green: cooperative full peel recovers valid card ids from dealt hole cards.
- [ ] **M8–M9** green: peek zone binding + invalid shares rejected without state corruption.
- [ ] **M10** green: private keys absent from shared `G`.
- [ ] **M11** green: shuffle does not strip encryption layers.
- [ ] No test reimplements production abort/encrypt bodies; handlers are exported production functions.
- [ ] `yarn workspace @manamesh/poker test` and `boardgameio-crypto` tests pass.
- [ ] Docs list M-threats → tests.

## Suggested order

1 → 2 → 3 → 4 → 5 → 6 → 8 (7 optional)

## Notes for implementers

- Existing `crypto.adversarial.test.ts` (C1–C4) stays; this suite is **orthogonal** (workflow + privacy, not only move identity).
- If `decryptToCardId` requires `layers === 1`, structure peels accordingly and document in test comments.
- Prefer deterministic `generateKeyPair(seed)` for debug reproducibility where API supports seeds.
- If honest path is broken (e.g. deal of plaintext), **fix `crypto.ts` first** — that is the value of this suite.
- Do not mark settlement deployment TASK.md complete; this is crypto correctness only.

## Out of scope

- Browser multi-tab P2P e2e
- On-chain hand verifier card binding to mental-poker commitments
- Replacing quickShuffle with true ZK shuffle proofs
- Performance benchmarks
