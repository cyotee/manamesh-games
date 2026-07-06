/**
 * Crypto One Piece TCG Game Module
 *
 * Mental poker implementation of One Piece TCG for P2P play.
 * Uses SRA commutative encryption for cryptographic fairness.
 * Includes abandonment support with key release and threshold escrow.
 *
 * Two encrypted decks per player: mainDeck and lifeDeck.
 * Cooperative decryption for life damage and face-up effects.
 */

import type { Game, Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";
import type { GameConfig } from "@manamesh/frontend/src/game/modules/types";
import type {
  OnePieceCard,
  OnePieceDonCard,
  OnePieceCryptoState,
  OnePieceCryptoPlayerState,
  DecryptRequest,
  ShuffleRngState,
} from "./types";
import {
  encrypt,
  decrypt,
  encryptDeck as encryptDeckCrypto,
  reencryptDeck,
  buildCardPointLookup,
  type EncryptedCard,
} from "@manamesh/boardgameio-crypto/mental-poker";
import { sha256Hex, stableStringify } from "@manamesh/boardgameio-crypto";
import {
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
  lookupCardIdFromPoint,
  deterministicShuffle,
} from "@manamesh/boardgameio-crypto";

// =============================================================================
// Constants
// =============================================================================

const MAIN_DECK_ZONE = "mainDeck";

// =============================================================================
// Helper Functions
// =============================================================================

function isHex(s: string): boolean {
  return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s);
}

// deterministicShuffle imported from shared embedded package

/**
 * Ensure shuffle RNG state exists.
 */
function ensureShuffleRng(G: OnePieceCryptoState): ShuffleRngState {
  const existing = (G as any).shuffleRng as ShuffleRngState | undefined;
  if (existing) return existing;

  const commits: Record<string, string | null> = {};
  const reveals: Record<string, string | null> = {};
  for (const pid of G.playerOrder ?? []) {
    commits[pid] = null;
    reveals[pid] = null;
  }

  const created: ShuffleRngState = {
    phase: "commit",
    commits,
    reveals,
    finalSeedHex: null,
    abortVotes: {},
  };
  (G as any).shuffleRng = created;
  return created;
}

/**
 * Maybe finalize the shuffle seed once all players have revealed.
 */
function maybeFinalizeShuffleSeed(G: OnePieceCryptoState): void {
  const rng = ensureShuffleRng(G);
  if (rng.finalSeedHex) return;

  const allRevealed = (G.playerOrder ?? []).every((pid) => {
    const seed = rng.reveals[pid];
    return typeof seed === "string" && seed.length > 0;
  });
  if (!allRevealed) return;

  const seeds = (G.playerOrder ?? []).map((pid) => rng.reveals[pid]);
  const bytes = new TextEncoder().encode(stableStringify({ seeds }));
  rng.finalSeedHex = sha256Hex(bytes);
  rng.phase = "ready";
}

// Re-export setup helpers from shared embedded package.
export {
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
} from "@manamesh/boardgameio-crypto";

// =============================================================================
// Initial State
// =============================================================================

/**
 * Create initial crypto state for One Piece TCG.
 */
