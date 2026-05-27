/**
 * Poker Game Module Types
 *
 * Type definitions for Texas Hold'em poker with both
 * standard (trusted server) and crypto (mental poker) variants.
 */

import type { ZoneDefinition } from "@manamesh/frontend/src/game/modules/types";
import type { StandardCard, CoreCard } from "@manamesh/frontend/src/game/modules/types";
import type { CryptoPluginState } from "@manamesh/crypto/plugin/crypto-plugin";
import type { EncryptedCard } from "@manamesh/crypto/mental-poker";

// ============================================================================
// Card Types
// ============================================================================

/**
 * A poker card extends StandardCard with no additional properties
 */
export interface PokerCard extends StandardCard {
  // StandardCard already has suit, rank, id, name
}

/**
 * Suit values for comparison
 */
export const SUIT_VALUES: Record<string, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
};

/**
 * Rank values for comparison (Ace is high by default)
 */
export const RANK_VALUES: Record<string, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/**
 * Rank values when Ace is low (for A-2-3-4-5 straight)
 */
export const RANK_VALUES_ACE_LOW: Record<string, number> = {
  ...RANK_VALUES,
  A: 1,
};

// ============================================================================
// Hand Ranking Types
// ============================================================================

/**
 * Poker hand categories in ascending order of strength
 */
export enum HandRank {
  HIGH_CARD = 0,
  PAIR = 1,
  TWO_PAIR = 2,
  THREE_OF_A_KIND = 3,
  STRAIGHT = 4,
  FLUSH = 5,
  FULL_HOUSE = 6,
  FOUR_OF_A_KIND = 7,
  STRAIGHT_FLUSH = 8,
  ROYAL_FLUSH = 9,
}

/**
 * Human-readable hand rank names
 */
export const HAND_RANK_NAMES: Record<HandRank, string> = {
  [HandRank.HIGH_CARD]: "High Card",
  [HandRank.PAIR]: "Pair",
  [HandRank.TWO_PAIR]: "Two Pair",
  [HandRank.THREE_OF_A_KIND]: "Three of a Kind",
  [HandRank.STRAIGHT]: "Straight",
  [HandRank.FLUSH]: "Flush",
  [HandRank.FULL_HOUSE]: "Full House",
  [HandRank.FOUR_OF_A_KIND]: "Four of a Kind",
  [HandRank.STRAIGHT_FLUSH]: "Straight Flush",
  [HandRank.ROYAL_FLUSH]: "Royal Flush",
};

/**
 * Evaluated hand with ranking information
 */
export interface EvaluatedHand {
  /** The hand category */
  rank: HandRank;
  /** Values used for comparison within same rank (highest first) */
  values: number[];
  /** The 5 cards that make up the best hand */
  cards: PokerCard[];
  /** Human-readable description */
  description: string;
}

// ============================================================================
// Game State Types
// ============================================================================

/**
 * Game phases for standard poker
 */
export type PokerPhase =
  | "waiting"
  | "preflop"
  | "flop"
  | "turn"
  | "river"
  | "showdown"
  | "gameOver";

/**
 * Extended phases for crypto poker (includes setup phases)
 */
export type CryptoPokerPhase =
  | "keyExchange"
  | "encrypt"
  | "shuffle"
  | PokerPhase
  | "voided";

/**
 * Betting round state
 */
export interface BettingRoundState {
  /** Current bet amount to call */
  currentBet: number;
  /** Minimum raise amount */
  minRaise: number;
  /** Player who has the action */
  activePlayer: string;
  /** Players who have acted this round */
  actedPlayers: string[];
  /** Is the betting round complete? */
  isComplete: boolean;
  /** Last aggressive action (bet/raise) player */
  lastAggressor: string | null;
}

/**
 * Player state in standard poker
 */
export interface PokerPlayerState {
  /** Hole cards (2 cards) */
  hand: PokerCard[];
  /** Player's chip stack */
  chips: number;
  /** Current bet in this round */
  bet: number;
  /** Has the player folded? */
  folded: boolean;
  /** Has the player acted in this betting round? */
  hasActed: boolean;
  /** Is the player all-in? */
  isAllIn: boolean;
}

/**
 * Extended player state for crypto poker
 */
