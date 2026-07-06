/**
 * Timestreams Game Module Types
 *
 * Type definitions for the Timestreams game module.
 * This module is rules-agnostic — it manages game state and ensures
 * fair deck operations through cryptographic protocols, but does NOT
 * enforce game rules. Players are responsible for following rules;
 * the system prevents cheating on deck operations.
 */

import type { CoreCard } from "@manamesh/frontend/src/game/modules/types";
import type { EncryptedCard } from "@manamesh/boardgameio-crypto/mental-poker";

// =============================================================================
// Era Constants
// =============================================================================

/**
 * The six eras of Timestreams in chronological order.
 * Used to drive timeline layout, card placement, and scoring.
 */
export const ERA_ORDER = [
  "stone",
  "medieval",
  "renaissance",
  "industrial",
  "modern",
  "future",
] as const;

/**
 * A valid Timestreams era identifier.
 */
export type EraId = (typeof ERA_ORDER)[number];

// =============================================================================
// Card Types
// =============================================================================

/**
 * A Timestreams card — extends CoreCard with game-specific fields.
 */
export interface TimestreamsCard extends CoreCard {
  /** The player who owns this card instance in their deck */
  ownerId: string;

  /** Primary category */
  cardType: 'invention' | 'action';

  /**
   * Subtypes (primarily for inventions).
   * "government" → only one allowed per era.
   * "art" → special interactions with other art cards.
   */
  subtypes?: string[];

  /** Additional text that does not fit neatly into the Play/Score/React fields. */
  addlCardText?: string;

  /** Optional flavor text to show when appropriate (e.g. in detailed views or hover previews). */
  flavorText?: string;

  /** Has a Play effect that resolves immediately when the card is played/placed. */
  hasPlayEffect: boolean;
  playEffectText?: string;

  /** Has a Score ability resolved during the scoring phase. */
  hasScoreEffect: boolean;
  scoreEffectText?: string;

  /**
   * Has a React ability.
   * - Inventions: triggered reactively by specific game events.
   * - Actions: may be played on anyone's turn in response to their action.
   */
  hasReact: boolean;

  /**
   * The full React ability text.
   * It contains the react trigger conditions, and the effect
   * if the player chooses to apply the ability.
   *
   * Example: "React: If this Invention would be moved or destroyed,
   * you may discard this card instead."
   */
  reactEffectText?: string;

  /**
   * Optional numeric score value.
   * Present on some Inventions. Useful for validation (Actions should not have score value).
   */
  scoreValue?: number;

  /** Keyword tags for quick filtering and future effect dispatch. */
  tags?: string[];
}

/**
 * Helper for the common "react:<event>" pattern.
 * For more complex tag combinations (including card ID references),
 * prefer writing small, focused evaluation functions that inspect tags.
 */
export function hasReactTrigger(card: TimestreamsCard, event: string): boolean {
  const target = `react:${event}`;
  return card.tags?.some(tag => tag === target || tag === event) ?? false;
}

/**
 * Composes the full human-readable card text.
 * Order: addlCardText, playEffectText, scoreEffectText, reactEffectText.
 * Flavor text is kept separate (use card.flavorText when appropriate to display).
 */
export function composeCardText(card: TimestreamsCard): string {
  const parts: string[] = [];

  if (card.addlCardText) {
    parts.push(card.addlCardText);
  }
  if (card.playEffectText) {
    parts.push(card.playEffectText);
  }
  if (card.scoreEffectText) {
    parts.push(card.scoreEffectText);
  }
  if (card.reactEffectText) {
    parts.push(card.reactEffectText);
  }

  return parts.join('\n\n');
}

// =============================================================================
// Era State
// =============================================================================

/**
 * State for a single era slot on the shared timeline.
 */
export interface EraState {
  /** Which era this slot represents */
  id: EraId;
  /** Ordered list of card IDs currently placed in this era */
  stack: string[];
}

// =============================================================================
// Player State
// =============================================================================

/**
 * Per-player state in Timestreams.
 */
