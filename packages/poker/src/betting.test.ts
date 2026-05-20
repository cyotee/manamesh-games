/**
 * Poker Betting Logic Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initBettingRound,
  getNextActivePlayer,
  isBettingRoundComplete,
  getActivePlayerIds,
  getActingPlayerIds,
  countActivePlayers,
  processFold,
  processCheck,
  processCall,
  processBet,
  processRaise,
  processAllIn,
  calculateSidePots,
  getSmallBlindPlayer,
  getBigBlindPlayer,
  getUTGPlayer,
  postBlinds,
  canPlayerAct,
  getValidActions,
} from './betting';
import type { BasePokerState, PokerPlayerState } from './types';

// Helper to create a basic game state
function createTestState(
  numPlayers: number = 3,
  startingChips: number = 1000
): BasePokerState {
  const playerOrder = Array.from({ length: numPlayers }, (_, i) => `player${i}`);
  const players: Record<string, PokerPlayerState> = {};

  for (const playerId of playerOrder) {
    players[playerId] = {
      hand: [],
      chips: startingChips,
      bet: 0,
      folded: false,
      hasActed: false,
      isAllIn: false,
    };
  }

  return {
    community: [],
    pot: 0,
    sidePots: [],
    players,
    dealer: playerOrder[0],
    smallBlind: playerOrder[1],
    bigBlind: playerOrder[2] ?? playerOrder[0],
    bettingRound: {
      currentBet: 0,
      minRaise: 20,
      activePlayer: playerOrder[0],
      actedPlayers: [],
      isComplete: false,
      lastAggressor: null,
    },
    smallBlindAmount: 10,
    bigBlindAmount: 20,
    playerOrder,
    winners: [],
    zones: {},
  };
}

describe('initBettingRound', () => {
  it('should initialize betting round with correct starting player', () => {
    const state = createTestState();
    const round = initBettingRound(state, 'player1');

    expect(round.currentBet).toBe(0);
    expect(round.minRaise).toBe(20);
    expect(round.activePlayer).toBe('player1');
    expect(round.actedPlayers).toEqual([]);
    expect(round.isComplete).toBe(false);
    expect(round.lastAggressor).toBeNull();
  });
});

describe('getNextActivePlayer', () => {
  it('should return next active player', () => {
    const state = createTestState();
    expect(getNextActivePlayer(state, 'player0')).toBe('player1');
    expect(getNextActivePlayer(state, 'player1')).toBe('player2');
    expect(getNextActivePlayer(state, 'player2')).toBe('player0');
  });

  it('should skip folded players', () => {
    const state = createTestState();
    state.players.player1.folded = true;
    expect(getNextActivePlayer(state, 'player0')).toBe('player2');
  });

  it('should skip all-in players', () => {
    const state = createTestState();
    state.players.player1.isAllIn = true;
    expect(getNextActivePlayer(state, 'player0')).toBe('player2');
  });

  it('should return null if no active players', () => {
    const state = createTestState();
    state.players.player0.folded = true;
    state.players.player1.folded = true;
    state.players.player2.folded = true;
    expect(getNextActivePlayer(state, 'player0')).toBeNull();
  });
});

describe('isBettingRoundComplete', () => {
  it('should return false if not all players have acted', () => {
    const state = createTestState();
    expect(isBettingRoundComplete(state)).toBe(false);
  });

  it('should return true if only one player remains', () => {
    const state = createTestState();
    state.players.player0.folded = true;
    state.players.player1.folded = true;
    expect(isBettingRoundComplete(state)).toBe(true);
  });

  it('should return true when all players have acted and matched bet', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;

    for (const player of Object.values(state.players)) {
      player.hasActed = true;
      player.bet = 50;
    }

    expect(isBettingRoundComplete(state)).toBe(true);
  });

  it('should return false if a player has not matched the current bet', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;

    state.players.player0.hasActed = true;
    state.players.player0.bet = 50;
    state.players.player1.hasActed = true;
    state.players.player1.bet = 50;
    state.players.player2.hasActed = true;
    state.players.player2.bet = 20; // Hasn't matched

    expect(isBettingRoundComplete(state)).toBe(false);
  });
});

describe('getActivePlayerIds', () => {
  it('should return players who have not folded', () => {
    const state = createTestState();
    state.players.player1.folded = true;

    const active = getActivePlayerIds(state);
    expect(active).toContain('player0');
    expect(active).not.toContain('player1');
    expect(active).toContain('player2');
  });
});

describe('getActingPlayerIds', () => {
  it('should return players who can act (not folded, not all-in)', () => {
    const state = createTestState();
    state.players.player0.folded = true;
    state.players.player1.isAllIn = true;

    const acting = getActingPlayerIds(state);
    expect(acting).not.toContain('player0');
    expect(acting).not.toContain('player1');
    expect(acting).toContain('player2');
  });
});

describe('countActivePlayers', () => {
  it('should count non-folded players', () => {
    const state = createTestState();
    expect(countActivePlayers(state)).toBe(3);

    state.players.player0.folded = true;
    expect(countActivePlayers(state)).toBe(2);
  });
});

describe('processFold', () => {
  it('should fold a player', () => {
    const state = createTestState();
    const result = processFold(state, 'player0');

    expect(result.valid).toBe(true);
    expect(state.players.player0.folded).toBe(true);
    expect(state.players.player0.hasActed).toBe(true);
  });

  it('should reject fold if player already folded', () => {
    const state = createTestState();
    state.players.player0.folded = true;

    const result = processFold(state, 'player0');
    expect(result.valid).toBe(false);
  });

  it('should reject fold if player is all-in', () => {
    const state = createTestState();
    state.players.player0.isAllIn = true;

    const result = processFold(state, 'player0');
    expect(result.valid).toBe(false);
  });
});

describe('processCheck', () => {
  it('should allow check when no bet to call', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 0;

    const result = processCheck(state, 'player0');
    expect(result.valid).toBe(true);
    expect(state.players.player0.hasActed).toBe(true);
  });

  it('should allow check when bet is already matched', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 20;
    state.players.player0.bet = 20;

    const result = processCheck(state, 'player0');
    expect(result.valid).toBe(true);
  });

  it('should reject check when there is a bet to call', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;

    const result = processCheck(state, 'player0');
    expect(result.valid).toBe(false);
  });
});

describe('processCall', () => {
  it('should call the current bet', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;

    const result = processCall(state, 'player0');

    expect(result.valid).toBe(true);
    expect(result.amount).toBe(50);
    expect(state.players.player0.bet).toBe(50);
    expect(state.players.player0.chips).toBe(950);
    expect(state.pot).toBe(50);
  });

  it('should go all-in when calling with insufficient chips', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 1500;

    const result = processCall(state, 'player0');

    expect(result.valid).toBe(true);
    expect(result.amount).toBe(1000); // Only has 1000
    expect(state.players.player0.isAllIn).toBe(true);
  });

  it('should reject call when nothing to call', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 0;

    const result = processCall(state, 'player0');
    expect(result.valid).toBe(false);
  });
});

describe('processBet', () => {
  it('should place a bet', () => {
    const state = createTestState();

    const result = processBet(state, 'player0', 100);

    expect(result.valid).toBe(true);
    expect(state.players.player0.bet).toBe(100);
    expect(state.players.player0.chips).toBe(900);
    expect(state.bettingRound.currentBet).toBe(100);
    expect(state.pot).toBe(100);
  });

  it('should reject bet less than big blind', () => {
    const state = createTestState();

    const result = processBet(state, 'player0', 10);
    expect(result.valid).toBe(false);
  });

  it('should reject bet when there is already a bet', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;

    const result = processBet(state, 'player0', 100);
    expect(result.valid).toBe(false);
  });

  it('should reset hasActed for other players', () => {
    const state = createTestState();
    state.players.player1.hasActed = true;

    processBet(state, 'player0', 100);

    expect(state.players.player1.hasActed).toBe(false);
  });
});

describe('processRaise', () => {
  it('should raise the bet', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;
    state.players.player0.bet = 50;
    state.bettingRound.minRaise = 50;

    const result = processRaise(state, 'player1', 100);

    expect(result.valid).toBe(true);
    expect(state.players.player1.bet).toBe(100);
    expect(state.bettingRound.currentBet).toBe(100);
  });

  it('should reject raise below minimum', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;
    state.bettingRound.minRaise = 50;

    const result = processRaise(state, 'player0', 70); // Only raises 20
    expect(result.valid).toBe(false);
  });
});

describe('processAllIn', () => {
  it('should go all-in', () => {
    const state = createTestState();

    const result = processAllIn(state, 'player0');

    expect(result.valid).toBe(true);
    expect(state.players.player0.chips).toBe(0);
    expect(state.players.player0.isAllIn).toBe(true);
    expect(state.players.player0.bet).toBe(1000);
    expect(state.pot).toBe(1000);
  });
});

describe('calculateSidePots', () => {
  it('should calculate side pots for all-in situations', () => {
    const state = createTestState();
    state.players.player0.bet = 100;
    state.players.player0.isAllIn = true;
    state.players.player1.bet = 200;
    state.players.player1.isAllIn = true;
    state.players.player2.bet = 300;

    const sidePots = calculateSidePots(state);

    expect(sidePots.length).toBeGreaterThan(0);
    // Main pot should have all 3 eligible
    expect(sidePots[0].eligiblePlayers).toHaveLength(3);
  });
});

describe('Position functions', () => {
  it('should get small blind player', () => {
    const state = createTestState();
    expect(getSmallBlindPlayer(state)).toBe('player1');
  });

  it('should get big blind player', () => {
    const state = createTestState();
    expect(getBigBlindPlayer(state)).toBe('player2');
  });

  it('should get UTG player (3+ players)', () => {
    const state = createTestState(4);
    expect(getUTGPlayer(state)).toBe('player3');
  });
});

describe('postBlinds', () => {
  it('should post small and big blinds', () => {
    const state = createTestState();
    postBlinds(state);

    expect(state.players.player1.bet).toBe(10); // Small blind
    expect(state.players.player1.chips).toBe(990);
    expect(state.players.player2.bet).toBe(20); // Big blind
    expect(state.players.player2.chips).toBe(980);
    expect(state.pot).toBe(30);
    expect(state.bettingRound.currentBet).toBe(20);
  });
});

describe('canPlayerAct', () => {
  it('should allow fold for active player', () => {
    const state = createTestState();
    expect(canPlayerAct(state, 'player0', 'fold')).toBe(true);
  });

  it('should not allow check when bet is outstanding', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;
    expect(canPlayerAct(state, 'player0', 'check')).toBe(false);
  });

  it('should allow call when bet is outstanding', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;
    expect(canPlayerAct(state, 'player0', 'call')).toBe(true);
  });

  it('should not allow bet when there is already a bet', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;
    expect(canPlayerAct(state, 'player0', 'bet')).toBe(false);
  });

  it('should not allow actions for folded player', () => {
    const state = createTestState();
    state.players.player0.folded = true;
    expect(canPlayerAct(state, 'player0', 'fold')).toBe(false);
  });
});

describe('getValidActions', () => {
  it('should return valid actions for active player', () => {
    const state = createTestState();
    const actions = getValidActions(state, 'player0');

    expect(actions).toContain('fold');
    expect(actions).toContain('check');
    expect(actions).toContain('bet');
    expect(actions).toContain('allIn');
    expect(actions).not.toContain('call'); // No bet to call
    expect(actions).not.toContain('raise'); // No bet to raise
  });

  it('should return call/raise when bet is outstanding', () => {
    const state = createTestState();
    state.bettingRound.currentBet = 50;

    const actions = getValidActions(state, 'player0');

    expect(actions).toContain('fold');
    expect(actions).toContain('call');
    expect(actions).toContain('raise');
    expect(actions).not.toContain('check');
    expect(actions).not.toContain('bet');
  });
});
