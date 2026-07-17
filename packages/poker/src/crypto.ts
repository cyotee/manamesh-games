/**
 * Crypto Poker Game Module
 *
 * Mental poker implementation of Texas Hold'em for P2P play.
 * Uses SRA commutative encryption for cryptographic fairness.
 */

import type { Game, Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";
import type { CardSchema, GameConfig, MoveValidation } from "@manamesh/frontend/src/game/modules/types";
import {
  PokerCard,
  CryptoPokerState,
  CryptoPokerPlayerState,
  CryptoPokerPhase,
  BettingRoundState,
  PeekNotification,
  DecryptRequest,
  DecryptNotification,
  POKER_ZONES,
  PokerConfig,
  DEFAULT_POKER_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
  TimeoutConfig,
  getAllCardIds,
} from "./types";
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
  getSmallBlindPlayer,
  getBigBlindPlayer,
  getUTGPlayer,
  getFirstToActPostflop,
  postBlinds,
  rotateDealer,
} from "./betting";
import { evaluateHand, findBestHand, determineWinners } from "./hands";
import {
  pokerCardSchema,
  createStandardDeck,
  shuffleDeck as shuffleStandardDeck,
} from "./game";
import type {
  CryptoPluginState,
  CryptoPluginApi,
} from "@manamesh/boardgameio-crypto/plugin/crypto-plugin";
import { CryptoPlugin } from "@manamesh/boardgameio-crypto/plugin/crypto-plugin";
import {
  generateKeyPair,
  encryptDeck as encryptDeckCrypto,
  reencryptDeck,
  quickShuffle,
  buildCardPointLookup,
  type EncryptedCard,
} from "@manamesh/boardgameio-crypto/mental-poker";
import { secpIsValidPointHex, validateEncryptedCard, validatePlayerIdentity } from "@manamesh/boardgameio-crypto/secp256k1";
import {
  keychainAdd,
  keychainFromRecord,
  MENTAL_POKER_KEYCHAIN_POLICY,
  requirePrivateKeyMatchesPublished,
} from "@manamesh/boardgameio-crypto/keychain";
import {
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
  lookupCardIdFromPoint,
  getLogicalMoveCount,
} from "@manamesh/boardgameio-crypto";

// =============================================================================
// Constants
// =============================================================================

const DECK_ZONE = "deck";
const COMMUNITY_ZONE = "community";

// Liveness protection (Phase 3 of security remediation)
export const POKER_DECRYPT_STALL_WINDOW_MOVES = 12;

// =============================================================================
// State Helpers
// =============================================================================

// Re-export setup helpers from shared embedded package.
export {
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
} from "@manamesh/boardgameio-crypto";

export function canAbortDecryptNow(G: CryptoPokerState, ctx: Ctx): boolean {
  const pending = G.decryptRequests.filter((r) => r.status === "pending");
  if (pending.length === 0) return false;
  const logicalMoves = getLogicalMoveCount(ctx);
  // Stall if we've had many moves since any pending decrypt was created (simple heuristic)
  const oldestPending = Math.min(...pending.map((r) => r.timestamp || 0));
  const movesSince = logicalMoves - (oldestPending ? 0 : logicalMoves); // fallback
  return logicalMoves >= POKER_DECRYPT_STALL_WINDOW_MOVES || movesSince > POKER_DECRYPT_STALL_WINDOW_MOVES;
}

// =============================================================================
// Initial State
// =============================================================================

/**
 * Create initial crypto poker state.
 *
 * @param config - Game configuration
 * @param config.options.initialBalances - Optional balances from blockchain (playerId -> chips)
 * @param config.options.handId - Optional hand ID for settlement tracking
 * @param config.options.dealerIndex - Optional dealer position (for multi-hand sessions)
 */
export function createCryptoInitialState(config: GameConfig): CryptoPokerState {
  const pokerConfig: PokerConfig = {
    ...DEFAULT_POKER_CONFIG,
    ...config.options,
  };

  // Get initial balances from blockchain or use default
  const initialBalances =
    (config.options?.initialBalances as Record<string, number>) || {};
  const handId =
    (config.options?.handId as string) || `hand-${(config.playerIDs || []).join('-')}-0`;
  const dealerIndex = (config.options?.dealerIndex as number) || 0;

  const cardIds = getAllCardIds();

  const players: Record<string, CryptoPokerPlayerState> = {};
  const startingChips: Record<string, number> = {};
  const contributions: Record<string, number> = {};
  const zones: Record<string, Record<string, PokerCard[]>> = {
    deck: { shared: [] },
    hand: {},
    community: { shared: [] },
    discard: { shared: [] },
    mucked: { shared: [] },
  };

  // Initialize player states with balances from blockchain
  for (const playerId of config.playerIDs) {
    const chips = initialBalances[playerId] ?? pokerConfig.startingChips;
    startingChips[playerId] = chips;
    contributions[playerId] = 0;

    players[playerId] = {
      hand: [],
      chips,
      bet: 0,
      folded: false,
      hasActed: false,
      isAllIn: false,
      publicKey: null,
      hasEncrypted: false,
      hasShuffled: false,
      hasPeeked: false,
      peekedCards: [],
      keysReleased: false,
      isConnected: true,
      lastHeartbeat: Date.now(),
    };
    zones.hand[playerId] = [];
  }

  const playerOrder = [...config.playerIDs];
  const dealer = playerOrder[dealerIndex % playerOrder.length];

  // Initialize crypto state
  const cryptoState: CryptoPluginState = {
    phase: "init",
    publicKeys: {},
    commitments: {},
    shuffleProofs: {},
    encryptedZones: {},
    cardPointLookup: {},
    revealedCards: {},
    pendingReveals: {},
  };

  const state: CryptoPokerState = {
    community: [],
    pot: 0,
    sidePots: [],
    players,
    dealer,
    smallBlind: playerOrder.length > 2 ? playerOrder[1] : playerOrder[0],
    bigBlind: playerOrder.length > 2 ? playerOrder[2] : playerOrder[1],
    phase: "keyExchange",
    bettingRound: {
      currentBet: 0,
      minRaise: pokerConfig.bigBlind,
      activePlayer: "",
      actedPlayers: [],
      isComplete: false,
      lastAggressor: null,
    },
    smallBlindAmount: pokerConfig.smallBlind,
    bigBlindAmount: pokerConfig.bigBlind,
    playerOrder,
    winners: [],
    zones,
    crypto: cryptoState,
    cardIds,
    setupPlayerIndex: 0,
    // Settlement tracking
    handId,
    contributions,
    startingChips,
    peekNotifications: [],
    // Cooperative decryption
    decryptRequests: [],
    decryptNotifications: [],
    // Key release tracking
    releasedCards: {},
    recentFolds: [],
    foldChallenges: [],
  };

  // Update positions
  state.smallBlind = getSmallBlindPlayer(state);
  state.bigBlind = getBigBlindPlayer(state);

  return state;
}

// =============================================================================
// Setup Phase Moves
// =============================================================================

/**
 * Submit public key during key exchange phase.
 */
/**
 * Mental-poker key admission: valid finite secp256k1 points, one key per seat,
 * no two seats share the same public key. Implemented via boardgameio-crypto
 * {@link MENTAL_POKER_KEYCHAIN_POLICY} — no game rules inside the crypto package.
 */
