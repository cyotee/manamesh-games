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
  ActiveDeckOp,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import type { TimestreamsCard } from "./types";
import { createPlaceholderDeck } from "./deck";
import { resolveDeck } from "./deckResolver";
import { createTimeline } from "./timeline";
import { initializeCardVisibility } from "./visibility";
import {
  reencryptDeck,
  encryptDeck as encryptDeckLib,
  decrypt,
  hashToPoint,
  secpPointNormalizeHex,
  type EncryptedCard,
} from "@manamesh/boardgameio-crypto/mental-poker";
import {
  sha256Hex,
  deterministicShuffle,
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
} from "@manamesh/boardgameio-crypto";
import { assignRandomHomeEras } from "./homeEra";

// =============================================================================
// Helpers
// =============================================================================

function isHex(s: string): boolean {
  return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s);
}

/**
 * Compute a commitment hash from a seed hex string.
 *
 * Hashes the UTF-8 bytes of the seed string (via TextEncoder) so that the
 * commit is actually bound to the seed value.  Both commit-time callers and
 * revealShuffleSeed's verification MUST use this function so they agree on
 * what the commitment represents.
 *
 * Exported so that tests can produce the correct commitment without
 * duplicating the byte-encoding logic.
 */
export function hashSeedCommit(seedHex: string): string {
  return sha256Hex(new TextEncoder().encode(seedHex));
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
 * - Supports real decks from asset pack (via deckResolver) or falls back to placeholders
 * - cardPoints deferred to encrypt step (empty here)
 * - timeline via createTimeline() (6 era slots)
 */
export function createCryptoInitialState(
  config: GameConfig,
  moduleConfig?: Partial<TimestreamsConfig>,
  realDecks?: Record<string, TimestreamsCard[]>,
): TimestreamsState {
  const playerOrder = [...config.playerIDs];

  // Derive deckSize from real decks (from pack) if provided.
  // This allows different decks (eras, custom packs) to have their own sizes
  // instead of being locked to the old hardcoded default of 36.
  let deckSize = moduleConfig?.deckSize ?? DEFAULT_CONFIG.deckSize;
  if (realDecks) {
    const realLengths = Object.values(realDecks)
      .map((d) => (Array.isArray(d) ? d.length : 0))
      .filter((l) => l > 0);
    if (realLengths.length > 0) {
      deckSize = realLengths[0];
    }
  }

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

  // Build per-player encrypted decks.
  // Prefer real decks from asset pack (if provided and non-empty).
  // Otherwise fall back to placeholders.
  // Full card objects are stored in G.cards so plaintext dealing and play
  // resolution can look them up without cooperative decryption.
  const encryptedDecks: TimestreamsState["encryptedDecks"] = {};
  const cardRegistry: Record<string, TimestreamsCard> = {};
  const allCardIds: string[] = [];

  for (const playerId of playerOrder) {
    const real = realDecks?.[playerId];
    const deckCards = (real && real.length > 0)
      ? real
      : createPlaceholderDeck(playerId, deckSize);

    encryptedDecks[playerId] = deckCards.map((card) => ({
      ciphertext: card.id,
      layers: 0,
    }));
    for (const card of deckCards) {
      allCardIds.push(card.id);
      cardRegistry[card.id] = card;
    }
  }

  // Merge config with defaults
  const resolvedConfig: TimestreamsConfig = {
    ...DEFAULT_CONFIG,
    ...moduleConfig,
    deckSize,
  };

  // Setup is the true starting phase (home eras). Mental-poker keyExchange
  // follows only when playMode === "mental-poker".
  const G: TimestreamsState = {
    players,
    playerOrder,
    config: resolvedConfig,
    phase: "setup",
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
    cards: cardRegistry,
    activityLog: [],
    pendingDealRemaining: {},
  };

  // Seed card visibility for every card across all players' decks
  initializeCardVisibility(G, allCardIds);

  return G;
}

/**
 * Deal day-1 hands from plaintext deck registry (playMode: "plaintext").
 * Takes the top N cards from each player's encryptedDecks (layers === 0,
 * ciphertext is the card id) and places full TimestreamsCard objects into hand.
 * Safe to call only when decks are still unencrypted.
 */
export function dealPlaintextHands(G: TimestreamsState, day = 1): void {
  const numPlayers = G.playerOrder.length;
  const drawCount = G.config.drawTable[numPlayers] ?? 6;

  for (const playerId of G.playerOrder) {
    const player = G.players[playerId];
    if (!player) continue;

    const deck = G.encryptedDecks[playerId];
    if (!deck || deck.length === 0) continue;

    // Only deal into empty hands for day 1; subsequent days append.
    const already = player.hand.length;
    const toDraw = day === 1 ? drawCount : Math.max(0, drawCount);
    if (day === 1 && already > 0) continue;

    const count = Math.min(toDraw, deck.length);
    for (let i = 0; i < count; i++) {
      const top = deck.shift();
      if (!top) break;
      const cardId = top.ciphertext;
      const fromRegistry = G.cards?.[cardId];
      const card: TimestreamsCard = fromRegistry
        ? { ...fromRegistry }
        : {
            id: cardId,
            name: cardId,
            ownerId: playerId,
            cardType: "invention",
            subtypes: [],
            hasPlayEffect: false,
            hasScoreEffect: true,
            hasReact: false,
            scoreValue: 1,
            tags: [],
          };
      player.hand.push(card);
      if (G.cards) G.cards[card.id] = card;
      // Owner can see their drawn cards
      if (G.cardVisibility) {
        G.cardVisibility[cardId] = "owner-known";
      }
    }
  }

  G.currentDay = day;
  G.phase = "play";
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
  // Tolerate brief G.phase lag right after setup→keyExchange transition.
  if (G.phase !== "keyExchange") {
    const readyForCrypto = G.playerOrder.every(
      (pid) => G.players[pid]?.ready && G.players[pid]?.homeEra,
    );
    if (G.phase === "setup" && readyForCrypto) {
      G.phase = "keyExchange";
    } else if (G.phase === "encrypt" || G.phase === "shuffle" || G.phase === "play") {
      // Already past key exchange — ignore late/retry submits.
      return G;
    } else {
      return INVALID_MOVE;
    }
  }

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (!publicKey || typeof publicKey !== "string" || publicKey.length < 16) {
    return INVALID_MOVE;
  }
  // Idempotent: same key ok; different key rejected
  if (player.publicKey) {
    if (player.publicKey === publicKey) return G;
    return INVALID_MOVE;
  }

  player.publicKey = publicKey;
  pushActivityLog(G, `P${playerId} submitted public key`, "system");

  // Check if all players have submitted their public keys
  const allSubmitted = G.playerOrder.every(
    (pid) => !!G.players[pid]?.publicKey,
  );

  if (allSubmitted) {
    G.phase = "encrypt";
    resetSetupPlayer(G);
    pushActivityLog(G, "All keys received — starting encrypt", "system");
  }

  return G;
}

// =============================================================================
// Encrypt Phase Moves
// =============================================================================

/**
 * Apply one SRA encryption layer to every player's deck.
 *
 * Preferred path: client peels/encrypts locally and passes `preEncrypted`
 * (avoids multi-second main-thread work inside the multiplayer master).
 * Fallback: pass privateKey only (legacy / tests).
 *
 * After the last setup player, phase advances to "shuffle".
 */
export function encryptDeck(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  privateKey?: string | null,
  preEncrypted?: Record<string, EncryptedCard[]> | null,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "encrypt") return INVALID_MOVE;

  const currentPlayer = getCurrentSetupPlayer(G);
  if (playerId !== currentPlayer) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;
  if (player.hasEncrypted) return INVALID_MOVE;

  if (preEncrypted && typeof preEncrypted === "object") {
    for (const deckOwnerId of G.playerOrder) {
      const next = preEncrypted[deckOwnerId];
      if (!next || !Array.isArray(next) || next.length === 0) return INVALID_MOVE;
      const prev = G.encryptedDecks[deckOwnerId];
      if (!prev || prev.length !== next.length) return INVALID_MOVE;
      // Expect exactly +1 layer on every card
      for (let i = 0; i < next.length; i++) {
        const wantLayers = (prev[i]?.layers ?? 0) + 1;
        if (next[i].layers !== wantLayers || typeof next[i].ciphertext !== "string") {
          return INVALID_MOVE;
        }
      }
      G.encryptedDecks[deckOwnerId] = next;
    }
  } else if (privateKey) {
    for (const deckOwnerId of G.playerOrder) {
      const deck = G.encryptedDecks[deckOwnerId];
      if (!deck || deck.length === 0) continue;

      if (deck[0].layers === 0) {
        const cardIds = deck.map((card) => card.ciphertext);
        G.encryptedDecks[deckOwnerId] = encryptDeckLib(cardIds, privateKey);
      } else {
        G.encryptedDecks[deckOwnerId] = reencryptDeck(deck, privateKey);
      }
    }
  } else {
    return INVALID_MOVE;
  }

  player.hasEncrypted = true;
  pushActivityLog(G, `P${playerId} encrypted all decks`, "system");

  if (advanceSetupPlayer(G)) {
    G.phase = "shuffle";
    resetSetupPlayer(G);
    pushActivityLog(G, "Encryption complete — starting shuffle", "system");
  }

  return G;
}

