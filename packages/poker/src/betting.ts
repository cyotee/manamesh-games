/**
 * Poker Betting Logic
 *
 * Handles betting rounds, pot calculations, and side pots for Texas Hold'em.
 */

import {
  BasePokerState,
  PokerPlayerState,
  BettingRoundState,
  SidePot,
  PokerConfig,
} from './types';

// ============================================================================
// Betting Round Management
// ============================================================================

/**
 * Initialize a new betting round
 */
export function initBettingRound(
  state: BasePokerState,
  startingPlayer: string
): BettingRoundState {
  return {
    currentBet: 0,
    minRaise: state.bigBlindAmount,
    activePlayer: startingPlayer,
    actedPlayers: [],
    isComplete: false,
    lastAggressor: null,
  };
}

/**
 * Get the next active player (skips folded and all-in players)
 */
export function getNextActivePlayer(
  state: BasePokerState,
  currentPlayer: string
): string | null {
  const { playerOrder, players } = state;
  const currentIndex = playerOrder.indexOf(currentPlayer);
  if (currentIndex === -1) return null;

  for (let i = 1; i <= playerOrder.length; i++) {
    const nextIndex = (currentIndex + i) % playerOrder.length;
    const nextPlayer = playerOrder[nextIndex];
    const playerState = players[nextPlayer];

    // Skip folded players and all-in players (they can't act)
    if (!playerState.folded && !playerState.isAllIn) {
      return nextPlayer;
    }
  }

  return null; // No active players
}

/**
 * Check if betting round is complete
 */
export function isBettingRoundComplete(state: BasePokerState): boolean {
  const { players, bettingRound } = state;
  const activePlayers = Object.entries(players).filter(
    ([_, p]) => !p.folded && !p.isAllIn
  );

  // If only one player remains, round is complete
  if (activePlayers.length <= 1) return true;

  // All active players must have acted
  for (const [playerId, player] of activePlayers) {
    if (!player.hasActed) return false;
    // And their bet must match the current bet
    if (player.bet < bettingRound.currentBet) return false;
  }

  return true;
}

/**
 * Get players still in the hand (not folded)
 */
export function getActivePlayerIds(state: BasePokerState): string[] {
  return Object.entries(state.players)
    .filter(([_, p]) => !p.folded)
    .map(([id]) => id);
}

/**
 * Get players who can still act (not folded, not all-in)
 */
export function getActingPlayerIds(state: BasePokerState): string[] {
  return Object.entries(state.players)
    .filter(([_, p]) => !p.folded && !p.isAllIn)
    .map(([id]) => id);
}

/**
 * Count active players (not folded)
 */
export function countActivePlayers(state: BasePokerState): number {
  return Object.values(state.players).filter((p) => !p.folded).length;
}

// ============================================================================
// Betting Actions
// ============================================================================

/**
 * Process a fold action
 */
export function processFold(
  state: BasePokerState,
  playerId: string
): { valid: boolean; error?: string } {
  const player = state.players[playerId];
  if (!player) return { valid: false, error: 'Player not found' };
  if (player.folded) return { valid: false, error: 'Already folded' };
  if (player.isAllIn) return { valid: false, error: 'Cannot fold when all-in' };

  player.folded = true;
  player.hasActed = true;

  return { valid: true };
}

/**
 * Process a check action
 */
export function processCheck(
  state: BasePokerState,
  playerId: string
): { valid: boolean; error?: string } {
  const player = state.players[playerId];
  if (!player) return { valid: false, error: 'Player not found' };
  if (player.folded) return { valid: false, error: 'Already folded' };
  if (player.isAllIn) return { valid: false, error: 'Cannot check when all-in' };

  // Can only check if no bet to call
  if (player.bet < state.bettingRound.currentBet) {
    return { valid: false, error: 'Cannot check, must call or fold' };
  }

  player.hasActed = true;

  return { valid: true };
}

/**
 * Process a call action
 */
export function processCall(
  state: BasePokerState,
  playerId: string
): { valid: boolean; error?: string; amount?: number } {
  const player = state.players[playerId];
  if (!player) return { valid: false, error: 'Player not found' };
  if (player.folded) return { valid: false, error: 'Already folded' };
  if (player.isAllIn) return { valid: false, error: 'Already all-in' };

  const toCall = state.bettingRound.currentBet - player.bet;
  if (toCall <= 0) {
    return { valid: false, error: 'Nothing to call' };
  }

  // Calculate actual amount (may be less if going all-in)
  const actualAmount = Math.min(toCall, player.chips);

  player.chips -= actualAmount;
  player.bet += actualAmount;
  state.pot += actualAmount;
  player.hasActed = true;

  if (player.chips === 0) {
    player.isAllIn = true;
  }

  return { valid: true, amount: actualAmount };
}

/**
 * Process a bet action (opening bet when no current bet)
 */
