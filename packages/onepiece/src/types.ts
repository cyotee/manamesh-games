/**
 * One Piece TCG Game Module Types
 *
 * Type definitions for the One Piece Trading Card Game module.
 * This module is rules-agnostic — it manages game state and ensures
 * fair deck operations through cryptographic protocols, but does NOT
 * enforce game rules. Players are responsible for following rules;
 * the system prevents cheating on deck operations.
 */

import type { CoreCard, ZoneDefinition } from "@manamesh/frontend/src/game/modules/types";
import type { CryptoPluginState } from "@manamesh/boardgameio-crypto/plugin/crypto-plugin";
import type { EncryptedCard } from "@manamesh/boardgameio-crypto/mental-poker";

// =============================================================================
// Card Types
// =============================================================================

export type OnePieceColor =
  | "red"
  | "green"
  | "blue"
  | "purple"
  | "black"
  | "yellow";

export type OnePieceCardType = "character" | "leader" | "event" | "stage";

export type OnePieceRarity = "C" | "UC" | "R" | "SR" | "SEC" | "L" | "SP";

/**
 * Full One Piece TCG card with all fields.
 * Extends CoreCard with One Piece-specific properties.
 */
export interface OnePieceCard extends CoreCard {
  cardType: OnePieceCardType;
  cost?: number;
  power?: number;
  counter?: number;
  color: OnePieceColor[];
  attributes?: string[];
  trigger?: string;
  effectText?: string;
  set: string;
  cardNumber: string;
  rarity: OnePieceRarity;
  /** Life value — Leaders only */
  life?: number;
}

/**
 * DON!! card — separate from regular cards.
 * DON!! cards are generic resources, not unique cards.
 */
export interface OnePieceDonCard extends CoreCard {
  cardType: "don";
}

/** Union type for all card types in the One Piece module */
export type AnyOnePieceCard = OnePieceCard | OnePieceDonCard;

// =============================================================================
// Card Visibility
// =============================================================================

/**
 * Visibility states for individual cards.
 *
 * Cards move through these states as they transition between zones
 * and as players perform operations on them.
 */
export type CardVisibilityState =
  | "encrypted" // Unknown to all (in shuffled deck)
  | "public" // Visible to all players
  | "secret" // Hidden from all (rare — transitional)
  | "owner-known" // Owner can see, opponent cannot
  | "opponent-known" // Opponent can see, owner cannot (rare)
  | "all-known"; // Both know but not publicly revealed

/**
 * Tracks a state transition for a card's visibility.
 */
export interface CardStateTransition {
  cardId: string;
  from: CardVisibilityState;
  to: CardVisibilityState;
  timestamp: number;
  initiatedBy: string;
  proof: CryptographicProof;
}

// =============================================================================
// Cryptographic Proofs
// =============================================================================

/**
 * A cryptographic proof linking state transitions into an auditable chain.
 */
export interface CryptographicProof {
  transitionId: string;
  previousProofHash: string | null;
  action: string;
  data: Record<string, unknown>;
  signatures: Record<string, string>;
  timestamp: number;
  hash: string;
}

// =============================================================================
// Deck Peek Protocol
// =============================================================================

/**
 * Request to peek at the top N cards of a deck.
 */
export interface DeckPeekRequest {
  id: string;
  playerId: string;
  deckZone: "mainDeck" | "lifeDeck";
  count: number;
  requestProof: string;
  timestamp: number;
}

/**
 * Opponent acknowledgement of a peek request, with decryption share.
 */
export interface DeckPeekAck {
  requestId: string;
  requestHash: string;
  decryptionShare: string;
  proof: string;
}

/**
 * Owner's decryption result after receiving opponent's share.
 */
export interface DeckPeekOwnerDecrypt {
  requestId: string;
  cardStates: CardStateTransition[];
}

/**
 * Optional reordering of peeked cards before returning to deck.
 */
export interface DeckPeekReorder {
  requestId: string;
  newPositions: number[];
  proof: string;
}

/**
 * Full peek protocol state.
 */
export interface DeckPeekProtocol {
  request: DeckPeekRequest;
  opponentAck?: DeckPeekAck;
  ownerDecrypt?: DeckPeekOwnerDecrypt;
  reorder?: DeckPeekReorder;
  status: "pending" | "acked" | "decrypted" | "reordered" | "complete";
}

// =============================================================================
// Play Area Slots
// =============================================================================

export type SlotType = "leader" | "character" | "stage";

/**
 * A slot in a player's play area.
 */
export interface PlayAreaSlot {
  slotType: SlotType;
  cardId: string | null;
  attachedDon: number;
  position: number;
}

// =============================================================================
// Game State
// =============================================================================

/**
 * Per-player state in One Piece TCG.
 */
export interface OnePiecePlayerState {
  mainDeck: OnePieceCard[];
  lifeDeck: OnePieceCard[];
  donDeck: OnePieceDonCard[];
  trash: OnePieceCard[];
  hand: OnePieceCard[];
  donArea: OnePieceDonCard[];
  playArea: PlayAreaSlot[];
  activeDon: number;
  totalDon: number;
}

