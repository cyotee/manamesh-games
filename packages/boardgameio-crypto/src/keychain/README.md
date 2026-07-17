# Keychain

GPG-style **public-key registry** with pluggable **admission policy**.

No game phases, no boardgame.io moves, no poker rules. Consumers supply opaque owner ids (seat, playerID, wallet, …) and a policy; the keychain only decides whether a key may enter and how it is stored.

## Concepts

| Term | Meaning |
|------|---------|
| **Keychain** | Immutable map `ownerId → { publicKey, fingerprint }` |
| **Policy** | Admission criteria (curve validity, uniqueness, replace) |
| **Fingerprint** | SHA-256 of normalized compressed public key bytes |
| **Normalize** | Store/compare compressed secp256k1 form |

## Named policies

- `STRICT_KEYCHAIN_POLICY` / `MENTAL_POKER_KEYCHAIN_POLICY` — valid finite points, one key per id, no shared keys across owners, no replace.
- `PERMISSIVE_KEYCHAIN_POLICY` — still validates curve; allows replace and shared keys (import-style).

## Usage (game move)

```ts
import {
  keychainFromRecord,
  keychainAdd,
  MENTAL_POKER_KEYCHAIN_POLICY,
} from "@manamesh/boardgameio-crypto/keychain";

const prior = keychainFromRecord(G.crypto.publicKeys, MENTAL_POKER_KEYCHAIN_POLICY);
const result = keychainAdd(prior, playerId, publicKey, MENTAL_POKER_KEYCHAIN_POLICY);
if (!result.ok) return INVALID_MOVE; // map reason → your error UX

G.crypto.publicKeys[playerId] = result.entry.publicKey; // canonical
G.crypto.keychain = result.keychain;
```

## Pure helpers

- `isValidSecp256k1PublicKey` / `normalizeSecp256k1PublicKey`
- `publicKeysEqual` / `publicKeyFingerprint`
- `privateKeyMatchesPublicKey` / `requirePrivateKeyMatchesPublished` — call from game `encryptDeck` so SRA layers use the sk that matches the published keychain pubkey

## Custom policy

```ts
keychainAdd(state, id, pk, {
  requireValidCurve: true,
  uniquePublicKeys: false, // allow two seats to publish the same key
  allowReplace: true,
});
```