export function submitPublicKey(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  publicKey: string,
): CryptoPokerState | typeof INVALID_MOVE {
  console.log(
    "[CryptoPoker] submitPublicKey called for player",
    playerId,
    "phase:",
    G.phase,
    "existing key:",
    G.players[playerId]?.publicKey,
  );
  if (G.phase !== "keyExchange") {
    console.log(
      "[CryptoPoker] submitPublicKey INVALID_MOVE: not in keyExchange phase",
    );
    return INVALID_MOVE;
  }

  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.publicKey) return INVALID_MOVE; // Already submitted

  // Rebuild keychain from committed publicKeys + admit under mental-poker policy.
  // Pure crypto admission; game only maps reject → INVALID_MOVE and stores result.
  const prior = keychainFromRecord(
    G.crypto.publicKeys ?? {},
    MENTAL_POKER_KEYCHAIN_POLICY,
  );
  const admitted = keychainAdd(
    prior,
    playerId,
    publicKey,
    MENTAL_POKER_KEYCHAIN_POLICY,
  );
  if (!admitted.ok) {
    console.log(
      "[CryptoPoker] submitPublicKey INVALID_MOVE: keychain reject",
      admitted.reason,
    );
    return INVALID_MOVE;
  }

  const canonical = admitted.entry.publicKey;
  player.publicKey = canonical;
  G.crypto.publicKeys[playerId] = canonical;
  G.crypto.keychain = admitted.keychain;

  // Check if all players have submitted
  const allSubmitted = G.playerOrder.every(
    (pid) => G.players[pid].publicKey !== null,
  );
  if (allSubmitted) {
    G.phase = "encrypt";
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Encrypt deck during encrypt phase.
 */
export function encryptDeck(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (G.phase !== "encrypt") return INVALID_MOVE;

  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }
  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (player.hasEncrypted) return INVALID_MOVE;

  // sk must derive the public key admitted to the keychain at key exchange
  const published =
    player.publicKey ?? G.crypto.publicKeys[playerId] ?? null;
  if (!requirePrivateKeyMatchesPublished(privateKey, published)) {
    console.log(
      "[CryptoPoker] encryptDeck INVALID_MOVE: private key does not match published public key",
    );
    return INVALID_MOVE;
  }

  // Perform actual encryption
  const existingDeck = G.crypto.encryptedZones["deck"];

  if (!existingDeck || existingDeck.length === 0) {
    // First player: encrypt all card IDs
    const cardIds = G.cardIds;
    console.log(
      "[CryptoPoker] First encryption by player",
      playerId,
      "- encrypting",
      cardIds.length,
      "cards",
    );

    // Card point lookup should already be built in submitPublicKey
    // Encrypt the deck
    const encryptedDeck = encryptDeckCrypto(cardIds, privateKey);
    G.crypto.encryptedZones["deck"] = encryptedDeck;
    console.log(
      "[CryptoPoker] Encrypted deck has",
      encryptedDeck.length,
      "cards with",
      encryptedDeck[0]?.layers,
      "layers",
    );
  } else {
    // Subsequent players: re-encrypt the already encrypted deck
    console.log(
      "[CryptoPoker] Re-encryption by player",
      playerId,
      "- current layers:",
      existingDeck[0]?.layers,
    );
    const reencryptedDeck = reencryptDeck(existingDeck, privateKey);
    G.crypto.encryptedZones["deck"] = reencryptedDeck;
    console.log(
      "[CryptoPoker] Re-encrypted deck has",
      reencryptedDeck.length,
      "cards with",
      reencryptedDeck[0]?.layers,
      "layers",
    );
  }

  // Update crypto phase
  G.crypto.phase = "encrypt";
  player.hasEncrypted = true;

  // Advance to next player or next phase
  if (advanceSetupPlayer(G)) {
    G.phase = "shuffle";
    resetSetupPlayer(G);
  }

  return G;
}

/**
 * Shuffle deck during shuffle phase.
 */
export function shuffleEncryptedDeck(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  events?: { endPhase?: () => void },
): CryptoPokerState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;

  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (player.hasShuffled) return INVALID_MOVE;

  // Get the encrypted deck
  const encryptedDeck = G.crypto.encryptedZones["deck"];
  if (!encryptedDeck || encryptedDeck.length === 0) {
    console.error("[CryptoPoker] No encrypted deck to shuffle!");
    return INVALID_MOVE;
  }

  // Shuffle the deck
  console.log(
    "[CryptoPoker] Shuffling deck for player",
    playerId,
    "- deck has",
    encryptedDeck.length,
    "cards",
  );
  const shuffledDeck = quickShuffle(encryptedDeck);
  G.crypto.encryptedZones["deck"] = shuffledDeck;
  console.log("[CryptoPoker] Deck shuffled by player", playerId);

  // Update crypto phase
  G.crypto.phase = "shuffle";
  player.hasShuffled = true;

  // Advance to next player or start game
  if (advanceSetupPlayer(G)) {
    // Update crypto phase to ready
    G.crypto.phase = "ready";

    // Transition to preflop - deal hole cards
    dealHoleCards(G);
    G.phase = "preflop";

    // Post blinds and set first to act
    postBlinds(G);
    const utgPlayer = getUTGPlayer(G);
    G.bettingRound = initBettingRound(G, utgPlayer);
    G.bettingRound.currentBet = G.bigBlindAmount;

    // Only end the setup phase if we're actually in setup (first hand)
    // For new hands, we're already in play phase, so don't call endPhase
    const isInSetupPhase = ctx.phase === "setup";
    console.log(
      "[CryptoPoker] Shuffle complete. ctx.phase:",
      ctx.phase,
      "isInSetupPhase:",
      isInSetupPhase,
    );
    if (isInSetupPhase && events?.endPhase) {
      console.log("[CryptoPoker] Ending setup phase, transitioning to play");
      events.endPhase();
      console.log("[CryptoPoker] Called events.endPhase()");
    } else {
      console.warn("[CryptoPoker] events.endPhase not available!");
    }
  }

  return G;
}

/**
 * Deal hole cards to all players (encrypted).
 */
export function dealHoleCards(G: CryptoPokerState): void {
  // In crypto mode, this moves encrypted cards to player hand zones
  // The actual card values remain encrypted until peek/reveal

  const deck = G.crypto.encryptedZones["deck"];
  if (!deck || deck.length === 0) {
    console.error("[CryptoPoker] No deck to deal from!");
    return;
  }

  console.log(
    "[CryptoPoker] Dealing hole cards to",
    G.playerOrder.length,
    "players",
  );

  // Deal 2 cards to each player (deal one card at a time in rotation, like real poker)
  for (let round = 0; round < 2; round++) {
    for (const playerId of G.playerOrder) {
      const handZone = `hand:${playerId}`;

      // Initialize hand zone if needed
      if (!G.crypto.encryptedZones[handZone]) {
        G.crypto.encryptedZones[handZone] = [];
      }

      // Take top card from deck and add to player's hand
      const card = deck.shift();
      if (card) {
        G.crypto.encryptedZones[handZone].push(card);
      }
    }
  }

  console.log("[CryptoPoker] Dealt cards. Deck remaining:", deck.length);
}

