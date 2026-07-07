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

