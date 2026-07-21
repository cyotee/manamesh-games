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