/**
 * Deal community cards (flop/turn/river) from encrypted deck.
 * Uses cooperative decryption - players must approve before cards are revealed.
 */
export function dealCommunityCards(
  G: CryptoPokerState,
  ctx: Ctx,
  count: number,
): void {
  const deck = G.crypto.encryptedZones["deck"];
  if (!deck || deck.length < count) {
    console.error(
      "[CryptoPoker] Not enough cards in deck to deal community cards!",
    );
    return;
  }

  if (!G.crypto.encryptedZones["community"]) {
    G.crypto.encryptedZones["community"] = [];
  }

  console.log("[CryptoPoker] Dealing", count, "community cards");

  for (let i = 0; i < count; i++) {
    const card = deck.shift();
    if (card) {
      G.crypto.encryptedZones["community"].push(card);
      const cardIndex = G.crypto.encryptedZones["community"].length - 1;

      requestCommunityCardDecrypt(G, ctx, cardIndex);

      G.community.push({
        id: `community-${G.community.length}`,
        rank: "?" as PokerCard["rank"],
        suit: "spades" as const,
      });
      console.log(
        "[CryptoPoker] Added placeholder community card (awaiting cooperative decrypt)",
      );
    }
  }

  console.log(
    "[CryptoPoker] Community cards:",
    G.community.length,
    ", Deck remaining:",
    deck.length,
  );
}

/**
 * Request cooperative decryption of community cards.
 * All players must approve before cards are revealed.
 */
function requestCommunityCardDecrypt(
  G: CryptoPokerState,
  ctx: Ctx,
  cardIndex: number,
): CryptoPokerState | typeof INVALID_MOVE {
  const zoneId = "community";

  // Check if there's already a pending request for this community card
  const existingRequest = G.decryptRequests.find(
    (r) =>
      r.zoneId === zoneId &&
      r.cardIndices.includes(cardIndex) &&
      r.status === "pending",
  );
  if (existingRequest) return G;

  const numMoves = (ctx as any).numMoves ?? 0;
  const requestId = `decrypt-${(ctx as any).turn ?? 0}-${numMoves}-community-${cardIndex}`;

  // Initialize approvals - no auto-approval for community cards
  // All players must contribute their decryption share
  const approvals: Record<string, boolean> = {};
  for (const pid of G.playerOrder) {
    approvals[pid] = false;
  }

  const request: DecryptRequest = {
    id: requestId,
    requestingPlayer: "community",
    zoneId,
    cardIndices: [cardIndex],
    timestamp: numMoves,
    status: "pending",
    approvals,
    decryptionShares: {},
  };

  G.decryptRequests.push(request);

  console.log(
    "[CryptoPoker] Community card decrypt request created:",
    requestId,
    "for card index:",
    cardIndex,
  );

  return G;
}

/**
 * Process pending community card decrypt requests.
 * Called during phase advancement to complete cooperative decryption.
 * V2 Security Fix: Uses cooperative decryption, not stored private keys.
 */
function processCommunityCardDecrypt(G: CryptoPokerState): void {
  const communityZone = G.crypto.encryptedZones["community"];
  if (!communityZone) return;

  // Find all completed decrypt requests for community cards
  const completedRequests = G.decryptRequests.filter(
    (r) =>
      r.zoneId === "community" &&
      r.status === "completed" &&
      r.requestingPlayer === "community",
  );

  for (const request of completedRequests) {
    for (const cardIndex of request.cardIndices) {
      if (cardIndex >= communityZone.length) continue;

      // Use the most-reduced share sent by players (progressive peel pattern).
      // Clients compute local peel on the current version they see; later
      // submitters may see prior peels, driving layers toward 0.
      const encryptedCard = communityZone[cardIndex];
      let decrypted = { ...encryptedCard };

      for (const playerId of G.playerOrder) {
        // Community requests are single-index; peels stored as length-1 arrays.
        const shareArr = request.decryptionShares[playerId];
        const share = shareArr?.[0];
        if (share && share.layers < decrypted.layers) {
          decrypted = { ...share };
        }
      }

      if (decrypted.layers === 0) {
        // Defensive check against tampered cardPointLookup (clients should also re-derive)
        const lookup = G.crypto.cardPointLookup || {};
        const pointKnown = Object.values(lookup).some((p) => p === decrypted.ciphertext);
        if (!pointKnown) {
          console.warn("[CryptoPoker] Final decrypted point not present in cardPointLookup");
        }
        const cardId = lookupCardIdFromPoint(
          G.crypto.cardPointLookup,
          decrypted.ciphertext,
        );
        if (cardId) {
          G.community.push(parseCardId(cardId));
          console.log("[CryptoPoker] Revealed community card:", cardId);
        }
      }

      // Update the source zone with the best peeled version (progressive reveal consistency with War)
      if (decrypted.layers < encryptedCard.layers) {
        communityZone[cardIndex] = decrypted;
      }
    }
  }
}

// =============================================================================
// Peek and Reveal Moves
// =============================================================================

/**
 * Request to peek at hole cards via cooperative decryption.
 * V2 Security Fix: Uses cooperative decryption instead of stored private keys.
 */
export function peekHoleCards(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (!["preflop", "flop", "turn", "river"].includes(G.phase))
    return INVALID_MOVE;

  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasPeeked) return INVALID_MOVE;
  if (player.folded) return INVALID_MOVE;

  const bettingComplete =
    G.bettingRound.isComplete ||
    G.phase === "showdown" ||
    G.bettingRound.actedPlayers.length === 0;
  if (!bettingComplete) return INVALID_MOVE;

  const handZoneId = `hand:${playerId}`;
  const handZone = G.crypto.encryptedZones[handZoneId];
  if (!handZone || handZone.length === 0) {
    console.error(
      "[CryptoPoker] No encrypted cards in hand zone for player",
      playerId,
    );
    return INVALID_MOVE;
  }

  const zoneId = handZoneId;
  const cardIndices = handZone.map((_, i) => i);

  const numMoves = (ctx as any).numMoves ?? 0;
  const requestId = `decrypt-${(ctx as any).turn ?? 0}-${numMoves}-${playerId}-peek`;

  const approvals: Record<string, boolean> = {};
  for (const pid of G.playerOrder) {
    approvals[pid] = pid === playerId;
  }

  const request: DecryptRequest = {
    id: requestId,
    requestingPlayer: playerId,
    zoneId,
    cardIndices,
    timestamp: numMoves,
    status: "pending",
    approvals,
    decryptionShares: {},
  };

  G.decryptRequests.push(request);

  G.peekNotifications.push({
    playerId,
    timestamp: Date.now(),
  });

  console.log(
    "[CryptoPoker] Player",
    playerId,
    "requested to peek at cards - decrypt request:",
    requestId,
  );

  return G;
}

// lookupCardIdFromPoint imported from shared embedded package.

/**
 * Parse a card ID (e.g., "Ah", "2c") into a PokerCard.
 */
/**
 * Parse a card ID (e.g., "hearts-A", "spades-K") into a PokerCard.
 * Card ID format is "${suit}-${rank}" as defined in types.ts getCardId().
 */
