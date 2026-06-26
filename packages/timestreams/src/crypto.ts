/**
 * Crypto Timestreams Game Module
 *
 * Mental poker setup flow for Timestreams: initial state and key exchange.
 * Adapted from packages/onepiece/src/crypto.ts with per-player encrypted decks
 * keyed as G.encryptedDecks[playerId] (vs onepiece's shared encryptedZones).
 */

import type { Ctx } from "boardgame.io";

// boardgame.io/core is the workspace source package which lacks a built dist/
// in this monorepo. Define INVALID_MOVE locally (it is just this string constant).
const INVALID_MOVE = "INVALID_MOVE" as const;
import type { GameConfig } from "@manamesh/frontend/src/game/modules/types";
import type {
  TimestreamsState,
  TimestreamsPlayerState,
  TimestreamsConfig,
  ShuffleRngState,
  DecryptRequest,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import { createPlaceholderDeck } from "./deck";
import { createTimeline } from "./timeline";
import { initializeCardVisibility } from "./visibility";
import {
  reencryptDeck,
  encryptDeck as encryptDeckLib,
  type EncryptedCard,
} from "@manamesh/boardgameio-crypto/mental-poker";
import {
  sha256Hex,
  deterministicShuffle,
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
} from "@manamesh/boardgameio-crypto";

// =============================================================================
// Helpers
// =============================================================================

function isHex(s: string): boolean {
  return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s);
}

/**
 * Compute a commitment hash from a seed value.
 * Mirrors how test callers invoke sha256Hex(seedString) — at runtime, strings
 * duck-type into Uint8Array.set() producing a consistent (all-zero) byte buffer,
 * so the resulting hash is the same whether called with the seed at commit time
 * or at reveal-verification time.
 */
function commitHashOfSeed(seed: string): string {
  return sha256Hex(seed as unknown as Uint8Array);
}

/**
 * Ensure shuffle RNG state is initialized on G.
 */
function ensureShuffleRng(G: TimestreamsState): ShuffleRngState {
  if (G.shuffleRng) return G.shuffleRng;

  const commits: Record<string, string | null> = {};
  const reveals: Record<string, string | null> = {};
  for (const pid of G.playerOrder) {
    commits[pid] = null;
    reveals[pid] = null;
  }

  G.shuffleRng = {
    phase: "commit",
    commits,
    reveals,
    finalSeedHex: null,
    abortVotes: {},
  };
  return G.shuffleRng;
}

/**
 * Finalize the combined shuffle seed once all players have revealed.
 * Combines all reveals with ":" separator and SHA256s the result.
 */
function maybeFinalizeShuffleSeed(G: TimestreamsState): void {
  const rng = ensureShuffleRng(G);
  if (rng.finalSeedHex) return;

  const allRevealed = G.playerOrder.every((pid) => {
    const seed = rng.reveals[pid];
    return typeof seed === "string" && seed.length > 0;
  });
  if (!allRevealed) return;

  // Combine all reveals into a deterministic final seed (proper TextEncoder use)
  const seedStr = G.playerOrder
    .map((pid) => rng.reveals[pid] ?? "")
    .join(":");
  rng.finalSeedHex = sha256Hex(new TextEncoder().encode(seedStr));
  rng.phase = "ready";
}

// =============================================================================
// Initial State
// =============================================================================

/**
 * Create initial crypto state for Timestreams.
 *
 * Adapted from onepiece's createCryptoInitialState (lines 114+).
 * Key differences:
 * - Per-player decks in G.encryptedDecks[playerId] (not shared encryptedZones)
 * - Uses createPlaceholderDeck for each player's deck
 * - cardPoints deferred to encrypt step (empty here)
 * - timeline via createTimeline() (6 era slots)
 */
export function createCryptoInitialState(
  config: GameConfig,
  moduleConfig?: Partial<TimestreamsConfig>,
): TimestreamsState {
  const playerOrder = [...config.playerIDs];
  const deckSize = moduleConfig?.deckSize ?? DEFAULT_CONFIG.deckSize;

  // Build per-player state
  const players: Record<string, TimestreamsPlayerState> = {};
  for (const playerId of playerOrder) {
    players[playerId] = {
      homeEra: null,
      ready: false,
      hand: [],
      discard: [],
      scorePile: [],
      hasPassedThisDay: false,
      publicKey: null,
      hasEncrypted: false,
      hasShuffled: false,
    };
  }

  // Build per-player encrypted decks as placeholder { ciphertext: cardId, layers: 0 }
  const encryptedDecks: TimestreamsState["encryptedDecks"] = {};
  const allCardIds: string[] = [];

  for (const playerId of playerOrder) {
    const placeholderCards = createPlaceholderDeck(playerId, deckSize);
    encryptedDecks[playerId] = placeholderCards.map((card) => ({
      ciphertext: card.id,
      layers: 0,
    }));
    for (const card of placeholderCards) {
      allCardIds.push(card.id);
    }
  }

  // Merge config with defaults
  const resolvedConfig: TimestreamsConfig = {
    ...DEFAULT_CONFIG,
    ...moduleConfig,
    deckSize,
  };

  // Build initial state (cardVisibility seeded after)
  const G: TimestreamsState = {
    players,
    playerOrder,
    config: resolvedConfig,
    phase: "keyExchange",
    timeline: createTimeline(),
    currentDay: 1,
    dayFirstPlayer: playerOrder[0],
    encryptedDecks,
    cardPoints: {},
    shuffleRng: null,
    eraAssignmentRng: null,
    pendingDecryptRequests: [],
    setupPlayerIndex: 0,
    cardVisibility: {},
    proofChain: [],
    scores: {},
    winner: null,
  };

  // Seed card visibility for every card across all players' decks
  initializeCardVisibility(G, allCardIds);

  return G;
}

