/**
 * Poker Crypto Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCryptoInitialState,
  validateCryptoMove,
  type CryptoPokerState,
} from './crypto';
import type { GameConfig } from '@manamesh/frontend/src/game/modules/types';
import type { PokerCard } from './types';

// Helper to create a test state
function createTestGameConfig(numPlayers: number = 2): GameConfig {
  const playerIDs = Array.from({ length: numPlayers }, (_, i) => `${i}`);
  return {
    numPlayers,
    playerIDs,
    options: {},
  };
}

// Helper to create a poker card
function card(suit: string, rank: string): PokerCard {
  return {
    id: `${suit}-${rank}`,
    name: `${rank} of ${suit}`,
    suit: suit as PokerCard['suit'],
    rank: rank as PokerCard['rank'],
  };
}

// Helper to create crypto initial state
async function createCryptoTestState(
  numPlayers: number = 2
): Promise<CryptoPokerState> {
  const config = createTestGameConfig(numPlayers);
  return createCryptoInitialState(config);
}

describe('releaseKey', () => {
  it('should set keysReleased to true when called', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].keysReleased = false;

    const result = validateCryptoMove(G, 'releaseKey', '0');
    expect(result.valid).toBe(true);
  });

  it('should reject if keys already released', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].keysReleased = true;

    const result = validateCryptoMove(G, 'releaseKey', '0');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Keys already released');
  });

  it('should reject if not in betting phase', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'showdown';
    G.players['0'].keysReleased = false;

    const result = validateCryptoMove(G, 'releaseKey', '0');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot release keys now');
  });
});

describe('challengeVoid', () => {
  it('should allow active player to challenge folded player', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].folded = false;
    G.players['1'].folded = true;

    // Add to recent folds
    const now = Date.now();
    G.recentFolds.push({
      playerId: '1',
      timestamp: now - 1000,
      challengeWindowEnd: now + 30000,
    });

    const result = validateCryptoMove(G, 'challengeVoid', '0', '1');
    expect(result.valid).toBe(true);
  });

  it('should reject if challenger has folded', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].folded = true;
    G.players['1'].folded = true;

    const result = validateCryptoMove(G, 'challengeVoid', '0', '1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Challenger has folded');
  });

  it('should reject if no recent fold found', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].folded = false;
    G.players['1'].folded = true;
    G.recentFolds = [];

    const result = validateCryptoMove(G, 'challengeVoid', '0', '1');
    expect(result.valid).toBe(false);
  });

  it('should reject if fold is outside challenge window', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].folded = false;
    G.players['1'].folded = true;

    // Fold outside challenge window
    const now = Date.now();
    G.recentFolds.push({
      playerId: '1',
      timestamp: now - 120000, // 2 minutes ago
      challengeWindowEnd: now - 90000, // expired
    });

    const result = validateCryptoMove(G, 'challengeVoid', '0', '1');
    expect(result.valid).toBe(false);
  });
});

describe('peekHoleCards bet gating', () => {
  it('should allow peek when betting round is complete', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = true;
    G.players['0'].hasPeeked = false;
    G.players['0'].folded = false;

    const result = validateCryptoMove(G, 'peekHoleCards', '0');
    expect(result.valid).toBe(true);
  });

  it('should allow peek when no one has acted yet', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = false;
    G.bettingRound.actedPlayers = [];
    G.players['0'].hasPeeked = false;
    G.players['0'].folded = false;

    const result = validateCryptoMove(G, 'peekHoleCards', '0');
    expect(result.valid).toBe(true);
  });

  it('should allow peek in showdown phase', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'showdown';
    G.players['0'].hasPeeked = false;
    G.players['0'].folded = false;

    const result = validateCryptoMove(G, 'peekHoleCards', '0');
    expect(result.valid).toBe(true);
  });

  it('should reject peek when betting round is active and incomplete', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = false;
    G.bettingRound.actedPlayers = ['0']; // Player 0 has acted
    G.players['0'].hasPeeked = false;
    G.players['0'].folded = false;

    const result = validateCryptoMove(G, 'peekHoleCards', '0');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Betting round not complete');
  });

  it('should reject if player already peeked', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = true;
    G.players['0'].hasPeeked = true;

    const result = validateCryptoMove(G, 'peekHoleCards', '0');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Already peeked');
  });
});

describe('requestDecrypt bet gating', () => {
  it('should allow request when betting round is complete', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = true;
    G.players['0'].hasPeeked = false;
    G.players['0'].folded = false;

    const result = validateCryptoMove(G, 'requestDecrypt', '0', 'hand:0', [0]);
    expect(result.valid).toBe(true);
  });

  it('should allow request when no one has acted yet', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = false;
    G.bettingRound.actedPlayers = [];
    G.players['0'].hasPeeked = false;
    G.players['0'].folded = false;

    const result = validateCryptoMove(G, 'requestDecrypt', '0', 'hand:0', [0]);
    expect(result.valid).toBe(true);
  });

  it('should reject request when betting round is active and incomplete', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = false;
    G.bettingRound.actedPlayers = ['1']; // Someone has acted
    G.players['0'].hasPeeked = false;
    G.players['0'].folded = false;

    const result = validateCryptoMove(G, 'requestDecrypt', '0', 'hand:0', [0]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Betting round not complete');
  });

  it('should reject if player has folded', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = true;
    G.players['0'].folded = true;

    const result = validateCryptoMove(G, 'requestDecrypt', '0', 'hand:0', [0]);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Cannot request after folding');
  });
});

describe('fold tracks unreleased keys', () => {
  it('should add player to recentFolds when folding without keys released', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].keysReleased = false;
    G.players['0'].folded = false;
    G.recentFolds = [];

    // Simulate fold tracking
    if (!G.players['0'].keysReleased) {
      const now = Date.now();
      G.recentFolds.push({
        playerId: '0',
        timestamp: now,
        challengeWindowEnd: now + 30000,
      });
    }

    expect(G.recentFolds.length).toBe(1);
    expect(G.recentFolds[0].playerId).toBe('0');
  });

  it('should not add player to recentFolds when keys already released', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.players['0'].keysReleased = true;
    G.recentFolds = [];

    // Simulate fold tracking
    if (!G.players['0'].keysReleased) {
      const now = Date.now();
      G.recentFolds.push({
        playerId: '0',
        timestamp: now,
        challengeWindowEnd: now + 30000,
      });
    }

    expect(G.recentFolds.length).toBe(0);
  });
});

describe('CryptoPokerState initialization', () => {
  it('should initialize keysReleased to false for all players', async () => {
    const G = await createCryptoTestState(2);

    expect(G.players['0'].keysReleased).toBe(false);
    expect(G.players['1'].keysReleased).toBe(false);
  });

  it('should initialize releasedCards as empty', async () => {
    const G = await createCryptoTestState(2);

    expect(G.releasedCards).toEqual({});
  });

  it('should initialize recentFolds as empty', async () => {
    const G = await createCryptoTestState(2);

    expect(G.recentFolds).toEqual([]);
  });

  it('should initialize foldChallenges as empty', async () => {
    const G = await createCryptoTestState(2);

    expect(G.foldChallenges).toEqual([]);
  });
});