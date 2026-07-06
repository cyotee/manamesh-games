import { describe, expect, it, beforeEach } from 'vitest';
import {
  generateNonce,
  serializeDeck,
  createCommitment,
  verifyCommitment,
  verifySelfCommitment,
  computeCommitmentHash,
  hashDeck,
  hashToHex,
  hexToHash,
  batchVerifyCommitments,
} from './commitment';
import type { EncryptedCard, DeckCommitment } from './types';

describe('Commitment', () => {
  // Test deck
  const testDeck: EncryptedCard[] = [
    { ciphertext: 'abc123', layers: 2 },
    { ciphertext: 'def456', layers: 2 },
    { ciphertext: 'ghi789', layers: 2 },
  ];

  describe('generateNonce', () => {
    it('generates nonce of default length', () => {
      const nonce = generateNonce();
      expect(nonce.length).toBe(32);
    });

    it('generates nonce of specified length', () => {
      const nonce = generateNonce(64);
      expect(nonce.length).toBe(64);
    });

    it('generates different nonces each time', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(hashToHex(nonce1)).not.toBe(hashToHex(nonce2));
    });
  });

  describe('serializeDeck', () => {
    it('serializes deck to bytes', () => {
      const bytes = serializeDeck(testDeck);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    });

    it('same deck produces same serialization', () => {
      const bytes1 = serializeDeck(testDeck);
      const bytes2 = serializeDeck(testDeck);

      expect(hashToHex(bytes1)).toBe(hashToHex(bytes2));
    });

    it('different decks produce different serialization', () => {
      const deck2: EncryptedCard[] = [
        { ciphertext: 'xyz', layers: 1 },
      ];

      const bytes1 = serializeDeck(testDeck);
      const bytes2 = serializeDeck(deck2);

      expect(hashToHex(bytes1)).not.toBe(hashToHex(bytes2));
    });

    it('includes layer count in serialization', () => {
      const deck1: EncryptedCard[] = [{ ciphertext: 'abc', layers: 1 }];
      const deck2: EncryptedCard[] = [{ ciphertext: 'abc', layers: 2 }];

      const bytes1 = serializeDeck(deck1);
      const bytes2 = serializeDeck(deck2);

      expect(hashToHex(bytes1)).not.toBe(hashToHex(bytes2));
    });
  });

  describe('createCommitment', () => {
    it('creates commitment with hash and nonce', async () => {
      const commitment = await createCommitment(testDeck);

      expect(commitment.hash).toBeInstanceOf(Uint8Array);
      expect(commitment.hash.length).toBe(32); // SHA-256
      expect(commitment.nonce).toBeInstanceOf(Uint8Array);
      expect(commitment.nonce.length).toBe(32);
      expect(commitment.timestamp).toBeGreaterThan(0);
    });

    it('same deck with different nonce produces different hash', async () => {
      const commitment1 = await createCommitment(testDeck);
      const commitment2 = await createCommitment(testDeck);

      expect(hashToHex(commitment1.hash)).not.toBe(hashToHex(commitment2.hash));
    });

    it('uses provided nonce', async () => {
      const nonce = generateNonce();
      const commitment = await createCommitment(testDeck, nonce);

      expect(hashToHex(commitment.nonce)).toBe(hashToHex(nonce));
    });

    it('same deck and nonce produces same hash', async () => {
      const nonce = generateNonce();
      const commitment1 = await createCommitment(testDeck, nonce);
      const commitment2 = await createCommitment(testDeck, nonce);

      expect(hashToHex(commitment1.hash)).toBe(hashToHex(commitment2.hash));
    });
  });

  describe('verifyCommitment', () => {
    let commitment: DeckCommitment;

    beforeEach(async () => {
      commitment = await createCommitment(testDeck);
    });

    it('verifies valid commitment', async () => {
      const valid = await verifyCommitment(commitment, testDeck, commitment.nonce);
      expect(valid).toBe(true);
    });

    it('rejects commitment with wrong deck', async () => {
      const wrongDeck: EncryptedCard[] = [{ ciphertext: 'wrong', layers: 1 }];
      const valid = await verifyCommitment(commitment, wrongDeck, commitment.nonce);
      expect(valid).toBe(false);
    });

    it('rejects commitment with wrong nonce', async () => {
      const wrongNonce = generateNonce();
      const valid = await verifyCommitment(commitment, testDeck, wrongNonce);
      expect(valid).toBe(false);
    });

    it('rejects commitment with modified deck order', async () => {
      const reorderedDeck = [...testDeck].reverse();
      const valid = await verifyCommitment(commitment, reorderedDeck, commitment.nonce);
      expect(valid).toBe(false);
    });
  });

  describe('verifySelfCommitment', () => {
    it('verifies commitment using stored nonce', async () => {
      const commitment = await createCommitment(testDeck);
      const valid = await verifySelfCommitment(commitment, testDeck);
      expect(valid).toBe(true);
    });

    it('rejects wrong deck', async () => {
      const commitment = await createCommitment(testDeck);
      const wrongDeck: EncryptedCard[] = [{ ciphertext: 'x', layers: 1 }];
      const valid = await verifySelfCommitment(commitment, wrongDeck);
      expect(valid).toBe(false);
    });
  });

  describe('computeCommitmentHash', () => {
    it('computes same hash as createCommitment', async () => {
      const nonce = generateNonce();
      const commitment = await createCommitment(testDeck, nonce);
      const hash = await computeCommitmentHash(testDeck, nonce);

      expect(hashToHex(hash)).toBe(hashToHex(commitment.hash));
    });
  });

  describe('hashDeck', () => {
    it('hashes deck deterministically', async () => {
      const hash1 = await hashDeck(testDeck);
      const hash2 = await hashDeck(testDeck);

      expect(hashToHex(hash1)).toBe(hashToHex(hash2));
    });

    it('different decks have different hashes', async () => {
      const deck2: EncryptedCard[] = [{ ciphertext: 'different', layers: 1 }];

      const hash1 = await hashDeck(testDeck);
      const hash2 = await hashDeck(deck2);

      expect(hashToHex(hash1)).not.toBe(hashToHex(hash2));
    });
  });

  describe('hashToHex / hexToHash', () => {
    it('converts hash to hex and back', () => {
      const original = new Uint8Array([0, 1, 255, 128, 64]);
      const hex = hashToHex(original);
      const recovered = hexToHash(hex);

      expect(hashToHex(recovered)).toBe(hashToHex(original));
    });

    it('produces lowercase hex', () => {
      const bytes = new Uint8Array([171, 205, 239]); // abcdef
      const hex = hashToHex(bytes);

      expect(hex).toBe('abcdef');
    });
  });

  describe('batchVerifyCommitments', () => {
    it('verifies multiple valid commitments', async () => {
      const deck1 = testDeck;
      const deck2: EncryptedCard[] = [{ ciphertext: 'xyz', layers: 1 }];

      const commitment1 = await createCommitment(deck1);
      const commitment2 = await createCommitment(deck2);

      const commitments = new Map([
        ['player1', commitment1],
        ['player2', commitment2],
      ]);

      const decks = new Map([
        ['player1', deck1],
        ['player2', deck2],
      ]);

      const nonces = new Map([
        ['player1', commitment1.nonce],
        ['player2', commitment2.nonce],
      ]);

      const results = await batchVerifyCommitments(commitments, decks, nonces);

      expect(results.get('player1')).toBe(true);
      expect(results.get('player2')).toBe(true);
    });

    it('detects invalid commitment in batch', async () => {
      const deck1 = testDeck;
      const deck2: EncryptedCard[] = [{ ciphertext: 'xyz', layers: 1 }];

      const commitment1 = await createCommitment(deck1);
      const commitment2 = await createCommitment(deck2);

      const commitments = new Map([
        ['player1', commitment1],
        ['player2', commitment2],
      ]);

      // Player 1 has correct deck, player 2 has wrong deck
      const decks = new Map([
        ['player1', deck1],
        ['player2', deck1], // Wrong!
      ]);

      const nonces = new Map([
        ['player1', commitment1.nonce],
        ['player2', commitment2.nonce],
      ]);

      const results = await batchVerifyCommitments(commitments, decks, nonces);

      expect(results.get('player1')).toBe(true);
      expect(results.get('player2')).toBe(false);
    });

    it('handles missing deck', async () => {
      const commitment = await createCommitment(testDeck);

      const commitments = new Map([['player1', commitment]]);
      const decks = new Map<string, EncryptedCard[]>(); // Empty
      const nonces = new Map([['player1', commitment.nonce]]);

      const results = await batchVerifyCommitments(commitments, decks, nonces);

      expect(results.get('player1')).toBe(false);
    });
  });

  describe('binding property', () => {
    it('cannot open commitment to different deck', async () => {
      const commitment = await createCommitment(testDeck);

      // Try to "cheat" by using a different deck
      const cheatingDeck: EncryptedCard[] = [
        { ciphertext: 'cheater', layers: 1 },
      ];

      // Even with same nonce, different deck should fail
      const valid = await verifyCommitment(commitment, cheatingDeck, commitment.nonce);
      expect(valid).toBe(false);
    });
  });

  describe('hiding property', () => {
    it('commitment reveals nothing about deck', () => {
      // This is more of a design property than something we can test
      // but we can verify that the hash looks random
      // (no obvious patterns related to input)
    });
  });
});
