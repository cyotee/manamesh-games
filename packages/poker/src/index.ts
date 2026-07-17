/**
 * Poker Game Module
 *
 * Texas Hold'em poker implementation with both standard and crypto variants.
 */

// Types
export type {
  PokerCard,
  BasePokerState,
  PokerState,
  PokerPlayerState,
  CryptoPokerState,
  CryptoPokerPlayerState,
  PokerPhase,
  CryptoPokerPhase,
  BettingRoundState,
  SidePot,
  PokerConfig,
  TimeoutConfig,
  EvaluatedHand,
  HandComparisonResult,
  ShowdownResult,
  MoveValidation,
  PeekNotification,
} from './types';

export {
  HandRank,
  HAND_RANK_NAMES,
  RANK_VALUES,
  SUIT_VALUES,
  POKER_ZONES,
  DEFAULT_POKER_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
  getCardId,
  parseCardId,
  getAllCardIds,
} from './types';

// Hand ranking
export {
  evaluateHand,
  compareHands,
  findBestHand,
  determineWinners,
  getHandRankName,
} from './hands';

// Betting logic
export {
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

// Standard Poker
export {
  PokerGame,
  PokerModule,
  createInitialState,
  validateMove,
  createStandardDeck,
  shuffleDeck,
  pokerCardSchema,
} from './game';

// Crypto Poker
export {
  CryptoPokerGame,
  CryptoPokerModule,
  createCryptoInitialState,
  validateCryptoMove,
  canAbortDecryptNow,
  buildHandResult,
  submitDecryptedShare,
  approveDecrypt,
  voteAbortDecrypt,
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
} from './crypto';

// On-chain settlement helpers (pair with the @manamesh/poker Solidity contracts)
export { deriveHandId } from './handId';
export type { HandInit } from './handId';
export {
  settlerDomain,
  signHandInit,
  recoverHandInitSigner,
  signHandOutcome,
  recoverHandOutcomeSigner,
  signRoundStateTransition,
  recoverRoundStateTransitionSigner,
} from './signing';
export type { HandOutcome, RoundStateTransition } from './signing';
export { buildSettlement, encodeCard } from './handOutcome';
export type { BuiltSettlement, SettleableHandState, BuildHandOutcomeOptions } from './handOutcome';

// Live settlement client (mocked-viem testable; pair with frontend BlockchainService)
export {
  LiveSettlementClient,
  pokerHandSettlerAbi,
  requirePlayerAddresses,
  buildHandInit,
  noncesForSortedPlayers,
  prepareSettlementPayload,
  buildAssertHandCall,
  buildSettleHandCall,
} from './settlementClient';
export type {
  SettlementClientMode,
  SettlementTableConfig,
  SettlementWriteClient,
  SettlementReadClient,
  SettlementWriteArgs,
  SettlementReadArgs,
  LiveSettlementClientOptions,
  TxCallResult,
  AssertHandCall,
  SettleHandCall,
} from './settlementClient';

// React board component
export { PokerBoard } from './components/PokerBoard';

// Default export is standard poker
export { PokerModule as default } from './game';
