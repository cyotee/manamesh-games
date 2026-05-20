/**
 * Standard Poker Game Module
 *
 * Implementation of Texas Hold'em for boardgame.io.
 * This is the trusted-server version; see crypto.ts for the P2P mental poker version.
 */

import type { Game, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { CardSchema, GameConfig, MoveValidation } from '@manamesh/frontend/src/game/modules/types';
import {
  PokerCard,
  PokerState,
  PokerPlayerState,
  PokerPhase,
  BettingRoundState,
  POKER_ZONES,
  PokerConfig,
  DEFAULT_POKER_CONFIG,
  RANK_VALUES,
  SUIT_VALUES,
} from './types';
import {
  initBettingRound,
  getNextActivePlayer,
  isBettingRoundComplete,
  getActivePlayerIds,
  countActivePlayers,
  processFold,
  processCheck,
  processCall,
  processBet,
  processRaise,
  processAllIn,
  calculateSidePots,
  resetBetsForNewRound,
  collectBets,
  getSmallBlindPlayer,
  getBigBlindPlayer,
  getUTGPlayer,
  getFirstToActPostflop,
  postBlinds,
  rotateDealer,
  canPlayerAct,
  getValidActions,
} from './betting';
import {
  evaluateHand,
  compareHands,
  findBestHand,
  determineWinners,
} from './hands';

// =============================================================================
// Constants
// =============================================================================

const SUITS: PokerCard['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: PokerCard['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// =============================================================================
// Card Creation
// =============================================================================

/**
 * Create a standard 52-card deck.
 */
export function createStandardDeck(): PokerCard[] {
  const deck: PokerCard[] = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${suit}-${rank}`,
        name: `${rank} of ${suit}`,
        suit,
        rank,
      });
    }
  }

  return deck;
}

/**
 * Fisher-Yates shuffle.
 */
export function shuffleDeck<T>(deck: T[]): T[] {
  const result = deck.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// =============================================================================
// State Management
// =============================================================================

/**
 * Create initial game state.
 */
export function createInitialState(config: GameConfig): PokerState {
  const pokerConfig: PokerConfig = {
    ...DEFAULT_POKER_CONFIG,
    ...config.options,
  };

  const deck = shuffleDeck(createStandardDeck());

  const players: Record<string, PokerPlayerState> = {};
  const zones: Record<string, Record<string, PokerCard[]>> = {
    deck: { shared: deck },
    hand: {},
    community: { shared: [] },
    discard: { shared: [] },
    mucked: { shared: [] },
  };

  // Initialize player states
  for (const playerId of config.playerIDs) {
    players[playerId] = {
      hand: [],
      chips: pokerConfig.startingChips,
      bet: 0,
      folded: false,
      hasActed: false,
      isAllIn: false,
    };
    zones.hand[playerId] = [];
  }

  const playerOrder = [...config.playerIDs];
  const dealer = playerOrder[0];

  const state: PokerState = {
    deck,
    community: [],
    pot: 0,
    sidePots: [],
    players,
    dealer,
    smallBlind: playerOrder.length > 2 ? playerOrder[1] : playerOrder[0],
    bigBlind: playerOrder.length > 2 ? playerOrder[2] : playerOrder[1],
    phase: 'waiting',
    bettingRound: {
      currentBet: 0,
      minRaise: pokerConfig.bigBlind,
      activePlayer: '',
      actedPlayers: [],
      isComplete: false,
      lastAggressor: null,
    },
    smallBlindAmount: pokerConfig.smallBlind,
    bigBlindAmount: pokerConfig.bigBlind,
    playerOrder,
    winners: [],
    zones,
  };

  // Update positions based on actual player order
  state.smallBlind = getSmallBlindPlayer(state);
  state.bigBlind = getBigBlindPlayer(state);

  return state;
}

/**
 * Sync zones from player and deck state.
 */
function syncZones(state: PokerState): void {
  state.zones.deck.shared = state.deck;
  state.zones.community.shared = state.community;

  for (const playerId of Object.keys(state.players)) {
    state.zones.hand[playerId] = state.players[playerId].hand;
  }
}

/**
 * Deal cards from deck to a player's hand.
 */
function dealToPlayer(state: PokerState, playerId: string, count: number): void {
  const player = state.players[playerId];
  for (let i = 0; i < count; i++) {
    const card = state.deck.pop();
    if (card) {
      player.hand.push(card);
    }
  }
  syncZones(state);
}

/**
 * Deal cards to community.
 */
function dealToCommunity(state: PokerState, count: number): void {
  for (let i = 0; i < count; i++) {
    const card = state.deck.pop();
    if (card) {
      state.community.push(card);
    }
  }
  syncZones(state);
}

/**
 * Burn a card (move to discard).
 */
function burnCard(state: PokerState): void {
  const card = state.deck.pop();
  if (card) {
    state.zones.discard.shared.push(card);
  }
}

// =============================================================================
// Game Phase Management
// =============================================================================

/**
 * Start a new hand.
 */
export function startHand(state: PokerState): void {
  // Reset deck
  state.deck = shuffleDeck(createStandardDeck());
  state.community = [];
  state.pot = 0;
  state.sidePots = [];
  state.winners = [];

  // Reset player states
  for (const player of Object.values(state.players)) {
    player.hand = [];
    player.bet = 0;
    player.folded = false;
    player.hasActed = false;
    player.isAllIn = false;
  }

  // Reset zones
  state.zones.discard.shared = [];
  state.zones.mucked.shared = [];
  syncZones(state);

  // Post blinds
  postBlinds(state);

  // Deal hole cards (2 to each player)
  for (const playerId of state.playerOrder) {
    dealToPlayer(state, playerId, 2);
  }

  // Set phase and first to act
  state.phase = 'preflop';

  // Preflop: action starts UTG (left of big blind)
  const utgPlayer = getUTGPlayer(state);
  state.bettingRound = initBettingRound(state, utgPlayer);
  state.bettingRound.currentBet = state.bigBlindAmount;
}

/**
 * Advance to next phase after betting round.
 */
function advancePhase(state: PokerState): void {
  collectBets(state);
  resetBetsForNewRound(state);

  // Check if only one player remains
  if (countActivePlayers(state) === 1) {
    state.phase = 'showdown';
    return;
  }

  const nextPhases: Record<PokerPhase, PokerPhase> = {
    waiting: 'preflop',
    preflop: 'flop',
    flop: 'turn',
    turn: 'river',
    river: 'showdown',
    showdown: 'gameOver',
    gameOver: 'waiting',
  };

  const nextPhase = nextPhases[state.phase];

  switch (nextPhase) {
    case 'flop':
      burnCard(state);
      dealToCommunity(state, 3);
      break;
    case 'turn':
    case 'river':
      burnCard(state);
      dealToCommunity(state, 1);
      break;
    case 'showdown':
      resolveShowdown(state);
      return;
  }

  state.phase = nextPhase;

  // Initialize betting round for post-flop phases
  if (['flop', 'turn', 'river'].includes(nextPhase)) {
    const firstToAct = getFirstToActPostflop(state);
    if (firstToAct) {
      state.bettingRound = initBettingRound(state, firstToAct);
    } else {
      // All players all-in, go to showdown
      advancePhase(state);
    }
  }
}

/**
 * Resolve showdown and award pot.
 */
function resolveShowdown(state: PokerState): void {
  state.phase = 'showdown';

  const activePlayers = getActivePlayerIds(state);

  // If only one player, they win by default
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    state.players[winner].chips += state.pot;
    state.winners = [winner];
    state.phase = 'gameOver';
    return;
  }

  // Evaluate all hands
  const playerHands = new Map(
    activePlayers.map((playerId) => {
      const player = state.players[playerId];
      const hand = findBestHand(player.hand, state.community);
      return [playerId, hand];
    })
  );

  // Determine winners
  const winners = determineWinners(playerHands);
  state.winners = winners;

  // Award pot (split if tie)
  const share = Math.floor(state.pot / winners.length);
  const remainder = state.pot % winners.length;

  for (let i = 0; i < winners.length; i++) {
    const winner = winners[i];
    // First winner gets any remainder
    state.players[winner].chips += share + (i === 0 ? remainder : 0);
  }

  state.pot = 0;
  state.phase = 'gameOver';
}

// =============================================================================
// Move Functions
// =============================================================================

/**
 * Fold move.
 */
function fold(G: PokerState, ctx: Ctx, playerId?: string): PokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processFold(G, pid);
  if (!result.valid) return INVALID_MOVE;

  // Advance to next player or end betting round
  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  syncZones(G);
  return G;
}

/**
 * Check move.
 */
function check(G: PokerState, ctx: Ctx, playerId?: string): PokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processCheck(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  return G;
}

/**
 * Call move.
 */
function call(G: PokerState, ctx: Ctx, playerId?: string): PokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processCall(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  return G;
}

/**
 * Bet move (opening bet when no current bet).
 */
function bet(
  G: PokerState,
  ctx: Ctx,
  amount: number,
  playerId?: string
): PokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processBet(G, pid, amount);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer) {
    G.bettingRound.activePlayer = nextPlayer;
  }

  return G;
}

/**
 * Raise move.
 */
function raise(
  G: PokerState,
  ctx: Ctx,
  totalBet: number,
  playerId?: string
): PokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processRaise(G, pid, totalBet);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer) {
    G.bettingRound.activePlayer = nextPlayer;
  }

  return G;
}

/**
 * All-in move.
 */
function allIn(G: PokerState, ctx: Ctx, playerId?: string): PokerState | typeof INVALID_MOVE {
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processAllIn(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G);
  }

  return G;
}

/**
 * Start new hand move.
 */
function newHand(G: PokerState, ctx: Ctx): PokerState | typeof INVALID_MOVE {
  if (G.phase !== 'waiting' && G.phase !== 'gameOver') {
    return INVALID_MOVE;
  }

  // Rotate dealer for new hand
  if (G.phase === 'gameOver') {
    rotateDealer(G);
  }

  startHand(G);
  return G;
}

// =============================================================================
// Card Schema
// =============================================================================

export const pokerCardSchema: CardSchema<PokerCard> = {
  validate: (card: unknown): card is PokerCard => {
    if (typeof card !== 'object' || card === null) return false;
    const c = card as Record<string, unknown>;
    return (
      typeof c.id === 'string' &&
      typeof c.name === 'string' &&
      typeof c.suit === 'string' &&
      ['hearts', 'diamonds', 'clubs', 'spades'].includes(c.suit) &&
      typeof c.rank === 'string' &&
      ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].includes(c.rank)
    );
  },
  create: (data) => ({
    id: data.id as string,
    name: data.name as string,
    suit: (data.suit as PokerCard['suit']) ?? 'hearts',
    rank: (data.rank as PokerCard['rank']) ?? 'A',
  }),
  getAssetKey: (card) => `${card.suit}-${card.rank}`,
};

// =============================================================================
// Move Validation
// =============================================================================

export function validateMove(
  state: PokerState,
  move: string,
  playerId: string,
  ...args: unknown[]
): MoveValidation {
  switch (move) {
    case 'fold':
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: 'Not your turn' };
      }
      if (!canPlayerAct(state, playerId, 'fold')) {
        return { valid: false, error: 'Cannot fold' };
      }
      return { valid: true };

    case 'check':
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: 'Not your turn' };
      }
      if (!canPlayerAct(state, playerId, 'check')) {
        return { valid: false, error: 'Cannot check' };
      }
      return { valid: true };

    case 'call':
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: 'Not your turn' };
      }
      if (!canPlayerAct(state, playerId, 'call')) {
        return { valid: false, error: 'Cannot call' };
      }
      return { valid: true };

    case 'bet':
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: 'Not your turn' };
      }
      if (!canPlayerAct(state, playerId, 'bet')) {
        return { valid: false, error: 'Cannot bet' };
      }
      const betAmount = args[0] as number;
      if (typeof betAmount !== 'number' || betAmount < state.bigBlindAmount) {
        return { valid: false, error: `Minimum bet is ${state.bigBlindAmount}` };
      }
      return { valid: true };

    case 'raise':
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: 'Not your turn' };
      }
      if (!canPlayerAct(state, playerId, 'raise')) {
        return { valid: false, error: 'Cannot raise' };
      }
      return { valid: true };

    case 'allIn':
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: 'Not your turn' };
      }
      if (!canPlayerAct(state, playerId, 'allIn')) {
        return { valid: false, error: 'Cannot go all-in' };
      }
      return { valid: true };

    case 'newHand':
      if (state.phase !== 'waiting' && state.phase !== 'gameOver') {
        return { valid: false, error: 'Cannot start new hand now' };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Unknown move: ${move}` };
  }
}

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

