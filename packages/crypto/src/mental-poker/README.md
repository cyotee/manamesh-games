# Mental Poker Cryptography

Cryptographic primitives for fair card games without a trusted dealer.

## Overview

Mental Poker allows players to play card games over a network without trusting each other or a central server. This implementation uses **SRA (Shamir-Rivest-Adleman) commutative encryption** on elliptic curves.

## Core Concept: Commutative Encryption

The key insight is that encryption layers can be removed in any order:

```
If Alice encrypts with key A, then Bob encrypts with key B:
  Enc_B(Enc_A(card))

Either can decrypt first:
  Dec_A(Dec_B(encrypted)) = Dec_B(Dec_A(encrypted)) = card
```

This means:
- Both players encrypt the deck
- Neither can read cards until both decrypt
- No trusted third party needed

## Components

### SRA Encryption (`sra.ts`)

Elliptic curve implementation of commutative encryption.

```typescript
import { generateKeyPair, encryptCard, decryptCard } from './sra';

// Generate keys
const { privateKey, publicKey } = generateKeyPair();

// Encrypt a card (card ID → curve point → encrypted point)
const encrypted = encryptCard('hearts-A', privateKey);
// encrypted = { point: '04abc...', layers: 1 }

// Re-encrypt with another key
const doubleEncrypted = reencryptCard(encrypted, privateKey2);
// doubleEncrypted = { point: '04def...', layers: 2 }

// Decrypt (removes one layer)
const partialDecrypted = decryptCard(doubleEncrypted, privateKey2);
// partialDecrypted = { point: '04abc...', layers: 1 }
```

**Implementation Details:**
- Uses secp256k1 curve (same as Bitcoin/Ethereum)
- Cards are hashed to curve points via try-and-increment
- Encryption: `encrypted = privateKey × point`
- Decryption: `decrypted = privateKey⁻¹ × encrypted`

### Shuffle Proofs (`shuffle-proof.ts`)

Verifiable shuffling to prevent cheating during deck randomization.

```typescript
import { shuffleWithProof, verifyShuffleProof } from './shuffle-proof';

// Shuffle with proof generation
const { shuffledDeck, proof, permutation, nonce } = await shuffleWithProof(deck);

// Later: verify the shuffle was valid
const isValid = await verifyShuffleProof(proof, originalDeck, shuffledDeck, nonce);
```

**Current Approach:** Commit-and-reveal (not full ZK)
1. Shuffler commits to permutation hash before shuffle
2. After game, permutation + nonce revealed for verification
3. Anyone can verify: `SHA-256(permutation || nonce) == commitment`

**Future Options:**
- Circom circuits for true zero-knowledge proofs
- Bayer-Groth shuffle arguments
- Neff shuffle proofs

### Commitments (`commitment.ts`)

Cryptographic commitments for binding players to choices.

```typescript
import { createCommitment, verifyCommitment, generateNonce } from './commitment';

// Commit to deck state
const nonce = generateNonce();
const commitment = await createCommitment(deck, nonce);

// Later: verify commitment
const isValid = await verifyCommitment(commitment, deck, nonce);
```

## Randomness Generation

Shuffles use the **Web Crypto API** for cryptographically secure randomness:

```typescript
function generatePermutation(length: number): Permutation {
  const perm = Array.from({ length }, (_, i) => i);

  for (let i = length - 1; i > 0; i--) {
    const randomBytes = new Uint8Array(4);
    crypto.getRandomValues(randomBytes);  // CSPRNG from OS
    const j = /* derive index */ % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  return perm;
}
```

### VRF Compatibility

The randomness source is abstracted and can be replaced with a **Verifiable Random Function** oracle (e.g., Chainlink VRF) for:

- Tournament play with public verifiability
- On-chain games requiring provable randomness
- Scenarios where browser CSPRNG trust is insufficient

See [War Game README](../../game/modules/war/README.md) for VRF integration details.

## Protocol Flow

```
1. KEY EXCHANGE
   ├─ Player A generates (privA, pubA)
   ├─ Player B generates (privB, pubB)
   └─ Exchange public keys

2. ENCRYPTION
   ├─ Deck: [card1, card2, ..., card52] (plain IDs)
   ├─ Player A encrypts all: layers = 1
   └─ Player B re-encrypts all: layers = 2

3. SHUFFLE (with proofs)
   ├─ Player A: shuffle + commit to permutation
   └─ Player B: shuffle + commit to permutation

4. DEAL
   └─ Distribute encrypted cards to zones

5. REVEAL (collaborative)
   ├─ To reveal card X:
   │   ├─ Player A decrypts: layers 2→1
   │   └─ Player B decrypts: layers 1→0
   └─ Lookup original card ID from curve point
```

## Security Properties

| Property | Guarantee |
|----------|-----------|
| **Confidentiality** | Cards unreadable until both decrypt |
| **Integrity** | Commitments bind players to actions |
| **Fairness** | Neither player controls deck order |
| **Verifiability** | Shuffle proofs validate randomization |

## Files

| File | Description |
|------|-------------|
| `types.ts` | Type definitions |
| `sra.ts` | SRA commutative encryption |
| `sra.test.ts` | SRA tests |
| `shuffle-proof.ts` | Shuffle proof generation/verification |
| `shuffle-proof.test.ts` | Shuffle proof tests |
| `commitment.ts` | Cryptographic commitments |
| `commitment.test.ts` | Commitment tests |
| `index.ts` | Module exports |

## Dependencies

- `elliptic` - Elliptic curve cryptography
- Web Crypto API - Hashing and random number generation

## References

- [Mental Poker (Wikipedia)](https://en.wikipedia.org/wiki/Mental_poker)
- [SRA Algorithm](https://en.wikipedia.org/wiki/Mental_poker#SRA_algorithm)
- [Shamir, Rivest, Adleman - Mental Poker (1981)](https://people.csail.mit.edu/rivest/pubs/SRA81.pdf)
