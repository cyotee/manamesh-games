---
name: boardgameio-crypto
description: >
  How to use @manamesh/boardgameio-crypto for mental poker, keychain admission,
  cooperative decrypt, and P2P-safe boardgame.io moves. Use when implementing
  or reviewing "mental poker", "SRA", "keychain", "submitPublicKey", "encryptDeck",
  "cooperative decrypt", "preEncrypted", "private key in move", "shuffle proof",
  "Shamir escrow", "CryptoPlugin", "@manamesh/boardgameio-crypto", Timestreams/Poker/Mistborn
  crypto, or any boardgame.io multiplayer crypto path. Prevents shipping private
  keys over multiplayer and misusing the keychain.
---

# @manamesh/boardgameio-crypto — Agent Guide

**Package:** `packages/boardgameio-crypto`  
**Import root:** `@manamesh/boardgameio-crypto`  
**Leaf package** — no dependency on frontend or game modules.

Read this before adding crypto to any ManaMesh game (Poker, Timestreams, Mistborn, One Piece, War, Go Fish, …).

---

## Hard rules (do not violate)

1. **Never put private keys in shared boardgame.io state `G`.**
2. **Never put private keys in multiplayer move arguments.**  
   With `client: false`, move args go to the master and often to peers.  
   Ship **ciphertexts / peels / commitments** only.
3. **Never put game phases / INVALID_MOVE / boardgame.io into the crypto package.**  
   Crypto = pure math + policies. Games map failures to `INVALID_MOVE`.
4. **Publish public keys via the keychain** (`MENTAL_POKER_KEYCHAIN_POLICY` for multi-party SRA tables).
5. **Bind encrypt sk to published pk on the client** before submitting layers (`requirePrivateKeyMatchesPublished` / `prepareEncryptionLayer`).
6. **`decryptToCardId` requires exactly one layer left** — progressive peels only; do not call it on N-layer cards.

If a change needs both a production encrypt and a test path:  
**client prepare → move(preEncrypted)** for multiplayer; **in-process privateKey-only** is offline/tests only and must be documented.

---

## Package map

| Import | Use for |
|--------|---------|
| `@manamesh/boardgameio-crypto/mental-poker` | SRA: `generateKeyPair`, `encrypt`/`decrypt`, `encryptDeck`/`reencryptDeck`, commitments, shuffle helpers |
| `@manamesh/boardgameio-crypto/keychain` | Public-key registry + admission policy (GPG-style) |
| `@manamesh/boardgameio-crypto/plugin` or `.../plugin/crypto-plugin` | boardgame.io plugin wrapper (`CryptoPluginState`, plugin API) |
| `@manamesh/boardgameio-crypto/secp256k1` | Points, `validateEncryptedCard`, `validatePlayerIdentity` |
| `@manamesh/boardgameio-crypto/shamirs` | Key escrow shares |
| `@manamesh/boardgameio-crypto` | Setup helpers: `getCurrentSetupPlayer`, `advanceSetupPlayer`, `resetSetupPlayer`, hash utils |

Docs in-package: `packages/boardgameio-crypto/README.md`, `src/keychain/README.md`.

---

## Architecture: what lives where

```
┌──────────────────────────────────────────────┐
│  boardgameio-crypto (pure)                   │
│  keychain, SRA, peels, validate*, Shamir     │
│  NO phases, NO INVALID_MOVE, NO player seats │
└──────────────────────────────────────────────┘
                    ▲ call pure APIs
┌──────────────────────────────────────────────┐
│  Game package (poker / timestreams / …)      │
│  phases, moves, INVALID_MOVE, G.crypto       │
│  map keychain reject → INVALID_MOVE          │
└──────────────────────────────────────────────┘
                    ▲ prepare* with local sk
┌──────────────────────────────────────────────┐
│  Board / client                              │
│  hold sk in React ref / local storage        │
│  prepareEncryptionLayer → moves.*(null, CT)  │
└──────────────────────────────────────────────┘
```

---

## Keychain (public keys only)

### Policies

| Policy | When |
|--------|------|
| `MENTAL_POKER_KEYCHAIN_POLICY` / `STRICT_KEYCHAIN_POLICY` | Multi-party SRA tables (default) |
| `PERMISSIVE_KEYCHAIN_POLICY` | Import-style: allow replace / shared keys (rare) |

Strict defaults: valid **finite** secp256k1 points, normalize compressed, one key per owner id, **no two seats share the same public key**, no replace.

### Key exchange move (game)

```ts
import {
  keychainFromRecord,
  keychainAdd,
  MENTAL_POKER_KEYCHAIN_POLICY,
} from "@manamesh/boardgameio-crypto/keychain";

// Build prior registry from already-admitted public keys only
const prior = keychainFromRecord(G.crypto.publicKeys ?? {}, MENTAL_POKER_KEYCHAIN_POLICY);
const result = keychainAdd(prior, playerId, publicKey, MENTAL_POKER_KEYCHAIN_POLICY);
if (!result.ok) return INVALID_MOVE; // reason: invalid_curve | duplicate_key | duplicate_id | …

player.publicKey = result.entry.publicKey;           // canonical compressed
G.crypto.publicKeys[playerId] = result.entry.publicKey;
G.crypto.keychain = result.keychain;                 // optional snapshot
```

**Reject:** empty strings, `"not-a-point"`, infinity (`00`), duplicate pubkeys across seats, second submit for same seat (unless policy allows replace).

### Encrypt-time binding (client, not on the wire)