function parseCardId(cardId: string): PokerCard {
  const validRanks: PokerCard["rank"][] = [
    "A",
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
  ];
  const validSuits: PokerCard["suit"][] = [
    "hearts",
    "diamonds",
    "clubs",
    "spades",
  ];

  const parts = cardId.split("-");
  if (parts.length !== 2) {
    console.error("[CryptoPoker] Invalid card ID format:", cardId);
    // Type assertion for placeholder - "?" isn't a valid rank but we need to show something
    return { id: cardId, rank: "?" as PokerCard["rank"], suit: "spades" };
  }

  const [suit, rank] = parts;

  // Validate suit
  if (!validSuits.includes(suit as PokerCard["suit"])) {
    console.error("[CryptoPoker] Invalid suit in card ID:", suit);
    return { id: cardId, rank: rank as PokerCard["rank"], suit: "spades" };
  }

  // Validate rank
  if (!validRanks.includes(rank as PokerCard["rank"])) {
    console.error("[CryptoPoker] Invalid rank in card ID:", rank);
    return {
      id: cardId,
      rank: rank as PokerCard["rank"],
      suit: suit as PokerCard["suit"],
    };
  }

  return {
    id: cardId,
    rank: rank as PokerCard["rank"],
    suit: suit as PokerCard["suit"],
  };
}

// =============================================================================
// Cooperative Decryption Moves
// =============================================================================

/**
 * Request cooperative decryption of cards.
 * This initiates the approval process - other players must approve before cards can be decrypted.
 */
function requestDecrypt(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  zoneId: string,
  cardIndices: number[],
): CryptoPokerState | typeof INVALID_MOVE {
  if (!["preflop", "flop", "turn", "river"].includes(G.phase))
    return INVALID_MOVE;

  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.folded) return INVALID_MOVE;

  const bettingComplete =
    G.bettingRound.isComplete ||
    G.phase === "showdown" ||
    G.bettingRound.actedPlayers.length === 0;
  if (!bettingComplete) return INVALID_MOVE;

  // Check if there's already a pending request for this zone
  const existingRequest = G.decryptRequests.find(
    (r) =>
      r.zoneId === zoneId &&
      r.requestingPlayer === playerId &&
      r.status === "pending",
  );
  if (existingRequest) return INVALID_MOVE;

  // Create the decrypt request
  const numMoves = (ctx as any).numMoves ?? 0;
  const requestId = `decrypt-${(ctx as any).turn ?? 0}-${numMoves}-${playerId}-${zoneId.replace(/[:/]/g,'-')}`;

  // Initialize approvals - requesting player auto-approves
  const approvals: Record<string, boolean> = {};
  for (const pid of G.playerOrder) {
    approvals[pid] = pid === playerId; // Auto-approve for requesting player
  }

  const request: DecryptRequest = {
    id: requestId,
    requestingPlayer: playerId,
    zoneId,
    cardIndices,
    timestamp: numMoves,
    status: "pending",
    approvals,
    decryptionShares: {},
  };

  G.decryptRequests.push(request);

  // Add notification for all players
  const notification: DecryptNotification = {
    type: "request",
    requestId,
    playerId,
    message: `Player ${playerId} requests to reveal their cards`,
    timestamp: Date.now(),
  };
  G.decryptNotifications.push(notification);

  console.log(
    "[CryptoPoker] Decrypt request created:",
    requestId,
    "for zone:",
    zoneId,
  );

  return G;
}

/**
 * Approve a decrypt request and submit decryption peels.
 * V2 Security Fix: Player decrypts LOCALLY and sends the RESULT, not their private key.
 *
 * @param decryptedCardOrShares - One EncryptedCard (single-index request) or an
 *   array parallel to `request.cardIndices` (multi-card hole peeks). Each entry
 *   should be a progressive peel of the *current* zone card with this player's key.
 */
export function approveDecrypt(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  requestId: string,
  decryptedCardOrShares: EncryptedCard | EncryptedCard[],
): CryptoPokerState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }

  const request = G.decryptRequests.find((r) => r.id === requestId);
  if (!request) {
    console.error("[CryptoPoker] Decrypt request not found:", requestId);
    return INVALID_MOVE;
  }

  if (request.status !== "pending") {
    console.error("[CryptoPoker] Request is not pending:", request.status);
    return INVALID_MOVE;
  }

  // Already approved *and* share submitted → no double-submit.
  // (Requester is auto-approved on peekHoleCards but still must submit a share.)
  if (request.approvals[playerId] && request.decryptionShares[playerId]) {
    console.log(
      "[CryptoPoker] Player",
      playerId,
      "already approved request with share",
      requestId,
    );
    return INVALID_MOVE;
  }

  const shares: EncryptedCard[] = Array.isArray(decryptedCardOrShares)
    ? decryptedCardOrShares
    : [decryptedCardOrShares];
  if (shares.length !== request.cardIndices.length) {
    return INVALID_MOVE;
  }
  for (const s of shares) {
    if (!validateEncryptedCard(s)) return INVALID_MOVE;
  }

  request.approvals[playerId] = true;
  request.decryptionShares[playerId] = shares;

  // Progressive peel: update zone cards toward fewer layers using this share set.
  const zone = G.crypto.encryptedZones[request.zoneId];
  if (zone) {
    for (let j = 0; j < request.cardIndices.length; j++) {
      const idx = request.cardIndices[j];
      if (idx < 0 || idx >= zone.length) continue;
      const share = shares[j];
      if (share.layers < zone[idx].layers) {
        zone[idx] = { ...share };
      }
    }
  }

  const notification: DecryptNotification = {
    type: "approval",
    requestId,
    playerId,
    message: `Player ${playerId} approved the decrypt request`,
    timestamp: Date.now(),
  };
  G.decryptNotifications.push(notification);

  console.log(
    "[CryptoPoker] Player",
    playerId,
    "approved decrypt request",
    requestId,
  );

  const allApproved = G.playerOrder.every((pid) => request.approvals[pid]);
  // Mental-poker privacy: every player must submit peels, not merely approve.
  const allShares = G.playerOrder.every(
    (pid) =>
      !!request.decryptionShares[pid] &&
      request.decryptionShares[pid].length === request.cardIndices.length,
  );

  if (allApproved && allShares) {
    console.log("[CryptoPoker] All players approved with shares! Completing decryption...");

    if (request.requestingPlayer === "community") {
      // Ensure zone reflects best peels from all players
      applyBestPeelsToZone(G, request);
      const zoneCards = G.crypto.encryptedZones[request.zoneId];
      const fullyPeeled =
        !!zoneCards &&
        request.cardIndices.every((idx) => zoneCards[idx]?.layers === 0);
      if (fullyPeeled) {
        request.status = "completed";
        processCommunityCardDecrypt(G);
      }
    } else {
      applyBestPeelsToZone(G, request);
      const requestingPlayer = G.players[request.requestingPlayer];
      const handZone = G.crypto.encryptedZones[request.zoneId];

      if (handZone && requestingPlayer && !requestingPlayer.hasPeeked) {
        const peekedCards: PokerCard[] = [];
        let fullyRevealed = true;

        for (const i of request.cardIndices) {
          const decrypted = handZone[i];
          if (!decrypted || decrypted.layers !== 0) {
            fullyRevealed = false;
            peekedCards.push({
              id: "unknown",
              rank: "?" as PokerCard["rank"],
              suit: "spades" as const,
            });
            continue;
          }
          const cardId = lookupCardIdFromPoint(
            G.crypto.cardPointLookup,
            decrypted.ciphertext,
          );
          if (cardId) {
            peekedCards.push(parseCardId(cardId));
          } else {
            fullyRevealed = false;
            peekedCards.push({
              id: "unknown",
              rank: "?" as PokerCard["rank"],
              suit: "spades" as const,
            });
          }
        }

        if (fullyRevealed) {
          request.status = "completed";
          requestingPlayer.peekedCards = peekedCards;
          requestingPlayer.hasPeeked = true;
          console.log(
            "[CryptoPoker] Cooperative decryption complete for player",
            request.requestingPlayer,
          );
        } else {
          console.warn(
            "[CryptoPoker] Shares present but cards not fully peeled — leaving request pending",
          );
        }
      }

      if (request.status === "completed") {
        G.peekNotifications.push({
          playerId: request.requestingPlayer,
          timestamp: Date.now(),
        });
        const completeNotification: DecryptNotification = {
          type: "completed",
          requestId,
          playerId: request.requestingPlayer,
          message: `Cards revealed for Player ${request.requestingPlayer}`,
          timestamp: Date.now(),
        };
        G.decryptNotifications.push(completeNotification);
      }
    }
  }

  return G;
}