export interface CryptoPokerPlayerState extends PokerPlayerState {
  /** Player's public key for encryption */
  publicKey: string | null;
  /** Has completed encryption phase */
  hasEncrypted: boolean;
  /** Has completed shuffle phase */
  hasShuffled: boolean;
  /** Has peeked at their hole cards */
  hasPeeked: boolean;
  /** Decrypted hole cards (only visible to this player after peek) */
  peekedCards: PokerCard[];
  /** Has released decryption keys (for proving valid cards on fold) */
  keysReleased: boolean;
  /** Is currently connected */
  isConnected: boolean;
  /** Timestamp of last heartbeat */
  lastHeartbeat: number;
}

/**
 * Base poker state shared between standard and crypto variants.
 * This allows betting functions to work with both state types.
 */
export interface BasePokerState {
  /** Community cards (flop, turn, river) */
  community: PokerCard[];
  /** Total pot */
  pot: number;
  /** Side pots for all-in situations */
  sidePots: SidePot[];
  /** Per-player state (base type) */
  players: Record<string, PokerPlayerState>;
  /** Dealer button position (player ID) */
  dealer: string;
  /** Small blind position (player ID) */
  smallBlind: string;
  /** Big blind position (player ID) */
  bigBlind: string;
  /** Betting round state */
  bettingRound: BettingRoundState;
  /** Configured small blind amount */
  smallBlindAmount: number;
  /** Configured big blind amount */
  bigBlindAmount: number;
  /** Player order (for turn rotation) */
  playerOrder: string[];
  /** Winner(s) of the hand */
  winners: string[];
  /** Zone state for DeckPlugin compatibility */
  zones: Record<string, Record<string, PokerCard[]>>;
}

/**
 * Standard poker game state
 */
export interface PokerState extends BasePokerState {
  /** Cards in the deck */
  deck: PokerCard[];
  /** Current game phase */
  phase: PokerPhase;
}

/**
 * Side pot for all-in situations
 */
export interface SidePot {
  /** Amount in this pot */
  amount: number;
  /** Players eligible to win this pot */
  eligiblePlayers: string[];
}

/**
 * Crypto poker game state
 */
export interface CryptoPokerState extends Omit<BasePokerState, "players"> {
  /** Extended player state */
  players: Record<string, CryptoPokerPlayerState>;
  /** Extended phase */
  phase: CryptoPokerPhase;
  /** Crypto plugin state */
  crypto: CryptoPluginState;
  /** Original card IDs (before encryption) */
  cardIds: string[];
  /** Player order for setup phases */
  setupPlayerIndex: number;

  // Settlement support
  /** Unique hand identifier for blockchain settlement */
  handId: string;
  /** Total contributions per player (for settlement) */
  contributions: Record<string, number>;
  /** Starting chip counts at hand start (for settlement verification) */
  startingChips: Record<string, number>;

  /** Peek notifications for UI */
  peekNotifications: PeekNotification[];

  // Cooperative decryption support
  /** Pending decrypt requests requiring approval */
  decryptRequests: DecryptRequest[];
  /** Notifications for decrypt events */
  decryptNotifications: DecryptNotification[];

  // Key release tracking for fold integrity
  /** Cards released by a player (playerId -> PokerCard[]) */
  releasedCards: Record<string, PokerCard[]>;
  /** Recent folds with challenge window tracking */
  recentFolds: RecentFold[];
  /** Fold challenges indexed by folded player */
  foldChallenges: FoldChallenge[];
}

/**
 * Record of a player folding
 */
export interface RecentFold {
  playerId: string;
  timestamp: number;
  challengeWindowEnd: number;
}

/**
 * A challenge against a folded player who didn't release keys
 */
export interface FoldChallenge {
  challenger: string;
  challenged: string;
  timestamp: number;
}

/**
 * Hand result for blockchain settlement
 */