/**
 * Build one encryption layer for all decks (client-side helper).
 * Call from the board before submit so the multiplayer master stays responsive.
 */
export function buildEncryptionLayer(
  G: TimestreamsState,
  privateKey: string,
): Record<string, EncryptedCard[]> {
  const out: Record<string, EncryptedCard[]> = {};
  for (const deckOwnerId of G.playerOrder) {
    const deck = G.encryptedDecks[deckOwnerId];
    if (!deck || deck.length === 0) {
      out[deckOwnerId] = [];
      continue;
    }
    if (deck[0].layers === 0) {
      const cardIds = deck.map((card) => card.ciphertext);
      out[deckOwnerId] = encryptDeckLib(cardIds, privateKey);
    } else {
      out[deckOwnerId] = reencryptDeck(deck, privateKey);
    }
  }
  return out;
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

  // Verify: hash(seed bytes) must match stored commitment.
  // hashSeedCommit hashes the UTF-8 bytes of the seed, so the commit is
  // actually bound to the seed value rather than to its string length.
  const computed = hashSeedCommit(seedHex.toLowerCase());
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
  pushActivityLog(G, `P${playerId} shuffled all encrypted decks`, "system");

  // Advance to next player; if all done, enter play phase.
  // Day deal / decrypt pipeline is started by beginPlayPhase (avoids double-deal).
  if (advanceSetupPlayer(G)) {
    G.phase = "play";
    pushActivityLog(G, "Shuffle complete — dealing hands", "deal");
    if (events?.endPhase) {
      events.endPhase();
    }
  }

  return G;
}