export interface TimestreamsPlayerState {
  /** The era this player has claimed as their home era, or null until chosen */
  homeEra: EraId | null;
  /** Whether the player has declared ready for the current phase */
  ready: boolean;
  /** Cards in the player's hand */
  hand: TimestreamsCard[];
  /** Cards this player has discarded */
  discard: TimestreamsCard[];
  /** Cards this player has scored */
  scorePile: TimestreamsCard[];
  /** Whether this player has passed during the current day */
  hasPassedThisDay: boolean;
  /** Player's mental-poker public key, or null before key exchange */
  publicKey: string | null;
  /** Whether this player has submitted their deck encryption */
  hasEncrypted: boolean;
  /** Whether this player has participated in the shuffle */
  hasShuffled: boolean;
}

// =============================================================================
// Phase
// =============================================================================

/**
 * The current phase of the game.
 */
export type TimestreamsPhase =
  | "setup"
  | "keyExchange"
  | "encrypt"
  | "shuffle"
  | "play"
  | "scoring"
  | "gameOver"
  | "voided";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for a Timestreams game session.
 */
export interface TimestreamsConfig {
  /** Number of timeline era slots available for scoring */
  scoringSlots: number;
  /** Total number of cards in each player's deck */
  deckSize: number;
  /** Map of player count -> cards drawn per day */
  drawTable: Record<number, number>;
  /** How home eras are assigned at game start */
  homeEraAssignment: "selectable" | "random";
  /** Deck encryption scheme in use */
  deckEncryption: "mental-poker";
  /** Whether to maintain a verifiable proof chain for all state transitions */
  proofChainEnabled: boolean;
}

// =============================================================================
// Shuffle RNG State
// =============================================================================

/**
 * Commit-reveal RNG state for a multi-party shuffle.
 * Players commit to a seed, then reveal; the final seed is the XOR of all reveals.
 */
export interface ShuffleRngState {
  /** Current phase of the commit-reveal protocol */
  phase: "commit" | "reveal" | "ready";
  /** playerId -> SHA256(seedHex) commitments (null if not yet committed) */
  commits: Record<string, string | null>;
  /** playerId -> seedHex reveals (null if not yet revealed) */
  reveals: Record<string, string | null>;
  /** Combined final seed in hex, populated when phase reaches "ready" */
  finalSeedHex: string | null;
  /** playerId -> true for players who have voted to abort the shuffle */
  abortVotes: Record<string, boolean>;
}

// =============================================================================
// Decrypt Request
// =============================================================================

/**
 * A cooperative decryption request for revealing one encrypted card.
 */
export interface DecryptRequest {
  /** Unique request ID */
  id: string;
  /** Player whose encrypted deck contains this card */
  playerId: string;
  /** Player who owns the deck being decrypted */
  deckOwnerId: string;
  /** Index of the card within the encrypted deck */
  cardIndex: number;
  /** Player who initiated the decryption request */
  requestedBy: string;
  /** Ordered list of player IDs whose decryption layers must be removed */
  requiredLayers: string[];
  /** How many layers have already been peeled */
  currentLayer: number;
  /** Lifecycle status of this request */
  status: "pending" | "partial" | "complete";
}

// =============================================================================
// Card Visibility
// =============================================================================

/**
 * Visibility state for an individual card in the system.
 */
export type CardVisibilityState = "encrypted" | "owner-known" | "public";

// =============================================================================
// Cryptographic Proof
// =============================================================================

/**
 * A single link in the cryptographic proof chain.
 * Chains state transitions into an auditable history.
 */
export interface CryptographicProof {
  /** Unique identifier for this transition */
  transitionId: string;
  /** Hash of the previous proof, or null for the genesis proof */
  previousProofHash: string | null;
  /** Human-readable action label */
  action: string;
  /** Arbitrary structured data for this transition */
  data: Record<string, unknown>;
  /** playerId -> signature over (transitionId + data) */
  signatures: Record<string, string>;
  /** Unix epoch milliseconds when this proof was created */
  timestamp: number;
  /** Hash of this proof's content (for chaining) */
  hash: string;
}

// =============================================================================
// Full Game State
// =============================================================================

/**
 * The complete Timestreams game state stored in boardgame.io.
 */
