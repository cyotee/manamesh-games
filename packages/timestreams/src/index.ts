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