export function processBet(
  state: BasePokerState,
  playerId: string,
  amount: number
): { valid: boolean; error?: string } {
  const player = state.players[playerId];
  if (!player) return { valid: false, error: 'Player not found' };
  if (player.folded) return { valid: false, error: 'Already folded' };
  if (player.isAllIn) return { valid: false, error: 'Already all-in' };

  // Can only bet if no current bet
  if (state.bettingRound.currentBet > 0) {
    return { valid: false, error: 'Cannot bet, must raise' };
  }

  // Minimum bet is big blind
  if (amount < state.bigBlindAmount && amount < player.chips) {
    return { valid: false, error: `Minimum bet is ${state.bigBlindAmount}` };
  }

  // Cannot bet more than chips
  if (amount > player.chips) {
    return { valid: false, error: 'Insufficient chips' };
  }

  player.chips -= amount;
  player.bet = amount;
  state.pot += amount;
  state.bettingRound.currentBet = amount;
  state.bettingRound.minRaise = amount;
  state.bettingRound.lastAggressor = playerId;
  player.hasActed = true;

  // Reset hasActed for other players (they now have a bet to respond to)
  for (const [id, p] of Object.entries(state.players)) {
    if (id !== playerId && !p.folded && !p.isAllIn) {
      p.hasActed = false;
    }
  }

  if (player.chips === 0) {
    player.isAllIn = true;
  }

  return { valid: true };
}

/**
 * Process a raise action
 */
export function processRaise(
  state: BasePokerState,
  playerId: string,
  totalBet: number
): { valid: boolean; error?: string } {
  const player = state.players[playerId];
  if (!player) return { valid: false, error: 'Player not found' };
  if (player.folded) return { valid: false, error: 'Already folded' };
  if (player.isAllIn) return { valid: false, error: 'Already all-in' };

  const raiseAmount = totalBet - state.bettingRound.currentBet;
  const toContribute = totalBet - player.bet;

  // Minimum raise
  if (raiseAmount < state.bettingRound.minRaise && toContribute < player.chips) {
    return { valid: false, error: `Minimum raise is ${state.bettingRound.minRaise}` };
  }

  // Cannot raise more than chips
  if (toContribute > player.chips) {
    return { valid: false, error: 'Insufficient chips' };
  }

  player.chips -= toContribute;
  state.pot += toContribute;
  state.bettingRound.minRaise = raiseAmount;
  state.bettingRound.currentBet = totalBet;
  state.bettingRound.lastAggressor = playerId;
  player.bet = totalBet;
  player.hasActed = true;

  // Reset hasActed for other players
  for (const [id, p] of Object.entries(state.players)) {
    if (id !== playerId && !p.folded && !p.isAllIn) {
      p.hasActed = false;
    }
  }

  if (player.chips === 0) {
    player.isAllIn = true;
  }

  return { valid: true };
}

/**
 * Process an all-in action
 */
export function processAllIn(
  state: BasePokerState,
  playerId: string
): { valid: boolean; error?: string; isRaise: boolean } {
  const player = state.players[playerId];
  if (!player) return { valid: false, error: 'Player not found', isRaise: false };
  if (player.folded) return { valid: false, error: 'Already folded', isRaise: false };
  if (player.isAllIn) return { valid: false, error: 'Already all-in', isRaise: false };

  const allInAmount = player.chips;
  const newTotalBet = player.bet + allInAmount;
  const isRaise = newTotalBet > state.bettingRound.currentBet;

  player.chips = 0;
  state.pot += allInAmount;
  player.bet = newTotalBet;
  player.isAllIn = true;
  player.hasActed = true;

  if (isRaise) {
    const raiseAmount = newTotalBet - state.bettingRound.currentBet;
    // Only update minRaise if this is a full raise
    if (raiseAmount >= state.bettingRound.minRaise) {
      state.bettingRound.minRaise = raiseAmount;
      state.bettingRound.lastAggressor = playerId;
      // Reset hasActed for other players
      for (const [id, p] of Object.entries(state.players)) {
        if (id !== playerId && !p.folded && !p.isAllIn) {
          p.hasActed = false;
        }
      }
    }
    state.bettingRound.currentBet = newTotalBet;
  }

  return { valid: true, isRaise };
}

// ============================================================================
// Pot Management
// ============================================================================

/**
 * Calculate side pots when there are all-in players
 */
export function calculateSidePots(state: BasePokerState): SidePot[] {
  const activePlayers = Object.entries(state.players)
    .filter(([_, p]) => !p.folded)
    .map(([id, p]) => ({ id, bet: p.bet }));

  if (activePlayers.length === 0) return [];

  // Sort by bet amount
  activePlayers.sort((a, b) => a.bet - b.bet);

  const sidePots: SidePot[] = [];
  let prevBet = 0;

  for (let i = 0; i < activePlayers.length; i++) {
    const currentBet = activePlayers[i].bet;
    if (currentBet > prevBet) {
      const betDiff = currentBet - prevBet;
      // All players from this point forward are eligible
      const eligiblePlayers = activePlayers.slice(i).map((p) => p.id);
      // Also include players who bet at least this much
      const allEligible = activePlayers
        .filter((p) => p.bet >= currentBet)
        .map((p) => p.id);

      // Calculate pot amount (betDiff * number of contributors at this level)
      const contributors = activePlayers.filter((p) => p.bet >= currentBet).length;
      const potAmount = betDiff * contributors;

      if (potAmount > 0) {
        sidePots.push({
          amount: potAmount,
          eligiblePlayers: allEligible,
        });
      }

      prevBet = currentBet;
    }
  }

  return sidePots;
}