export interface PokerHandResult {
  /** Unique hand identifier */
  handId: string;
  /** Winners of the hand */
  winners: string[];
  /** Payout per player */
  payouts: Record<string, number>;
  /** Contribution per player */
  contributions: Record<string, number>;
  /** Total pot */
  totalPot: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Notification that a player peeked at their cards
 */
export interface PeekNotification {
  playerId: string;
  timestamp: number;
}

/**
 * Request for cooperative card decryption.
 * Players must approve for decryption to proceed.
 */
export interface DecryptRequest {
  /** Unique request ID */
  id: string;
  /** Player requesting decryption */
  requestingPlayer: string;
  /** Zone being decrypted (e.g., 'hand:0') */
  zoneId: string;
  /** Card indices to decrypt */
  cardIndices: number[];
  /** Timestamp of request */
  timestamp: number;
  /** Status of the request */
  status: "pending" | "approved" | "completed" | "rejected";
  /** Players who have approved */
  approvals: Record<string, boolean>;
  decryptionShares: Record<string, EncryptedCard>;
}

/**
 * Notification for decrypt request events
 */
export interface DecryptNotification {
  type: "request" | "approval" | "completed" | "rejected";
  requestId: string;
  playerId: string;
  message: string;
  timestamp: number;
}

// ============================================================================
// Zone Definitions
// ============================================================================

/**
 * Zone definitions for poker
 */
export const POKER_ZONES: ZoneDefinition[] = [
  {
    id: "deck",
    name: "Deck",
    visibility: "hidden",
    shared: true,
    ordered: true,
    features: ["shuffle", "draw"],
  },
  {
    id: "hand",
    name: "Hand",
    visibility: "owner-only",
    shared: false,
    ordered: false,
    features: [],
  },
  {
    id: "community",
    name: "Community",
    visibility: "public",
    shared: true,
    ordered: true,
    features: [],
  },
  {
    id: "discard",
    name: "Discard",
    visibility: "hidden",
    shared: true,
    ordered: false,
    features: [],
  },
  {
    id: "mucked",
    name: "Mucked",
    visibility: "hidden",
    shared: true,
    ordered: false,
    features: [],
  },
];

// ============================================================================
// Move Types
// ============================================================================

/**
 * Poker move types
 */
export type PokerMoveType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "allIn"
  // Crypto-specific moves
  | "submitPublicKey"
  | "encryptDeck"
  | "shuffleDeck"
  | "peekHoleCards"
  | "submitDecryptionShare"
  | "acknowledgeResult"
  // Cooperative decryption moves
  | "requestDecrypt"
  | "approveDecrypt"
  | "dismissNotification"
  // Key release moves
  | "releaseKey"
  | "challengeVoid";

/**
 * Move validation result
 */
export interface MoveValidation {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Poker game configuration
 */
export interface PokerConfig {
  /** Small blind amount */
  smallBlind: number;
  /** Big blind amount */
  bigBlind: number;
  /** Starting chips per player */
  startingChips: number;
  /** Minimum players to start */
  minPlayers: number;
  /** Maximum players */
  maxPlayers: number;
  /** Auto-reveal hole cards on deal (crypto only) */
  autoRevealHoleCards?: boolean;
  /** Timeout configuration (crypto only) */
  timeouts?: TimeoutConfig;
}

/**
 * Timeout configuration for crypto poker
 */
export interface TimeoutConfig {
  /** Heartbeat interval in ms */
  heartbeatInterval: number;
  /** Disconnect threshold in ms */
  disconnectThreshold: number;
  /** Action timeout in ms */
  actionTimeout: number;
}

/**
 * Default timeout configuration
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  heartbeatInterval: 5000,
  disconnectThreshold: 15000,
  actionTimeout: 30000,
};

/**
 * Default poker configuration
 */
export const DEFAULT_POKER_CONFIG: PokerConfig = {
  smallBlind: 10,
  bigBlind: 20,
  startingChips: 1000,
  minPlayers: 2,
  maxPlayers: 9,
  autoRevealHoleCards: false,
  timeouts: DEFAULT_TIMEOUT_CONFIG,
};

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Result of comparing two hands
 */
export type HandComparisonResult = -1 | 0 | 1;

/**
 * Showdown result for a player
 */
export interface ShowdownResult {
  playerId: string;
  hand: EvaluatedHand;
  potShare: number;
}

/**
 * Card ID format helper
 */
export function getCardId(suit: string, rank: string): string {
  return `${suit}-${rank}`;
}

/**
 * Parse a card ID into suit and rank
 */
export function parseCardId(
  cardId: string,
): { suit: string; rank: string } | null {
  const parts = cardId.split("-");
  if (parts.length !== 2) return null;
  return { suit: parts[0], rank: parts[1] };
}

/**
 * Get all 52 standard card IDs
 */
export function getAllCardIds(): string[] {
  const suits = ["clubs", "diamonds", "hearts", "spades"];
  const ranks = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
  ];
  const ids: string[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      ids.push(getCardId(suit, rank));
    }
  }
  return ids;
}