// =============================================================================
// Era Assignment RNG (for homeEraAssignment === 'random' in setup phase)
// Full commit-reveal wiring, mirroring shuffle but in setup phase.
// =============================================================================

function ensureEraAssignmentRng(G: TimestreamsState): ShuffleRngState {
  if (G.eraAssignmentRng) return G.eraAssignmentRng;

  const commits: Record<string, string | null> = {};
  const reveals: Record<string, string | null> = {};
  for (const pid of G.playerOrder) {
    commits[pid] = null;
    reveals[pid] = null;
  }

  G.eraAssignmentRng = {
    phase: "commit",
    commits,
    reveals,
    finalSeedHex: null,
    abortVotes: {},
  };
  return G.eraAssignmentRng;
}

function maybeFinalizeEraSeed(G: TimestreamsState): void {
  const rng = ensureEraAssignmentRng(G);
  if (rng.finalSeedHex) return;

  const allRevealed = G.playerOrder.every((pid) => {
    const seed = rng.reveals[pid];
    return typeof seed === "string" && seed.length > 0;
  });
  if (!allRevealed) return;

  const seedStr = G.playerOrder
    .map((pid) => rng.reveals[pid] ?? "")
    .join(":");
  rng.finalSeedHex = sha256Hex(new TextEncoder().encode(seedStr));
}

export function commitEraSeed(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  commitHashHex: string,
  callerId?: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "setup") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (G.config.homeEraAssignment !== "random") return INVALID_MOVE;

  const rng = ensureEraAssignmentRng(G);

  if (!isHex(commitHashHex) || commitHashHex.length !== 64) return INVALID_MOVE;

  const existing = rng.commits[playerId] ?? null;
  if (existing && existing !== commitHashHex) return INVALID_MOVE;
  rng.commits[playerId] = commitHashHex;

  const allCommitted = G.playerOrder.every((pid) => {
    const c = rng.commits[pid];
    return typeof c === "string" && c.length > 0;
  });
  if (allCommitted && rng.phase === "commit") {
    rng.phase = "reveal";
  }

  return G;
}

export function revealEraSeed(
  G: TimestreamsState,
  _ctx: Ctx,
  playerId: string,
  seedHex: string,
  callerId?: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "setup") return INVALID_MOVE;
  if (callerId && callerId !== playerId) return INVALID_MOVE;
  if (!G.players[playerId]) return INVALID_MOVE;
  if (G.config.homeEraAssignment !== "random") return INVALID_MOVE;

  const rng = ensureEraAssignmentRng(G);

  if (rng.phase !== "reveal" && rng.phase !== "ready") return INVALID_MOVE;
  if (!isHex(seedHex) || seedHex.length < 16) return INVALID_MOVE;

  const commit = rng.commits[playerId];
  if (!commit) return INVALID_MOVE;

  if (hashSeedCommit(seedHex) !== commit) return INVALID_MOVE;

  rng.reveals[playerId] = seedHex;

  maybeFinalizeEraSeed(G);

  if (rng.finalSeedHex) {
    rng.phase = "ready";
    assignRandomHomeEras(G, rng.finalSeedHex);
    // Auto-ready once eras assigned (for random mode)
    for (const pid of G.playerOrder) {
      const p = G.players[pid];
      if (p) p.ready = true;
    }
  }

  return G;
}