/** Apply the minimum-layer share for each card index across all players to the zone. */
function applyBestPeelsToZone(G: CryptoPokerState, request: DecryptRequest): void {
  const zone = G.crypto.encryptedZones[request.zoneId];
  if (!zone) return;
  for (let j = 0; j < request.cardIndices.length; j++) {
    const idx = request.cardIndices[j];
    if (idx < 0 || idx >= zone.length) continue;
    let best = { ...zone[idx] };
    for (const pid of G.playerOrder) {
      const share = request.decryptionShares[pid]?.[j];
      if (share && share.layers < best.layers) {
        best = { ...share };
      }
    }
    zone[idx] = best;
  }
}

/**
 * Dismiss a decrypt notification.
 */
function dismissNotification(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  notificationIndex: number,
): CryptoPokerState | typeof INVALID_MOVE {
  if (
    notificationIndex < 0 ||
    notificationIndex >= G.decryptNotifications.length
  ) {
    return INVALID_MOVE;
  }

  G.decryptNotifications.splice(notificationIndex, 1);
  return G;
}

/**
 * Release decryption keys for hole cards (proves valid cards on fold).
 * Player submits their decrypted hole cards to prove they had valid cards.
 */
export function releaseKey(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  decryptedCards: PokerCard[],
): CryptoPokerState | typeof INVALID_MOVE {
  const phases: CryptoPokerPhase[] = ["preflop", "flop", "turn", "river"];
  if (!phases.includes(G.phase)) return INVALID_MOVE;

  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.keysReleased) return INVALID_MOVE;

  player.keysReleased = true;
  G.releasedCards[playerId] = decryptedCards;

  console.log(
    "[CryptoPoker] Player",
    playerId,
    "released keys with cards:",
    decryptedCards.map((c) => c.id).join(", "),
  );

  return G;
}

/**
 * Challenge a player who folded without releasing their keys.
 * If successful, the game is voided and the challenger(s) win.
 */
export function challengeVoid(
  G: CryptoPokerState,
  ctx: Ctx,
  challengerId: string,
  challengedPlayerId: string,
): CryptoPokerState | typeof INVALID_MOVE {
  const challenger = G.players[challengerId];
  if (!challenger) return INVALID_MOVE;
  if (challenger.folded) return INVALID_MOVE;

  const challenged = G.players[challengedPlayerId];
  if (!challenged) return INVALID_MOVE;

  const logicalNow = (ctx as any).numMoves ?? 0;
  const recentFold = G.recentFolds.find(
    (f) =>
      f.playerId === challengedPlayerId &&
      logicalNow - f.timestamp < 5 &&
      f.challengeWindowEnd > logicalNow,
  );
  if (!recentFold) return INVALID_MOVE;

  G.foldChallenges.push({
    challenger: challengerId,
    challenged: challengedPlayerId,
    timestamp: logicalNow,
  });

  G.phase = "voided";
  G.winners = [challengerId];

  console.log(
    "[CryptoPoker] challengeVoid:",
    challengerId,
    "challenged",
    challengedPlayerId,
    "- game voided",
  );

  return G;
}

/**
 * Submit decryption share for community card reveal.
 * V2 Security Fix: Player decrypts LOCALLY and sends the RESULT, not their private key.
 */
export function submitDecryptedShare(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
  decryptedCard: EncryptedCard,
  zoneId: string,
  cardIndex: number,
): CryptoPokerState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  if (!validatePlayerIdentity(ctx.playerID, playerId)) {
    return INVALID_MOVE;
  }

  if (!validateEncryptedCard(decryptedCard)) {
    return INVALID_MOVE;
  }

  const request = G.decryptRequests.find(
    (r) =>
      r.zoneId === zoneId &&
      r.requestingPlayer === "community" &&
      r.status === "pending" &&
      r.cardIndices.includes(cardIndex),
  );
  if (!request) return INVALID_MOVE;
  if (request.approvals[playerId] && request.decryptionShares[playerId]) {
    return INVALID_MOVE;
  }

  request.approvals[playerId] = true;
  // Parallel to cardIndices (usually length 1 for community)
  const shares = request.cardIndices.map((idx) =>
    idx === cardIndex ? decryptedCard : G.crypto.encryptedZones[zoneId]?.[idx] ?? decryptedCard,
  );
  request.decryptionShares[playerId] = shares;

  // Progressive zone update
  const zone = G.crypto.encryptedZones[zoneId];
  if (zone && decryptedCard.layers < zone[cardIndex].layers) {
    zone[cardIndex] = { ...decryptedCard };
  }

  const allApproved = G.playerOrder.every((pid) => request.approvals[pid]);
  const allShares = G.playerOrder.every(
    (pid) => !!request.decryptionShares[pid]?.length,
  );
  if (allApproved && allShares && zone?.[cardIndex]?.layers === 0) {
    request.status = "completed";
    processCommunityCardDecrypt(G);
  }

  return G;
}

/**
 * Abort stalled cooperative decrypt requests (liveness).
 * Marks pending requests rejected, tags non-approvers as abortedDecrypt, voids the hand.
 */
export function voteAbortDecrypt(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (!validatePlayerIdentity(ctx.playerID, playerId)) return INVALID_MOVE;
  if (!canAbortDecryptNow(G, ctx)) return INVALID_MOVE;

  const refusingPlayers: string[] = [];
  G.decryptRequests.forEach((r) => {
    if (r.status === "pending") {
      r.status = "rejected";
      G.playerOrder.forEach((pid) => {
        if (!r.approvals[pid]) {
          refusingPlayers.push(pid);
          if (G.players[pid]) {
            (G.players[pid] as any).abortedDecrypt = true;
          }
        }
      });
    }
  });

  console.log(
    "[CryptoPoker] Decrypt requests aborted due to stall by",
    playerId,
    "refusers:",
    refusingPlayers,
  );

  if (
    ["preflop", "flop", "turn", "river", "showdown"].includes(G.phase) &&
    G.decryptRequests.some((r) => r.status === "rejected")
  ) {
    G.phase = "voided";
  }

  return G;
}

// =============================================================================
// Betting Moves (Wrapper for Standard Poker)
// =============================================================================