export interface TimestreamsState {
  /** Per-player state keyed by player ID */
  players: Record<string, TimestreamsPlayerState>;
  /** Ordered array of player IDs (turn order) */
  playerOrder: string[];
  /** Game configuration */
  config: TimestreamsConfig;
  /** Current game phase */
  phase: TimestreamsPhase;
  /** The shared timeline, one EraState per era */
  timeline: Record<EraId, EraState>;
  /** Which day of the game we are on (1-based) */
  currentDay: number;
  /** Player ID of the first player for the current day */
  dayFirstPlayer: string;
  /** Encrypted decks keyed by player ID */
  encryptedDecks: Record<string, EncryptedCard[]>;
  /** cardId -> era placement for scoring */
  cardPoints: Record<string, string>;
  /** State for the deck-shuffle RNG, or null outside the shuffle phase */
  shuffleRng: ShuffleRngState | null;
  /** State for the era-assignment RNG (when homeEraAssignment = "random") */
  eraAssignmentRng: ShuffleRngState | null;
  /** In-flight cooperative decryption requests */
  pendingDecryptRequests: DecryptRequest[];
  /** Index into playerOrder for sequential setup operations */
  setupPlayerIndex: number;
  /** cardId -> visibility state */
  cardVisibility: Record<string, CardVisibilityState>;
  /** Audit trail of cryptographic proofs */
  proofChain: CryptographicProof[];
  /** Current scores keyed by player ID */
  scores: Record<string, number>;
  /** Winning player ID, or null if the game is not over */
  winner: string | null;

  /** M2 rules engine: id -> full card for every card in public play. */
  cards?: Record<string, TimestreamsCard>;
  /** M2 rules engine: hostCardId -> attached action card ids. */
  attachments?: Record<string, string[]>;
  /** M2 rules engine: active duration modifiers. */
  modifiers?: ActiveModifier[];
  /** M2 rules engine: registered delayed/ongoing triggers. */
  pendingTriggers?: PendingTrigger[];
  /** M2 rules engine: per-player turn flags. */
  turnFlags?: Record<string, TurnFlags>;
  /** M2 rules engine: prompts awaiting UI answers for the last played card. */
  pendingPrompts?: Array<{ id: string; deciderId: string; kind: string; options: string[]; min: number; max: number; reason: string }>;

  /** M3: per-card flags for cards already scored in the current scoring pass (for Wonky rule). */
  scoredThisScoring?: string[];
}

// =============================================================================
// Rules Engine State (M2) — optional fields, lazily initialized by src/effects/state.ts
// =============================================================================

/** A duration-limited continuous effect (PRD §9). */
export interface ActiveModifier {
  sourceCardId: string;
  ownerId: string;
  kind: 'prevent-action-play' | 'prevent-move-future' | 'prevent-move-past';
  duration: 'rest-of-today' | 'rest-of-game';
}

/** A registered delayed (one-shot) or ongoing trigger (PRD §7.1, §9). */
export interface PendingTrigger {
  sourceCardId: string;
  ownerId: string;
  event: 'action-played' | 'invention-played' | 'discarded-from-play';
  /** Era to watch; null = anywhere. Anchored eras follow PRD §3.8. */
  eraAnchor: EraId | null;
  limit: 'once' | 'ongoing';
  spent: boolean;
}

/** Per-player turn-manipulation flags (extra turns, skips, Navigation). */
export interface TurnFlags {
  skipNextTurn: boolean;
  extraTurns: number;
  /** During an Androids extra turn: inventions may not be played. */
  noInventionThisTurn: boolean;
  /** Navigation: next invention may be played into this scope instead of Today. */
  allowNextInventionEra: 'yesterday-or-tomorrow' | null;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Sensible defaults for a standard Timestreams session.
 */
export const DEFAULT_CONFIG: TimestreamsConfig = {
  scoringSlots: 6,
  deckSize: 36,
  drawTable: { 2: 6, 3: 5, 4: 4 },
  homeEraAssignment: "selectable",
  deckEncryption: "mental-poker",
  proofChainEnabled: true,
};

// =============================================================================
// Asset Pack Metadata Shapes (target for OCR + pack builder)
// =============================================================================

/**
 * Metadata shape for cards in era-specific deck sets (e.g. stone_age, future_tech).
 * This goes into CardManifestEntry.metadata in the asset pack.
 * Populated from OCR of scanned card images + Deck List.txt.
 */
export interface TimestreamsDeckCardMetadata {
  /** Primary category */
  cardType: 'invention' | 'action';

  /**
   * Subtypes for inventions (e.g. "art", "government").
   * Governments have the rule: only one per era.
   */
  subtypes?: string[];

