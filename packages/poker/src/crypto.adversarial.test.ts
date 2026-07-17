/**
 * Adversarial crypto tests (C1–C4) — drive SHIPPED move handlers.
 *
 * C1: validateCryptoMove + spoofed ctx (mirrors production identity binding).
 * C2: real `submitDecryptedShare` / `approveDecrypt` with invalid EncryptedCard → INVALID_MOVE.
 * C3: real `voteAbortDecrypt` + `canAbortDecryptNow` → voided + buildHandResult.
 * C4: illegal phase / double-release via validateCryptoMove phase guards.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import type { Ctx } from "boardgame.io";
import {
  createCryptoInitialState,
  validateCryptoMove,
  buildHandResult,
  canAbortDecryptNow,
  submitDecryptedShare,
  approveDecrypt,
  voteAbortDecrypt,
  type CryptoPokerState,
} from "./crypto";
import type { GameConfig } from "@manamesh/frontend/src/game/modules/types";

function createTestGameConfig(numPlayers: number = 2): GameConfig {
  const playerIDs = Array.from({ length: numPlayers }, (_, i) => `${i}`);
  return { numPlayers, playerIDs, options: {} };
}

async function createCryptoTestState(numPlayers: number = 2): Promise<CryptoPokerState> {
  return createCryptoInitialState(createTestGameConfig(numPlayers));
}

function mockCtx(playerID: string, numMoves = 0): Ctx {
  return {
    numPlayers: 2,
    turn: 1,
    currentPlayer: playerID,
    playOrder: ["0", "1"],
    playOrderPos: playerID === "0" ? 0 : 1,
    phase: "play",
    playerID,
    numMoves,
  } as unknown as Ctx;
}

const SPOOF_CTX = { playerID: "1" } as const;

/** Pending community decrypt request that accept shares via submitDecryptedShare. */
function seedCommunityDecryptRequest(G: CryptoPokerState, cardIndex = 0) {
  const zoneId = "community";
  G.crypto.encryptedZones[zoneId] = [
    { ciphertext: "02" + "ab".repeat(32), layers: 2 },
  ];
  G.decryptRequests.push({
    id: "adv-community-1",
    requestingPlayer: "community",
    zoneId,
    cardIndices: [cardIndex],
    timestamp: 0,
    status: "pending",
    approvals: { "0": false, "1": false },
    decryptionShares: {},
  } as any);
  return { zoneId, cardIndex, requestId: "adv-community-1" };
}

describe("C1: player identity spoofing", () => {
  const moves: Array<{ move: string; setup: (G: CryptoPokerState) => void }> = [
    {
      move: "submitPublicKey",
      setup: (G) => {
        G.phase = "keyExchange";
      },
    },
    {
      move: "encryptDeck",
      setup: (G) => {
        G.phase = "encrypt";
        G.setupPlayerIndex = 0;
      },
    },
    {
      move: "shuffleDeck",
      setup: (G) => {
        G.phase = "shuffle";
        G.setupPlayerIndex = 0;
      },
    },
    {
      move: "peekHoleCards",
      setup: (G) => {
        G.phase = "preflop";
        G.bettingRound.isComplete = true;
        G.players["0"].hasPeeked = false;
      },
    },
    {
      move: "requestDecrypt",
      setup: (G) => {
        G.phase = "flop";
        G.bettingRound.isComplete = true;
        G.players["0"].hasPeeked = false;
        G.players["0"].folded = false;
      },
    },
    {
      move: "approveDecrypt",
      setup: (G) => {
        G.phase = "flop";
      },
    },
    {
      move: "submitDecryptedShare",
      setup: (G) => {
        G.phase = "flop";
      },
    },
    {
      move: "releaseKey",
      setup: (G) => {
        G.phase = "preflop";
        G.players["0"].keysReleased = false;
      },
    },
    {
      move: "voteAbortDecrypt",
      setup: (G) => {
        G.phase = "flop";
      },
    },
  ];

  for (const { move, setup } of moves) {
    it(`C1 ${move} rejects playerId spoofing (claimed 0, ctx 1)`, async () => {
      const G = await createCryptoTestState(2);
      setup(G);
      const result = validateCryptoMove(G, move, "0", SPOOF_CTX);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Player ID mismatch");
    });
  }

  it("C1 submitDecryptedShare move rejects spoofed playerId", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "flop";
    const { zoneId, cardIndex } = seedCommunityDecryptRequest(G);
    const badCard = { ciphertext: "02" + "cd".repeat(32), layers: 1 };
    // ctx says player 1, args claim player 0
    const result = submitDecryptedShare(G, mockCtx("1"), "0", badCard as any, zoneId, cardIndex);
    expect(result).toBe(INVALID_MOVE);
    expect(G.decryptRequests[0].approvals["0"]).toBe(false);
  });

  it("C1 peekHoleCards allows matching identity", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "preflop";
    G.bettingRound.isComplete = true;
    G.players["0"].hasPeeked = false;
    const result = validateCryptoMove(G, "peekHoleCards", "0", { playerID: "0" });
    expect(result.valid).toBe(true);
  });
});

