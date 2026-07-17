/**
 * Mistborn keychain admission + sk↔pk encrypt binding.
 */
import { describe, it, expect } from "vitest";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";
import { normalizeSecp256k1PublicKey } from "@manamesh/boardgameio-crypto/keychain";
import { submitPublicKey, encryptDeck, createCryptoInitialState } from "./crypto";
import type { MistbornState } from "./types";
import type { Ctx } from "boardgame.io";

const INVALID_MOVE = "INVALID_MOVE";

function baseG(n = 2): MistbornState {
  const playerOrder = Array.from({ length: n }, (_, i) => `${i}`);
  const players: MistbornState["players"] = {};
  for (const id of playerOrder) {
    players[id] = {
      character: "Vin",
      trainingPosition: 0,
      burnLimit: 1,
      unlockedLevels: 0,
      health: 10,
      metals: [],
      missionPoints: 0,
      missionCubes: {},
      hasTarget: false,
    };
  }
  return {
    players,
    playerOrder,
    currentPlayer: "0",
    phase: "keyExchange",
    zones: {},
    market: ["card-a", "card-b", "card-c"],
    marketDeckCount: 0,
    eliminated: [],
    boxingsAvailable: 0,
    atiumAvailable: 0,
    selectedMissions: [],
    isCoop: false,
    crypto: {
      phase: "keyExchange",
      publicKeys: {},
      commitments: {},
      shuffleProofs: {},
      encryptedZones: {},
      cardPointLookup: {},
    },
    cardVisibility: {},
    proofChain: [],
    moveHistory: [],
    ...createCryptoInitialState(),
  } as MistbornState;
}

function ctx(playerID: string, phase = "keyExchange"): Ctx {
  return {
    playerID,
    currentPlayer: playerID,
    numPlayers: 2,
    playOrder: ["0", "1"],
    phase,
  } as unknown as Ctx;
}

describe("Mistborn keychain + encrypt binding", () => {
  it("admits valid keys and rejects duplicates / garbage", () => {
    const G = baseG(2);
    const k0 = generateKeyPair();
    const k1 = generateKeyPair();

    expect(
      submitPublicKey(G, ctx("0"), "0", k0.publicKey),
    ).not.toBe(INVALID_MOVE);
    expect(G.crypto.publicKeys["0"]).toBe(
      normalizeSecp256k1PublicKey(k0.publicKey),
    );

    expect(submitPublicKey(G, ctx("1"), "1", "not-a-point")).toBe(
      INVALID_MOVE,
    );
    expect(submitPublicKey(G, ctx("1"), "1", k0.publicKey)).toBe(
      INVALID_MOVE,
    );

    expect(
      submitPublicKey(G, ctx("1"), "1", k1.publicKey),
    ).not.toBe(INVALID_MOVE);
    expect(G.phase).toBe("encrypt");
  });

  it("encryptDeck requires sk matching published pubkey", () => {
    const G = baseG(2);
    const k0 = generateKeyPair();
    const k1 = generateKeyPair();
    submitPublicKey(G, ctx("0"), "0", k0.publicKey);
    submitPublicKey(G, ctx("1"), "1", k1.publicKey);

    expect(
      encryptDeck(G, ctx("0", "encrypt"), "0", generateKeyPair().privateKey),
    ).toBe(INVALID_MOVE);

    expect(
      encryptDeck(G, ctx("0", "encrypt"), "0", k0.privateKey),
    ).not.toBe(INVALID_MOVE);
    expect(G.crypto.encryptedZones["deck"]?.length).toBeGreaterThan(0);
  });
});
