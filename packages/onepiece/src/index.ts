/**
 * One Piece TCG Game Module
 *
 * Rules-agnostic state manager for the One Piece Trading Card Game.
 * Manages game state and ensures fair deck operations through
 * cooperative decryption (mental poker).
 *
 * Features:
 * - 7 game zones (Main Deck, Life Deck, DON!! Deck, Trash, Hand, Play Area, DON!! Area)
 * - Card visibility state machine with 6 states
 * - 4-step cooperative deck peek protocol
 * - Play area slots (Leader, Characters, Stage, DON!! attachment)
 * - Cryptographic proof chain for auditability
 */

// Main module export
export { OnePieceModule, OnePieceGame, onePieceCardSchema } from "./game";
export { OnePieceCryptoGame, createCryptoInitialState } from "./crypto";
export { default } from "./game";

// Types
export type {
  OnePieceCard,
  OnePieceDonCard,
  AnyOnePieceCard,
  OnePieceColor,
  OnePieceCardType,
  OnePieceRarity,
  OnePieceState,
  OnePiecePlayerState,
  OnePiecePhase,
  OnePieceModuleConfig,
  OnePieceGameModule,
  CardVisibilityState,
  CardStateTransition,
  CryptographicProof,
  DeckPeekRequest,
  DeckPeekAck,
  DeckPeekOwnerDecrypt,
  DeckPeekReorder,
  DeckPeekProtocol,
  PlayAreaSlot,
  SlotType,
} from "./types";

export { DEFAULT_CONFIG } from "./types";

// Zones
export { ONEPIECE_ZONES, ZONE_IDS, getZoneById } from "./zones";

// Visibility state machine
export {
  isValidTransition,
  getValidTransitions,
  transitionCardVisibility,
  batchTransitionVisibility,
  getCardVisibility,
  initializeCardVisibility,
  isCardVisibleTo,
} from "./visibility";

// Play area
export {
  createPlayArea,
  getLeaderSlot,
  getCharacterSlots,
  getStageSlot,
  getSlotByPosition,
  findSlotByCardId,
  findEmptyCharacterSlot,
  countOccupiedCharacterSlots,
  placeCardInSlot,
  removeCardFromSlot,
  attachDon,
  detachDon,
  getTotalAttachedDon,
} from "./playArea";

// Peek protocol
export {
  createPeekRequest,
  acknowledgePeekRequest,
  ownerDecryptPeek,
  reorderPeekedCards,
  completePeek,
  findPeekProtocol,
  getPlayerActivePeeks,
} from "./peek";

// Proof chain
export {
  createProof,
  signProof,
  appendProof,
  verifyProofChain,
  verifyProofSignatures,
  getLatestProof,
  getLatestProofHash,
  getProofsForCard,
} from "./proofChain";

export type {
  ProofChainError,
  ProofChainVerification,
  SignatureVerification,
} from "./proofChain";

// Game functions
export {
  createDonCards,
  shuffleDeck,
  createInitialState,
  validateMove,
} from "./game";
