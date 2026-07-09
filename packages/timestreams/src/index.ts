export const PACKAGE_NAME = "@manamesh/timestreams";

// Re-export key module pieces
export { TimestreamsModule, TimestreamsGame } from "./game";
export { default } from "./game";
export * from "./types";
export { TIMESTREAMS_ZONES, ZONE_IDS, getZoneById } from "./zones";
export {
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  commitShuffleSeed,
  revealShuffleSeed,
  shuffleEncryptedDeck,
  submitDecryptionShare,
  dealForDay,
  dealPlaintextHands,
  requestDraws,
  pushActivityLog,
  peelDecryptShare,
  enqueueNextDrawIfNeeded,
  buildEncryptionLayer,
  startSearchDeckReveal,
  completeSearchDeckPick,
  hasActiveDeckOp,
  deckHasEncryption,
  commitDeckOpSeed,
  revealDeckOpSeed,
  submitDeckOpReencrypt,
  buildDeckOpReencryptLayer,
} from "./crypto";
export { createPlaceholderDeck, createCardFromManifest, createDeckFromPack, timestreamsCardSchema } from "./deck";
export { resolveDeck, resolveDeckFromPack, resolveDecksFromPack as resolveDecksForPlayers, getDeckSizeFromPack, materializeHomeEraDecks } from "./deckResolver";
export { loadPackCatalogFromHttp, DEFAULT_PACK_BASE_URL, ERA_TO_SET } from "./packCatalog";
export type { PackCatalog, PackCardEntry, PackCatalogLoadResult } from "./packCatalog";
export { composeCardText, hasReactTrigger } from "./types";
export { resolvePlayEffect } from "./effects/resolvePlay";
export { canPlayCard } from "./effects/gates";
export { fireEvent, registerStaticTriggers } from "./effects/triggers";
export {
  resolveScoring,
  computeScoringSlotsForEra,
  scoringSlotModifierNotes,
} from "./scoring";
export { checkReactForDiscard, checkReactForMove, applyReactsForEvent, isProtected } from "./effects/react";
export {
  getAvailableHandReacts,
  applyHandReact,
  openHandReactWindowForAction,
  submitHandReactAnswer,
} from "./effects/handReact";
export { TimestreamsBoard } from "./board/TimestreamsBoard";
export type { EffectResult, PlayerPrompt, ChoiceMap } from "./effects/types";