```ts
import { requirePrivateKeyMatchesPublished } from "@manamesh/boardgameio-crypto/keychain";

// Local only — before building preEncrypted
if (!requirePrivateKeyMatchesPublished(privateKey, player.publicKey)) {
  throw new Error("private_key_does_not_match_published_public_key");
}
```

Reference helpers (Timestreams):

- `prepareEncryptionLayer(G, playerId, privateKey)` → preEncrypted  
- `prepareDeckOpReencryptLayer(G, playerId, privateKey)` → layer  
- Move: `encryptDeck(null, preEncrypted)` / `submitDeckOpReencrypt(null, layer)`

---

## Mental poker (SRA) — correct flow

1. **Key exchange** — each seat submits **public** key via keychain.  
2. **Encrypt** — each seat adds one layer with **their** sk (client-side), submits **ciphertexts**.  
3. **Shuffle** — permute encrypted cards (layers must stay N).  
4. **Deal** — move encrypted cards into hand/community zones (still N layers).  
5. **Cooperative reveal** — progressive peels: each peer peels **current** zone card with their sk; share is an `EncryptedCard` with fewer layers; complete only when `layers === 0` and all required shares present.

### Peels and card IDs

```ts
import { decrypt, decryptToCardId } from "@manamesh/boardgameio-crypto/mental-poker";
import { validateEncryptedCard } from "@manamesh/boardgameio-crypto/secp256k1";

// Progressive: decrypt(card, myPrivateKey) → EncryptedCard with layers - 1
// Final: only when layers === 1 before last peel, or layers === 0 ciphertext maps via cardPointLookup
if (!validateEncryptedCard(share)) return INVALID_MOVE;
```

**Privacy:** subset of keys must not recover opponent hole cards; full key set recovers multiset of deck.

### Identity on moves

```ts
import { validatePlayerIdentity } from "@manamesh/boardgameio-crypto/secp256k1";

if (!validatePlayerIdentity(ctx.playerID, playerId)) return INVALID_MOVE;
```

---

## Multiplayer move patterns

### ✅ Correct

```ts
// Board (client)
const preEncrypted = prepareEncryptionLayer(G, playerID, localKeyPair.privateKey);
moves.encryptDeck(null, preEncrypted); // ciphertexts only

// Cooperative peel (client)
const peeled = decrypt(zoneCard, localKeyPair.privateKey);
moves.submitDecryptedShare(requestId, peeled); // or approveDecrypt with peels[]
```

### ❌ Wrong (agent footguns we already hit)

| Anti-pattern | Why |
|--------------|-----|
| `moves.encryptDeck(privateKey)` or `(sk, preEncrypted)` on P2P | sk leaves the machine |
| `G.players[id].privateKey = sk` | shared state leak |
| Store raw invalid pubkey without keychain | no curve check, no uniqueness |
| Assume `submitPublicKey` validates by itself | must call `keychainAdd` (or plugin that uses it) |
| Call `decryptToCardId` on multi-layer cards | API requires one layer |
| Complete coop decrypt on approvals only | require real peels + full peel to `layers === 0` |
| Put keychain uniqueness logic inside pure SRA | policy belongs in keychain; seats belong in the game |
| Treat shuffle “proof” as ZK | commit-reveal / integrity helpers only today |

---

## CryptoPlugin notes

`CryptoPlugin.api().submitPublicKey` admits under `MENTAL_POKER_KEYCHAIN_POLICY` and stores **normalized** compressed keys. Rejects throw `Error("keychain_reject:…")`. Games that need `INVALID_MOVE` should call `keychainAdd` themselves (Poker pattern).

Optional field: `CryptoPluginState.keychain` snapshot.

---

## Checklist for a new mental-poker game

- [ ] Depend on `@manamesh/boardgameio-crypto` (workspace)  
- [ ] Key exchange uses `keychainAdd` + `MENTAL_POKER_KEYCHAIN_POLICY`  
- [ ] Public keys stored canonical; private keys only in client ref  
- [ ] Encrypt: `prepare*` locally → move submits preEncrypted only  
- [ ] All sensitive moves: `client: false` + `validatePlayerIdentity`  
- [ ] Decrypt shares: `validateEncryptedCard` before mutating state  
- [ ] Coop complete only when all required peels present and `layers === 0`  
- [ ] Tests: invalid/duplicate pubkey rejected; wrong sk rejected **client-side**; multiplayer path asserts move args have **no** sk  
- [ ] Run `yarn workspace @manamesh/boardgameio-crypto test` after package changes  

---

## Reference consumers (canonical patterns)

| Package | Files |
|---------|--------|
| Poker | `packages/poker/src/crypto.ts` (keychain + sk binding on encrypt); `mentalPoker.harness.ts`; S10 tests |
| Timestreams | `packages/timestreams/src/crypto.ts` (`prepareEncryptionLayer`); `board/TimestreamsBoard.tsx` (null sk on moves) |
| Mistborn | `packages/mistborn-deckbuilder/src/crypto.ts` |

Adversarial index: `packages/poker/docs/ADVERSARIAL_TESTS.md`.

---

## Tests

```bash
yarn workspace @manamesh/boardgameio-crypto test
yarn workspace @manamesh/boardgameio-crypto test src/keychain
yarn workspace @manamesh/poker test src/mentalPoker.keyExchange
yarn workspace @manamesh/timestreams test src/crypto.test.ts
```

---

## See also

- `packages/boardgameio-crypto/src/keychain/README.md` — policy knobs  
- Root `CLAUDE.md` — monorepo layout; crypto is **not** under `packages/frontend/src/crypto`  
- `.opencode/skills/manamesh-crypto` — legacy overview; **paths there are stale** — prefer this skill  
- `skill:manamesh-game-modules` — how games plug into the platform  
