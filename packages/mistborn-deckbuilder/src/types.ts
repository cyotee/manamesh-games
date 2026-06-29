/**
 * Types for Mistborn: The Deck Building Game module.
 *
 * Phase 1 focus: rules-free structural management + complete data model
 * (full effectText + structured tags) for easy transition to enforcement.
 */

import type {
  CoreCard,
  ZoneDefinition,
} from '@manamesh/frontend/src/game/modules/types';
import type { CryptoPluginState } from '@manamesh/boardgameio-crypto/plugin/crypto-plugin';
import type { EncryptedCard } from '@manamesh/boardgameio-crypto/mental-poker';

// =============================================================================
// Metals
// =============================================================================

export const METALS = [
  'pewter',
  'tin',
  'bronze',
  'copper',
  'zinc',
  'brass',
  'iron',
  'steel',
  'atium',
] as const;

export type Metal = (typeof METALS)[number];

export interface MetalState {
  metal: Metal;
  burned: boolean;
  flared: boolean;
  /** Card ID this metal is currently attached to (for Savant etc. in Phase 2) */
  attachedTo?: string;
}

// =============================================================================
// Cards
// =============================================================================

export type MistbornCardType =
  | 'action'
  | 'ally'
  | 'funding'
  | 'character-starter'
  | 'confrontation'
  | 'lord-ruler';

export interface MistbornCard extends CoreCard {
  /** Coin cost when buying from market */
  cost: number;

  /** Primary metal required to activate */
  metal?: Metal | Metal[];

  /** Additional metals for secondary abilities (must activate top first) */
  additionalMetals?: Array<Metal | Metal[]>;

  /** The metal pairing shown in the vial (for using card as metal or refresh) */
  pairing?: [Metal, Metal];

  cardType: MistbornCardType;

  /** Ally defense value */
  defense?: number;

  /** Full printed text from the card */
  effectText?: string;

  /**
   * Structured tags/keywords for future rules enforcement.
   * Examples: 'pull', 'soothe', 'cloud', 'savant:+2combat', 'offturn:cloud-3',
   * 'defender', 'riot', 'seek', 'push'
   */
  tags?: string[];

  /**
   * Relative path to the cropped image under assets/cards/
   * e.g. "market_cards/Market_Card-Soar.png" or "metal_training_cards/Metal_Training_Card-Pewter.png"
   */
  imagePath?: string;

  /** Optional path for card back */
  backImagePath?: string;
}

// =============================================================================
// Game State
// =============================================================================

export interface PlayerState {
  character: string; // e.g. "Vin", "Kelsier"
  trainingPosition: number; // steps advanced on track (0-based)
  burnLimit: number; // derived from training (1-4)
  unlockedLevels: number; // character abilities unlocked
  health: number;
  metals: MetalState[]; // always 8 entries
  missionPoints: number; // pool granted by effects
  missionCubes: Record<string, number>; // missionId -> track position
  hasTarget: boolean;
}

export interface LordRulerState {
  health: number;
  dominance: number;
  deckCount: number;
  // Adversaries placed in front of players (keyed by playerId)
  adversaries: Record<string, any[]>; // placeholder for now
}

export type MistbornPhase =
  | 'setup'
  | 'keyExchange'
  | 'encrypt'
  | 'shuffle'
  | 'play'
  | 'combat'
  | 'endTurn'
  | 'gameOver'
  | 'voided';

export interface MistbornConfig {
  numPlayers: number;
  characters: Record<string, string>; // playerId -> character name
  selectedMissions: string[]; // 3 mission ids
  isCoop: boolean;
}

// =============================================================================
// Asset Set Modeling
// =============================================================================

/** Logical sets in the Mistborn asset pack, corresponding to different card pools / "decks" */
export const MISTBORN_SETS = {
  MARKET: 'market',
  MISSIONS: 'missions',
  LORD_RULER: 'lord-ruler',
  METAL_TRAINING: 'metal-training',
  CHARACTERS: 'character',
  FUNDING: 'funding',
} as const;

export type MistbornSet = typeof MISTBORN_SETS[keyof typeof MISTBORN_SETS];

/** Mapping from game concepts to the asset sets they draw from */
export const DECK_SET_MAPPING = {
  /** The shared market row */
  market: [MISTBORN_SETS.MARKET] as const,
  /** Player starting decks (metal training + character card + funding) */
  starters: [MISTBORN_SETS.METAL_TRAINING, MISTBORN_SETS.CHARACTERS, MISTBORN_SETS.FUNDING] as const,
  /** Mission tracks */
  missions: [MISTBORN_SETS.MISSIONS] as const,
  /** Lord Ruler challenge cards (solo/co-op) */
  lordRuler: [MISTBORN_SETS.LORD_RULER] as const,
} as const;

export type DeckType = keyof typeof DECK_SET_MAPPING;

export function getBurnLimit(position: number): number {
  // Example milestones from the track (adjust based on exact image positions)
  // Position 0 = start burn 1
  if (position >= 9) return 4;
  if (position >= 6) return 3;
  if (position >= 3) return 2;
  return 1;
}

export interface MistbornState {
  players: Record<string, PlayerState>;
  playerOrder: string[];
  currentPlayer: string;
  phase: MistbornPhase;

  // Card zones (powered by DeckPlugin)
  zones: Record<string, Record<string, MistbornCard[]>>;

  // Shared
  market: string[]; // visible market card ids (always 6)
  marketDeckCount: number;
  eliminated: MistbornCard[];

  // Resources
  boxingsAvailable: number;
  atiumAvailable: number;

  selectedMissions: string[];
  targetHolder?: string;

  // Co-op
  isCoop: boolean;
  lordRuler?: LordRulerState;

  // Rules engine: per-player coins spent on buys this turn (reset on turn start / cleanup)
  coinsSpent?: Record<string, number>;

  // Crypto / audit
  crypto: CryptoPluginState;
  cardVisibility: Record<string, any>;
  proofChain: any[];

  // History for full replay/scrubber
  moveHistory: Array<{
    playerId: string;
    move: string;
    args: any[];
    timestamp: number;
  }>;

  winner?: string | null;
}

// =============================================================================
// Moves (Phase 1 - structural + helpers)
// =============================================================================

export type MistbornMove =
  | 'draw'
  | 'playCard'
  | 'useAsMetal'
  | 'buyCard'
  | 'eliminateCard'
  | 'burnMetal'
  | 'flareMetal'
  | 'refreshMetal'
  | 'grantMissionPoints'
  | 'spendMissionPoints'
  | 'advanceTraining'
  | 'adjustHealth'
  | 'declareCombat'
  | 'assignDamage'
  | 'passTarget'
  | 'refillMarket'
  | 'cleanupAndDraw'
  | 'endMainPhase'
  | 'drawLordRulerCard'; // co-op visual only

// =============================================================================
// Data types (for complete card/character/mission defs)
// =============================================================================

export interface CharacterData {
  id: string;
  name: string;
  signatureMetal: Metal;
  imagePath?: string;
  abilities: {
    level1?: string;
    level2?: string; // "once per turn eliminate bought action..."
    level3?: string;
    atium?: string;
  };
  description?: string;
}

export interface MissionReward {
  description: string;
  firstPlayerBonus?: string;
  isPermanent?: boolean;
}

export interface MissionData {
  id: string;
  name: string;
  rewards: MissionReward[]; // index corresponds to track steps
  topReward: MissionReward;
}

// Re-export for convenience
export type { CoreCard, ZoneDefinition } from '@manamesh/frontend/src/game/modules/types';