/**
 * Poker game for boardgame.io.
 */
export const PokerGame: Game<PokerState> = {
  name: 'poker',

  setup: (ctx): PokerState => {
    return createInitialState({
      numPlayers: (ctx.numPlayers as number) ?? 2,
      playerIDs: (ctx.playOrder as string[]) ?? ['0', '1'],
    });
  },

  turn: {
    // Poker uses sequential turns, action is controlled by bettingRound.activePlayer
    order: {
      first: () => 0,
      next: ({ G }) => {
        const activeIndex = G.playerOrder.indexOf(G.bettingRound.activePlayer);
        return activeIndex >= 0 ? activeIndex : 0;
      },
    },
  },

  phases: {
    play: {
      start: true,
      moves: {
        fold: {
          move: ({ G, ctx }, playerId?: string) => fold(G, ctx, playerId),
          client: false,
        },
        check: {
          move: ({ G, ctx }, playerId?: string) => check(G, ctx, playerId),
          client: false,
        },
        call: {
          move: ({ G, ctx }, playerId?: string) => call(G, ctx, playerId),
          client: false,
        },
        bet: {
          move: ({ G, ctx }, amount: number, playerId?: string) => bet(G, ctx, amount, playerId),
          client: false,
        },
        raise: {
          move: ({ G, ctx }, totalBet: number, playerId?: string) => raise(G, ctx, totalBet, playerId),
          client: false,
        },
        allIn: {
          move: ({ G, ctx }, playerId?: string) => allIn(G, ctx, playerId),
          client: false,
        },
        newHand: {
          move: ({ G, ctx }) => newHand(G, ctx),
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    // Game ends when only one player has chips
    const playersWithChips = Object.entries(G.players).filter(
      ([_, p]) => p.chips > 0
    );
    if (playersWithChips.length === 1) {
      return { winner: playersWithChips[0][0] };
    }
    return undefined;
  },
};

// =============================================================================
// Module Export
// =============================================================================

export const PokerModule = {
  id: 'poker',
  name: 'Texas Hold\'em',
  version: '1.0.0',
  description: 'Texas Hold\'em Poker - community cards and betting rounds',

  cardSchema: pokerCardSchema,
  zones: POKER_ZONES,

  assetRequirements: {
    required: ['card_face'] as const,
    optional: ['card_back'] as const,
    idFormat: 'standard_52' as const,
  },

  initialState: createInitialState,
  validateMove,
  getBoardgameIOGame: () => PokerGame,

  zoneLayout: {
    zones: {
      deck: { x: 10, y: 50, width: 10, height: 15, cardArrangement: 'stack' as const },
      community: { x: 30, y: 50, width: 40, height: 15, cardArrangement: 'fan' as const },
      hand: { x: 50, y: 85, width: 20, height: 15, cardArrangement: 'fan' as const },
      discard: { x: 80, y: 50, width: 10, height: 15, cardArrangement: 'stack' as const },
    },
    defaultCardSize: { width: 63, height: 88 },
  },
};

export default PokerModule;