// =============================================================================
// Cooperative Decryption + activity log
// =============================================================================

const ACTIVITY_LOG_MAX = 80;

/** Append a non-modal activity-log line (newest last). */
export function pushActivityLog(
  G: TimestreamsState,
  message: string,
  kind: "decrypt" | "deal" | "system" | "info" = "info",
): void {
  if (!G.activityLog) G.activityLog = [];
  G.activityLog.push({
    id: `log-${Date.now()}-${G.activityLog.length}`,
    at: Date.now(),
    message,
    kind,
  });
  if (G.activityLog.length > ACTIVITY_LOG_MAX) {
    G.activityLog.splice(0, G.activityLog.length - ACTIVITY_LOG_MAX);
  }
}

/** Ensure G.cardPointLookup is filled for known registry cards (once). */
function ensureCardPointLookup(G: TimestreamsState): Record<string, string> {
  if (!(G as any).cardPointLookup) (G as any).cardPointLookup = {};
  const lookup = (G as any).cardPointLookup as Record<string, string>;
  for (const cardId of Object.keys(G.cards ?? {})) {
    if (lookup[cardId]) continue;
    try {
      const pt = hashToPoint(cardId);
      lookup[cardId] = secpPointNormalizeHex(pt.encode("hex", false));
    } catch {
      // skip
    }
  }
  return lookup;
}

/** Map fully-peeled curve point ciphertext back to a known card id. */
export function resolveCardIdFromPoint(
  G: TimestreamsState,
  pointCiphertext: string,
): string | null {
  const want = secpPointNormalizeHex(pointCiphertext);
  const lookup = ensureCardPointLookup(G);
  for (const [cardId, hex] of Object.entries(lookup)) {
    if (hex === want) return cardId;
  }
  // Fallback: still-plain ids (tests / unencrypted edge)
  for (const pid of G.playerOrder) {
    for (const c of G.encryptedDecks[pid] ?? []) {
      if (c.layers === 0 && c.ciphertext === pointCiphertext) return c.ciphertext;
    }
  }
  return null;
}

/**
 * Push a cooperative decryption request for the top card of the owner's deck
 * (cardIndex should be 0 for sequential draws). Peels **non-owners first**, then
 * the owner last, so the card ends at layers === 0 and can be materialised.
 */
export function requestDraw(
  G: TimestreamsState,
  ownerId: string,
  cardIndex: number,
  requestedBy: string,
  purpose: "draw" | "search" = "draw",
): void {
  const nonOwners = G.playerOrder.filter((pid) => pid !== ownerId);
  // Full peel: everyone removes their layer; owner last so final plaintext is available.
  const requiredLayers = [...nonOwners, ownerId];
  const request: DecryptRequest = {
    id: `${purpose}:${ownerId}:${cardIndex}:${Date.now()}:${G.pendingDecryptRequests.length}`,
    playerId: ownerId,
    deckOwnerId: ownerId,
    cardIndex,
    requestedBy,
    requiredLayers,
    currentLayer: 0,
    status: "pending",
    materialized: false,
    purpose,
  };
  G.pendingDecryptRequests.push(request);
  pushActivityLog(
    G,
    purpose === "search"
      ? `P${requestedBy} requested full-deck decrypt (search)`
      : `P${requestedBy} requested decrypt for P${ownerId}'s draw`,
    "decrypt",
  );
}

/** True if any card in this deck still has encryption layers. */
export function deckHasEncryption(G: TimestreamsState, ownerId: string): boolean {
  const deck = G.encryptedDecks[ownerId] ?? [];
  return deck.some((c) => (c.layers ?? 0) > 0);
}

export function hasActiveDeckOp(G: TimestreamsState): boolean {
  const op = G.activeDeckOp;
  return !!(op && op.phase !== "done");
}

/**
 * Start a mental-poker deck search: auto-decrypt every remaining card into
 * activeDeckOp.revealed, then open the choose prompt.
 */