export function createCryptoInitialState(
  config: GameConfig,
  moduleConfig?: {
    startingLife?: number;
    startingDon?: number;
    startingHand?: number;
  },
): OnePieceCryptoState {
  const playerOrder = [...config.playerIDs];

  const players: Record<string, OnePieceCryptoPlayerState> = {};

  for (const playerId of playerOrder) {
    players[playerId] = {
      // Plaintext zones
      hand: [],
      lifeDeck: [],
      donDeck: [],
      donArea: [],
      trash: [],
      playArea: [],
      activeDon: 0,
      totalDon: moduleConfig?.startingDon ?? 10,
      leaderCardId: null,
      // Crypto-specific
      publicKey: null,
      hasEncrypted: false,
      hasShuffled: false,
      isConnected: true,
      lastHeartbeat: Date.now(),
    };
  }

  // Initialize encrypted zones
  const encryptedZones: Record<string, EncryptedCard[]> = {};
  encryptedZones[MAIN_DECK_ZONE] = [];

  // Add life deck zones for each player
  for (const playerId of playerOrder) {
    encryptedZones[`lifeDeck:${playerId}`] = [];
    encryptedZones[`hand:${playerId}`] = [];
  }

  const cryptoState = {
    phase: "init" as const,
    publicKeys: {} as Record<string, string>,
    commitments: {} as Record<string, string>,
    shuffleProofs: {} as Record<string, string>,
    encryptedZones,
    cardPointLookup: {} as Record<string, string>,
    revealedCards: {} as Record<string, string>,
    pendingReveals: {} as Record<string, Record<string, string>>,
  };

  const deckCardIds: Record<string, string[]> = {};
  const lifeDeckIds: Record<string, string[]> = {};
  for (const playerId of playerOrder) {
    deckCardIds[playerId] = [];
    lifeDeckIds[playerId] = [];
  }

  const state: OnePieceCryptoState = {
    players,
    config: {
      startingLife: moduleConfig?.startingLife ?? 5,
      startingDon: moduleConfig?.startingDon ?? 10,
      startingHand: moduleConfig?.startingHand ?? 5,
      maxCharacterSlots: 5,
      allowStageCard: true,
      deckEncryption: "mental-poker",
      proofChainEnabled: true,
    },
    phase: "keyExchange",
    winner: null,
    turnCount: 0,
    cardVisibility: {},
    activePeeks: [],
    proofChain: [],
    zones: {
      mainDeck: {},
      lifeDeck: {},
      donDeck: {},
      trash: {},
      hand: {},
      playArea: {},
      donArea: {},
    },
    deckLoaded: {},
    leaderLife: {},
    // Crypto-specific
    encryptedZones,
    crypto: cryptoState,
    shuffleRng: null,
    pendingDecryptRequests: [],
    setupPlayerIndex: 0,
    playerOrder,
    deckCardIds,
    lifeDeckIds,
  };

  // Initialize deckLoaded and leaderLife for each player
  for (const playerId of playerOrder) {
    state.deckLoaded[playerId] = false;
    state.leaderLife[playerId] = moduleConfig?.startingLife ?? 5;
  }

  return state;
}

// =============================================================================
// Setup Phase Moves
// =============================================================================

/**
 * Submit public key during key exchange phase.
 */
export function submitPublicKey(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  publicKey: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  console.log(
    "[OnePieceCrypto] submitPublicKey called for player",
    playerId,
    "phase:",
    G.phase,
    "existing key:",
    G.players[playerId]?.publicKey,
  );
  if (G.phase !== "keyExchange") {
    console.log(
      "[OnePieceCrypto] submitPublicKey INVALID_MOVE: not in keyExchange phase",
    );
    return INVALID_MOVE;
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.publicKey) return INVALID_MOVE; // Already submitted

  player.publicKey = publicKey;
  G.crypto.publicKeys[playerId] = publicKey;

  // Check if all players have submitted
  const allSubmitted = G.playerOrder.every(
    (pid) => G.players[pid].publicKey !== null,
  );
  if (allSubmitted) {
    G.phase = "encrypt";
    resetSetupPlayer(G);
    console.log(
      "[OnePieceCrypto] All public keys submitted. Moving to encrypt.",
    );
  }

  return G;
}

/**
 * Encrypt deck during encrypt phase.
 * Both main deck and life deck are encrypted.
 */