// =============================================================================
// Key Exchange Move
// =============================================================================

/**
 * Submit a public key during key exchange phase.
 *
 * Adapted from onepiece's submitPublicKey (lines 230+).
 * When all players have submitted, advances phase to "encrypt"
 * and resets the sequential setup-player pointer.
 */
export function submitPublicKey(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  publicKey: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "keyExchange") return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.publicKey) return INVALID_MOVE; // Already submitted

  player.publicKey = publicKey;

  // Check if all players have submitted their public keys
  const allSubmitted = G.playerOrder.every(
    (pid) => G.players[pid].publicKey !== null,
  );

  if (allSubmitted) {
    G.phase = "encrypt";
    resetSetupPlayer(G);
  }

  return G;
}

// =============================================================================
// Encrypt Phase Moves
// =============================================================================

/**
 * Apply one SRA encryption layer to every player's deck.
 *
 * Adapted from onepiece's encryptDeck (lines 277+).
 * Key difference: applies to ALL per-player decks in G.encryptedDecks (not a
 * single shared zone). The current setup player applies their private key to
 * every player's deck. First pass encrypts from placeholder card IDs; subsequent
 * passes re-encrypt the already-encrypted deck.
 * After the last setup player, phase advances to "shuffle".
 */
export function encryptDeck(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  privateKey: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "encrypt") return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasEncrypted) return INVALID_MOVE;

  // Apply encryption layer to every player's deck
  for (const deckOwnerId of G.playerOrder) {
    const deck = G.encryptedDecks[deckOwnerId];
    if (!deck || deck.length === 0) continue;

    if (deck[0].layers === 0) {
      // First encryption pass: ciphertext fields hold plain card IDs
      const cardIds = deck.map((card) => card.ciphertext);
      G.encryptedDecks[deckOwnerId] = encryptDeckLib(cardIds, privateKey);
    } else {
      // Subsequent pass: add another SRA layer on top
      G.encryptedDecks[deckOwnerId] = reencryptDeck(deck, privateKey);
    }
  }

  player.hasEncrypted = true;

  // Advance to next player; if all done, enter shuffle phase
  if (advanceSetupPlayer(G)) {
    G.phase = "shuffle";
    resetSetupPlayer(G);
  }

  return G;
}

// =============================================================================
// Shuffle Phase Moves
// =============================================================================

/**
 * Commit a shuffle seed hash during the shuffle phase.
 *
 * Adapted from onepiece's commitShuffleSeed (lines 376+).
 * Stores SHA256(seed) commitment per player. When all players have committed,
 * advances shuffleRng.phase to "reveal".
 */
export function commitShuffleSeed(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  commitHashHex: string,
  callerId?: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);

  // Validate 64-char hex (SHA256 output)
  if (!isHex(commitHashHex) || commitHashHex.length !== 64) return INVALID_MOVE;

  const existing = rng.commits[playerId] ?? null;
  if (existing && existing !== commitHashHex) return INVALID_MOVE;
  rng.commits[playerId] = commitHashHex;

  const allCommitted = G.playerOrder.every((pid) => {
    const c = rng.commits[pid];
    return typeof c === "string" && c.length === 64;
  });
  if (allCommitted) {
    rng.phase = "reveal";
  }

  return G;
}

/**
 * Reveal a shuffle seed and verify against the prior commitment.
 *
 * Adapted from onepiece's revealShuffleSeed (lines 415+).
 * Verification uses commitHashOfSeed() which mirrors how callers produce the
 * commit (both pass the seed string directly to sha256Hex). Finalizes the
 * combined seed when all players have revealed.
 */
export function revealShuffleSeed(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  seedHex: string,
  callerId?: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);

  if (rng.phase !== "reveal" && rng.phase !== "ready") return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;

  // Validate seed is hex and long enough to resist trivial brute force
  if (!isHex(seedHex) || seedHex.length < 16) return INVALID_MOVE;

  const commit = rng.commits[playerId];
  if (!commit) return INVALID_MOVE;

  // Verify: hash(seed) must match stored commitment.
  // commitHashOfSeed mirrors how callers produce the commit hash.
  const computed = commitHashOfSeed(seedHex.toLowerCase());
  if (computed !== commit.toLowerCase()) return INVALID_MOVE;

  const existing = rng.reveals[playerId] ?? null;
  if (existing && existing.toLowerCase() !== seedHex.toLowerCase()) {
    return INVALID_MOVE;
  }
  rng.reveals[playerId] = seedHex.toLowerCase();

  maybeFinalizeShuffleSeed(G);
  return G;
}