export function startSearchDeckReveal(
  G: TimestreamsState,
  ownerId: string,
  sourceCardId: string,
  opts: { toHand: boolean; shuffleAfter: boolean },
): ActiveDeckOp {
  const deck = G.encryptedDecks[ownerId] ?? [];
  const commits: Record<string, string | null> = {};
  const reveals: Record<string, string | null> = {};
  for (const pid of G.playerOrder) {
    commits[pid] = null;
    reveals[pid] = null;
  }

  // Plaintext deck: skip decrypt, go straight to choose.
  if (!deckHasEncryption(G, ownerId)) {
    const revealed = deck.map((c) => c.ciphertext);
    const op: ActiveDeckOp = {
      id: `search:${sourceCardId}:${Date.now()}`,
      kind: "search-deck",
      sourceCardId,
      ownerId,
      phase: revealed.length ? "choose" : "done",
      decryptTotal: revealed.length,
      decryptDone: revealed.length,
      revealed: [...revealed],
      toHand: opts.toHand,
      shuffleAfter: opts.shuffleAfter,
      shuffleCommits: commits,
      shuffleReveals: reveals,
      finalSeedHex: null,
      reencryptPlayerIndex: 0,
      statusMessage: revealed.length
        ? "Choose a card from your deck"
        : "Deck empty",
    };
    G.activeDeckOp = op;
    if (revealed.length) {
      G.pendingPrompts = [
        {
          id: `${sourceCardId}:search-deck`,
          deciderId: ownerId,
          kind: "choose-card",
          options: revealed,
          min: 1,
          max: 1,
          reason: "play:search-deck",
        },
      ];
    }
    return op;
  }

  const op: ActiveDeckOp = {
    id: `search:${sourceCardId}:${Date.now()}`,
    kind: "search-deck",
    sourceCardId,
    ownerId,
    phase: "decrypt",
    decryptTotal: deck.length,
    decryptDone: 0,
    revealed: [],
    toHand: opts.toHand,
    shuffleAfter: opts.shuffleAfter,
    shuffleCommits: commits,
    shuffleReveals: reveals,
    finalSeedHex: null,
    reencryptPlayerIndex: 0,
    statusMessage: `Decrypting deck for search… 0/${deck.length}`,
  };
  G.activeDeckOp = op;
  pushActivityLog(
    G,
    `P${ownerId} searching deck — decrypting ${deck.length} card(s)`,
    "decrypt",
  );
  enqueueNextSearchDecrypt(G);
  return op;
}

function enqueueNextSearchDecrypt(G: TimestreamsState): void {
  const op = G.activeDeckOp;
  if (!op || op.phase !== "decrypt") return;
  if (hasActiveDecrypt(G, op.ownerId)) return;
  const deck = G.encryptedDecks[op.ownerId] ?? [];
  if (deck.length === 0) {
    finishSearchDecrypt(G);
    return;
  }
  requestDraw(G, op.ownerId, 0, op.ownerId, "search");
  op.statusMessage = `Decrypting deck for search… ${op.decryptDone}/${op.decryptTotal}`;
}

function finishSearchDecrypt(G: TimestreamsState): void {
  const op = G.activeDeckOp;
  if (!op) return;
  op.phase = "choose";
  op.statusMessage = "Choose a card from your decrypted deck";
  G.pendingPrompts = [
    {
      id: `${op.sourceCardId}:search-deck`,
      deciderId: op.ownerId,
      kind: "choose-card",
      options: [...op.revealed],
      min: 1,
      max: 1,
      reason: "play:search-deck",
    },
  ];
  pushActivityLog(
    G,
    `Deck search ready for P${op.ownerId} (${op.revealed.length} cards)`,
    "decrypt",
  );
}

/**
 * After the search pick: remove card to hand, put remainder back, start fair reshuffle if needed.
 */
export function completeSearchDeckPick(
  G: TimestreamsState,
  pickId: string,
): boolean {
  const op = G.activeDeckOp;
  if (!op || op.phase !== "choose") return false;
  if (!op.revealed.includes(pickId)) return false;

  const remaining = op.revealed.filter((id) => id !== pickId);
  const player = G.players[op.ownerId];
  if (!player) return false;

  if (op.toHand) {
    const fromRegistry = G.cards?.[pickId];
    const card: TimestreamsCard = fromRegistry
      ? { ...fromRegistry, ownerId: op.ownerId }
      : {
          id: pickId,
          name: pickId,
          ownerId: op.ownerId,
          cardType: "invention",
          subtypes: [],
          hasPlayEffect: false,
          hasScoreEffect: true,
          hasReact: false,
          scoreValue: 1,
          tags: [],
        };
    player.hand.push(card);
    if (!G.cards) G.cards = {};
    G.cards[card.id] = card;
    if (G.cardVisibility) G.cardVisibility[pickId] = "owner-known";
  }

  // Remaining deck as plaintext ids (layers 0) pending fair reshuffle + re-encrypt
  G.encryptedDecks[op.ownerId] = remaining.map((id) => ({
    ciphertext: id,
    layers: 0,
  }));
  G.pendingPrompts = [];
  op.revealed = remaining;

  if (op.shuffleAfter && remaining.length > 1) {
    beginDeckReshuffle(G);
  } else if (remaining.length > 0 && G.config?.playMode === "mental-poker") {
    beginDeckReencrypt(G);
  } else {
    op.phase = "done";
    op.statusMessage = "Deck search complete";
    G.activeDeckOp = null;
  }
  pushActivityLog(G, `P${op.ownerId} took ${pickId} from search`, "info");
  return true;
}

