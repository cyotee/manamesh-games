---
name: manamesh-crypto
description: This skill should be used when the user asks about "cryptographic primitives", "SRA encryption", "Shamir secret sharing", "Merkle tree", "mental poker", "threshold cryptography", "EC ElGamal", "Paillier", "DLEQ proofs", " Feldman DKG", "ECDSA", "Go Fish crypto", "key escrow", "shuffle proof", or needs to understand how ManaMesh implements provably fair play.
---

# ManaMesh Cryptographic Primitives

## Conceptual Overview

ManaMesh demonstrates three cryptographic paradigms for provably fair P2P play:

1. **Mental Poker (SRA)** — Commutative encryption for card games with hidden shuffled decks
2. **Commitment Schemes (Merkle)** — Binding commitments for verifiable board placement
3. **Threshold Homomorphic Encryption** — Aggregate computations with threshold decryption

All primitives live in `packages/frontend/src/crypto/` and are re-exported from `src/crypto/index.ts`.

## Mental Poker (SRA Commutative Encryption)

### Core File: `src/crypto/mental-poker/sra.ts`

Implements SRA (Shamir-Rivest-Adleman) commutative encryption over secp256k1 elliptic curves. Each player encrypts the deck with their own key. Cards can only be decrypted when ALL encryption layers are removed cooperatively.

**Key functions:**

- `generateKeyPair()` → `{ publicKey, privateKey }` — creates EC key pair
- `encrypt(plaintext: bigint, publicKey: Point, r?: Scalar) → Ciphertext` — encrypts a card
- `decrypt(ciphertext: Ciphertext, privateKey: Scalar) → bigint` — removes one encryption layer
- `encryptDeck(cards: bigint[], publicKey: Point) → EncryptedDeck` — batch encrypt entire deck
- `decryptDeck(deck: EncryptedDeck, privateKey: Scalar) → EncryptedDeck` — removes one layer
- `reencryptDeck(deck: EncryptedDeck, privateKey: Scalar) → EncryptedDeck` — re-encrypt for shuffling
- `verifyCommutative(plaintext, pubKey, privKey)` — verifies encrypt→decrypt round-trip

### Commitment: `src/crypto/mental-poker/commitment.ts`

Deck commitment helpers for verifiable shuffle without revealing:

- `generateNonce()` → string — creates random salt
- `serializeDeck(deck: EncryptedDeck)` → string
- `createCommitment(deck: EncryptedDeck, nonce: string)` → `DeckCommitment`
- `verifyCommitment(deck: EncryptedDeck, commitment: DeckCommitment, nonce: string)` → boolean
- `hashDeck(deck: EncryptedDeck)` → string — deterministic deck hash

### Shuffle Proof: `src/crypto/mental-poker/shuffle-proof.ts`

Commit-and-reveal shuffle verification (not a true ZK proof — code comments note this):

- `createShuffleProof(oldDeck, newDeck, permutation, privateKey)` → `ShuffleProof`
- `verifyShuffleProof(oldDeck, newDeck, proof, publicKey)` → boolean
- `shuffleWithProof(deck, privateKey)` — combines shuffle + proof generation

### Plugin Integration: `src/crypto/plugin/crypto-plugin.ts`

boardgame.io plugin that wraps mental poker primitives into game API:

```typescript
createPlayerCryptoContext(playerIndex, keyPair); // Initialize player crypto
createPlayerCryptoContextFromWallet(playerIndex); // Initialize from wallet
generateStandard52CardIds(); // Standard 52-card deck IDs
```

**Types exported:** `CryptoPluginState`, `CryptoPluginApi`, `CryptoPlayerContext`, `SerializedCommitment`, `SerializedShuffleProof`

## Shamir's Secret Sharing (`src/crypto/shamirs/`)

For key escrow and abandonment recovery. If a player abandons, remaining players can reconstruct their key after a threshold is met.

**Files:**

