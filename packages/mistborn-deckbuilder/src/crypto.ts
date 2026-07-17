/**
 * Mistborn mental-poker crypto layer.
 *
 * Key exchange uses `@manamesh/boardgameio-crypto` keychain + MENTAL_POKER policy.
 * Encrypt requires private key matching the published public key (sk↔pk binding).
 *
 * Full deck encrypt/shuffle/deal can expand later; admission + binding are enforced now.
 */

import type { Ctx } from "boardgame.io";
// boardgame.io/core may lack a built dist in this monorepo — use the string constant.
const INVALID_MOVE = "INVALID_MOVE" as const;
import {
  encryptDeck as encryptDeckLib,
  reencryptDeck,
  type EncryptedCard,
} from "@manamesh/boardgameio-crypto/mental-poker";
import {
  keychainAdd,
  keychainFromRecord,
  MENTAL_POKER_KEYCHAIN_POLICY,
  publicKeysEqual,
  requirePrivateKeyMatchesPublished,
} from "@manamesh/boardgameio-crypto/keychain";
import {
  getCurrentSetupPlayer,
  advanceSetupPlayer,
  resetSetupPlayer,
} from "@manamesh/boardgameio-crypto";
import type { MistbornState, MistbornPhase } from "./types";

const INVALID = INVALID_MOVE;

/** Crypto-facing player fields stored on optional extensions until full PlayerState merge. */
export type MistbornCryptoPlayer = {
  publicKey: string | null;
  hasEncrypted: boolean;
  hasShuffled: boolean;
};

function cryptoPlayers(
  G: MistbornState,
): Record<string, MistbornCryptoPlayer> {
  if (!(G as any)._cryptoPlayers) {
    const map: Record<string, MistbornCryptoPlayer> = {};
    for (const pid of G.playerOrder) {
      map[pid] = {
        publicKey: G.crypto?.publicKeys?.[pid] ?? null,
        hasEncrypted: false,
        hasShuffled: false,
      };
    }
    (G as any)._cryptoPlayers = map;
  }
  return (G as any)._cryptoPlayers as Record<string, MistbornCryptoPlayer>;
}

export function createCryptoInitialState(): Partial<MistbornState> {
  return {
    crypto: {
      phase: "keyExchange",
      publicKeys: {},
      commitments: {},
      shuffleProofs: {},
      encryptedZones: {},
      cardPointLookup: {},
    },
  } as any;
}

/**
 * Submit a public key during keyExchange.
 * Uses MENTAL_POKER_KEYCHAIN_POLICY (valid finite points, unique ids, unique keys).
 */
export function submitPublicKey(
  G: MistbornState,
  ctx: Ctx,
  playerId: string,
  publicKey: string,
): MistbornState | typeof INVALID_MOVE {
  if (G.phase !== "keyExchange" && (ctx.phase as string) !== "keyExchange") {
    // Prefer G.phase; boardgame.io phase may also be keyExchange
    if (G.phase !== "keyExchange") return INVALID;
  }

  if (ctx.playerID !== undefined && ctx.playerID !== playerId) {
    return INVALID;
  }

  const cp = cryptoPlayers(G);
  const slot = cp[playerId];
  if (!slot) return INVALID;

  if (slot.publicKey) {
    if (publicKeysEqual(slot.publicKey, publicKey)) return G;
    return INVALID;
  }

  const prior = keychainFromRecord(
    G.crypto?.publicKeys ?? {},
    MENTAL_POKER_KEYCHAIN_POLICY,
  );
  const admitted = keychainAdd(
    prior,
    playerId,
    publicKey,
    MENTAL_POKER_KEYCHAIN_POLICY,
  );
  if (!admitted.ok) return INVALID;

  const canonical = admitted.entry.publicKey;
  slot.publicKey = canonical;
  if (!G.crypto) {
    Object.assign(G, createCryptoInitialState());
  }
  G.crypto.publicKeys[playerId] = canonical;
  G.crypto.keychain = admitted.keychain;
  G.crypto.phase = "keyExchange";

  const allSubmitted = G.playerOrder.every(
    (pid) => !!cp[pid]?.publicKey || !!G.crypto.publicKeys[pid],
  );
  if (allSubmitted) {
    G.phase = "encrypt" as MistbornPhase;
    G.crypto.phase = "encrypt";
    resetSetupPlayer(G as any);
  }

  return G;
}

/**
 * Apply one SRA layer to a zone (default "deck") with sk↔pk binding.
 */
export function encryptDeck(
  G: MistbornState,
  ctx: Ctx,
  playerId: string,
  privateKey: string,
  zoneId = "deck",
): MistbornState | typeof INVALID_MOVE {
  if (G.phase !== "encrypt" && G.crypto?.phase !== "encrypt") {
    return INVALID;
  }
  if (ctx.playerID !== undefined && ctx.playerID !== playerId) {
    return INVALID;
  }

  const cp = cryptoPlayers(G);
  const slot = cp[playerId];
  if (!slot) return INVALID;
  if (slot.hasEncrypted) return INVALID;

  const published =
    slot.publicKey ?? G.crypto?.publicKeys?.[playerId] ?? null;
  if (!requirePrivateKeyMatchesPublished(privateKey, published)) {
    return INVALID;
  }

  // Optional sequential setup order when setupPlayerIndex is present
  if (
    typeof (G as any).setupPlayerIndex === "number" &&
    Array.isArray(G.playerOrder)
  ) {
    try {
      const current = getCurrentSetupPlayer(G as any);
      if (current && playerId !== current) return INVALID;
    } catch {
      /* setup pointer optional for early mistborn */
    }
  }

  if (!G.crypto.encryptedZones) G.crypto.encryptedZones = {};
  const existing = G.crypto.encryptedZones[zoneId];

  if (!existing || existing.length === 0) {
    // Seed from market or zone cards if available
    const cardIds =
      G.market?.length > 0
        ? [...G.market]
        : Object.keys(G.crypto.cardPointLookup ?? {});
    if (cardIds.length === 0) {
      // Minimal encrypt path: empty deck still marks participation
      G.crypto.encryptedZones[zoneId] = [];
    } else {
      G.crypto.encryptedZones[zoneId] = encryptDeckLib(
        cardIds,
        privateKey,
      ) as EncryptedCard[];
    }
  } else {
    G.crypto.encryptedZones[zoneId] = reencryptDeck(
      existing,
      privateKey,
    ) as EncryptedCard[];
  }

  slot.hasEncrypted = true;

  const allEncrypted = G.playerOrder.every((pid) => cp[pid]?.hasEncrypted);
  if (allEncrypted) {
    G.phase = "shuffle" as MistbornPhase;
    G.crypto.phase = "shuffle";
    resetSetupPlayer(G as any);
  } else {
    try {
      advanceSetupPlayer(G as any);
    } catch {
      /* optional */
    }
  }

  return G;
}

export const cryptoMoves = {
  submitPublicKey: (
    G: MistbornState,
    ctx: Ctx,
    playerId: string,
    publicKey: string,
  ) => submitPublicKey(G, ctx, playerId, publicKey),
  encryptDeck: (
    G: MistbornState,
    ctx: Ctx,
    playerId: string,
    privateKey: string,
  ) => encryptDeck(G, ctx, playerId, privateKey),
};

export { getCurrentSetupPlayer };