export function beginDeckReshuffle(G: TimestreamsState): void {
  const op = G.activeDeckOp;
  if (!op) return;
  op.phase = "reshuffle-commit";
  op.statusMessage = "Fair reshuffle — commit seeds…";
  for (const pid of G.playerOrder) {
    op.shuffleCommits[pid] = null;
    op.shuffleReveals[pid] = null;
  }
  op.finalSeedHex = null;
  pushActivityLog(G, `Reshuffling P${op.ownerId}'s deck (commit phase)`, "system");
}

export function commitDeckOpSeed(
  G: TimestreamsState,
  playerId: string,
  commitHashHex: string,
): TimestreamsState | typeof INVALID_MOVE {
  const op = G.activeDeckOp;
  if (!op || op.phase !== "reshuffle-commit") return INVALID_MOVE;
  if (!isHex(commitHashHex) || commitHashHex.length !== 64) return INVALID_MOVE;
  if (op.shuffleCommits[playerId]) return INVALID_MOVE;
  op.shuffleCommits[playerId] = commitHashHex.toLowerCase();
  const all = G.playerOrder.every((pid) => !!op.shuffleCommits[pid]);
  if (all) {
    op.phase = "reshuffle-reveal";
    op.statusMessage = "Fair reshuffle — reveal seeds…";
  }
  return G;
}

export function revealDeckOpSeed(
  G: TimestreamsState,
  playerId: string,
  seedHex: string,
): TimestreamsState | typeof INVALID_MOVE {
  const op = G.activeDeckOp;
  if (!op || op.phase !== "reshuffle-reveal") return INVALID_MOVE;
  if (!isHex(seedHex) || seedHex.length < 16) return INVALID_MOVE;
  const commit = op.shuffleCommits[playerId];
  if (!commit) return INVALID_MOVE;
  if (hashSeedCommit(seedHex.toLowerCase()) !== commit.toLowerCase()) {
    return INVALID_MOVE;
  }
  op.shuffleReveals[playerId] = seedHex.toLowerCase();
  const all = G.playerOrder.every((pid) => !!op.shuffleReveals[pid]);
  if (all) {
    const seedStr = G.playerOrder.map((pid) => op.shuffleReveals[pid] ?? "").join(":");
    op.finalSeedHex = sha256Hex(new TextEncoder().encode(seedStr));
    applyDeckOpShuffle(G);
  }
  return G;
}

function applyDeckOpShuffle(G: TimestreamsState): void {
  const op = G.activeDeckOp;
  if (!op || !op.finalSeedHex) return;
  const deck = G.encryptedDecks[op.ownerId];
  if (deck && deck.length > 1) {
    G.encryptedDecks[op.ownerId] = deterministicShuffle(
      deck,
      op.finalSeedHex + op.ownerId,
    );
  }
  pushActivityLog(G, `P${op.ownerId}'s deck reshuffled (fair seed)`, "system");
  if (G.config?.playMode === "mental-poker" && (G.encryptedDecks[op.ownerId]?.length ?? 0) > 0) {
    beginDeckReencrypt(G);
  } else {
    op.phase = "done";
    op.statusMessage = "Reshuffle complete";
    G.activeDeckOp = null;
  }
}

export function beginDeckReencrypt(G: TimestreamsState): void {
  const op = G.activeDeckOp;
  if (!op) return;
  op.phase = "reencrypt";
  op.reencryptPlayerIndex = 0;
  op.statusMessage = `Re-encrypting deck (P${G.playerOrder[0]})…`;
  pushActivityLog(G, `Re-encrypting P${op.ownerId}'s remaining deck`, "system");
}

/**
 * Apply one player's encryption layer to the active deck-op owner's remaining deck.
 * Preferred: preEncrypted array for that deck only.
 */