- `shamirs/types.ts` — `SecretShare`, `KeyShare`, `SplitResult`, `ShamirConfig`
- `shamirs/split.ts` — `splitSecret`, `validateShare`, `createKeyShares`
- `shamirs/reconstruct.ts` — `reconstructSecret`, `canReconstruct`, `reconstructKeyFromShares`

**Constants:** `PRIME` — large prime for field arithmetic

**Usage pattern:**

```typescript
const { shares, commitments } = createKeyShares(secret, threshold, totalShares);
const recovered = reconstructKeyFromShares(shares.slice(0, threshold));
```

Used by: War, Poker, Go Fish (for key escrow in `keyEscrow` phase)

## Merkle Tree (`src/crypto/merkle.ts`)

SHA-256 based Merkle tree for Merkle Battleship board commitments:

- `merkleRoot(items: Uint8Array[])` → `Uint8Array` — compute tree root
- `merkleRootHex(items: string[])` → `string` — hex version
- `merkleProof(items: Uint8Array[], index: number)` → `MerkleProofStep[]` — sibling hashes
- `verifyMerkleProof(item, proof: MerkleProofStep[], root)` → boolean

**Leaf hashing for battleship:** `SHA256(utf8("${gameId}|${playerId}|${cellIndex}|${bit}|") || saltBytes)` where bit is 0 (water) or 1 (ship)

## Threshold Homomorphic Encryption

### secp256k1 Helpers (`src/crypto/secp256k1.ts`)

Low-level secp256k1 arithmetic — foundation for EC ElGamal, DLEQ, Feldman DKG:

- `secpModN`, `secpInvN` — modular arithmetic
- `secpBaseMulHex(scalarHex)` — G \* scalar
- `secpPointAddHex(p1, p2)` — point addition
- `secpPointMulHex(point, scalar)` — point multiplication
- `secpLagrangeCoeffAt0(indices, myIndex)` — Lagrange interpolation coefficient

### EC ElGamal (`src/crypto/ec-elgamal-exp.ts`)

EC ElGamal with message-in-exponent encoding (small integers only):

- `elgamalEncryptExp(message: bigint, pubKey: Point, r?: Scalar)` → `ElGamalCiphertext`
- `elgamalAdd(c1: Ciphertext, c2: Ciphertext)` → `Ciphertext` — homomorphic add
- `elgamalPartialDecrypt(ciphertext, privateShare)` → `Point` — threshold partial decrypt
- `elgamalCombinePartials(ciphertext, partials: Point[])` → `Point` — combine to get message
- `elgamalDecodeSmallMessage(point)` → `bigint` — decode message from point

### Feldman DKG (`src/crypto/feldman-dkg.ts`)

Feldman Verifiable Secret Sharing for distributed key generation:

- `dkgMakeDealerSecrets(dealerIndex, threshold)` → `DkgDealerSecrets`
- `dkgEvaluateShare(share: SecretShare, receiverIndex)` → `{value: SecpScalarHex, commitment: SecpPointHex}`
- `dkgVerifyShare(share, commitment, dealerPubKey)` → boolean
- `dkgCombineCommitments(commitments: DkgCommitment[])` → `SecpPointHex` — combine to public key
- `dkgPublicShareFromPrivateShare(privateShare, publicKey)` — compute public share

### DLEQ Proofs (`src/crypto/dleq.ts`)

Chaum-Pedersen DLEQ proofs for proving equivalence of discrete logs:

- `dleqProve({g, h, G, H, x})` → `DleqProof` — prove `log_g(G) = log_h(H)`
- `dleqVerify({g, h, G, H, proof})` → boolean

Used by Threshold Tally to verify partial decryption validity.

## Other Primitives

### ECDSA (`src/crypto/ecdsa.ts`)

secp256k1 ECDSA for Go Fish ZK verdict signing:

- `ecdsaGenerateKeyPair(seed?)` → `EcdsaKeyPair`
- `ecdsaSignDigestHex(digestHex, privateKeyHex)` → `string` — signature
- `ecdsaVerifyDigestHex(digestHex, signatureHex, publicKeyHex)` → boolean

### SHA-256 (`src/crypto/sha256.ts`)