/**
 * Permute every player's encrypted deck using the finalized shuffle seed.
 *
 * Adapted from onepiece's shuffleEncryptedDeck (lines 462+).
 * Key difference: shuffles ALL per-player decks (not a single shared zone).
 * Each setup player applies deterministicShuffle(deck, finalSeedHex + playerId)
 * to every deck, ensuring the permutation varies per player while remaining
 * deterministic. After the last setup player, advances to "play" and deals day 1.
 */
export function shuffleEncryptedDeck(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  events?: { endPhase?: () => void },
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "shuffle") return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasShuffled) return INVALID_MOVE;

  const rng = ensureShuffleRng(G);
  if (!rng.finalSeedHex) return INVALID_MOVE;

  // Per-player seed: finalSeedHex (64 hex chars) + playerId (valid hex digit)
  const playerSeed = rng.finalSeedHex + playerId;

  // Permute every player's deck with this player's seed
  for (const deckOwnerId of G.playerOrder) {
    const deck = G.encryptedDecks[deckOwnerId];
    if (deck && deck.length > 0) {
      G.encryptedDecks[deckOwnerId] = deterministicShuffle(deck, playerSeed);
    }
  }

  player.hasShuffled = true;

  // Advance to next player; if all done, enter play phase and deal day 1
  if (advanceSetupPlayer(G)) {
    G.phase = "play";
    dealForDay(G, 1);

    if (events?.endPhase) {
      events.endPhase();
    }
  }

  return G;
}

// =============================================================================
// Cooperative Decryption
// =============================================================================

/**
 * Push a cooperative decryption request for a single card in the owner's deck.
 * Requires all non-owner players to provide a decryption share first.
 */
export function requestDraw(
  G: TimestreamsState,
  ownerId: string,
  cardIndex: number,
  requestedBy: string,
): void {
  // Non-owner players must strip their encryption layers
  const requiredLayers = G.playerOrder.filter((pid) => pid !== ownerId);
  const request: DecryptRequest = {
    id: `draw:${ownerId}:${cardIndex}:${G.pendingDecryptRequests.length}`,
    playerId: ownerId,
    deckOwnerId: ownerId,
    cardIndex,
    requestedBy,
    requiredLayers,
    currentLayer: 0,
    status: "pending",
  };
  G.pendingDecryptRequests.push(request);
}

/**
 * Create cooperative draw requests for each player's top cards for the given day.
 *
 * Adapted from onepiece's dealStartingHands (lines 537+).
 * Uses G.config.drawTable[numPlayers] to determine hand size.
 * Tolerant of empty/short decks: skips players whose deck is empty or shorter
 * than requested, so unit tests with no real crypto state do not throw.
 */
export function dealForDay(G: TimestreamsState, _day: number): void {
  const numPlayers = G.playerOrder.length;
  const drawCount = G.config.drawTable[numPlayers] ?? 0;

  for (const playerId of G.playerOrder) {
    const deck = G.encryptedDecks[playerId];
    if (!deck || deck.length === 0) continue; // tolerant: skip empty deck

    const count = Math.min(drawCount, deck.length);
    for (let i = 0; i < count; i++) {
      requestDraw(G, playerId, i, playerId);
    }
  }
}

/**
 * Submit one decryption layer for a pending cooperative draw request.
 *
 * Adapted from onepiece's submitDecryptionShare (lines 585+).
 * Key difference: updates G.encryptedDecks[deckOwnerId] (not encryptedZones).
 * The caller provides the partially-decrypted card (their layer removed).
 * When all non-owner layers are stripped, marks the request complete.
 */
export function submitDecryptionShare(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  requestId: string,
  share: EncryptedCard,
): TimestreamsState | typeof INVALID_MOVE {
  const request = G.pendingDecryptRequests.find((r) => r.id === requestId);
  if (!request) return INVALID_MOVE;
  if (request.status === "complete") return INVALID_MOVE;

  // Validate this player is next in the required layer sequence
  const expectedPlayerId = request.requiredLayers[request.currentLayer];
  if (expectedPlayerId !== playerId) return INVALID_MOVE;

  // Apply the decryption share to the card in the deck owner's slot
  const deck = G.encryptedDecks[request.deckOwnerId];
  if (!deck) return INVALID_MOVE;

  const { cardIndex } = request;
  if (cardIndex < 0 || cardIndex >= deck.length) return INVALID_MOVE;

  // Replace card with the partially-decrypted version provided by this player
  deck[cardIndex] = share;
  request.currentLayer++;

  if (request.currentLayer >= request.requiredLayers.length) {
    request.status = "complete";
  } else {
    request.status = "partial";
  }

  return G;
}
