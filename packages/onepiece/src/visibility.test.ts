/**
 * Card Visibility State Machine Tests
 *
 * Tests for the 6-state visibility system and transitions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidTransition,
  getValidTransitions,
  transitionCardVisibility,
  batchTransitionVisibility,
  getCardVisibility,
  initializeCardVisibility,
  isCardVisibleTo,
} from './visibility';
import { createInitialState } from './game';
import type { OnePieceState, CardVisibilityState } from './types';

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
// Valid Transition Tests
// =============================================================================

describe('isValidTransition', () => {
  it('should allow encrypted → owner-known', () => {
    expect(isValidTransition('encrypted', 'owner-known')).toBe(true);
  });

  it('should allow encrypted → public', () => {
    expect(isValidTransition('encrypted', 'public')).toBe(true);
  });

  it('should allow encrypted → all-known', () => {
    expect(isValidTransition('encrypted', 'all-known')).toBe(true);
  });

  it('should allow owner-known → public', () => {
    expect(isValidTransition('owner-known', 'public')).toBe(true);
  });

  it('should allow owner-known → all-known', () => {
    expect(isValidTransition('owner-known', 'all-known')).toBe(true);
  });

  it('should allow owner-known → encrypted', () => {
    expect(isValidTransition('owner-known', 'encrypted')).toBe(true);
  });

  it('should allow public → encrypted', () => {
    expect(isValidTransition('public', 'encrypted')).toBe(true);
  });

  it('should allow all-known → public', () => {
    expect(isValidTransition('all-known', 'public')).toBe(true);
  });

  it('should allow all-known → encrypted', () => {
    expect(isValidTransition('all-known', 'encrypted')).toBe(true);
  });

  it('should reject same-state transitions', () => {
    expect(isValidTransition('encrypted', 'encrypted')).toBe(false);
    expect(isValidTransition('public', 'public')).toBe(false);
  });

  it('should reject invalid transitions', () => {
    // public → owner-known is not valid
    expect(isValidTransition('public', 'owner-known')).toBe(false);
    // public → secret is not valid
    expect(isValidTransition('public', 'secret')).toBe(false);
  });

  describe('secret state transitions', () => {
    it('should allow secret → owner-known', () => {
      expect(isValidTransition('secret', 'owner-known')).toBe(true);
    });

    it('should allow secret → opponent-known', () => {
      expect(isValidTransition('secret', 'opponent-known')).toBe(true);
    });

    it('should allow secret → public', () => {
      expect(isValidTransition('secret', 'public')).toBe(true);
    });

    it('should allow secret → encrypted', () => {
      expect(isValidTransition('secret', 'encrypted')).toBe(true);
    });
  });

  describe('opponent-known state transitions', () => {
    it('should allow opponent-known → public', () => {
      expect(isValidTransition('opponent-known', 'public')).toBe(true);
    });

    it('should allow opponent-known → all-known', () => {
      expect(isValidTransition('opponent-known', 'all-known')).toBe(true);
    });

    it('should allow opponent-known → encrypted', () => {
      expect(isValidTransition('opponent-known', 'encrypted')).toBe(true);
    });
  });
});

describe('getValidTransitions', () => {
  it('should list valid transitions from encrypted', () => {
    const transitions = getValidTransitions('encrypted');
    expect(transitions).toContain('owner-known');
    expect(transitions).toContain('public');
    expect(transitions).toContain('all-known');
    expect(transitions).not.toContain('encrypted');
  });

  it('should list valid transitions from owner-known', () => {
    const transitions = getValidTransitions('owner-known');
    expect(transitions).toContain('public');
    expect(transitions).toContain('all-known');
    expect(transitions).toContain('encrypted');
  });

  it('should list valid transitions from public', () => {
    const transitions = getValidTransitions('public');
    expect(transitions).toContain('encrypted');
    expect(transitions).toHaveLength(1);
  });
});

// =============================================================================
// State Transition Tests
// =============================================================================

describe('transitionCardVisibility', () => {
  let state: OnePieceState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should transition a card and produce a proof', () => {
    state.cardVisibility['card-1'] = 'encrypted';
    const transition = transitionCardVisibility(
      state, 'card-1', 'owner-known', '0', 'draw',
    );

    expect(transition).not.toBeNull();
    expect(transition!.from).toBe('encrypted');
    expect(transition!.to).toBe('owner-known');
    expect(transition!.cardId).toBe('card-1');
    expect(transition!.initiatedBy).toBe('0');
    expect(transition!.proof).toBeDefined();
    expect(transition!.proof.hash).toBeDefined();
  });

  it('should update state card visibility', () => {
    state.cardVisibility['card-1'] = 'encrypted';
    transitionCardVisibility(state, 'card-1', 'owner-known', '0', 'draw');
    expect(state.cardVisibility['card-1']).toBe('owner-known');
  });

  it('should append proof to proof chain', () => {
    const initialChainLength = state.proofChain.length;
    state.cardVisibility['card-1'] = 'encrypted';
    transitionCardVisibility(state, 'card-1', 'owner-known', '0', 'draw');
    expect(state.proofChain.length).toBe(initialChainLength + 1);
  });

  it('should return null for invalid transitions', () => {
    state.cardVisibility['card-1'] = 'public';
    const transition = transitionCardVisibility(
      state, 'card-1', 'owner-known', '0', 'invalid',
    );
    expect(transition).toBeNull();
  });

  it('should default untracked cards to encrypted', () => {
    const transition = transitionCardVisibility(
      state, 'untracked-card', 'owner-known', '0', 'draw',
    );
    expect(transition).not.toBeNull();
    expect(transition!.from).toBe('encrypted');
  });

  it('should chain proofs correctly', () => {
    state.cardVisibility['card-1'] = 'encrypted';
    state.cardVisibility['card-2'] = 'encrypted';

    transitionCardVisibility(state, 'card-1', 'owner-known', '0', 'draw');
    transitionCardVisibility(state, 'card-2', 'owner-known', '0', 'draw');

    expect(state.proofChain.length).toBe(2);
    expect(state.proofChain[1].previousProofHash).toBe(state.proofChain[0].hash);
  });
});

describe('batchTransitionVisibility', () => {
  let state: OnePieceState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should transition multiple cards at once', () => {
    const cardIds = ['card-1', 'card-2', 'card-3'];
    for (const id of cardIds) {
      state.cardVisibility[id] = 'encrypted';
    }

    const transitions = batchTransitionVisibility(
      state, cardIds, 'owner-known', '0', 'peekDecrypt',
    );

    expect(transitions).toHaveLength(3);
    for (const t of transitions) {
      expect(t.from).toBe('encrypted');
      expect(t.to).toBe('owner-known');
    }
  });

  it('should skip cards with invalid transitions', () => {
    state.cardVisibility['card-1'] = 'encrypted';
    state.cardVisibility['card-2'] = 'public'; // public → owner-known is invalid

    const transitions = batchTransitionVisibility(
      state, ['card-1', 'card-2'], 'owner-known', '0', 'peek',
    );

    expect(transitions).toHaveLength(1);
    expect(transitions[0].cardId).toBe('card-1');
  });
});

// =============================================================================
// Visibility Query Tests
// =============================================================================

describe('getCardVisibility', () => {
  it('should return tracked visibility', () => {
    const state = createTestState();
    state.cardVisibility['card-1'] = 'public';
    expect(getCardVisibility(state, 'card-1')).toBe('public');
  });

  it('should default to encrypted for untracked cards', () => {
    const state = createTestState();
    expect(getCardVisibility(state, 'unknown-card')).toBe('encrypted');
  });
});

describe('initializeCardVisibility', () => {
  it('should set initial visibility for all specified cards', () => {
    const state = createTestState();
    initializeCardVisibility(state, ['a', 'b', 'c'], 'encrypted');
    expect(state.cardVisibility['a']).toBe('encrypted');
    expect(state.cardVisibility['b']).toBe('encrypted');
    expect(state.cardVisibility['c']).toBe('encrypted');
  });

  it('should support custom initial state', () => {
    const state = createTestState();
    initializeCardVisibility(state, ['a'], 'public');
    expect(state.cardVisibility['a']).toBe('public');
  });
});

describe('isCardVisibleTo', () => {
  it('should return true for public cards regardless of viewer', () => {
    expect(isCardVisibleTo('public', true)).toBe(true);
    expect(isCardVisibleTo('public', false)).toBe(true);
  });

  it('should return false for encrypted cards regardless of viewer', () => {
    expect(isCardVisibleTo('encrypted', true)).toBe(false);
    expect(isCardVisibleTo('encrypted', false)).toBe(false);
  });

  it('should return false for secret cards regardless of viewer', () => {
    expect(isCardVisibleTo('secret', true)).toBe(false);
    expect(isCardVisibleTo('secret', false)).toBe(false);
  });

  it('should return true for owner-known only if viewer is owner', () => {
    expect(isCardVisibleTo('owner-known', true)).toBe(true);
    expect(isCardVisibleTo('owner-known', false)).toBe(false);
  });

  it('should return true for opponent-known only if viewer is not owner', () => {
    expect(isCardVisibleTo('opponent-known', true)).toBe(false);
    expect(isCardVisibleTo('opponent-known', false)).toBe(true);
  });

  it('should return true for all-known regardless of viewer', () => {
    expect(isCardVisibleTo('all-known', true)).toBe(true);
    expect(isCardVisibleTo('all-known', false)).toBe(true);
  });
});