export function encryptDeck(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "encrypt") return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasEncrypted) return INVALID_MOVE;

  // Encrypt main deck
  const existingMainDeck = G.encryptedZones[MAIN_DECK_ZONE];

  if (!existingMainDeck || existingMainDeck.length === 0) {
    // First player: encrypt all main deck card IDs
    const mainDeckCardIds = G.deckCardIds[playerId] ?? [];
    console.log(
      "[OnePieceCrypto] First encryption by player",
      playerId,
      "- encrypting",
      mainDeckCardIds.length,
      "main deck cards",
    );

    if (mainDeckCardIds.length > 0) {
      const encryptedMainDeck = encryptDeckCrypto(mainDeckCardIds, privateKey);
      G.encryptedZones[MAIN_DECK_ZONE] = encryptedMainDeck;
      console.log(
        "[OnePieceCrypto] Encrypted main deck has",
        encryptedMainDeck.length,
        "cards with",
        encryptedMainDeck[0]?.layers,
        "layers",
      );
    }
  } else {
    // Subsequent players: re-encrypt the already encrypted deck
    console.log(
      "[OnePieceCrypto] Re-encryption by player",
      playerId,
      "- current layers:",
      existingMainDeck[0]?.layers,
    );
    const reencryptedDeck = reencryptDeck(existingMainDeck, privateKey);
    G.encryptedZones[MAIN_DECK_ZONE] = reencryptedDeck;
    console.log(
      "[OnePieceCrypto] Re-encrypted main deck has",
      reencryptedDeck.length,
      "cards with",
      reencryptedDeck[0]?.layers,
      "layers",
    );
  }

  // Encrypt life deck for this player
  const lifeDeckZone = `lifeDeck:${playerId}`;
  const existingLifeDeck = G.encryptedZones[lifeDeckZone];
  const lifeDeckIds = G.lifeDeckIds[playerId] ?? [];

  if (!existingLifeDeck || existingLifeDeck.length === 0) {
    if (lifeDeckIds.length > 0) {
      const encryptedLifeDeck = encryptDeckCrypto(lifeDeckIds, privateKey);
      G.encryptedZones[lifeDeckZone] = encryptedLifeDeck;
      console.log(
        "[OnePieceCrypto] Player",
        playerId,
        "encrypted life deck with",
        encryptedLifeDeck.length,
        "cards",
      );
    }
  } else {
    const reencryptedLifeDeck = reencryptDeck(existingLifeDeck, privateKey);
    G.encryptedZones[lifeDeckZone] = reencryptedLifeDeck;
    console.log("[OnePieceCrypto] Player", playerId, "re-encrypted life deck");
  }

  // Update crypto phase
  G.crypto.phase = "encrypt";
  player.hasEncrypted = true;

  // Advance to next player or next phase
  if (advanceSetupPlayer(G)) {
    G.phase = "shuffle";
    resetSetupPlayer(G);
    console.log("[OnePieceCrypto] Deck encryption complete. Starting shuffle.");
  }

  return G;
}

/**
 * Commit shuffle seed hash during shuffle phase.
 */
export function commitShuffleSeed(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  commitHashHex: string,
  callerId?: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);

  // Validate 64-char hex (SHA256)
  if (!isHex(commitHashHex) || commitHashHex.length !== 64) return INVALID_MOVE;

  const existing = rng.commits[playerId] ?? null;
  if (existing && existing !== commitHashHex) return INVALID_MOVE;
  rng.commits[playerId] = commitHashHex;

  console.log("[OnePieceCrypto] Player", playerId, "committed shuffle seed.");

  const allCommitted = (G.playerOrder ?? []).every((pid) => {
    const c = rng.commits[pid];
    return typeof c === "string" && c.length === 64;
  });
  if (allCommitted) {
    rng.phase = "reveal";
    console.log(
      "[OnePieceCrypto] All players committed. Reveal phase started.",
    );
  }

  return G;
}

/**
 * Reveal shuffle seed during shuffle phase.
 */
export function revealShuffleSeed(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  seedHex: string,
  callerId?: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);

  if (rng.phase !== "reveal" && rng.phase !== "ready") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;

  // Validate seed hex (minimum length to prevent trivial brute force)
  if (!isHex(seedHex) || seedHex.length < 16) return INVALID_MOVE;

  const commit = rng.commits[playerId];
  if (!commit) return INVALID_MOVE;

  // Verify SHA256(seedHex) matches committed hash
  const bytes = new TextEncoder().encode(seedHex.toLowerCase());
  const computed = sha256Hex(bytes);
  if (computed !== commit.toLowerCase()) {
    console.log(
      "[OnePieceCrypto] Reveal verification failed for player",
      playerId,
    );
    return INVALID_MOVE;
  }

  const existing = rng.reveals[playerId] ?? null;
  if (existing && existing.toLowerCase() !== seedHex.toLowerCase())
    return INVALID_MOVE;
  rng.reveals[playerId] = seedHex.toLowerCase();

  console.log("[OnePieceCrypto] Player", playerId, "revealed shuffle seed.");

  maybeFinalizeShuffleSeed(G);
  return G;
}

