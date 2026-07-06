import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx } from "boardgame.io";
import { INVALID_MOVE } from "boardgame.io/core";

import {
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  commitShuffleSeed,
  revealShuffleSeed,
  shuffleEncryptedDeck,
  getCurrentSetupPlayer,
} from "./boardgameio-crypto";

import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";
import { sha256Hex } from "@manamesh/boardgameio-crypto";

// Helpers
function createMockCtx(
  playerIndex: string = "0",
  phase: string = "keyExchange",
): Ctx {
  return {
    currentPlayer: playerIndex,
    numPlayers: 2,
    playOrder: ["0", "1"],
    phase,
    turn: 0,
    numMoves: 0,
  } as unknown as Ctx;
}

function createCryptoState(playerIds: string[] = ["0", "1"]) {
  const config = { numPlayers: playerIds.length, playerIDs: playerIds } as any;
  return createCryptoInitialState(config);
}

describe("OnePieceCryptoGame (crypto setup)", () => {
  let G: any;

  beforeEach(() => {
    G = createCryptoState();
  });

  describe("initial state", () => {
    it("starts in keyExchange phase with empty public keys and encrypted zones", () => {
      expect(G.phase).toBe("keyExchange");
      expect(G.players["0"].publicKey).toBeNull();
      expect(G.players["1"].publicKey).toBeNull();
      expect(G.encryptedZones).toBeDefined();
      expect(G.encryptedZones.mainDeck).toBeDefined();
      expect(G.encryptedZones[`lifeDeck:0`]).toBeDefined();
      expect(G.encryptedZones[`lifeDeck:1`]).toBeDefined();
      expect(G.setupPlayerIndex).toBe(0);
    });
  });

  describe("keyExchange phase", () => {
    it("submitPublicKey stores public key and advances to encrypt when all submit", () => {
      const ctx = createMockCtx("0", "keyExchange");
      const { publicKey: pub0, privateKey: priv0 } = generateKeyPair();
      const { publicKey: pub1, privateKey: priv1 } = generateKeyPair();

      // Player 0 submits
      let res = submitPublicKey(G, ctx, "0", pub0);
      expect(res).toBe(G);
      expect(G.players["0"].publicKey).toBe(pub0);
      expect(G.phase).toBe("keyExchange");

      // Player 1 submits - should transition
      res = submitPublicKey(G, ctx, "1", pub1);
      expect(res).toBe(G);
      expect(G.players["1"].publicKey).toBe(pub1);
      expect(G.phase).toBe("encrypt");
    });

    it("rejects submitPublicKey when not in keyExchange or duplicate", () => {
      const ctx = createMockCtx("0", "encrypt");
      const { publicKey: pub0 } = generateKeyPair();

      // Ensure the game phase is not keyExchange so the move is invalid
      G.phase = "encrypt";
      const bad = submitPublicKey(G, ctx, "0", pub0);
      expect(bad).toBe(INVALID_MOVE);

      // Move back to keyExchange and submit once
      G.phase = "keyExchange";
      const { publicKey: pubA } = generateKeyPair();
      const ok = submitPublicKey(
        G,
        createMockCtx("0", "keyExchange"),
        "0",
        pubA,
      );
      expect(ok).toBe(G);
      // Duplicate submit should be rejected
      const dup = submitPublicKey(
        G,
        createMockCtx("0", "keyExchange"),
        "0",
        pubA,
      );
      expect(dup).toBe(INVALID_MOVE);
    });
  });

  // keyEscrow removed: tests updated for new flow keyExchange -> encrypt

  describe("encrypt phase", () => {
    it("encrypts main and life decks, layers increment per player and advances to shuffle", () => {
      // Prepare: submit keys to reach encrypt phase
      const k0 = generateKeyPair();
      const k1 = generateKeyPair();
      submitPublicKey(G, createMockCtx("0", "keyExchange"), "0", k0.publicKey);
      submitPublicKey(G, createMockCtx("1", "keyExchange"), "1", k1.publicKey);

      // Populate deckCardIds and lifeDeckIds
      G.deckCardIds["0"] = Array.from({ length: 30 }, (_, i) => `p0-${i}`);
      G.deckCardIds["1"] = Array.from({ length: 30 }, (_, i) => `p1-${i}`);
      G.lifeDeckIds["0"] = Array.from({ length: 5 }, (_, i) => `l0-${i}`);
      G.lifeDeckIds["1"] = Array.from({ length: 5 }, (_, i) => `l1-${i}`);

      expect(G.phase).toBe("encrypt");

      // Player 0 encrypts first
      const enc0 = encryptDeck(
        G,
        createMockCtx("0", "encrypt"),
        "0",
        k0.privateKey,
      );
      expect(enc0).toBe(G);
      expect(G.encryptedZones.mainDeck.length).toBeGreaterThan(0);
      expect(G.encryptedZones[`lifeDeck:0`].length).toBeGreaterThan(0);
      // After first encrypt, layers should be 1
      const firstLayers = G.encryptedZones.mainDeck[0].layers;
      expect(firstLayers).toBeGreaterThanOrEqual(1);

      // Player 1 re-encrypts
      const enc1 = encryptDeck(
        G,
        createMockCtx("1", "encrypt"),
        "1",
        k1.privateKey,
      );
      expect(enc1).toBe(G);
      // Now layers should equal number of players (2) for the main deck
      const layersAfter = G.encryptedZones.mainDeck[0].layers;
      expect(layersAfter).toBeGreaterThanOrEqual(2);
      // Each player's life deck should have been encrypted at least once
      expect(G.encryptedZones[`lifeDeck:0`][0].layers).toBeGreaterThanOrEqual(
        1,
      );
      expect(G.encryptedZones[`lifeDeck:1`][0].layers).toBeGreaterThanOrEqual(
        1,
      );

      expect(G.phase).toBe("shuffle");
    });

    it("rejects encryptDeck when not in encrypt phase or out-of-turn", () => {
      G.phase = "shuffle";
      const bad = encryptDeck(G, createMockCtx("0", "shuffle"), "0", "priv");
      expect(bad).toBe(INVALID_MOVE);
    });
  });

  describe("shuffle phase (commit-reveal & shuffle)", () => {
    it("commit/reveal flow validates commits and reveals and finalSeedHex is set", () => {
      // Move to shuffle and ensure encrypted deck exists
      G.phase = "shuffle";
      // Ensure encrypted deck has entries
      G.encryptedZones.mainDeck = Array.from({ length: 20 }, (_, i) => ({
        ciphertext: `c${i}`,
        layers: 2,
      }));
      G.encryptedZones[`lifeDeck:0`] = Array.from({ length: 5 }, (_, i) => ({
        ciphertext: `l0-${i}`,
        layers: 2,
      }));
      G.encryptedZones[`lifeDeck:1`] = Array.from({ length: 5 }, (_, i) => ({
        ciphertext: `l1-${i}`,
        layers: 2,
      }));

      // Invalid commit hex
      const badCommit = commitShuffleSeed(
        G,
        createMockCtx("0", "shuffle"),
        "0",
        "nothex",
      );
      expect(badCommit).toBe(INVALID_MOVE);

      // Valid commit/reveal
      // Use hex-only seeds by hashing a label, then commit the hash
      const seed0 = sha256Hex(new TextEncoder().encode("s0"));
      const seed1 = sha256Hex(new TextEncoder().encode("s1"));
      const commit0 = sha256Hex(new TextEncoder().encode(seed0));
      const commit1 = sha256Hex(new TextEncoder().encode(seed1));

      const c0 = commitShuffleSeed(
        G,
        createMockCtx("0", "shuffle"),
        "0",
        commit0,
      );
      expect(c0).toBe(G);
      // Not yet reveal phase until both commit
      expect((G as any).shuffleRng.phase).toBe("commit");

      const c1 = commitShuffleSeed(
        G,
        createMockCtx("1", "shuffle"),
        "1",
        commit1,
      );
      expect(c1).toBe(G);
      expect((G as any).shuffleRng.phase).toBe("reveal");

      // Wrong reveal should be rejected
      const badReveal = revealShuffleSeed(
        G,
        createMockCtx("0", "shuffle"),
        "0",
        "deadbeef",
      );
      expect(badReveal).toBe(INVALID_MOVE);

      // Correct reveals
      const r0 = revealShuffleSeed(
        G,
        createMockCtx("0", "shuffle"),
        "0",
        seed0,
      );
      expect(r0).toBe(G);
      const r1 = revealShuffleSeed(
        G,
        createMockCtx("1", "shuffle"),
        "1",
        seed1,
      );
      expect(r1).toBe(G);

      // After both reveals, finalSeedHex should be derived
      expect((G as any).shuffleRng.finalSeedHex).toBeDefined();
      expect((G as any).shuffleRng.finalSeedHex.length).toBeGreaterThan(0);
    });

    it("shuffleEncryptedDeck allows each player to shuffle and deals starting hands", () => {
      // Prepare a shuffled-ready rng
      G.phase = "shuffle";
      G.encryptedZones.mainDeck = Array.from({ length: 30 }, (_, i) => ({
        ciphertext: `c${i}`,
        layers: 2,
      }));
      G.encryptedZones[`lifeDeck:0`] = Array.from({ length: 5 }, (_, i) => ({
        ciphertext: `l0-${i}`,
        layers: 2,
      }));
      G.encryptedZones[`lifeDeck:1`] = Array.from({ length: 5 }, (_, i) => ({
        ciphertext: `l1-${i}`,
        layers: 2,
      }));

      // Prepare rng with finalSeedHex and commit/reveal filled
      (G as any).shuffleRng = {
        phase: "ready",
        commits: { "0": "x", "1": "y" },
        reveals: { "0": "a", "1": "b" },
        finalSeedHex: sha256Hex(new TextEncoder().encode("final")),
        abortVotes: {},
      };

      // Ensure setupPlayerIndex is reset
      G.setupPlayerIndex = 0;

      // Player 0 shuffles
      const s0 = shuffleEncryptedDeck(G, createMockCtx("0", "shuffle"), "0");
      expect(s0).toBe(G);
      expect(G.players["0"].hasShuffled).toBe(true);
      // Still in shuffle until player1 acts
      expect(G.phase).toBe("shuffle");

      // Player 1 shuffles - should finish and move to play
      const s1 = shuffleEncryptedDeck(G, createMockCtx("1", "shuffle"), "1");
      expect(s1).toBe(G);
      expect(G.players["1"].hasShuffled).toBe(true);
      expect(G.phase).toBe("play");

      // Deal starting hands: each hand zone should have startingHand (default 5)
      expect(G.encryptedZones[`hand:0`].length).toBe(G.config.startingHand);
      expect(G.encryptedZones[`hand:1`].length).toBe(G.config.startingHand);
    });
  });
});
