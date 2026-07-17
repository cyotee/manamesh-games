/**
 * Residual R1: P2P / WebRTC identity MITM — modeled offline against
 * validatePlayerIdentity, authenticateCredentials, and production handlers.
 *
 * Transport-level WebRTC MITM is not simulated here; these tests assert the
 * game-layer peer-id / credential binding that must hold once a peer is seated.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import { validatePlayerIdentity } from "@manamesh/boardgameio-crypto/secp256k1";
import { decrypt } from "@manamesh/boardgameio-crypto/mental-poker";
import {
  runMentalPokerSetup,
  progressiveCoopPeekHand,
  mockCtx,
  TABLE_SIZES,
} from "./mentalPoker.harness";
import {
  CryptoPokerGame,
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  shuffleEncryptedDeck,
  peekHoleCards,
  approveDecrypt,
  submitDecryptedShare,
  releaseKey,
  voteAbortDecrypt,
  canAbortDecryptNow,
  validateCryptoMove,
  type CryptoPokerState,
} from "./crypto";
import type { PokerCard } from "./types";

const auth = CryptoPokerGame.authenticateCredentials!;

function seedPendingCommunity(G: CryptoPokerState, n: number) {
  G.phase = "flop";
  G.crypto.encryptedZones["community"] = Array.from({ length: 1 }, () => ({
    ciphertext: "02" + "ab".repeat(32),
    layers: n,
  }));
  G.decryptRequests.push({
    id: "p2p-community-1",
    requestingPlayer: "community",
    zoneId: "community",
    cardIndices: [0],
    timestamp: 0,
    status: "pending",
    approvals: Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`${i}`, false]),
    ),
    decryptionShares: {},
  } as any);
}

// ---------------------------------------------------------------------------
// R1a: validatePlayerIdentity binding primitive
// ---------------------------------------------------------------------------
describe("R1 P2P: validatePlayerIdentity peer binding", () => {
  it("rejects spoofed claim when ctx.playerID is set", () => {
    expect(validatePlayerIdentity("1", "0")).toBe(false);
    expect(validatePlayerIdentity("0", "1")).toBe(false);
    expect(validatePlayerIdentity("0", "0")).toBe(true);
  });

  it("rejects empty / non-string claimed playerId", () => {
    expect(validatePlayerIdentity("0", "")).toBe(false);
    expect(validatePlayerIdentity("0", undefined as any)).toBe(false);
    expect(validatePlayerIdentity("0", null as any)).toBe(false);
  });

  it("allows claim when ctx.playerID is undefined (trusted-host fallback)", () => {
    // Documented: host paths may omit ctx.playerID; modules should pass real sender.
    expect(validatePlayerIdentity(undefined, "0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R1b: authenticateCredentials shapes (multiplayer gate)
// ---------------------------------------------------------------------------
describe("R1 P2P: authenticateCredentials multiplayer gate", () => {
  it("rejects empty string credentials", () => {
    expect(auth("")).toBe(false);
  });

  it("rejects empty object credentials (non-matching / missing token shape)", () => {
    expect(auth({})).toBe(false);
  });

  it("allows undefined/null for pure local single-player", () => {
    expect(auth(undefined as any)).toBe(true);
    expect(auth(null as any)).toBe(true);
  });

  it("allows non-empty string and non-empty object credentials", () => {
    expect(auth("peer-token-abc")).toBe(true);
    expect(auth({ token: "x", playerId: "0" })).toBe(true);
  });

  it("rejects zero-ish primitives that multiplayer might accidentally pass", () => {
    expect(auth(0 as any)).toBe(false);
    expect(auth(false as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R1c: production handlers reject playerId ≠ ctx.playerID
// ---------------------------------------------------------------------------
describe.each(TABLE_SIZES)(
  "R1 P2P: production handlers reject identity MITM — %i players",
  (n) => {
    it("submitPublicKey / encryptDeck / shuffleEncryptedDeck reject spoof", async () => {
      const G = createCryptoInitialState({
        numPlayers: n,
        playerIDs: Array.from({ length: n }, (_, i) => `${i}`),
        options: {},
      });
      // keyExchange: player 1 claims to be 0
      const spoofKey = submitPublicKey(
        G,
        mockCtx("1", { numPlayers: n }),
        "0",
        "02" + "aa".repeat(32),
      );
      expect(spoofKey).toBe(INVALID_MOVE);

      const { G: setupG, players } = await runMentalPokerSetup({ numPlayers: n });
      // Already past encrypt/shuffle — re-check handlers still bind identity
      const enc = encryptDeck(
        setupG,
        mockCtx("1", { numPlayers: n }),
        "0",
        players[0].keys.privateKey,
      );
      expect(enc).toBe(INVALID_MOVE);

      const shuf = shuffleEncryptedDeck(
        setupG,
        mockCtx("1", { numPlayers: n }),
        "0",
        players[0].keys.privateKey,
      );
      expect(shuf).toBe(INVALID_MOVE);
    });

    it("peekHoleCards rejects spoofed playerId (cannot start opponent peek as self)", async () => {
      const { G } = await runMentalPokerSetup({ numPlayers: n });
      G.bettingRound.isComplete = true;
      const res = peekHoleCards(G, mockCtx("1", { numPlayers: n }), "0");
      expect(res).toBe(INVALID_MOVE);
      expect(G.decryptRequests.length).toBe(0);
      expect(G.players["0"].hasPeeked).toBe(false);
    });

    it("approveDecrypt / submitDecryptedShare / releaseKey / voteAbortDecrypt reject spoof", async () => {
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      G.bettingRound.isComplete = true;
      let state = peekHoleCards(
        G,
        mockCtx("0", { numPlayers: n }),
        "0",
      ) as CryptoPokerState;
      const req = state.decryptRequests.find((r) => r.zoneId === "hand:0")!;
      expect(req).toBeDefined();

      const zone = state.crypto.encryptedZones["hand:0"]!;
      const peels = req.cardIndices.map((idx) =>
        decrypt(zone[idx], players[1].keys.privateKey),
      );
      // ctx=1 claims player 0
      const adv = approveDecrypt(
        state,
        mockCtx("1", { numPlayers: n }),
        "0",
        req.id,
        peels,
      );
      expect(adv).toBe(INVALID_MOVE);
      expect(state.decryptRequests[0].approvals["0"]).toBe(true); // only auto-approve of real requester
      expect(state.decryptRequests[0].decryptionShares["0"]).toBeUndefined();

      seedPendingCommunity(state, n);
      const share = submitDecryptedShare(
        state,
        mockCtx("1", { numPlayers: n }),
        "0",
        { ciphertext: "02" + "cd".repeat(32), layers: n - 1 } as any,
        "community",
        0,
      );
      expect(share).toBe(INVALID_MOVE);

      const fakeCards: PokerCard[] = [
        { id: "hearts-A", rank: "A", suit: "hearts" } as PokerCard,
        { id: "spades-K", rank: "K", suit: "spades" } as PokerCard,
      ];
      const rel = releaseKey(
        state,
        mockCtx("1", { numPlayers: n }),
        "0",
        fakeCards,
      );
      expect(rel).toBe(INVALID_MOVE);
      expect(state.players["0"].keysReleased).toBe(false);

      // Stall window open, but spoofed abort fails
      const ctxStalled = mockCtx("1", { numPlayers: n, numMoves: 25 });
      expect(canAbortDecryptNow(state, ctxStalled)).toBe(true);
      const abort = voteAbortDecrypt(state, ctxStalled, "0");
      expect(abort).toBe(INVALID_MOVE);
      expect(state.phase).not.toBe("voided");
    });
  },
);

// ---------------------------------------------------------------------------
// R1d: validateCryptoMove + matching identity still allowed
// ---------------------------------------------------------------------------
describe("R1 P2P: matching identity accepted on validate path", () => {
  it("validateCryptoMove accepts matching playerID and rejects mismatch", async () => {
    const G = createCryptoInitialState({
      numPlayers: 2,
      playerIDs: ["0", "1"],
      options: {},
    });
    G.phase = "keyExchange";
    expect(
      validateCryptoMove(G, "submitPublicKey", "0", { playerID: "0" }).valid,
    ).toBe(true);
    expect(
      validateCryptoMove(G, "submitPublicKey", "0", { playerID: "1" }).valid,
    ).toBe(false);
    expect(
      validateCryptoMove(G, "submitPublicKey", "0", { playerID: "1" }).error,
    ).toBe("Player ID mismatch");
  });
});