export function submitDeckOpReencrypt(
  G: TimestreamsState,
  playerId: string,
  privateKey?: string | null,
  preEncrypted?: EncryptedCard[] | null,
): TimestreamsState | typeof INVALID_MOVE {
  const op = G.activeDeckOp;
  if (!op || op.phase !== "reencrypt") return INVALID_MOVE;
  const expected = G.playerOrder[op.reencryptPlayerIndex];
  if (playerId !== expected) return INVALID_MOVE;

  const prev = G.encryptedDecks[op.ownerId] ?? [];
  if (prev.length === 0) {
    op.phase = "done";
    G.activeDeckOp = null;
    return G;
  }

  if (preEncrypted && Array.isArray(preEncrypted)) {
    if (preEncrypted.length !== prev.length) return INVALID_MOVE;
    for (let i = 0; i < prev.length; i++) {
      if (preEncrypted[i].layers !== (prev[i].layers ?? 0) + 1) return INVALID_MOVE;
    }
    G.encryptedDecks[op.ownerId] = preEncrypted;
  } else if (privateKey) {
    if ((prev[0]?.layers ?? 0) === 0) {
      G.encryptedDecks[op.ownerId] = encryptDeckLib(
        prev.map((c) => c.ciphertext),
        privateKey,
      );
    } else {
      G.encryptedDecks[op.ownerId] = reencryptDeck(prev, privateKey);
    }
  } else {
    return INVALID_MOVE;
  }

  op.reencryptPlayerIndex += 1;
  if (op.reencryptPlayerIndex >= G.playerOrder.length) {
    op.phase = "done";
    op.statusMessage = "Deck re-encrypted";
    pushActivityLog(G, `P${op.ownerId}'s deck re-encrypted after search`, "system");
    G.activeDeckOp = null;
  } else {
    op.statusMessage = `Re-encrypting deck (P${G.playerOrder[op.reencryptPlayerIndex]})…`;
  }
  return G;
}

/** Build one re-encrypt layer for the active deck-op owner's remaining deck. */
export function buildDeckOpReencryptLayer(
  G: TimestreamsState,
  privateKey: string,
): EncryptedCard[] | null {
  const op = G.activeDeckOp;
  if (!op || op.phase !== "reencrypt") return null;
  const prev = G.encryptedDecks[op.ownerId] ?? [];
  if (prev.length === 0) return [];
  if ((prev[0]?.layers ?? 0) === 0) {
    return encryptDeckLib(
      prev.map((c) => c.ciphertext),
      privateKey,
    );
  }
  return reencryptDeck(prev, privateKey);
}

/** True if this deck already has an active (not yet materialized) decrypt request. */
function hasActiveDecrypt(G: TimestreamsState, ownerId: string): boolean {
  return G.pendingDecryptRequests.some(
    (r) => r.deckOwnerId === ownerId && !r.materialized,
  );
}

/**
 * If the player still needs draws and has no in-flight request, enqueue top-card decrypt.
 */
export function enqueueNextDrawIfNeeded(G: TimestreamsState, ownerId: string): void {
  if (!G.pendingDealRemaining) G.pendingDealRemaining = {};
  const remaining = G.pendingDealRemaining[ownerId] ?? 0;
  if (remaining <= 0) return;
  const deck = G.encryptedDecks[ownerId];
  if (!deck || deck.length === 0) {
    G.pendingDealRemaining[ownerId] = 0;
    return;
  }
  if (hasActiveDecrypt(G, ownerId)) return;
  requestDraw(G, ownerId, 0, ownerId);
}

/**
 * Create sequential day-deal decrypt pipeline for each player.
 * One active top-of-deck request at a time; next enqueued after materialize.
 */
export function dealForDay(G: TimestreamsState, _day: number): void {
  const numPlayers = G.playerOrder.length;
  const drawCount = G.config.drawTable[numPlayers] ?? 0;
  if (!G.pendingDealRemaining) G.pendingDealRemaining = {};

  for (const playerId of G.playerOrder) {
    const deck = G.encryptedDecks[playerId];
    if (!deck || deck.length === 0) {
      G.pendingDealRemaining[playerId] = 0;
      continue;
    }
    const count = Math.min(drawCount, deck.length);
    G.pendingDealRemaining[playerId] = (G.pendingDealRemaining[playerId] ?? 0) + count;
    pushActivityLog(G, `Dealing ${count} card(s) to P${playerId} (decrypt)`, "deal");
    enqueueNextDrawIfNeeded(G, playerId);
  }
}

/**
 * Request `count` cooperative draws from the top of a player's encrypted deck
 * (queued via pendingDealRemaining; sequential).
 */
export function requestDraws(G: TimestreamsState, playerId: string, count: number): number {
  const deck = G.encryptedDecks[playerId];
  if (!deck || deck.length === 0 || count <= 0) return 0;
  if (!G.pendingDealRemaining) G.pendingDealRemaining = {};
  const n = Math.min(count, deck.length);
  G.pendingDealRemaining[playerId] = (G.pendingDealRemaining[playerId] ?? 0) + n;
  pushActivityLog(G, `P${playerId} drawing ${n} (decrypt requested)`, "decrypt");
  enqueueNextDrawIfNeeded(G, playerId);
  return n;
}

