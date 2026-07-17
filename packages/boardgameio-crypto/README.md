# @manamesh/boardgameio-crypto

Shared cryptographic primitives for ManaMesh's provably-fair P2P card games.

This is a **leaf package** — it has no dependencies on `@manamesh/frontend` or any
other in-tree package, so it can be consumed freely without import cycles.

## Consumers

- `@manamesh/frontend` — War, Go Fish, OnePiece, Threshold Tally, Battleship game modules.
- `@manamesh/poker` — mental-poker dealing + the EIP-712 settlement flow.

## Entry points

| Import | Contents |
|--------|----------|
| `@manamesh/boardgameio-crypto` | Barrel: re-exports everything below |
| `@manamesh/boardgameio-crypto/mental-poker` | SRA commutative encryption, commitment + shuffle proofs |
| `@manamesh/boardgameio-crypto/keychain` | GPG-style public-key registry + admission policies |
| `@manamesh/boardgameio-crypto/plugin/crypto-plugin` | boardgame.io crypto plugin |
| `@manamesh/boardgameio-crypto/merkle` | Merkle-tree commitments (Battleship) |
| `@manamesh/boardgameio-crypto/ec-elgamal-exp`, `/feldman-dkg`, `/dleq` | Threshold Tally primitives |
| `@manamesh/boardgameio-crypto/ecdsa`, `/secp256k1`, `/sha256`, `/stable-json` | Signing + hashing helpers |
| `@manamesh/boardgameio-crypto/paillier` | Paillier HE (HE Battleship) |
| `@manamesh/boardgameio-crypto/shamirs` | Shamir secret sharing (ECIES-encrypted) |
| `@manamesh/boardgameio-crypto/zk`, `/snarkjs-range` | snarkjs ZK helpers |

## Agent / integration skill

**Read before wiring crypto into a game:**  
`.grok/skills/boardgameio-crypto/SKILL.md` (also under `.opencode/skills/boardgameio-crypto/`).

Hard rules summarized there:

1. Never put private keys in shared `G` or multiplayer move args — submit **ciphertexts / peels** only.  
2. Admit public keys via **keychain** (`MENTAL_POKER_KEYCHAIN_POLICY` for multi-party SRA).  
3. Bind encrypt sk → published pk **on the client** (`prepareEncryptionLayer` / `requirePrivateKeyMatchesPublished`).  
4. Keep game phases / `INVALID_MOVE` in the game package; crypto stays pure.

## Test

```bash
yarn workspace @manamesh/boardgameio-crypto test
```

## Note on type-checking

This code was authored under `@manamesh/frontend`, which ships via esbuild and
never runs `tsc`. As a result the sources carry pre-existing latent strict-mode
type issues (e.g. `stable-json.ts` strict-null, a `BufferSource` lib-version
mismatch, a Groth16 duplicate re-export in the barrel) that were never enforced.
No standalone `typecheck` script is wired here yet, to match that origin
convention; cleaning up the latent type debt is tracked separately. Runtime
correctness is covered by the Vitest suite.