/**
 * Shuffle the encrypted deck during shuffle phase.
 * Uses deterministic shuffle seeded by the combined reveal seed.
 */
export function shuffleEncryptedDeck(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  events?: { endPhase?: () => void },
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasShuffled) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);
  if (!rng.finalSeedHex) {
    console.log("[OnePieceCrypto] Cannot shuffle: final seed not ready");
    return INVALID_MOVE;
  }

  // Get the encrypted main deck
  const encryptedDeck = G.encryptedZones[MAIN_DECK_ZONE];
  if (!encryptedDeck || encryptedDeck.length === 0) {
    console.error("[OnePieceCrypto] No encrypted deck to shuffle!");
    return INVALID_MOVE;
  }

  // Deterministic shuffle using seed per player
  const playerSeed = sha256Hex(
    new TextEncoder().encode(`${rng.finalSeedHex}:${playerId}`),
  );
  const shuffledDeck = deterministicShuffle(encryptedDeck, playerSeed);
  G.encryptedZones[MAIN_DECK_ZONE] = shuffledDeck;

  // Also shuffle each player's life deck deterministically
  for (const pid of G.playerOrder) {
    const lifeZone = `lifeDeck:${pid}`;
    const lifeDeck = G.encryptedZones[lifeZone];
    if (lifeDeck && lifeDeck.length > 0) {
      const lifeSeed = sha256Hex(
        new TextEncoder().encode(`${rng.finalSeedHex}:${pid}:life`),
      );
      G.encryptedZones[lifeZone] = deterministicShuffle(lifeDeck, lifeSeed);
    }
  }

  console.log("[OnePieceCrypto] Player", playerId, "shuffled the decks.");

  player.hasShuffled = true;
  G.crypto.phase = "shuffle";

  // Advance to next player or start game
  if (advanceSetupPlayer(G)) {
    G.crypto.phase = "ready";

    // Deal starting hands
    dealStartingHands(G);

    G.phase = "play";
    console.log("[OnePieceCrypto] Shuffle complete. Starting play phase.");

    const isInSetupPhase = ctx.phase === "setup";
    if (isInSetupPhase && events?.endPhase) {
      events.endPhase();
    }
  }

  return G;
}

/**
 * Deal starting hands to all players.
 * Deals 1 card at a time in rotation from the main deck.
 */
export function dealStartingHands(G: OnePieceCryptoState): void {
  const deck = G.encryptedZones[MAIN_DECK_ZONE];
  if (!deck || deck.length === 0) {
    console.error("[OnePieceCrypto] No deck to deal from!");
    return;
  }

  const handSize = G.config.startingHand;

  console.log(
    "[OnePieceCrypto] Dealing",
    handSize,
    "cards to each of",
    G.playerOrder.length,
    "players",
  );

  // Initialize hand zones
  for (const playerId of G.playerOrder) {
    G.encryptedZones[`hand:${playerId}`] = [];
  }

  // Deal cards in rotation
  for (let round = 0; round < handSize; round++) {
    for (const playerId of G.playerOrder) {
      const card = deck.shift();
      if (!card) {
        console.warn("[OnePieceCrypto] Deck ran out during deal!");
        return;
      }
      G.encryptedZones[`hand:${playerId}`].push(card);
    }
  }

  console.log(
    "[OnePieceCrypto] Starting hands dealt. Deck remaining:",
    deck.length,
  );
}

// =============================================================================
// Cooperative Decryption Moves
// =============================================================================

/**
 * Submit decryption share for a pending decrypt request.
 * Used for both life damage (move card to hand) and face-up (keep in life zone).
 */