/**
 * Reset bets for new betting round
 */
export function resetBetsForNewRound(state: BasePokerState): void {
  for (const player of Object.values(state.players)) {
    player.bet = 0;
    player.hasActed = false;
  }
}

/**
 * Collect bets into pot at end of betting round
 */
export function collectBets(state: BasePokerState): void {
  // Bets are already added to pot incrementally
  // Just reset player bets
  for (const player of Object.values(state.players)) {
    player.bet = 0;
  }
}

// ============================================================================
// Position Management
// ============================================================================

/**
 * Get small blind player (left of dealer)
 */
export function getSmallBlindPlayer(state: BasePokerState): string {
  const dealerIndex = state.playerOrder.indexOf(state.dealer);
  const sbIndex = (dealerIndex + 1) % state.playerOrder.length;
  return state.playerOrder[sbIndex];
}

/**
 * Get big blind player (left of small blind)
 */
export function getBigBlindPlayer(state: BasePokerState): string {
  const dealerIndex = state.playerOrder.indexOf(state.dealer);
  const bbIndex = (dealerIndex + 2) % state.playerOrder.length;
  return state.playerOrder[bbIndex];
}

/**
 * Get UTG player (first to act preflop, left of big blind)
 */
export function getUTGPlayer(state: BasePokerState): string {
  const dealerIndex = state.playerOrder.indexOf(state.dealer);
  const utgIndex = (dealerIndex + 3) % state.playerOrder.length;
  return state.playerOrder[utgIndex];
}

/**
 * Get first to act postflop (left of dealer)
 */
export function getFirstToActPostflop(state: BasePokerState): string | null {
  const dealerIndex = state.playerOrder.indexOf(state.dealer);

  // Find first non-folded player left of dealer
  for (let i = 1; i <= state.playerOrder.length; i++) {
    const index = (dealerIndex + i) % state.playerOrder.length;
    const playerId = state.playerOrder[index];
    if (!state.players[playerId].folded && !state.players[playerId].isAllIn) {
      return playerId;
    }
  }

  return null;
}

/**
 * Post blinds at start of hand
 */
export function postBlinds(state: BasePokerState): void {
  const sbPlayer = state.players[state.smallBlind];
  const bbPlayer = state.players[state.bigBlind];

  // Post small blind
  const sbAmount = Math.min(state.smallBlindAmount, sbPlayer.chips);
  sbPlayer.chips -= sbAmount;
  sbPlayer.bet = sbAmount;
  state.pot += sbAmount;
  if (sbPlayer.chips === 0) sbPlayer.isAllIn = true;

  // Post big blind
  const bbAmount = Math.min(state.bigBlindAmount, bbPlayer.chips);
  bbPlayer.chips -= bbAmount;
  bbPlayer.bet = bbAmount;
  state.pot += bbAmount;
  if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;

  // Set current bet to big blind
  state.bettingRound.currentBet = bbAmount;
  state.bettingRound.minRaise = state.bigBlindAmount;
}

/**
 * Rotate dealer button
 */
export function rotateDealer(state: BasePokerState): void {
  const currentIndex = state.playerOrder.indexOf(state.dealer);
  const nextIndex = (currentIndex + 1) % state.playerOrder.length;
  state.dealer = state.playerOrder[nextIndex];
  state.smallBlind = getSmallBlindPlayer(state);
  state.bigBlind = getBigBlindPlayer(state);
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if player can make a specific action
 */
export function canPlayerAct(
  state: BasePokerState,
  playerId: string,
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn'
): boolean {
  const player = state.players[playerId];
  if (!player || player.folded || player.isAllIn) return false;

  switch (action) {
    case 'fold':
      return true;

    case 'check':
      return player.bet >= state.bettingRound.currentBet;

    case 'call':
      return player.bet < state.bettingRound.currentBet;

    case 'bet':
      return state.bettingRound.currentBet === 0 && player.chips > 0;

    case 'raise':
      return state.bettingRound.currentBet > 0 && player.chips > 0;

    case 'allIn':
      return player.chips > 0;

    default:
      return false;
  }
}

/**
 * Get valid actions for a player
 */
export function getValidActions(
  state: BasePokerState,
  playerId: string
): ('fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn')[] {
  const actions: ('fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn')[] = [];

  if (canPlayerAct(state, playerId, 'fold')) actions.push('fold');
  if (canPlayerAct(state, playerId, 'check')) actions.push('check');
  if (canPlayerAct(state, playerId, 'call')) actions.push('call');
  if (canPlayerAct(state, playerId, 'bet')) actions.push('bet');
  if (canPlayerAct(state, playerId, 'raise')) actions.push('raise');
  if (canPlayerAct(state, playerId, 'allIn')) actions.push('allIn');

  return actions;
}
