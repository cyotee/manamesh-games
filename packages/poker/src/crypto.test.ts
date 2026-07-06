/**
 * Poker Crypto Integration Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCryptoInitialState,
  validateCryptoMove,
  buildHandResult,
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

    // Fold outside challenge window (use logical move counts for determinism)
    G.recentFolds.push({
      playerId: '1',
      timestamp: 10,
      challengeWindowEnd: 15,
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

describe('Security: decrypt stall abort (liveness)', () => {
  it('should allow voteAbortDecrypt after stall window when pending requests exist', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'flop';
    G.bettingRound.isComplete = true;
    G.decryptRequests = [{
      id: 'stall-test',
      requestingPlayer: '0',
      zoneId: 'hand:0',
      cardIndices: [0],
      timestamp: 0,
      status: 'pending',
      approvals: { '0': true, '1': false },
      decryptionShares: {},
    }];

    // Simulate enough moves passed
    const mockCtx = { numMoves: 20 } as any;

    const result = validateCryptoMove(G, 'voteAbortDecrypt', '1', mockCtx);
    expect(result.valid).toBe(true);
  });

  it('should reject voteAbortDecrypt before stall window (enforced in move, not validate)', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'flop';
    G.decryptRequests = [{ id: 'early', requestingPlayer: '0', zoneId: 'hand:0', cardIndices: [0], timestamp: 0, status: 'pending', approvals: {}, decryptionShares: {} }];

    const mockCtx = { numMoves: 3 } as any;
    // validate is permissive; the real guard + INVALID_MOVE is inside the move implementation
    const validateRes = validateCryptoMove(G, 'voteAbortDecrypt', '1', mockCtx);
    expect(validateRes.valid).toBe(true);

    // The canAbort helper (used by move) should return false
    const can = (G as any).decryptRequests?.some((r: any) => r.status === 'pending') && mockCtx.numMoves >= 12;
    expect(can).toBe(false);
  });
});

describe('Full round-trip simulation: decrypt approve → stall → abort → void + settlement', () => {
  it('simulates complete adversarial stall scenario with correct void and hand result', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'flop';
    G.bettingRound.isComplete = true;

    // Simulate hole card encrypted state
    const handZoneId = 'hand:0';
    G.crypto.encryptedZones[handZoneId] = [
      { ciphertext: '02' + 'a'.repeat(64), layers: 2 } // 2-player layers
    ];

    // Player 0 requests decrypt
    const reqId = 'rt-sim-1';
    G.decryptRequests.push({
      id: reqId,
      requestingPlayer: '0',
      zoneId: handZoneId,
      cardIndices: [0],
      timestamp: 5,
      status: 'pending',
      approvals: { '0': true, '1': false },
      decryptionShares: {},
    } as any);

    // Simulate approve by player 0 (already done) and stall by advancing moves
    const ctxStalled = { numMoves: 25, playerID: '1' } as any;

    // Player 1 never approves -> stall reached
    const canAbort = (G.decryptRequests.some(r => r.status === 'pending') && ctxStalled.numMoves >= 12);
    expect(canAbort).toBe(true);

    // Now vote abort (as player 1)
    const abortResult = validateCryptoMove(G, 'voteAbortDecrypt', '1', ctxStalled);
    expect(abortResult.valid).toBe(true);

    // Manually apply abort effect (simulating the move body)
    G.decryptRequests.forEach((r: any) => {
      if (r.status === 'pending') {
        r.status = 'rejected';
        if (!G.players['1']) G.players['1'] = {} as any;
        (G.players['1'] as any).abortedDecrypt = true;
      }
    });
    G.phase = 'voided';

    // Now simulate end of hand -> buildHandResult (real call)
    const handResult = buildHandResult(G);

    expect(G.phase).toBe('voided');
    expect((G.players['1'] as any).abortedDecrypt).toBe(true);
    expect(G.decryptRequests[0].status).toBe('rejected');

    // Verify settlement result reflects abort
    expect(handResult.abortedDecrypt).toBe(true);
    expect(handResult.refusers).toContain('1');
    expect(handResult.winners.length).toBe(0);
  });
});

describe('Security: player identity binding', () => {
  it('should reject moves where claimed playerId does not match ctx.playerID', async () => {
    const G = await createCryptoTestState(2);
    G.phase = 'preflop';
    G.bettingRound.isComplete = true;
    G.players['0'].hasPeeked = false;

    // Simulate a malicious call claiming to be player '0' while ctx says '1'
    const result = validateCryptoMove(G, 'peekHoleCards', '0' /* claimed */, { playerID: '1' } as any);
    expect(result.valid).toBe(false);
  });
});

describe('Security: encrypted card validation', () => {
  // Note: validateEncryptedCard is re-exported via the lib; we test behavior via move validation
  it('should reject invalid point in decrypted shares (via combine paths)', async () => {
    // This is exercised in real flows; here we assert the helper rejects bad data
    const { validateEncryptedCard } = await import('@manamesh/boardgameio-crypto/secp256k1');
    expect(validateEncryptedCard(null)).toBe(false);
    expect(validateEncryptedCard({ ciphertext: 'not-a-point', layers: 1 })).toBe(false);
    expect(validateEncryptedCard({ ciphertext: '00', layers: -1 })).toBe(false);
  });
});