/**
 * Full game state for One Piece TCG.
 */
export interface OnePieceState {
  players: Record<string, OnePiecePlayerState>;
  config: OnePieceModuleConfig;
  phase: OnePiecePhase;
  winner: string | null;
  turnCount: number;

  /** Card visibility tracking */
  cardVisibility: Record<string, CardVisibilityState>;

  /** Active peek protocols */
  activePeeks: DeckPeekProtocol[];

  /** Proof chain for auditability */
  proofChain: CryptographicProof[];

  /** Zone mirror for deck plugin compatibility */
  zones: Record<string, Record<string, AnyOnePieceCard[]>>;

  /** Tracks which players have loaded their decks in setup phase */
  deckLoaded: Record<string, boolean>;

  /** Remaining life for each player's leader (for win condition) */
  leaderLife: Record<string, number>;

  /** Optional: card id lists extracted from loaded decks for crypto games */
  deckCardIds?: Record<string, string[]>;
  lifeDeckIds?: Record<string, string[]>;
}

export type OnePiecePhase =
  | "setup"
  | "keyExchange"
  | "encrypt"
  | "shuffle"
  | "play"
  | "gameOver"
  | "voided";

// =============================================================================
// Module Configuration
// =============================================================================

/**
 * Configuration for the One Piece game module.
 */
export interface OnePieceModuleConfig {
  startingLife: number;
  startingDon: number;
  startingHand: number;
  maxCharacterSlots: number;
  allowStageCard: boolean;
  deckEncryption: "mental-poker";
  proofChainEnabled: boolean;
}

export const DEFAULT_CONFIG: OnePieceModuleConfig = {
  startingLife: 5,
  startingDon: 10,
  startingHand: 5,
  maxCharacterSlots: 5,
  allowStageCard: true,
  deckEncryption: "mental-poker",
  proofChainEnabled: true,
};

// =============================================================================
// Module Type
// =============================================================================

export type OnePieceGameModule = import("../types").GameModule<
  OnePieceCard,
  OnePieceState
>;

// =============================================================================
// Crypto-specific Types (OnePiece mental-poker variant)
// =============================================================================

/**
 * Per-player state for the cryptographic One Piece variant.
 * Keeps most gameplay zones plaintext where appropriate, but
 * includes flags for crypto progress and connectivity.
 */
export interface OnePieceCryptoPlayerState {
  // Encrypted hand zone
  hand: OnePieceCard[];
  // Other plaintext zones (don't need encryption)
  lifeDeck: OnePieceCard[];
  donDeck: OnePieceDonCard[];
  donArea: OnePieceDonCard[];
  trash: OnePieceCard[];
  playArea: PlayAreaSlot[];
  activeDon: number;
  totalDon: number;
  // Leader slot card ID
  leaderCardId: string | null;

  // Crypto-specific
  publicKey: string | null;
  hasEncrypted: boolean;
  hasShuffled: boolean;
  isConnected: boolean;
  lastHeartbeat: number;
}

/**
 * Shuffle RNG commit-reveal state for deterministic multi-party shuffle.
 */
export interface ShuffleRngState {
  phase: "commit" | "reveal" | "ready";
  commits: Record<string, string>; // playerId -> SHA256(seedHex)
  reveals: Record<string, string>; // playerId -> seedHex
  finalSeedHex: string | null;
  abortVotes: Record<string, boolean>;
}

/**
 * Cooperative decryption request for revealing encrypted cards.
 */
export interface DecryptRequest {
  id: string;
  playerId: string; // who needs the reveal
  zoneId: string; // which encrypted zone
  cardIndex: number; // which card in the zone
  requestedBy: string; // who requested the decrypt
  requiredLayers: string[]; // playerIds who must decrypt (in order)
  currentLayer: number; // how many layers have been removed
  status: "pending" | "partial" | "complete";
  purpose: "damage" | "face-up"; // distinguishes the two reveal paths
}

/**
 * Full crypto-enabled One Piece game state.
 * Extends the plaintext OnePieceState but replaces player states with crypto ones
 * and adds encrypted zones, plugin state, escrow shares, and shuffle RNG.
 */
export interface OnePieceCryptoState extends Omit<OnePieceState, "players"> {
  // Override player state for crypto
  players: Record<string, OnePieceCryptoPlayerState>;

  // Encrypted zones — replaces plaintext card arrays
  encryptedZones: Record<string, EncryptedCard[]>;

  // Crypto plugin state
  crypto: CryptoPluginState;

  // Commit-reveal shuffle state
  shuffleRng: ShuffleRngState | null;

  // Pending decryption requests (for life damage + face-up effects)
  pendingDecryptRequests: DecryptRequest[];

  // Setup player index (for sequential encryption/shuffle)
  setupPlayerIndex: number;

  // Player order
  playerOrder: string[];

  // Card IDs per player (extracted from loaded decks for encryption)
  deckCardIds: Record<string, string[]>;

  // Life deck card IDs per player (for encrypting life decks)
  lifeDeckIds: Record<string, string[]>;

  // ctx.numMoves recorded when the latest DecryptRequest was created; used for stall detection.
  revealStallEnteredAt?: number;
}
