# Task 4 Report: One Piece mental-poker keychain + sk↔pk binding

**Status:** DONE  
**Date:** 2026-07-21  
**Commit:** `c6ed8f6` — `feat(onepiece): keychain admission and encrypt sk binding`

---

## Summary

Wired `@cyotee/boardgameio-crypto` keychain admission into One Piece crypto key exchange and bound encrypt-time private keys to published public keys. Invalid/duplicate pubkeys and mismatched sk are rejected with `INVALID_MOVE`. Canonical compressed pubkeys are stored on player + `G.crypto.publicKeys` (+ optional `G.crypto.keychain` snapshot). Private keys are never written to shared `G`.

---

## Files changed

| File | Change |
|------|--------|
| `packages/onepiece/src/crypto.ts` | Keychain imports; `submitPublicKey` admission + identity; `encryptDeck` sk↔pk binding + identity |
| `packages/onepiece/src/crypto.test.ts` | Adversarial keychain suite; happy-path canonical key expectations; mock `playerID` |
| `packages/onepiece/src/types.ts` | **No change** — `CryptoPluginState` already has optional `keychain?: KeychainState` |

---

## Implementation details

### `submitPublicKey`

1. Phase gate: `keyExchange` only  
2. `validatePlayerIdentity(ctx.playerID, playerId)`  
3. Idempotent same-key resubmit via `publicKeysEqual` → return `G`; different key for seat → `INVALID_MOVE`  
4. `keychainFromRecord` + `keychainAdd(..., MENTAL_POKER_KEYCHAIN_POLICY)`  
5. On reject (`invalid_curve`, `duplicate_key`, …) → `INVALID_MOVE`  
6. Store `admitted.entry.publicKey` (canonical compressed) on `player.publicKey`, `G.crypto.publicKeys[playerId]`, and `G.crypto.keychain`  
7. When all seats submitted → phase `encrypt` + `resetSetupPlayer`

### `encryptDeck`

1. Phase / turn-order / `hasEncrypted` checks (unchanged)  
2. `validatePlayerIdentity`  
3. `requirePrivateKeyMatchesPublished(privateKey, published)` where published is `player.publicKey ?? G.crypto.publicKeys[playerId]`  
4. On mismatch → `INVALID_MOVE` without setting `hasEncrypted`  
5. Encryption path unchanged; **does not store `privateKey` on G**

Documented in-code that sk-in-move is offline/unit-test path (same as Poker today). No `prepareEncryptionLayer` / preEncrypted overload added (YAGNI per brief).

---

## Tests

### Adversarial (new)

- Rejects invalid public key (`"not-a-point"` → keychain `invalid_curve`)  
- Rejects duplicate public key across seats (`duplicate_key`)  
- Stores canonical compressed public key  
- `encryptDeck` rejects sk that does not match published pk  

### Happy-path updates

- Expect stored keys via `normalizeSecp256k1PublicKey(...)`  
- Same-key resubmit is idempotent; different key for same seat rejected  
- Mock `Ctx` includes `playerID` for identity binding  

### Commands

```bash
yarn workspace @manamesh/onepiece test src/crypto.test.ts  # 11 passed
yarn workspace @manamesh/onepiece test                      # 238 passed (8 files)
```

---

## Known follow-ups (out of scope)

1. **Multiplayer sk on wire:** `encryptDeck` boardgame.io move still accepts `privateKey` with `client: false` (host/master path). Production should migrate to client-side `prepareEncryptionLayer` → `encryptDeck(null, preEncrypted)` when that overload exists. Documented same as Poker offline/test path; no refactor in this task.  
2. **UI/board:** Any board that submits sk via moves remains a known offline/test path until client prepare lands.  
3. **Noise:** Pre-existing vitest/web-worker stderr (`id` undefined) unrelated to this change.

---

## Hard rules compliance

| Rule | Status |
|------|--------|
| Never put private keys in shared G | ✅ |
| Keychain admits public keys only under MENTAL_POKER_KEYCHAIN_POLICY | ✅ |
| Use keychain + validatePlayerIdentity | ✅ |
| Canonical compressed public keys stored | ✅ |
| Only onepiece files in commit | ✅ (`crypto.ts`, `crypto.test.ts`) |