describe("C2: invalid decrypt-share material on real move path", () => {
  it("submitDecryptedShare rejects malformed ciphertext (INVALID_MOVE, no approval)", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "flop";
    const { zoneId, cardIndex } = seedCommunityDecryptRequest(G);

    // "00" is the identity point and may pass point parsing; use clear garbage.
    const invalid = { ciphertext: "deadbeef", layers: 1 } as any;
    const result = submitDecryptedShare(G, mockCtx("0"), "0", invalid, zoneId, cardIndex);

    expect(result).toBe(INVALID_MOVE);
    expect(G.decryptRequests[0].status).toBe("pending");
    expect(G.decryptRequests[0].approvals["0"]).toBe(false);
    expect(G.decryptRequests[0].decryptionShares["0"]).toBeUndefined();
  });

  it("submitDecryptedShare rejects non-point ciphertext", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "flop";
    const { zoneId, cardIndex } = seedCommunityDecryptRequest(G);

    const invalid = { ciphertext: "not-a-point", layers: 1 } as any;
    const result = submitDecryptedShare(G, mockCtx("1"), "1", invalid, zoneId, cardIndex);

    expect(result).toBe(INVALID_MOVE);
    expect(G.decryptRequests[0].approvals["1"]).toBe(false);
  });

  it("approveDecrypt rejects invalid encrypted card (INVALID_MOVE, no approval)", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "flop";
    G.decryptRequests.push({
      id: "adv-peek-req",
      requestingPlayer: "0",
      zoneId: "hand:0",
      cardIndices: [0],
      timestamp: 0,
      status: "pending",
      approvals: { "0": true, "1": false },
      decryptionShares: {},
    } as any);

    const invalid = { ciphertext: "00", layers: -1 } as any;
    // Multi-index request needs parallel peels
    const result = approveDecrypt(G, mockCtx("1"), "1", "adv-peek-req", [
      invalid,
    ]);

    expect(result).toBe(INVALID_MOVE);
    expect(G.decryptRequests[0].status).toBe("pending");
    expect(G.decryptRequests[0].approvals["1"]).toBe(false);
    expect(G.decryptRequests[0].decryptionShares["1"]).toBeUndefined();
  });
});

describe("C3: real voteAbortDecrypt stall path", () => {
  it("canAbortDecryptNow is false before stall window", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "flop";
    G.decryptRequests.push({
      id: "stall-early",
      requestingPlayer: "0",
      zoneId: "hand:0",
      cardIndices: [0],
      timestamp: 0,
      status: "pending",
      approvals: { "0": true, "1": false },
      decryptionShares: {},
    } as any);

    expect(canAbortDecryptNow(G, mockCtx("1", 5))).toBe(false);
    const tooEarly = voteAbortDecrypt(G, mockCtx("1", 5), "1");
    expect(tooEarly).toBe(INVALID_MOVE);
    expect(G.phase).toBe("flop");
    expect(G.decryptRequests[0].status).toBe("pending");
  });

  it("voteAbortDecrypt voids hand and sets abortedDecrypt for refusers", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "flop";
    G.bettingRound.isComplete = true;
    G.crypto.encryptedZones["hand:0"] = [{ ciphertext: "02" + "a".repeat(64), layers: 2 }];

    G.decryptRequests.push({
      id: "adv-stall-1",
      requestingPlayer: "0",
      zoneId: "hand:0",
      cardIndices: [0],
      timestamp: 0,
      status: "pending",
      approvals: { "0": true, "1": false },
      decryptionShares: {},
    } as any);

    const ctxStalled = mockCtx("1", 25);
    expect(canAbortDecryptNow(G, ctxStalled)).toBe(true);

    const result = voteAbortDecrypt(G, ctxStalled, "1");
    expect(result).not.toBe(INVALID_MOVE);
    const next = result as CryptoPokerState;

    expect(next.phase).toBe("voided");
    expect(next.decryptRequests[0].status).toBe("rejected");
    expect((next.players["1"] as any).abortedDecrypt).toBe(true);
    // Player 0 approved — not a refuser
    expect((next.players["0"] as any).abortedDecrypt).toBeFalsy();

    const handResult = buildHandResult(next);
    expect(handResult.abortedDecrypt).toBe(true);
    expect(handResult.refusers).toContain("1");
    expect(handResult.winners.length).toBe(0);
  });

  it("voteAbortDecrypt rejects identity spoof on real handler", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "flop";
    G.decryptRequests.push({
      id: "adv-stall-spoof",
      requestingPlayer: "0",
      zoneId: "hand:0",
      cardIndices: [0],
      timestamp: 0,
      status: "pending",
      approvals: { "0": true, "1": false },
      decryptionShares: {},
    } as any);

    const result = voteAbortDecrypt(G, mockCtx("1", 25), "0" /* spoof */);
    expect(result).toBe(INVALID_MOVE);
    expect(G.phase).toBe("flop");
    expect(G.decryptRequests[0].status).toBe("pending");
  });
});

describe("C4: illegal phase and double-release", () => {
  it("rejects releaseKey when already released", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "preflop";
    G.players["0"].keysReleased = true;
    const result = validateCryptoMove(G, "releaseKey", "0");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Keys already released");
  });

  it("rejects releaseKey outside betting phases", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "showdown";
    G.players["0"].keysReleased = false;
    const result = validateCryptoMove(G, "releaseKey", "0");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Cannot release keys now");
  });

  it("rejects peekHoleCards while betting incomplete", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "preflop";
    G.bettingRound.isComplete = false;
    G.bettingRound.actedPlayers = ["0"];
    G.players["0"].hasPeeked = false;
    const result = validateCryptoMove(G, "peekHoleCards", "0");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Betting round not complete");
  });

  it("rejects submitPublicKey outside keyExchange", async () => {
    const G = await createCryptoTestState(2);
    G.phase = "preflop";
    const result = validateCryptoMove(G, "submitPublicKey", "0");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Not in key exchange phase");
  });
});
