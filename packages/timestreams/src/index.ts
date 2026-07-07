export const PACKAGE_NAME = "@manamesh/timestreams";

// Re-export key module pieces
export { TimestreamsModule, TimestreamsGame } from "./game";
export { default } from "./game";
export * from "./types";
export { TIMESTREAMS_ZONES, ZONE_IDS, getZoneById } from "./zones";
export { createCryptoInitialState, submitPublicKey, encryptDeck, commitShuffleSeed, revealShuffleSeed, shuffleEncryptedDeck, submitDecryptionShare, dealForDay } from "./crypto";
export { createPlaceholderDeck, createCardFromManifest, createDeckFromPack, timestreamsCardSchema } from "./deck";
export { resolveDeck, resolveDeckFromPack, resolveDecksFromPack as resolveDecksForPlayers, getDeckSizeFromPack } from "./deckResolver";
export { composeCardText, hasReactTrigger } from "./types";
export { resolvePlayEffect } from "./effects/resolvePlay";
export { canPlayCard } from "./effects/gates";
export { fireEvent, registerStaticTriggers } from "./effects/triggers";
export { resolveScoring } from "./scoring";
export { checkReactForDiscard, checkReactForMove, applyReactsForEvent, isProtected } from "./effects/react";
export { TimestreamsBoard } from "./board/TimestreamsBoard";
export type { EffectResult, PlayerPrompt, ChoiceMap } from "./effects/types";