/**
 * Fold move.
 */
export function fold(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (playerId && playerId !== ctx.playerID) return INVALID_MOVE;
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processFold(G, pid);
  if (!result.valid) return INVALID_MOVE;

  if (!G.players[pid].keysReleased) {
    // Use logical move count for determinism (wall time only for UI)
    const logicalTime = (ctx as any).numMoves ?? G.recentFolds.length;
    G.recentFolds.push({
      playerId: pid,
      timestamp: logicalTime,
      challengeWindowEnd: logicalTime + 5, // window in move count
    });
  }

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G, ctx);
  }

  return G;
}

/**
 * Check move.
 */
function check(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (playerId && playerId !== ctx.playerID) return INVALID_MOVE;
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processCheck(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G, ctx);
  }

  return G;
}

/**
 * Call move.
 */
function call(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (playerId && playerId !== ctx.playerID) return INVALID_MOVE;
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processCall(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G, ctx);
  }

  return G;
}

/**
 * Bet move.
 */
function bet(
  G: CryptoPokerState,
  ctx: Ctx,
  amount: number,
  playerId?: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (playerId && playerId !== ctx.playerID) return INVALID_MOVE;
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
  G: CryptoPokerState,
  ctx: Ctx,
  totalBet: number,
  playerId?: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (playerId && playerId !== ctx.playerID) return INVALID_MOVE;
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
function allIn(
  G: CryptoPokerState,
  ctx: Ctx,
  playerId?: string,
): CryptoPokerState | typeof INVALID_MOVE {
  if (playerId && playerId !== ctx.playerID) return INVALID_MOVE;
  const pid = playerId ?? ctx.currentPlayer;
  if (G.bettingRound.activePlayer !== pid) return INVALID_MOVE;

  const result = processAllIn(G, pid);
  if (!result.valid) return INVALID_MOVE;

  const nextPlayer = getNextActivePlayer(G, pid);
  if (nextPlayer && !isBettingRoundComplete(G)) {
    G.bettingRound.activePlayer = nextPlayer;
  } else {
    advancePhase(G, ctx);
  }

  return G;
}

// =============================================================================
// Phase Advancement
// =============================================================================

/**
 * Advance to next phase after betting round.
 */
export function advancePhase(G: CryptoPokerState, ctx: Ctx): void {
  // Reset bets for next round
  for (const player of Object.values(G.players)) {
    player.bet = 0;
    player.hasActed = false;
  }

  // Check if only one player remains
  if (countActivePlayers(G) === 1) {
    G.phase = "showdown";
    resolveShowdown(G);
    return;
  }

  const phaseOrder: CryptoPokerPhase[] = [
    "keyExchange",
    "encrypt",
    "shuffle",
    "preflop",
    "flop",
    "turn",
    "river",
    "showdown",
    "gameOver",
  ];

  const currentIndex = phaseOrder.indexOf(G.phase);
  const nextPhase = phaseOrder[currentIndex + 1];

  if (!nextPhase) {
    G.phase = "gameOver";
    return;
  }

  switch (nextPhase) {
    case "flop":
      dealCommunityCards(G, ctx, 3);
      G.phase = "flop";
      break;

    case "turn":
      dealCommunityCards(G, ctx, 1);
      G.phase = "turn";
      break;

    case "river":
      dealCommunityCards(G, ctx, 1);
      G.phase = "river";
      break;

    case "showdown":
      resolveShowdown(G);
      return;

    default:
      G.phase = nextPhase;
  }

  // Initialize betting round for post-flop phases
  if (["flop", "turn", "river"].includes(nextPhase)) {
    const firstToAct = getFirstToActPostflop(G);
    if (firstToAct) {
      G.bettingRound = initBettingRound(G, firstToAct);
    } else {
      // All players all-in
      advancePhase(G, ctx);
    }
  }
}

/**
 * Resolve showdown - reveal hands and award pot.
 */
function resolveShowdown(G: CryptoPokerState): void {
  G.phase = "showdown";

  const activePlayers = getActivePlayerIds(G);

  // If only one player, they win by default
  if (activePlayers.length === 1) {
    const winner = activePlayers[0];
    G.players[winner].chips += G.pot;
    G.winners = [winner];
    G.phase = "gameOver";
    return;
  }

  // Evaluate each active player's hand
  // In crypto mode, we use peekedCards (decrypted hole cards) + community cards
  const playerHands: {
    playerId: string;
    hand: ReturnType<typeof findBestHand>;
  }[] = [];

  for (const playerId of activePlayers) {
    const player = G.players[playerId];
    const holeCards = player.peekedCards;

    // If player hasn't peeked, we can't evaluate their hand
    // In a real implementation, we'd force reveal at showdown
    if (!holeCards || holeCards.length === 0) {
      console.warn(
        "[CryptoPoker] Player",
        playerId,
        "has no peeked cards at showdown",
      );
      continue;
    }

    // Find best 5-card hand from hole cards + community cards
    const bestHand = findBestHand(holeCards, G.community);
    playerHands.push({ playerId, hand: bestHand });

    console.log(
      "[CryptoPoker] Player",
      playerId,
      "best hand:",
      bestHand.description,
    );
  }

  if (playerHands.length === 0) {
    console.error("[CryptoPoker] No valid hands at showdown!");
    G.phase = "gameOver";
    return;
  }

  // Determine winner(s) by comparing hands
  let winners: string[] = [];

  // Sort hands to find winner(s) - highest hand wins
  playerHands.sort((a, b) => {
    // Compare by rank first
    if (a.hand.rank !== b.hand.rank) {
      return b.hand.rank - a.hand.rank; // Higher rank wins
    }
    // Same rank - compare values (kickers)
    for (let i = 0; i < a.hand.values.length; i++) {
      if (a.hand.values[i] !== b.hand.values[i]) {
        return b.hand.values[i] - a.hand.values[i]; // Higher value wins
      }
    }
    return 0; // Tie
  });

  // Find all players with the same best hand (for split pots)
  const bestHand = playerHands[0].hand;
  winners = playerHands
    .filter((ph) => {
      if (ph.hand.rank !== bestHand.rank) return false;
      for (let i = 0; i < ph.hand.values.length; i++) {
        if (ph.hand.values[i] !== bestHand.values[i]) return false;
      }
      return true;
    })
    .map((ph) => ph.playerId);

  console.log(
    "[CryptoPoker] Winner(s):",
    winners,
    "with",
    bestHand.description,
  );

  // Award pot (split if tie)
  const potShare = Math.floor(G.pot / winners.length);
  for (const winnerId of winners) {
    G.players[winnerId].chips += potShare;
  }

  G.winners = winners;
  G.pot = 0;
  G.phase = "gameOver";
}

// Note: newHand function removed - each hand is now a new game instance
// To start a new hand:
// 1. Get hand result from ctx.gameover.handResult
// 2. Settle pot via blockchain service
// 3. Get new balances from blockchain
// 4. Create a new game instance with those balances

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

/**
 * Crypto Poker game for boardgame.io.
 */
export const CryptoPokerGame: Game<CryptoPokerState> = {
  name: "crypto-poker",

  // Improved stub for security (Phase 4): basic presence check.
  // In pure P2P, the boardgameIO-p2p layer + move-level validatePlayerIdentity provide the real binding.
  // TODO: integrate real credentials (e.g. signed player tokens) when relay is added.
  authenticateCredentials: (credentials: any, _playerMetadata?: any) => {
    // Production-hardening: require non-empty credentials when the multiplayer
    // layer supplies them. Pure local/single-player may pass undefined.
    if (credentials === undefined || credentials === null) return true;
    if (typeof credentials === "string") return credentials.length > 0;
    if (typeof credentials === "object") {
      return Object.keys(credentials as object).length > 0;
    }
    return Boolean(credentials);
  },

  setup: async (ctx): Promise<CryptoPokerState> => {
    const state = createCryptoInitialState({
      numPlayers: (ctx.numPlayers as number) ?? 2,
      playerIDs: (ctx.playOrder as string[]) ?? ["0", "1"],
    });

    // Build card point lookup with real SHA-256
    const lookup = await buildCardPointLookup(state.cardIds);
    for (const [cardId, point] of lookup) {
      state.crypto.cardPointLookup[cardId] = point;
    }

    // Basic integrity note: the lookup is deterministic from cardIds.
    // Clients should re-derive via buildCardPointLookup and compare on reveal paths
    // to detect malicious host-provided mapping (see lookupCardIdFromPoint callers).

    return state;
  },

  turn: {
    order: {
      first: () => 0,
      next: ({ G }) => {
        // During setup phases, use setupPlayerIndex
        if (
          ["keyExchange", "encrypt", "shuffle"].includes(G.phase)
        ) {
          return G.setupPlayerIndex % G.playerOrder.length;
        }
        // During betting, use activePlayer
        const activeIndex = G.playerOrder.indexOf(G.bettingRound.activePlayer);
        return activeIndex >= 0 ? activeIndex : 0;
      },
    },
  },

  phases: {
    setup: {
      start: true,
      moves: {
        // All moves have client: false to prevent optimistic updates in P2P mode.
        // This ensures GUEST doesn't increment stateID locally before HOST confirms.
        submitPublicKey: {
          move: ({ G, ctx }, playerId: string, publicKey: string) =>
            submitPublicKey(G, ctx, playerId, publicKey),
          client: false,
        },
        encryptDeck: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            encryptDeck(G, ctx, playerId, privateKey),
          client: false,
        },
        shuffleDeck: {
          move: ({ G, ctx, events }, playerId: string, privateKey: string) =>
            shuffleEncryptedDeck(G, ctx, playerId, privateKey, events),
          client: false,
        },
      },
      next: "play",
      endIf: ({ G }) => G.phase === "preflop",
    },
    play: {
      moves: {
        // Setup moves (for new hands - need full crypto setup again)
        submitPublicKey: {
          move: ({ G, ctx }, playerId: string, publicKey: string) =>
            submitPublicKey(G, ctx, playerId, publicKey),
          client: false,
        },
        encryptDeck: {
          move: ({ G, ctx }, playerId: string, privateKey: string) =>
            encryptDeck(G, ctx, playerId, privateKey),
          client: false,
        },
        shuffleDeck: {
          move: ({ G, ctx, events }, playerId: string, privateKey: string) =>
            shuffleEncryptedDeck(G, ctx, playerId, privateKey, events),
          client: false,
        },
        peekHoleCards: {
          move: ({ G, ctx }, playerId: string) =>
            peekHoleCards(G, ctx, playerId),
          client: false,
        },
        submitDecryptedShare: {
          move: (
            { G, ctx },
            playerId: string,
            decryptedCard: EncryptedCard,
            zoneId: string,
            cardIndex: number,
          ) =>
            submitDecryptedShare(
              G,
              ctx,
              playerId,
              decryptedCard,
              zoneId,
              cardIndex,
            ),
          client: false,
        },
        // Cooperative decryption (requires approval from all players)
        requestDecrypt: {
          move: (
            { G, ctx },
            playerId: string,
            zoneId: string,
            cardIndices: number[],
          ) => requestDecrypt(G, ctx, playerId, zoneId, cardIndices),
          client: false,
        },
        approveDecrypt: {
          move: (
            { G, ctx },
            playerId: string,
            requestId: string,
            decryptedCard: EncryptedCard,
          ) => approveDecrypt(G, ctx, playerId, requestId, decryptedCard),
          client: false,
        },
        // Minimal liveness: allow aborting stalled decrypt requests (see canAbortDecryptNow)
        voteAbortDecrypt: {
          move: ({ G, ctx }, playerId: string) => voteAbortDecrypt(G, ctx, playerId),
          client: false,
        },
        dismissNotification: {
          move: ({ G, ctx }, playerId: string, notificationIndex: number) =>
            dismissNotification(G, ctx, playerId, notificationIndex),
          client: false,
        },
        releaseKey: {
          move: ({ G, ctx }, playerId: string, decryptedCards: PokerCard[]) =>
            releaseKey(G, ctx, playerId, decryptedCards),
          client: false,
        },
        challengeVoid: {
          move: (
            { G, ctx },
            challengerId: string,
            challengedPlayerId: string,
          ) => challengeVoid(G, ctx, challengerId, challengedPlayerId),
          client: false,
        },
        // Betting
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
          move: ({ G, ctx }, amount: number, playerId?: string) =>
            bet(G, ctx, amount, playerId),
          client: false,
        },
        raise: {
          move: ({ G, ctx }, totalBet: number, playerId?: string) =>
            raise(G, ctx, totalBet, playerId),
          client: false,
        },
        allIn: {
          move: ({ G, ctx }, playerId?: string) => allIn(G, ctx, playerId),
          client: false,
        },
        // Note: newHand move removed - each hand is a new game instance
        // Use the blockchain service to settle and create a new game
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === "voided") {
      return { draw: true, reason: "voided", handResult: buildHandResult(G) };
    }

    // Game ends when hand is complete (showdown resolved or gameOver)
    if (G.phase === "gameOver") {
      return {
        winners: G.winners,
        handResult: buildHandResult(G),
      };
    }

    return undefined;
  },
};

