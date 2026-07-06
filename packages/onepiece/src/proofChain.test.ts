/**
 * Proof Chain Tests
 *
 * Tests for cryptographic proof chain creation, linking, and verification.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createProof,
  signProof,
  appendProof,
  verifyProofChain,
  verifyProofSignatures,
  getLatestProof,
  getLatestProofHash,
  getProofsForCard,
} from './proofChain';
import { createInitialState } from './game';
import type { OnePieceState, CryptographicProof } from './types';

// =============================================================================
// Test Utilities
// =============================================================================

function createTestState(): OnePieceState {
  return createInitialState({
    numPlayers: 2,
    playerIDs: ['0', '1'],
  });
}

// =============================================================================
// Proof Creation Tests
// =============================================================================

describe('createProof', () => {
  it('should create a proof with all required fields', () => {
    const proof = createProof('draw', { cardId: 'card-1' }, null);

    expect(proof.transitionId).toBeDefined();
    expect(proof.transitionId).toMatch(/^proof-/);
    expect(proof.previousProofHash).toBeNull();
    expect(proof.action).toBe('draw');
    expect(proof.data).toEqual({ cardId: 'card-1' });
    expect(proof.signatures).toEqual({});
    expect(proof.timestamp).toBeGreaterThan(0);
    expect(proof.hash).toBeDefined();
  });

  it('should create proofs with unique transition IDs', () => {
    const proof1 = createProof('a', {}, null);
    const proof2 = createProof('b', {}, null);
    expect(proof1.transitionId).not.toBe(proof2.transitionId);
  });

  it('should link to previous proof hash', () => {
    const proof1 = createProof('a', {}, null);
    const proof2 = createProof('b', {}, proof1.hash);
    expect(proof2.previousProofHash).toBe(proof1.hash);
  });

  it('should store arbitrary data', () => {
    const data = { cardId: 'c-1', from: 'encrypted', to: 'public', count: 3 };
    const proof = createProof('transition', data, null);
    expect(proof.data).toEqual(data);
  });
});

// =============================================================================
// Proof Signing Tests
// =============================================================================

describe('signProof', () => {
  it('should add a player signature', () => {
    const proof = createProof('draw', {}, null);
    const signed = signProof(proof, '0', 'sig-player-0');

    expect(signed.signatures['0']).toBe('sig-player-0');
  });

  it('should support multiple signatures', () => {
    let proof = createProof('draw', {}, null);
    proof = signProof(proof, '0', 'sig-0');
    proof = signProof(proof, '1', 'sig-1');

    expect(proof.signatures['0']).toBe('sig-0');
    expect(proof.signatures['1']).toBe('sig-1');
  });

  it('should not mutate the original proof', () => {
    const proof = createProof('draw', {}, null);
    const signed = signProof(proof, '0', 'sig-0');

    expect(proof.signatures).toEqual({});
    expect(signed.signatures['0']).toBe('sig-0');
  });
});

// =============================================================================
// Proof Chain Operations Tests
// =============================================================================

describe('appendProof', () => {
  it('should add proof to the chain', () => {
    const state = createTestState();
    const proof = createProof('draw', {}, null);
    appendProof(state, proof);
    expect(state.proofChain).toHaveLength(1);
    expect(state.proofChain[0]).toBe(proof);
  });

  it('should append sequentially', () => {
    const state = createTestState();
    const p1 = createProof('a', {}, null);
    const p2 = createProof('b', {}, p1.hash);
    appendProof(state, p1);
    appendProof(state, p2);
    expect(state.proofChain).toHaveLength(2);
  });
});

// =============================================================================
// Proof Chain Verification Tests
// =============================================================================

describe('verifyProofChain', () => {
  it('should verify an empty chain', () => {
    const result = verifyProofChain([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should verify a single-proof chain', () => {
    const proof = createProof('draw', {}, null);
    const result = verifyProofChain([proof]);
    expect(result.valid).toBe(true);
  });

  it('should verify a correctly linked chain', () => {
    const p1 = createProof('a', {}, null);
    const p2 = createProof('b', {}, p1.hash);
    const p3 = createProof('c', {}, p2.hash);

    const result = verifyProofChain([p1, p2, p3]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should detect broken chain linkage', () => {
    const p1 = createProof('a', {}, null);
    const p2 = createProof('b', {}, 'wrong-hash');

    const result = verifyProofChain([p1, p2]);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].error).toContain('Chain broken');
  });

  it('should detect non-null first proof hash', () => {
    const proof = createProof('a', {}, 'should-be-null');
    const result = verifyProofChain([proof]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].error).toContain('First proof must have null');
  });

  it('should detect timestamp regression', () => {
    const p1 = createProof('a', {}, null);
    const p2 = createProof('b', {}, p1.hash);
    // Force timestamp regression
    p2.timestamp = p1.timestamp - 1000;

    const result = verifyProofChain([p1, p2]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.error.includes('Timestamp regression'))).toBe(true);
  });

  it('should report multiple errors', () => {
    const p1 = createProof('a', {}, 'not-null');
    const p2 = createProof('b', {}, 'wrong-link');
    p2.timestamp = p1.timestamp - 1000;

    const result = verifyProofChain([p1, p2]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// Signature Verification Tests
// =============================================================================

describe('verifyProofSignatures', () => {
  it('should verify when all required signers present', () => {
    let proof = createProof('draw', {}, null);
    proof = signProof(proof, '0', 'sig-0');
    proof = signProof(proof, '1', 'sig-1');

    const result = verifyProofSignatures(proof, ['0', '1']);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('should detect missing signers', () => {
    const proof = signProof(createProof('draw', {}, null), '0', 'sig-0');

    const result = verifyProofSignatures(proof, ['0', '1']);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['1']);
  });

  it('should report all missing signers', () => {
    const proof = createProof('draw', {}, null);
    const result = verifyProofSignatures(proof, ['0', '1', '2']);
    expect(result.missing).toEqual(['0', '1', '2']);
  });
});

// =============================================================================
// Proof Chain Query Tests
// =============================================================================

describe('Proof Chain Queries', () => {
  let state: OnePieceState;

  beforeEach(() => {
    state = createTestState();
  });

  describe('getLatestProof', () => {
    it('should return null for empty chain', () => {
      expect(getLatestProof(state)).toBeNull();
    });

    it('should return the last proof', () => {
      const p1 = createProof('a', {}, null);
      const p2 = createProof('b', {}, p1.hash);
      appendProof(state, p1);
      appendProof(state, p2);
      expect(getLatestProof(state)).toBe(p2);
    });
  });

  describe('getLatestProofHash', () => {
    it('should return null for empty chain', () => {
      expect(getLatestProofHash(state)).toBeNull();
    });

    it('should return the last proof hash', () => {
      const proof = createProof('a', {}, null);
      appendProof(state, proof);
      expect(getLatestProofHash(state)).toBe(proof.hash);
    });
  });

  describe('getProofsForCard', () => {
    it('should return all proofs for a specific card', () => {
      const p1 = createProof('draw', { cardId: 'card-1' }, null);
      const p2 = createProof('play', { cardId: 'card-2' }, p1.hash);
      const p3 = createProof('reveal', { cardId: 'card-1' }, p2.hash);
      appendProof(state, p1);
      appendProof(state, p2);
      appendProof(state, p3);

      const cardProofs = getProofsForCard(state, 'card-1');
      expect(cardProofs).toHaveLength(2);
      expect(cardProofs[0].action).toBe('draw');
      expect(cardProofs[1].action).toBe('reveal');
    });

    it('should return empty array for unknown card', () => {
      const proofs = getProofsForCard(state, 'nonexistent');
      expect(proofs).toHaveLength(0);
    });
  });
});