function materializeCompletedDraw(G: TimestreamsState, request: DecryptRequest): void {
  if (request.materialized) return;
  const deck = G.encryptedDecks[request.deckOwnerId];
  if (!deck) return;
  const { cardIndex } = request;
  if (cardIndex < 0 || cardIndex >= deck.length) return;
  const enc = deck[cardIndex];
  if (!enc || enc.layers !== 0) {
    pushActivityLog(
      G,
      `Decrypt finished for P${request.deckOwnerId} but card still has ${enc?.layers ?? "?"} layer(s)`,
      "decrypt",
    );
    return;
  }

  let cardId = resolveCardIdFromPoint(G, enc.ciphertext);
  // Fallback: if somehow still a plain id (unencrypted tests)
  if (!cardId && enc.ciphertext && !enc.ciphertext.startsWith("04")) {
    cardId = enc.ciphertext;
  }
  if (!cardId) {
    pushActivityLog(
      G,
      `P${request.deckOwnerId}: decrypt complete but card id could not be resolved`,
      "decrypt",
    );
    request.materialized = true;
    return;
  }

  const fromRegistry = G.cards?.[cardId];
  const card: TimestreamsCard = fromRegistry
    ? { ...fromRegistry, ownerId: request.deckOwnerId }
    : {
        id: cardId,
        name: cardId,
        ownerId: request.deckOwnerId,
        cardType: "invention",
        subtypes: [],
        hasPlayEffect: false,
        hasScoreEffect: true,
        hasReact: false,
        scoreValue: 1,
        tags: [],
      };

  deck.splice(cardIndex, 1);
  if (!G.cards) G.cards = {};
  G.cards[card.id] = card;

  request.materialized = true;
  request.status = "complete";
  G.pendingDecryptRequests = G.pendingDecryptRequests.filter((r) => r.id !== request.id);

  // --- Search: accumulate revealed cards, do not put into hand yet ---
  if (request.purpose === "search") {
    const op = G.activeDeckOp;
    if (op && op.ownerId === request.deckOwnerId && op.phase === "decrypt") {
      op.revealed.push(cardId);
      op.decryptDone += 1;
      op.statusMessage = `Decrypting deck for search… ${op.decryptDone}/${op.decryptTotal}`;
      pushActivityLog(
        G,
        `Search decrypt ${op.decryptDone}/${op.decryptTotal} for P${op.ownerId}`,
        "decrypt",
      );
      if (deck.length === 0) {
        finishSearchDecrypt(G);
      } else {
        enqueueNextSearchDecrypt(G);
      }
    }
    return;
  }

  // --- Normal draw into hand ---
  const player = G.players[request.deckOwnerId];
  if (!player) return;
  player.hand.push(card);
  if (G.cardVisibility) G.cardVisibility[cardId] = "owner-known";

  if (G.pendingDealRemaining && G.pendingDealRemaining[request.deckOwnerId] > 0) {
    G.pendingDealRemaining[request.deckOwnerId] -= 1;
  }

  pushActivityLog(
    G,
    `Decrypt complete — P${request.deckOwnerId} received a card`,
    "decrypt",
  );
  enqueueNextDrawIfNeeded(G, request.deckOwnerId);
}

/**
 * Submit one decryption layer for a pending cooperative draw request.
 * When all layers are peeled, materialises the card into the owner's hand
 * and enqueues the next pending deal draw if any.
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
  if (request.status === "complete" && request.materialized) return INVALID_MOVE;

  const expectedPlayerId = request.requiredLayers[request.currentLayer];
  if (expectedPlayerId !== playerId) return INVALID_MOVE;

  const deck = G.encryptedDecks[request.deckOwnerId];
  if (!deck) return INVALID_MOVE;

  const { cardIndex } = request;
  if (cardIndex < 0 || cardIndex >= deck.length) return INVALID_MOVE;

  deck[cardIndex] = share;
  request.currentLayer++;

  if (request.currentLayer >= request.requiredLayers.length) {
    request.status = "complete";
    pushActivityLog(
      G,
      `P${playerId} submitted final decrypt layer for P${request.deckOwnerId}'s draw`,
      "decrypt",
    );
    materializeCompletedDraw(G, request);
  } else {
    request.status = "partial";
    pushActivityLog(
      G,
      `P${playerId} auto-decrypted a layer for P${request.deckOwnerId}'s draw`,
      "decrypt",
    );
  }

  return G;
}

/**
 * Client helper: peel one layer with the local private key for a pending request
 * where this player is next. Returns the share to pass to submitDecryptionShare.
 */
export function peelDecryptShare(
  encryptedCard: EncryptedCard,
  privateKey: string,
): EncryptedCard {
  return decrypt(encryptedCard, privateKey);
}