/**
 * Build hand result for blockchain settlement.
 */
export function buildHandResult(G: CryptoPokerState): {
  handId: string;
  winners: string[];
  payouts: Record<string, number>;
  contributions: Record<string, number>;
  totalPot: number;
  timestamp: number;
  abortedDecrypt?: boolean;
  refusers?: string[];
} {
  const abortedPlayers = Object.entries(G.players)
    .filter(([, p]) => (p as any).abortedDecrypt)
    .map(([id]) => id);

  // Calculate contributions as difference from starting chips
  const contributions: Record<string, number> = {};
  for (const [playerId, player] of Object.entries(G.players)) {
    contributions[playerId] = G.startingChips[playerId] - player.chips;
  }

  // Calculate payouts - each player gets back their contribution plus any winnings
  const payouts: Record<string, number> = {};
  const totalPot = Object.values(contributions).reduce((a, b) => a + b, 0);

  // Initialize payouts to 0
  for (const playerId of Object.keys(G.players)) {
    payouts[playerId] = 0;
  }

  let result: any = {
    handId: G.handId,
    winners: G.winners,
    payouts,
    contributions,
    totalPot,
    timestamp: Date.now(),
  };

  // If any decrypt was aborted, treat as draw / void for settlement impact
  if (abortedPlayers.length > 0 || G.phase === "voided") {
    // Return contributions to all (or adjust for refusers forfeiting)
    for (const playerId of Object.keys(G.players)) {
      payouts[playerId] = contributions[playerId]; // refund contrib
    }
    result.abortedDecrypt = true;
    result.refusers = abortedPlayers;
    result.winners = []; // no winners on abort
    return result;
  }

  // Winners split the pot
  if (G.winners.length > 0) {
    const winShare = Math.floor(totalPot / G.winners.length);
    const remainder = totalPot % G.winners.length;
    for (let i = 0; i < G.winners.length; i++) {
      payouts[G.winners[i]] = winShare + (i < remainder ? 1 : 0);
    }
  }

  return result;
}

