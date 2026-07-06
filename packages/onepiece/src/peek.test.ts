/**
 * Deck Peek Protocol Tests
 *
 * Tests for the 4-step cooperative deck peeking protocol.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPeekRequest,
  acknowledgePeekRequest,
  ownerDecryptPeek,
  reorderPeekedCards,
  completePeek,
  findPeekProtocol,
  getPlayerActivePeeks,
} from './peek';
import { createInitialState } from './game';
import type { OnePieceState, OnePieceCard } from './types';

// =============================================================================
// Test Utilities
// =============================================================================

function createTestCard(id: string): OnePieceCard {
  return {
    id,
    name: `Card ${id}`,
    cardType: 'character',
    cost: 3,
    power: 5000,
    color: ['red'],
    set: 'OP01',
    cardNumber: id,
    rarity: 'C',
  };
}

function createTestState(): OnePieceState {
  const state = createInitialState({
    numPlayers: 2,
    playerIDs: ['0', '1'],
  });

  // Add cards to player 0's main deck for peek testing
  const cards = Array.from({ length: 10 }, (_, i) => createTestCard(`card-${i}`));
  state.players['0'].mainDeck = cards;

  // Initialize visibility for these cards
  for (const card of cards) {
    state.cardVisibility[card.id] = 'encrypted';
  }

  return state;
}

// =============================================================================
// Step 1: Peek Request Tests
// =============================================================================

describe('createPeekRequest', () => {
  let state: OnePieceState;

  beforeEach(() => {
    state = createTestState();
  });

  it('should create a peek request for main deck', () => {
    const protocol = createPeekRequest(state, '0', 'mainDeck', 3);

    expect(protocol).not.toBeNull();
    expect(protocol!.request.playerId).toBe('0');
    expect(protocol!.request.deckZone).toBe('mainDeck');
    expect(protocol!.request.count).toBe(3);
    expect(protocol!.status).toBe('pending');
  });

  it('should add protocol to active peeks', () => {
    createPeekRequest(state, '0', 'mainDeck', 3);
    expect(state.activePeeks).toHaveLength(1);
  });

  it('should add proof to proof chain', () => {
    const initialLength = state.proofChain.length;
    createPeekRequest(state, '0', 'mainDeck', 3);
    expect(state.proofChain.length).toBe(initialLength + 1);
  });

  it('should cap count to deck size', () => {
    const protocol = createPeekRequest(state, '0', 'mainDeck', 100);
    expect(protocol!.request.count).toBe(10); // Only 10 cards in deck
  });

  it('should fail for invalid player', () => {
    const protocol = createPeekRequest(state, 'nonexistent', 'mainDeck', 3);
    expect(protocol).toBeNull();
  });

  it('should fail for empty deck', () => {
    state.players['0'].mainDeck = [];
    const protocol = createPeekRequest(state, '0', 'mainDeck', 3);
    expect(protocol).toBeNull();
  });

  it('should support life deck peek', () => {
    state.players['0'].lifeDeck = [createTestCard('life-1'), createTestCard('life-2')];
    state.cardVisibility['life-1'] = 'encrypted';
    state.cardVisibility['life-2'] = 'encrypted';

    const protocol = createPeekRequest(state, '0', 'lifeDeck', 2);
    expect(protocol).not.toBeNull();
    expect(protocol!.request.deckZone).toBe('lifeDeck');
  });

  it('should generate unique request IDs', () => {
    const p1 = createPeekRequest(state, '0', 'mainDeck', 1);
    const p2 = createPeekRequest(state, '0', 'mainDeck', 1);
    expect(p1!.request.id).not.toBe(p2!.request.id);
  });
});

// =============================================================================
// Step 2: Opponent Acknowledgement Tests
// =============================================================================

describe('acknowledgePeekRequest', () => {
  let state: OnePieceState;
  let requestId: string;

  beforeEach(() => {
    state = createTestState();
    const protocol = createPeekRequest(state, '0', 'mainDeck', 3)!;
    requestId = protocol.request.id;
  });

  it('should acknowledge a pending request', () => {
    const ack = acknowledgePeekRequest(state, requestId, 'share-data', 'sig-1');

    expect(ack).not.toBeNull();
    expect(ack!.requestId).toBe(requestId);
    expect(ack!.decryptionShare).toBe('share-data');
  });

  it('should update protocol status to acked', () => {
    acknowledgePeekRequest(state, requestId, 'share', 'sig');
    const protocol = findPeekProtocol(state, requestId);
    expect(protocol!.status).toBe('acked');
  });

  it('should fail for non-existent request', () => {
    const ack = acknowledgePeekRequest(state, 'nonexistent', 'share', 'sig');
    expect(ack).toBeNull();
  });

  it('should fail for already acked request', () => {
    acknowledgePeekRequest(state, requestId, 'share', 'sig');
    const ack = acknowledgePeekRequest(state, requestId, 'share2', 'sig2');
    expect(ack).toBeNull();
  });
});

// =============================================================================
// Step 3: Owner Decryption Tests
// =============================================================================

describe('ownerDecryptPeek', () => {
  let state: OnePieceState;
  let requestId: string;

  beforeEach(() => {
    state = createTestState();
    const protocol = createPeekRequest(state, '0', 'mainDeck', 3)!;
    requestId = protocol.request.id;
    acknowledgePeekRequest(state, requestId, 'share', 'sig');
  });

  it('should decrypt peeked cards', () => {
    const result = ownerDecryptPeek(state, requestId);

    expect(result).not.toBeNull();
    expect(result!.requestId).toBe(requestId);
    expect(result!.cardStates).toHaveLength(3);
  });

  it('should transition cards to owner-known', () => {
    ownerDecryptPeek(state, requestId);

    // The top 3 cards should now be owner-known
    const topCards = state.players['0'].mainDeck.slice(0, 3);
    for (const card of topCards) {
      expect(state.cardVisibility[card.id]).toBe('owner-known');
    }
  });

  it('should update protocol status to decrypted', () => {
    ownerDecryptPeek(state, requestId);
    const protocol = findPeekProtocol(state, requestId);
    expect(protocol!.status).toBe('decrypted');
  });

  it('should fail for non-acked request', () => {
    const state2 = createTestState();
    const protocol = createPeekRequest(state2, '0', 'mainDeck', 3)!;
    // Not acked yet
    const result = ownerDecryptPeek(state2, protocol.request.id);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Step 4: Reorder Tests
// =============================================================================

describe('reorderPeekedCards', () => {
  let state: OnePieceState;
  let requestId: string;

  beforeEach(() => {
    state = createTestState();
    const protocol = createPeekRequest(state, '0', 'mainDeck', 3)!;
    requestId = protocol.request.id;
    acknowledgePeekRequest(state, requestId, 'share', 'sig');
    ownerDecryptPeek(state, requestId);
  });

  it('should reorder peeked cards', () => {
    const originalOrder = state.players['0'].mainDeck.slice(0, 3).map((c) => c.id);

    const result = reorderPeekedCards(state, requestId, [2, 0, 1], 'sig');

    expect(result).not.toBeNull();
    const newOrder = state.players['0'].mainDeck.slice(0, 3).map((c) => c.id);
    expect(newOrder[0]).toBe(originalOrder[2]);
    expect(newOrder[1]).toBe(originalOrder[0]);
    expect(newOrder[2]).toBe(originalOrder[1]);
  });

  it('should update protocol status to reordered', () => {
    reorderPeekedCards(state, requestId, [2, 0, 1], 'sig');
    const protocol = findPeekProtocol(state, requestId);
    expect(protocol!.status).toBe('reordered');
  });

  it('should reject invalid permutation length', () => {
    const result = reorderPeekedCards(state, requestId, [0, 1], 'sig');
    expect(result).toBeNull();
  });

  it('should reject invalid permutation values', () => {
    const result = reorderPeekedCards(state, requestId, [0, 0, 0], 'sig');
    expect(result).toBeNull();
  });

  it('should accept identity permutation', () => {
    const originalOrder = state.players['0'].mainDeck.slice(0, 3).map((c) => c.id);
    const result = reorderPeekedCards(state, requestId, [0, 1, 2], 'sig');
    expect(result).not.toBeNull();

    const newOrder = state.players['0'].mainDeck.slice(0, 3).map((c) => c.id);
    expect(newOrder).toEqual(originalOrder);
  });

  it('should fail for non-decrypted request', () => {
    const state2 = createTestState();
    const protocol = createPeekRequest(state2, '0', 'mainDeck', 3)!;
    const result = reorderPeekedCards(state2, protocol.request.id, [0, 1, 2], 'sig');
    expect(result).toBeNull();
  });
});

// =============================================================================
// Completion Tests
// =============================================================================

describe('completePeek', () => {
  let state: OnePieceState;
  let requestId: string;

  beforeEach(() => {
    state = createTestState();
    const protocol = createPeekRequest(state, '0', 'mainDeck', 3)!;
    requestId = protocol.request.id;
    acknowledgePeekRequest(state, requestId, 'share', 'sig');
    ownerDecryptPeek(state, requestId);
  });

  it('should complete a decrypted peek (no reorder)', () => {
    const result = completePeek(state, requestId);
    expect(result).toBe(true);
  });

  it('should complete a reordered peek', () => {
    reorderPeekedCards(state, requestId, [2, 0, 1], 'sig');
    const result = completePeek(state, requestId);
    expect(result).toBe(true);
  });

  it('should remove from active peeks', () => {
    completePeek(state, requestId);
    expect(state.activePeeks).toHaveLength(0);
  });

  it('should fail for pending request', () => {
    const state2 = createTestState();
    const protocol = createPeekRequest(state2, '0', 'mainDeck', 1)!;
    const result = completePeek(state2, protocol.request.id);
    expect(result).toBe(false);
  });
});

// =============================================================================
// Query Tests
// =============================================================================

describe('findPeekProtocol', () => {
  it('should find an active protocol', () => {
    const state = createTestState();
    const protocol = createPeekRequest(state, '0', 'mainDeck', 3)!;
    const found = findPeekProtocol(state, protocol.request.id);
    expect(found).toBe(protocol);
  });

  it('should return undefined for nonexistent protocol', () => {
    const state = createTestState();
    expect(findPeekProtocol(state, 'nonexistent')).toBeUndefined();
  });
});

describe('getPlayerActivePeeks', () => {
  it('should return peeks for a specific player', () => {
    const state = createTestState();
    // Add cards to player 1's deck too
    state.players['1'].mainDeck = [createTestCard('p1-card-1')];
    state.cardVisibility['p1-card-1'] = 'encrypted';

    createPeekRequest(state, '0', 'mainDeck', 2);
    createPeekRequest(state, '1', 'mainDeck', 1);

    expect(getPlayerActivePeeks(state, '0')).toHaveLength(1);
    expect(getPlayerActivePeeks(state, '1')).toHaveLength(1);
  });
});