export function submitDecryptionShare(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
  requestId: string,
  decryptionShare: EncryptedCard,
): OnePieceCryptoState | typeof INVALID_MOVE {
  const request = G.pendingDecryptRequests.find((r) => r.id === requestId);
  if (!request) {
    console.error("[OnePieceCrypto] Decrypt request not found:", requestId);
    return INVALID_MOVE;
  }

  // Record stall window entry on first share submission for this request
  if (request.currentLayer === 0 && G.revealStallEnteredAt === undefined) {
    G.revealStallEnteredAt = Number((ctx as any).numMoves ?? 0);
  }

  if (request.status === "complete") {
    console.error("[OnePieceCrypto] Request already complete:", requestId);
    return INVALID_MOVE;
  }

  // Validate this player is expected to provide a layer
  const expectedPlayerId = request.requiredLayers[request.currentLayer];
  if (expectedPlayerId !== playerId) {
    console.log(
      "[OnePieceCrypto] Player",
      playerId,
      "cannot submit share yet. Expected:",
      expectedPlayerId,
    );
    return INVALID_MOVE;
  }

  // Apply the decryption layer to the card
  const zone = G.encryptedZones[request.zoneId];
  if (!zone) return INVALID_MOVE;

  const cardIndex = request.cardIndex;
  if (cardIndex < 0 || cardIndex >= zone.length) return INVALID_MOVE;

  // Replace the card with the partially decrypted version
  zone[cardIndex] = decryptionShare;

  // Advance to next layer
  request.currentLayer++;

  console.log(
    "[OnePieceCrypto] Player",
    playerId,
    "submitted decryption share. Current layer:",
    request.currentLayer,
    "/",
    request.requiredLayers.length,
  );

  // Check if all layers have been removed
  if (request.currentLayer >= request.requiredLayers.length) {
    request.status = "complete";
    console.log("[OnePieceCrypto] Decryption complete for request:", requestId);

    // Execute the reveal based on purpose
    if (request.purpose === "damage") {
      // Move the card from life zone to owner's hand
      const [revealedCard] = zone.splice(cardIndex, 1);
      if (revealedCard) {
        // Look up the card ID from the ciphertext
        const cardId = lookupCardIdFromPoint(
          G.crypto.cardPointLookup,
          revealedCard.ciphertext,
        );
        if (cardId) {
          // Add plaintext card to owner's hand
          // In a real implementation, we would decrypt fully here
          // For now, the card stays encrypted until fully decrypted
          console.log(
            "[OnePieceCrypto] Life damage: card revealed (full decryption would happen here)",
            cardId,
          );
        }
      }
    } else if (request.purpose === "face-up") {
      // Mark the card as face-up in the life zone
      // This would update cardVisibility state
      console.log(
        "[OnePieceCrypto] Card revealed face-up in life zone at index:",
        cardIndex,
      );
    }
  } else {
    request.status = "partial";
  }

  return G;
}

/**
 * Release key after game end (no-op — abandonment voids hand, no key recovery).
 */
export function releaseKey(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  console.log("[OnePieceCrypto] Player", playerId, "key release (no-op).");

  return G;
}

// =============================================================================
// Reveal Stall Timeout
// =============================================================================

/** Moves either player may make before a stalled cooperative reveal can be voided. */
export const ONEPIECE_REVEAL_STALL_WINDOW_MOVES = 8;

/**
 * Vote to void a stalled cooperative card reveal.
 * Either player may call this once ONEPIECE_REVEAL_STALL_WINDOW_MOVES moves have
 * elapsed since the last DecryptRequest was created without completion.
 */
export function voteAbortReveal(
  G: OnePieceCryptoState,
  ctx: Ctx,
  playerId: string,
): OnePieceCryptoState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (playerId !== ctx.playerID) {
    return INVALID_MOVE;
  }

  const hasPendingRequest = G.pendingDecryptRequests.some(
    (r) => r.status !== "complete",
  );
  if (!hasPendingRequest) return INVALID_MOVE;

  if (G.revealStallEnteredAt === undefined) return INVALID_MOVE;
  const now = Number((ctx as any).numMoves ?? 0);
  if (now - G.revealStallEnteredAt < ONEPIECE_REVEAL_STALL_WINDOW_MOVES) {
    return INVALID_MOVE;
  }

  G.phase = "voided";
  return G;
}

