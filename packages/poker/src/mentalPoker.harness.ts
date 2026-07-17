/**
 * Mental-poker test harness — real keys + production handlers only.
 * Supports table sizes 2–5 (product max for these suites).
 */

import type { Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";
import {
  generateKeyPair,
  decrypt,
  decryptToCardId,
  buildCardPointLookup,
  type CryptoKeyPair,
  type EncryptedCard,
} from "@manamesh/boardgameio-crypto/mental-poker";
import type { GameConfig } from "@manamesh/frontend/src/game/modules/types";
import type { CryptoPokerState } from "./types";
import {
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  shuffleEncryptedDeck,
  peekHoleCards,
  approveDecrypt,
  submitDecryptedShare,
} from "./crypto";

/** Supported table sizes for mental-poker adversarial coverage. */
export const TABLE_SIZES = [2, 3, 4, 5] as const;
export type TableSize = (typeof TABLE_SIZES)[number];

export type PlayerKeys = { id: string; keys: CryptoKeyPair };

export function mockCtx(
  playerID: string,
  opts?: { numMoves?: number; phase?: string; numPlayers?: number },
): Ctx {
  const numPlayers = opts?.numPlayers ?? 2;
  const playOrder = Array.from({ length: numPlayers }, (_, i) => `${i}`);
  const playOrderPos = Math.max(0, playOrder.indexOf(playerID));
  return {
    numPlayers,
    turn: 1,
    currentPlayer: playerID,
    playOrder,
    playOrderPos,
    phase: opts?.phase ?? "setup",
    playerID,
    numMoves: opts?.numMoves ?? 0,
  } as unknown as Ctx;
}

function gameConfig(numPlayers: number): GameConfig {
  if (numPlayers < 2 || numPlayers > 5) {
    throw new Error(`numPlayers must be 2–5, got ${numPlayers}`);
  }
  const playerIDs = Array.from({ length: numPlayers }, (_, i) => `${i}`);
  return { numPlayers, playerIDs, options: {} };
}

/**
 * Try to recover a card id by peeling with the given private keys (in order).
 * Returns card id only if a full recovery is possible; otherwise null.
 */
export function tryRecoverWithKeys(
  card: EncryptedCard,
  privateKeys: string[],
  lookup: Map<string, string>,
): string | null {
  let cur: EncryptedCard = { ciphertext: card.ciphertext, layers: card.layers };
  try {
    for (const sk of privateKeys) {
      if (cur.layers === 0) break;
      if (cur.layers === 1) {
        return decryptToCardId(cur, sk, lookup);
      }
      cur = decrypt(cur, sk);
    }
    if (cur.layers === 0) {
      for (const [cardId, point] of lookup) {
        if (
          point === cur.ciphertext ||
          point.toLowerCase() === cur.ciphertext.toLowerCase()
        ) {
          return cardId;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Assert no proper subset of keys recovers the card (for N-player privacy). */
export function assertProperSubsetsCannotRecover(
  card: EncryptedCard,
  privateKeys: string[],
  lookup: Map<string, string>,
): void {
  const n = privateKeys.length;
  // All non-empty proper subsets: for n players, test each leave-one-out and each singleton
  for (let i = 0; i < n; i++) {
    const subset = privateKeys.filter((_, j) => j !== i);
    if (subset.length === 0) continue;
    if (tryRecoverWithKeys(card, subset, lookup) !== null) {
      throw new Error(`Proper subset missing key ${i} recovered card (privacy break)`);
    }
  }
  for (let i = 0; i < n; i++) {
    if (tryRecoverWithKeys(card, [privateKeys[i]], lookup) !== null) {
      throw new Error(`Singleton key ${i} recovered card (privacy break)`);
    }
  }
}

export function assertNoPrivateKeysInSharedState(
  G: CryptoPokerState,
  privateKeys: string[],
): void {
  const blob = JSON.stringify(G);
  for (const sk of privateKeys) {
    if (sk.length > 8 && blob.includes(sk)) {
      throw new Error("Private key leaked into shared game state");
    }
  }
  for (const p of Object.values(G.players)) {
    expectNoSkField(p as unknown as Record<string, unknown>);
  }
}

function expectNoSkField(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (/private/i.test(key)) {
      throw new Error(`Unexpected private key field in player state: ${key}`);
    }
  }
}

/**
 * keyExchange → encrypt×N → shuffle×N → deal (via last shuffle).
 * Uses production handlers only.
 */
export async function runMentalPokerSetup(opts?: {
  numPlayers?: number;
}): Promise<{
  G: CryptoPokerState;
  players: PlayerKeys[];
  lookup: Map<string, string>;
  numPlayers: number;
}> {
  const numPlayers = opts?.numPlayers ?? 2;
  const config = gameConfig(numPlayers);
  let G = createCryptoInitialState(config);

  const players: PlayerKeys[] = config.playerIDs.map((id, i) => {
    const seed = new Uint8Array(32);
    seed[0] = 0xa1;
    seed[1] = i + 1;
    seed[2] = 0x5a;
    seed[3] = numPlayers;
    for (let j = 4; j < 32; j++) seed[j] = (i * 17 + j * numPlayers) & 0xff;
    return { id, keys: generateKeyPair(seed) };
  });

  const ctxOpts = { numPlayers };

  // Populate card point lookup (same as CryptoPokerGame.setup)
  const lookup = await buildCardPointLookup(G.cardIds);
  for (const [cardId, point] of lookup) {
    G.crypto.cardPointLookup[cardId] = point;
  }

  // keyExchange
  expectPhase(G, "keyExchange");
  for (const p of players) {
    const res = submitPublicKey(G, mockCtx(p.id, ctxOpts), p.id, p.keys.publicKey);
    if (res === INVALID_MOVE) throw new Error(`submitPublicKey failed for ${p.id}`);
    G = res;
  }
  expectPhase(G, "encrypt");

  // encrypt in setup order
  for (let i = 0; i < numPlayers; i++) {
    const pid = G.playerOrder[G.setupPlayerIndex];
    const player = players.find((p) => p.id === pid)!;
    const res = encryptDeck(G, mockCtx(pid, ctxOpts), pid, player.keys.privateKey);
    if (res === INVALID_MOVE) throw new Error(`encryptDeck failed for ${pid}`);
    G = res;
  }
  expectPhase(G, "shuffle");

  const layersBeforeShuffle = G.crypto.encryptedZones["deck"]?.[0]?.layers;
  if (layersBeforeShuffle !== numPlayers) {
    throw new Error(
      `Expected ${numPlayers} layers before shuffle, got ${layersBeforeShuffle}`,
    );
  }

  // shuffle until deal
  for (let i = 0; i < numPlayers; i++) {
    const pid = G.playerOrder[G.setupPlayerIndex];
    const player = players.find((p) => p.id === pid)!;
    const res = shuffleEncryptedDeck(
      G,
      mockCtx(pid, { ...ctxOpts, phase: "setup" }),
      pid,
      player.keys.privateKey,
      { endPhase: () => {} },
    );
    if (res === INVALID_MOVE) throw new Error(`shuffleEncryptedDeck failed for ${pid}`);
    G = res;
  }

  if (G.phase !== "preflop") {
    throw new Error(`Expected preflop after shuffle/deal, got ${G.phase}`);
  }

  return { G, players, lookup, numPlayers };
}

/**
 * Progressive coop peel of a player's hole cards via approveDecrypt.
 * Each player peels *current* zone cards with their key (one round = one layer).
 * After N rounds, all hole cards should reach layers===0 and hasPeeked for requester.
 */
export function progressiveCoopPeekHand(
  G: CryptoPokerState,
  players: PlayerKeys[],
  requesterId: string,
): CryptoPokerState {
  const n = players.length;
  G.bettingRound.isComplete = true;
  let state = G;
  const peekRes = peekHoleCards(
    state,
    mockCtx(requesterId, { numPlayers: n }),
    requesterId,
  );
  if (peekRes === INVALID_MOVE) throw new Error("peekHoleCards failed");
  state = peekRes;

  const req = state.decryptRequests.find(
    (r) => r.zoneId === `hand:${requesterId}` && r.status === "pending",
  );
  if (!req) throw new Error("no pending peek request");

  // N progressive rounds — each player peels once from current zone state
  for (const p of players) {
    const zone = state.crypto.encryptedZones[`hand:${requesterId}`]!;
    const peels = req.cardIndices.map((idx) => decrypt(zone[idx], p.keys.privateKey));
    const res = approveDecrypt(
      state,
      mockCtx(p.id, { numPlayers: n }),
      p.id,
      req.id,
      peels,
    );
    if (res === INVALID_MOVE) throw new Error(`approveDecrypt failed for ${p.id}`);
    state = res;
  }
  return state;
}

/**
 * Progressive cooperative peel of specific indices in any encrypted zone.
 * - `hand:*` zones: finds a pending decrypt request covering the indices and uses approveDecrypt.
 * - `community`: uses submitDecryptedShare per index (one request per card from dealCommunityCards).
 */
export function progressiveCoopPeekZone(
  G: CryptoPokerState,
  players: PlayerKeys[],
  zoneId: string,
  indices: number[],
): CryptoPokerState {
  const n = players.length;
  let state = G;

  if (zoneId === "community") {
    // Community peels are one request per card index via submitDecryptedShare
    for (const cardIndex of indices) {
      for (const p of players) {
        const zone = state.crypto.encryptedZones["community"]!;
        if (!zone?.[cardIndex]) {
          throw new Error(`community card ${cardIndex} missing`);
        }
        const peel = decrypt(zone[cardIndex], p.keys.privateKey);
        const res = submitDecryptedShare(
          state,
          mockCtx(p.id, { numPlayers: n }),
          p.id,
          peel,
          "community",
          cardIndex,
        );
        if (res === INVALID_MOVE) {
          throw new Error(
            `community peel failed for ${p.id} index ${cardIndex}`,
          );
        }
        state = res;
      }
    }
    return state;
  }

  // Hand / multi-index zones: require a pending request covering these indices
  const req = state.decryptRequests.find(
    (r) =>
      r.zoneId === zoneId &&
      r.status === "pending" &&
      indices.every((i) => r.cardIndices.includes(i)),
  );
  if (!req) {
    throw new Error(`no pending decrypt request for zone ${zoneId}`);
  }

  for (const p of players) {
    const zone = state.crypto.encryptedZones[zoneId]!;
    const peels = req.cardIndices.map((idx) =>
      decrypt(zone[idx], p.keys.privateKey),
    );
    const res = approveDecrypt(
      state,
      mockCtx(p.id, { numPlayers: n }),
      p.id,
      req.id,
      peels,
    );
    if (res === INVALID_MOVE) {
      throw new Error(`approveDecrypt failed for ${p.id} zone ${zoneId}`);
    }
    state = res;
  }
  return state;
}

function expectPhase(G: CryptoPokerState, phase: string): void {
  if (G.phase !== phase) {
    throw new Error(`Expected phase ${phase}, got ${G.phase}`);
  }
}