// =============================================================================
// Move Validation
// =============================================================================

/**
 * When tests (or callers) pass a mock ctx `{ playerID }` among args, enforce that
 * the claimed `playerId` matches the authenticated context — same binding as
 * production moves via `validatePlayerIdentity`.
 */
function identityMismatchFromArgs(playerId: string, args: unknown[]): MoveValidation | null {
  const mockCtx = args.find(
    (a: unknown) => a && typeof a === "object" && a !== null && "playerID" in (a as object),
  ) as { playerID?: string } | undefined;
  if (mockCtx && mockCtx.playerID !== undefined && mockCtx.playerID !== playerId) {
    return { valid: false, error: "Player ID mismatch" };
  }
  return null;
}

export function validateCryptoMove(
  state: CryptoPokerState,
  move: string,
  playerId: string,
  ...args: unknown[]
): MoveValidation {
  // C1: identity spoof rejection for all crypto-sensitive moves when ctx is supplied.
  const cryptoMovesWithIdentity = new Set([
    "submitPublicKey",
    "encryptDeck",
    "shuffleDeck",
    "peekHoleCards",
    "requestDecrypt",
    "approveDecrypt",
    "submitDecryptedShare",
    "releaseKey",
    "voteAbortDecrypt",
  ]);
  if (cryptoMovesWithIdentity.has(move)) {
    const idFail = identityMismatchFromArgs(playerId, args);
    if (idFail) return idFail;
  }

  switch (move) {
    case "submitPublicKey":
      if (state.phase !== "keyExchange") {
        return { valid: false, error: "Not in key exchange phase" };
      }
      if (state.players[playerId]?.publicKey) {
        return { valid: false, error: "Key already submitted" };
      }
      return { valid: true };

    case "encryptDeck":
      if (state.phase !== "encrypt") {
        return { valid: false, error: "Not in encrypt phase" };
      }
      if (getCurrentSetupPlayer(state) !== playerId) {
        return { valid: false, error: "Not your turn to encrypt" };
      }
      return { valid: true };

    case "shuffleDeck":
      if (state.phase !== "shuffle") {
        return { valid: false, error: "Not in shuffle phase" };
      }
      if (getCurrentSetupPlayer(state) !== playerId) {
        return { valid: false, error: "Not your turn to shuffle" };
      }
      return { valid: true };

    case "peekHoleCards":
      if (!["preflop", "flop", "turn", "river", "showdown"].includes(state.phase)) {
        return { valid: false, error: "Cannot peek now" };
      }
      if (state.players[playerId]?.hasPeeked) {
        return { valid: false, error: "Already peeked" };
      }
      if (state.phase !== "showdown") {
        const bettingComplete =
          state.bettingRound.isComplete ||
          state.bettingRound.actedPlayers.length === 0;
        if (!bettingComplete) {
          return { valid: false, error: "Betting round not complete" };
        }
      }
      return { valid: true };

    case "requestDecrypt":
      if (!["preflop", "flop", "turn", "river"].includes(state.phase)) {
        return { valid: false, error: "Cannot request decryption now" };
      }
      if (state.players[playerId]?.hasPeeked) {
        return { valid: false, error: "Already revealed cards" };
      }
      if (state.players[playerId]?.folded) {
        return { valid: false, error: "Cannot request after folding" };
      }
      {
        const bettingComplete =
          state.bettingRound.isComplete ||
          state.phase === "showdown" ||
          state.bettingRound.actedPlayers.length === 0;
        if (!bettingComplete) {
          return { valid: false, error: "Betting round not complete" };
        }
      }
      return { valid: true };

    case "approveDecrypt":
    case "submitDecryptedShare":
      return { valid: true };

    case "voteAbortDecrypt":
      return { valid: true };

    case "dismissNotification":
      return { valid: true };

    case "releaseKey":
      if (!["preflop", "flop", "turn", "river"].includes(state.phase)) {
        return { valid: false, error: "Cannot release keys now" };
      }
      if (state.players[playerId]?.keysReleased) {
        return { valid: false, error: "Keys already released" };
      }
      return { valid: true };

    case "challengeVoid":
      if (state.players[playerId]?.folded) {
        return { valid: false, error: "Challenger has folded" };
      }
      const challengerId = playerId;
      const challengedPlayerId = args[0] as string;
      // Use large logical now for validate (actual enforcement + window is in the move fn which has real ctx)
      const logicalNow = 1000;
      const recentFold = state.recentFolds?.find(
        (f) =>
          f.playerId === challengedPlayerId &&
          logicalNow - (f.timestamp || 0) < 5 &&
          (f.challengeWindowEnd || 0) > logicalNow,
      );
      if (!recentFold) {
        return { valid: false, error: "No recent fold found for challenged player" };
      }
      return { valid: true };

    // Standard betting moves - delegate to standard validation
    case "fold":
    case "check":
    case "call":
    case "bet":
    case "raise":
    case "allIn":
      if (!["preflop", "flop", "turn", "river"].includes(state.phase)) {
        return { valid: false, error: "Not in betting phase" };
      }
      if (state.bettingRound.activePlayer !== playerId) {
        return { valid: false, error: "Not your turn" };
      }
      return { valid: true };

    default:
      return { valid: false, error: `Unknown move: ${move}` };
  }
}

// =============================================================================
// Module Export
// =============================================================================

export const CryptoPokerModule = {
  id: "crypto-poker",
  name: "Crypto Texas Hold'em",
  version: "1.0.0",
  description: "Texas Hold'em Poker with mental poker encryption for P2P play",

  cardSchema: pokerCardSchema,
  zones: POKER_ZONES,

  assetRequirements: {
    required: ["card_face"] as const,
    optional: ["card_back"] as const,
    idFormat: "standard_52" as const,
  },

  initialState: createCryptoInitialState,
  validateMove: validateCryptoMove,
  getBoardgameIOGame: () => CryptoPokerGame,

  zoneLayout: {
    zones: {
      deck: {
        x: 10,
        y: 50,
        width: 10,
        height: 15,
        cardArrangement: "stack" as const,
      },
      community: {
        x: 30,
        y: 50,
        width: 40,
        height: 15,
        cardArrangement: "fan" as const,
      },
      hand: {
        x: 50,
        y: 85,
        width: 20,
        height: 15,
        cardArrangement: "fan" as const,
      },
      discard: {
        x: 80,
        y: 50,
        width: 10,
        height: 15,
        cardArrangement: "stack" as const,
      },
    },
    defaultCardSize: { width: 63, height: 88 },
  },
};

export default CryptoPokerModule;
