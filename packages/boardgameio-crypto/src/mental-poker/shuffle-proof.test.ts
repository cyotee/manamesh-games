import { describe, expect, it } from 'vitest';
import {
  generatePermutation,
  applyPermutation,
  isValidPermutation,
  invertPermutation,
  serializePermutation,
  deserializePermutation,
  commitPermutation,
  verifyPermutationCommitment,
  createShuffleProof,
  verifyShuffleProof,
  shuffleWithProof,
  quickShuffle,
} from './shuffle-proof';
import { generateNonce } from './commitment';
import type { EncryptedCard } from './types';

describe('Shuffle Proof', () => {
  // Test deck
  const testDeck: EncryptedCard[] = [
    { ciphertext: 'card0', layers: 1 },
    { ciphertext: 'card1', layers: 1 },
    { ciphertext: 'card2', layers: 1 },
    { ciphertext: 'card3', layers: 1 },
    { ciphertext: 'card4', layers: 1 },
  ];

  describe('generatePermutation', () => {
    it('generates permutation of correct length', () => {
      const perm = generatePermutation(10);
      expect(perm.length).toBe(10);
    });

    it('generates valid permutation', () => {
      const perm = generatePermutation(52);
      expect(isValidPermutation(perm)).toBe(true);
    });

    it('generates different permutations', () => {
      const perm1 = generatePermutation(52);
      const perm2 = generatePermutation(52);

      // Very unlikely to be the same
      expect(perm1.join(',')).not.toBe(perm2.join(','));
    });
  });

  describe('applyPermutation', () => {
    it('reorders deck according to permutation', () => {
      const perm = [2, 0, 1, 4, 3]; // Swap some elements
      const result = applyPermutation(testDeck, perm);

      expect(result[0].ciphertext).toBe('card2');
      expect(result[1].ciphertext).toBe('card0');
      expect(result[2].ciphertext).toBe('card1');
      expect(result[3].ciphertext).toBe('card4');
      expect(result[4].ciphertext).toBe('card3');
    });

    it('identity permutation leaves deck unchanged', () => {
      const identity = [0, 1, 2, 3, 4];
      const result = applyPermutation(testDeck, identity);

      expect(result.map((c) => c.ciphertext)).toEqual(
        testDeck.map((c) => c.ciphertext)
      );
    });

    it('throws on length mismatch', () => {
      const wrongLength = [0, 1, 2];

      expect(() => applyPermutation(testDeck, wrongLength)).toThrow(
        'Deck and permutation must have same length'
      );
    });
  });

  describe('isValidPermutation', () => {
    it('accepts valid permutation', () => {
      expect(isValidPermutation([0, 1, 2, 3, 4])).toBe(true);
      expect(isValidPermutation([4, 3, 2, 1, 0])).toBe(true);
      expect(isValidPermutation([2, 0, 4, 1, 3])).toBe(true);
    });

    it('rejects duplicate values', () => {
      expect(isValidPermutation([0, 1, 1, 3, 4])).toBe(false);
    });

    it('rejects out of range values', () => {
      expect(isValidPermutation([0, 1, 2, 3, 5])).toBe(false);
      expect(isValidPermutation([-1, 0, 1, 2, 3])).toBe(false);
    });

    it('rejects missing values', () => {
      expect(isValidPermutation([0, 1, 3, 3, 4])).toBe(false);
    });
  });

  describe('invertPermutation', () => {
    it('inverts permutation correctly', () => {
      const perm = [2, 0, 1, 4, 3];
      const inverse = invertPermutation(perm);

      // Applying both should give identity
      const result = applyPermutation(
        applyPermutation(testDeck, perm),
        inverse
      );

      expect(result.map((c) => c.ciphertext)).toEqual(
        testDeck.map((c) => c.ciphertext)
      );
    });

    it('inverse of inverse is original', () => {
      const perm = generatePermutation(10);
      const inv = invertPermutation(perm);
      const invInv = invertPermutation(inv);

      expect(invInv).toEqual(perm);
    });
  });

  describe('serialize/deserialize permutation', () => {
    it('round-trips permutation', () => {
      const perm = [4, 2, 0, 3, 1];
      const bytes = serializePermutation(perm);
      const recovered = deserializePermutation(bytes);

      expect(recovered).toEqual(perm);
    });
  });

  describe('commitPermutation', () => {
    it('creates commitment hash', async () => {
      const perm = [0, 1, 2, 3, 4];
      const nonce = generateNonce();

      const commitment = await commitPermutation(perm, nonce);

      expect(commitment).toBeInstanceOf(Uint8Array);
      expect(commitment.length).toBe(32);
    });

    it('same permutation/nonce gives same commitment', async () => {
      const perm = [1, 0, 2, 3, 4];
      const nonce = generateNonce();

      const c1 = await commitPermutation(perm, nonce);
      const c2 = await commitPermutation(perm, nonce);

      expect(Array.from(c1)).toEqual(Array.from(c2));
    });

    it('different nonce gives different commitment', async () => {
      const perm = [1, 0, 2, 3, 4];
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      const c1 = await commitPermutation(perm, nonce1);
      const c2 = await commitPermutation(perm, nonce2);

      expect(Array.from(c1)).not.toEqual(Array.from(c2));
    });
  });

  describe('verifyPermutationCommitment', () => {
    it('verifies valid commitment', async () => {
      const perm = [3, 1, 0, 2, 4];
      const nonce = generateNonce();

      const commitment = await commitPermutation(perm, nonce);
      const valid = await verifyPermutationCommitment(commitment, perm, nonce);

      expect(valid).toBe(true);
    });

    it('rejects wrong permutation', async () => {
      const perm1 = [0, 1, 2, 3, 4];
      const perm2 = [4, 3, 2, 1, 0];
      const nonce = generateNonce();

      const commitment = await commitPermutation(perm1, nonce);
      const valid = await verifyPermutationCommitment(commitment, perm2, nonce);

      expect(valid).toBe(false);
    });

    it('rejects wrong nonce', async () => {
      const perm = [0, 1, 2, 3, 4];
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      const commitment = await commitPermutation(perm, nonce1);
      const valid = await verifyPermutationCommitment(commitment, perm, nonce2);

      expect(valid).toBe(false);
    });
  });

  describe('shuffleWithProof', () => {
    it('shuffles deck and creates proof', async () => {
      const { shuffledDeck, proof, permutation, nonce } = await shuffleWithProof(testDeck);

      expect(shuffledDeck.length).toBe(testDeck.length);
      expect(proof).toBeDefined();
      expect(proof.commitment).toBeInstanceOf(Uint8Array);
      expect(isValidPermutation(permutation)).toBe(true);
      expect(nonce).toBeInstanceOf(Uint8Array);
    });

    it('creates verifiable proof', async () => {
      const { shuffledDeck, proof, nonce } = await shuffleWithProof(testDeck);

      const valid = await verifyShuffleProof(proof, testDeck, shuffledDeck, nonce);
      expect(valid).toBe(true);
    });

    it('shuffled deck differs from original', async () => {
      const { shuffledDeck } = await shuffleWithProof(testDeck);

      // Very unlikely to be in same order
      const originalOrder = testDeck.map((c) => c.ciphertext).join(',');
      const shuffledOrder = shuffledDeck.map((c) => c.ciphertext).join(',');

      expect(shuffledOrder).not.toBe(originalOrder);
    });
  });

  describe('verifyShuffleProof', () => {
    it('accepts valid shuffle', async () => {
      const { shuffledDeck, proof, nonce } = await shuffleWithProof(testDeck);

      const valid = await verifyShuffleProof(proof, testDeck, shuffledDeck, nonce);
      expect(valid).toBe(true);
    });

    it('rejects wrong input deck', async () => {
      const { shuffledDeck, proof, nonce } = await shuffleWithProof(testDeck);

      const wrongInput: EncryptedCard[] = [
        { ciphertext: 'wrong', layers: 1 },
      ];

      const valid = await verifyShuffleProof(proof, wrongInput, shuffledDeck, nonce);
      expect(valid).toBe(false);
    });

    it('rejects wrong output deck', async () => {
      const { proof, nonce } = await shuffleWithProof(testDeck);

      const wrongOutput: EncryptedCard[] = [
        { ciphertext: 'wrong', layers: 1 },
      ];

      const valid = await verifyShuffleProof(proof, testDeck, wrongOutput, nonce);
      expect(valid).toBe(false);
    });

    it('rejects wrong nonce', async () => {
      const { shuffledDeck, proof } = await shuffleWithProof(testDeck);
      const wrongNonce = generateNonce();

      const valid = await verifyShuffleProof(proof, testDeck, shuffledDeck, wrongNonce);
      expect(valid).toBe(false);
    });

    it('rejects tampered permutation', async () => {
      const { shuffledDeck, proof, nonce } = await shuffleWithProof(testDeck);

      // Tamper with the proof
      const tamperedProof = { ...proof };
      const originalPerm = JSON.parse(new TextDecoder().decode(proof.proof)) as number[];
      const tamperedPerm = originalPerm.slice();
      // Ensure tamper differs even if original is identity.
      if (tamperedPerm.length >= 2) {
        [tamperedPerm[0], tamperedPerm[1]] = [tamperedPerm[1], tamperedPerm[0]];
      } else {
        tamperedPerm.push(0);
      }
      tamperedProof.proof = new TextEncoder().encode(JSON.stringify(tamperedPerm));

      const valid = await verifyShuffleProof(
        tamperedProof,
        testDeck,
        shuffledDeck,
        nonce
      );
      expect(valid).toBe(false);
    });
  });

  describe('quickShuffle', () => {
    it('shuffles deck', () => {
      const result = quickShuffle(testDeck);

      expect(result.length).toBe(testDeck.length);
      // Contains same cards (different order)
      const originalCards = new Set(testDeck.map((c) => c.ciphertext));
      const shuffledCards = new Set(result.map((c) => c.ciphertext));
      expect(shuffledCards).toEqual(originalCards);
    });
  });

  describe('52 card performance', () => {
    const fullDeck: EncryptedCard[] = Array.from({ length: 52 }, (_, i) => ({
      ciphertext: `card${i}`,
      layers: 2,
    }));

    it('shuffles 52 cards with proof in reasonable time', async () => {
      const start = performance.now();
      const { shuffledDeck, proof, nonce } = await shuffleWithProof(fullDeck);
      const shuffleTime = performance.now() - start;

      // This is a smoke performance check; keep thresholds loose to avoid CI flake.
      expect(shuffleTime).toBeLessThan(250);

      const verifyStart = performance.now();
      const valid = await verifyShuffleProof(proof, fullDeck, shuffledDeck, nonce);
      const verifyTime = performance.now() - verifyStart;

      expect(valid).toBe(true);
      expect(verifyTime).toBeLessThan(250);
    });
  });
});