// =============================================================================
// boardgame.io Game Definition
// =============================================================================

/**
 * Crypto One Piece TCG game for boardgame.io.
 * Only defines the crypto setup phases. The play phase is defined in game.ts.
 */
export const OnePieceCryptoGame: Game<OnePieceCryptoState> = {
  name: "onepiece-crypto",

  // Stub: wire to a real session-token validator when a relay server is deployed.
  // In pure P2P mode, ctx.playerID is enforced by the libp2p transport instead.
  authenticateCredentials: () => true,

  setup: async (ctx): Promise<OnePieceCryptoState> => {
    const numPlayers = (ctx.numPlayers as number) ?? 2;
    const playerIDs =
      (ctx.playOrder as string[]) ??
      Array.from({ length: numPlayers }, (_, i) => String(i));

    const state = createCryptoInitialState({ numPlayers, playerIDs });

    // Build card point lookup for all card IDs that might be used
    // Note: In a full implementation, card IDs would be populated during loadDeck
    const allCardIds: string[] = [];
    for (const pid of playerIDs) {
      allCardIds.push(...(state.deckCardIds[pid] ?? []));
      allCardIds.push(...(state.lifeDeckIds[pid] ?? []));
    }

    if (allCardIds.length > 0) {
      const lookup = await buildCardPointLookup(allCardIds);
      for (const [cardId, point] of lookup) {
        state.crypto.cardPointLookup[cardId] = point;
      }
    }

    return state;
  },

  turn: {
    order: {
      first: () => 0,
      next: ({ G }) => {
        if (
          ["keyExchange", "encrypt", "shuffle"].includes(G.phase)
        ) {
          return G.setupPlayerIndex % G.playerOrder.length;
        }
        return 0;
      },
    },
  },

  phases: {
    setup: {
      start: true,
      moves: {
        // All moves have client: false to prevent optimistic updates in P2P mode.
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
        commitShuffleSeed: {
          move: (
            { G, ctx, playerID },
            playerId: string,
            commitHashHex: string,
          ) => commitShuffleSeed(G, ctx, playerId, commitHashHex, playerID),
          client: false,
        },
        revealShuffleSeed: {
          move: ({ G, ctx, playerID }, playerId: string, seedHex: string) =>
            revealShuffleSeed(G, ctx, playerId, seedHex, playerID),
          client: false,
        },
        shuffleEncryptedDeck: {
          move: ({ G, ctx, events }, playerId: string) =>
            shuffleEncryptedDeck(G, ctx, playerId, events),
          client: false,
        },
      },
      next: "play",
      endIf: ({ G }) => G.phase === "play",
    },

    play: {
      turn: {
        activePlayers: { all: "play" },
      },
      moves: {
        // Setup moves (resume / debug)
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
        commitShuffleSeed: {
          move: (
            { G, ctx, playerID },
            playerId: string,
            commitHashHex: string,
          ) => commitShuffleSeed(G, ctx, playerId, commitHashHex, playerID),
          client: false,
        },
        revealShuffleSeed: {
          move: ({ G, ctx, playerID }, playerId: string, seedHex: string) =>
            revealShuffleSeed(G, ctx, playerId, seedHex, playerID),
          client: false,
        },
        shuffleEncryptedDeck: {
          move: ({ G, ctx, events }, playerId: string) =>
            shuffleEncryptedDeck(G, ctx, playerId, events),
          client: false,
        },
        // Cooperative decryption
        submitDecryptionShare: {
          move: (
            { G, ctx },
            playerId: string,
            requestId: string,
            decryptionShare: EncryptedCard,
          ) =>
            submitDecryptionShare(G, ctx, playerId, requestId, decryptionShare),
          client: false,
        },
        // Key release
        releaseKey: {
          move: ({ G, ctx }, playerId: string) => releaseKey(G, ctx, playerId),
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === "voided") {
      return { draw: true, reason: "voided" };
    }
    if (G.phase === "gameOver" && G.winner) {
      return { winner: G.winner };
    }
    return undefined;
  },
};