  /** Additional card text that does not fit neatly into the Play/Score/React categories. */
  addlCardText?: string;

  /** Optional flavor text to show when appropriate (e.g. in detailed views). */
  flavorText?: string;

  /** Whether this card has a Play effect that triggers on placement/play. */
  hasPlayEffect: boolean;

  /** Play effect text (if hasPlayEffect). */
  playEffectText?: string;

  /** Whether this card has a Score ability (resolved in scoring phase). */
  hasScoreEffect: boolean;

  /** Score ability text. Actions should not have this. */
  scoreEffectText?: string;

  /**
   * Whether this card has a React ability.
   * - For Inventions: triggered reactively by specific game events.
   * - For Actions: can be played on anyone's turn in response to their action.
   */
  hasReact: boolean;

  /**
   * The full React ability text from the card.
   * It contains the react trigger conditions, and the effect
   * if the player chooses to apply the ability.
   *
   * Example: "React: If another card would move this Invention,
   * discard this card instead."
   */
  reactEffectText?: string;

  /**
   * Numeric score value (only present for cards that participate in scoring).
   * For Action cards this field should be omitted entirely.
   * Used as a secondary heuristic for the "should be Invention" correction.
   */
  scoreValue?: number;

  /**
   * Tags for declarative, machine-readable card behavior.
   *
   * The goal is to declare as much behavior as possible in the manifest
   * so that game logic can be driven by evaluating tags rather than
   * hard-coding per-card rules.
   *
   * Recommended conventions:
   * - Verbs/actions: "move", "destroy", "draw"
   * - Triggers: "react:move", "react:destroy"
   * - Parameters via separate tags or key=value style when needed:
   *     ["react:move", "target:opponent", "requires:stone-age-cloth"]
   *
   * Game code should centralize tag interpretation logic so that
   * adding new cards rarely requires changes to the rules engine.
   */
  tags?: string[];
}

/**
 * Metadata for era header/column cards (the 6 timeline backdrops).
 */
export interface TimestreamsEraCardMetadata {
  assetType: 'era';
  era: EraId;
  label: string; // e.g. "Stone Age", "Future Tech"
}

/**
 * Metadata for player aid reference cards.
 */
export interface TimestreamsAidCardMetadata {
  assetType: 'playerAid';
  aidType: 'scoring' | 'turn';
  title: string;
  /** The full instructions / rules summary on the aid card. */
  text: string;
}

/**
 * Union for all Timestreams-specific metadata in asset packs.
 */
export type TimestreamsCardMetadata =
  | TimestreamsDeckCardMetadata
  | TimestreamsEraCardMetadata
  | TimestreamsAidCardMetadata;

// =============================================================================
// Detection Helpers (for hand filtering and future prompting)
// =============================================================================

/** Is this card a normal Invention that can be played on your turn into the current era? */
export function isPlayableInvention(card: TimestreamsCard): boolean {
  return card.cardType === 'invention' && !card.hasReact;
}

/** Is this an Action that can be played instead of an Invention on your turn? */
export function isPlayableAction(card: TimestreamsCard): boolean {
  return card.cardType === 'action' && !card.hasReact;
}

/** Does this card have a React ability that might be playable right now? */
export function hasReactAbility(card: TimestreamsCard): boolean {
  return card.hasReact;
}

/** Is this a Government invention? (only one allowed per era) */
export function isGovernment(card: TimestreamsCard): boolean {
  return card.subtypes?.includes('government') ?? false;
}

/** Does this card have a Score ability that will be relevant in the scoring phase? */
export function hasScoreAbility(card: TimestreamsCard): boolean {
  // Primary signal is the explicit boolean. scoreValue is only used as fallback
  // during transition or when hasScoreEffect is not explicitly set.
  if (card.hasScoreEffect !== undefined) {
    return card.hasScoreEffect;
  }
  return (card.scoreValue ?? 0) > 0;
}

/**
 * Validation heuristic from the physical cards:
 * If a card claims to be an "action" but has a score value / score text,
 * it is almost certainly an Invention (see Androids example).
 *
 * For real data, prefer checking hasScoreEffect === true.
 */
export function shouldBeInvention(card: Partial<TimestreamsCard>): boolean {
  return (
    card.cardType === 'action' &&
    (card.hasScoreEffect === true || (card.scoreValue ?? 0) > 0)
  );
}