Synchronous SHA-256 for boardgame.io compatibility (no async SubtleCrypto):

- `sha256(data: Uint8Array)` → `Uint8Array`
- `sha256Hex(str: string)` → `string`
- `bytesToHex`, `hexToBytes`, `concatBytes` — utility helpers

### Stable JSON (`src/crypto/stable-json.ts`)

Canonical JSON serialization for deterministic hashing/signing:

- `stableStringify(value: unknown)` → `string` — deterministic JSON

### Paillier (`src/crypto/paillier.ts`) — Demo Only

Additive homomorphic encryption demo for HE Battleship:

- `paillierGenerateKeypair(bits?)` → `{publicKey, privateKey}`
- `paillierEncrypt(message: bigint, publicKey)` → `Ciphertext`
- `paillierDecrypt(ciphertext, privateKey)` → `bigint`
- `paillierAdd(c1, c2)` — homomorphic add
- `paillierScalarMul(c, scalar)` — homomorphic scalar multiply

**Note:** Demo-quality key sizes, not production-grade.

## Which Game Uses Which Primitive

| Game                   | Primitives Used                                                |
| ---------------------- | -------------------------------------------------------------- |
| War                    | SRA (mental-poker), Shamir (key escrow)                        |
| Poker                  | SRA, Shamir                                                    |
| Go Fish (all variants) | SHA-256 (shuffle seed), ECDSA (zk-attest verdict sigs), Shamir |
| Merkle Battleship      | Merkle tree, SHA-256                                           |
| HE Battleship          | Paillier (demo)                                                |
| Threshold Tally        | secp256k1, EC ElGamal, Feldman DKG, DLEQ                       |

## Important Constraints / Gotchas

- **Mental poker shuffle proof is NOT a true ZK proof** — it's a commit-and-reveal scheme. Code comments explicitly note this.
- **SRA uses try-and-increment hash-to-curve** — synchronous placeholder, not production `hash_to_curve`. Production contracts should use proper hash-to-curve.
- **Paillier & Feldman DKG are demo-quality** — reduced key sizes for browser feasibility, not production.
- **Go Fish ZK circuits are placeholder** — signing/verification infrastructure is wired but actual ZK circuit proofs are not generated.
- **Paillier is synchronous** — all operations are synchronous to work with boardgame.io's sync move model.

## Key Files

```
packages/frontend/src/crypto/index.ts                           # Main re-export entry
packages/frontend/src/crypto/mental-poker/sra.ts               # SRA encryption
packages/frontend/src/crypto/mental-poker/commitment.ts         # Deck commitment
packages/frontend/src/crypto/mental-poker/shuffle-proof.ts       # Shuffle proof
packages/frontend/src/crypto/mental-poker/types.ts               # Mental poker types
packages/frontend/src/crypto/plugin/crypto-plugin.ts             # boardgame.io plugin
packages/frontend/src/crypto/shamirs/split.ts                   # Shamir split
packages/frontend/src/crypto/shamirs/reconstruct.ts             # Shamir reconstruct
packages/frontend/src/crypto/shamirs/types.ts                    # Shamir types
packages/frontend/src/crypto/merkle.ts                          # Merkle tree
packages/frontend/src/crypto/secp256k1.ts                      # secp256k1 helpers
packages/frontend/src/crypto/ec-elgamal-exp.ts                 # EC ElGamal
packages/frontend/src/crypto/feldman-dkg.ts                    # Feldman DKG
packages/frontend/src/crypto/dleq.ts                           # DLEQ proofs
packages/frontend/src/crypto/ecdsa.ts                          # ECDSA
packages/frontend/src/crypto/paillier.ts                        # Paillier demo
packages/frontend/src/crypto/sha256.ts                         # SHA-256
packages/frontend/src/crypto/stable-json.ts                    # Stable JSON
```

## See Also

- `skill:manamesh-game-modules` — How games use these primitives
- `skill:manamesh-contracts` — On-chain settlement (GameVault uses EIP-712 signatures)
