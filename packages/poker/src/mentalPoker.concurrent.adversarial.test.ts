/**
 * S3 — Concurrent / overlapping decrypt requests (adversarial).
 *
 * Product semantics (locked by these tests):
 * - Multiple pending decrypt requests may coexist (two hole peeks; hole + community).
 * - Completing request A does not complete request B.
 * - `voteAbortDecrypt` is **global**: rejects *all* pending requests and voids the hand
 *   (`phase = "voided"`). It does **not** clear already-completed peeks' `hasPeeked`.
 * - Completion order is independent: A then B vs B then A yield the same card ids.
 *
 * Real keys + production handlers only.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import { decrypt } from "@manamesh/boardgameio-crypto/mental-poker";
import {
  runMentalPokerSetup,
  progressiveCoopPeekHand,
  progressiveCoopPeekZone,
  tryRecoverWithKeys,
  mockCtx,
  type PlayerKeys,
} from "./mentalPoker.harness";
import {
  peekHoleCards,
  approveDecrypt,
  dealCommunityCards,
  submitDecryptedShare,
  voteAbortDecrypt,
  canAbortDecryptNow,
  POKER_DECRYPT_STALL_WINDOW_MOVES,
  type CryptoPokerState,
} from "./crypto";

const CONCURRENT_SIZES = [2, 3] as const;

function openHolePeek(
  G: CryptoPokerState,
  n: number,
  requesterId: string,
): CryptoPokerState {
  G.bettingRound.isComplete = true;
  const res = peekHoleCards(
    G,
    mockCtx(requesterId, { numPlayers: n }),
    requesterId,
  );
  if (res === INVALID_MOVE) throw new Error(`peekHoleCards failed for ${requesterId}`);
  return res as CryptoPokerState;
}

function completeHolePeekInPlace(
  G: CryptoPokerState,
  players: PlayerKeys[],
  requesterId: string,
): CryptoPokerState {
  const n = players.length;
  const req = G.decryptRequests.find(
    (r) => r.zoneId === `hand:${requesterId}` && r.status === "pending",
  );
  if (!req) throw new Error(`no pending peek for ${requesterId}`);
  let state = G;
  for (const p of players) {
    const zone = state.crypto.encryptedZones[`hand:${requesterId}`]!;
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
      throw new Error(`approveDecrypt failed for ${p.id} on hand:${requesterId}`);
    }
    state = res as CryptoPokerState;
  }
  return state;
}

function progressiveCommunityCard(
  G: CryptoPokerState,
  players: PlayerKeys[],
  cardIndex: number,
): CryptoPokerState {
  return progressiveCoopPeekZone(G, players, "community", [cardIndex]);
}

describe.each(CONCURRENT_SIZES)(
  "S3 concurrent decrypt requests — %i players",
  (n) => {
    it("S3.1: two concurrent hole peeks; complete A without completing B", async () => {
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      let state = openHolePeek(G, n, "0");
      state = openHolePeek(state, n, "1");

      const pendingHands = state.decryptRequests
        .filter((r) => r.status === "pending")
        .map((r) => r.zoneId);
      expect(pendingHands).toEqual(
        expect.arrayContaining([`hand:0`, `hand:1`]),
      );

      state = completeHolePeekInPlace(state, players, "0");

      expect(state.players["0"].hasPeeked).toBe(true);
      expect(state.players["0"].peekedCards.length).toBe(2);
      expect(state.players["1"].hasPeeked).toBe(false);
      expect(state.players["1"].peekedCards.length).toBe(0);

      const reqB = state.decryptRequests.find(
        (r) => r.zoneId === "hand:1" && r.status === "pending",
      );
      expect(reqB).toBeDefined();
      for (const c of state.crypto.encryptedZones["hand:1"]!) {
        // B may have received no peels yet → still N layers
        expect(c.layers).toBe(n);
      }
      for (const c of state.crypto.encryptedZones["hand:0"]!) {
        expect(c.layers).toBe(0);
      }
    });

    it("S3.2: community decrypt + hole peek; finish community without hole peeked", async () => {
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      let state = openHolePeek(G, n, "0");
      expect(state.players["0"].hasPeeked).toBe(false);

      dealCommunityCards(state, mockCtx("0", { numPlayers: n }), 3);
      expect(state.crypto.encryptedZones["community"]?.length).toBe(3);
      expect(
        state.decryptRequests.some(
          (r) =>
            r.zoneId === "community" &&
            r.status === "pending" &&
            r.cardIndices.includes(0),
        ),
      ).toBe(true);

      // Fully peel community card 0 only
      state = progressiveCommunityCard(state, players, 0);
      expect(state.crypto.encryptedZones["community"]![0].layers).toBe(0);

      // Hole peek still incomplete
      expect(state.players["0"].hasPeeked).toBe(false);
      const holeReq = state.decryptRequests.find(
        (r) => r.zoneId === "hand:0" && r.status === "pending",
      );
      expect(holeReq).toBeDefined();
      for (const c of state.crypto.encryptedZones["hand:0"]!) {
        expect(c.layers).toBe(n);
      }
    });

    it("S3.3: voteAbortDecrypt voids hand globally; keeps completed hasPeeked", async () => {
      /**
       * Product rule: abort is **hand/phase-global**, not per-request.
       * Completing seat 0 then aborting a stalled seat 1 request voids phase
       * and rejects remaining pending requests, but does not clear seat 0's peek.
       */
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      let state = progressiveCoopPeekHand(G, players, "0");
      expect(state.players["0"].hasPeeked).toBe(true);

      state = openHolePeek(state, n, "1");
      expect(state.players["1"].hasPeeked).toBe(false);

      const stalledCtx = mockCtx("0", {
        numPlayers: n,
        numMoves: POKER_DECRYPT_STALL_WINDOW_MOVES,
      });
      expect(canAbortDecryptNow(state, stalledCtx)).toBe(true);
      const aborted = voteAbortDecrypt(state, stalledCtx, "0");
      expect(aborted).not.toBe(INVALID_MOVE);
      const after = aborted as CryptoPokerState;

      expect(after.phase).toBe("voided");
      // Global: all pending rejected
      expect(
        after.decryptRequests
          .filter((r) => r.zoneId === "hand:1")
          .every((r) => r.status === "rejected"),
      ).toBe(true);
      // Completed peek preserved
      expect(after.players["0"].hasPeeked).toBe(true);
      expect(after.players["0"].peekedCards.length).toBe(2);
      expect(after.players["1"].hasPeeked).toBe(false);
    });

    it("S3.4: completion order independence (A then B vs B then A)", async () => {
      // Shuffle is randomized — clone the same post-setup state for both orders.
      const { G, players, lookup } = await runMentalPokerSetup({ numPlayers: n });
      const allKeys = players.map((p) => p.keys.privateKey);
      const expected0 = G.crypto.encryptedZones["hand:0"]!.map((c) =>
        tryRecoverWithKeys(c, allKeys, lookup)!,
      ).sort();
      const expected1 = G.crypto.encryptedZones["hand:1"]!.map((c) =>
        tryRecoverWithKeys(c, allKeys, lookup)!,
      ).sort();

      const clone = (): CryptoPokerState =>
        JSON.parse(JSON.stringify(G)) as CryptoPokerState;

      // Order A→B
      let a = openHolePeek(clone(), n, "0");
      a = openHolePeek(a, n, "1");
      a = completeHolePeekInPlace(a, players, "0");
      a = completeHolePeekInPlace(a, players, "1");

      // Order B→A
      let b = openHolePeek(clone(), n, "0");
      b = openHolePeek(b, n, "1");
      b = completeHolePeekInPlace(b, players, "1");
      b = completeHolePeekInPlace(b, players, "0");

      expect(a.players["0"].hasPeeked).toBe(true);
      expect(a.players["1"].hasPeeked).toBe(true);
      expect(b.players["0"].hasPeeked).toBe(true);
      expect(b.players["1"].hasPeeked).toBe(true);

      const idsA0 = a.players["0"].peekedCards.map((c) => c.id).sort();
      const idsA1 = a.players["1"].peekedCards.map((c) => c.id).sort();
      const idsB0 = b.players["0"].peekedCards.map((c) => c.id).sort();
      const idsB1 = b.players["1"].peekedCards.map((c) => c.id).sort();

      expect(idsA0).toEqual(idsB0);
      expect(idsA1).toEqual(idsB1);
      expect(idsA0).toEqual(expected0);
      expect(idsA1).toEqual(expected1);
      for (const id of [...idsA0, ...idsA1]) {
        expect(G.cardIds).toContain(id);
        expect(id).not.toBe("unknown");
      }
    });
  },
);

describe("S3 concurrent community isolation (N=2)", () => {
  it("finishing community card 0 does not complete community card 1", async () => {
    const { G, players } = await runMentalPokerSetup({ numPlayers: 2 });
    dealCommunityCards(G, mockCtx("0", { numPlayers: 2 }), 2);
    let state = progressiveCommunityCard(G, players, 0);
    expect(state.crypto.encryptedZones["community"]![0].layers).toBe(0);
    expect(state.crypto.encryptedZones["community"]![1].layers).toBe(2);
    const r1 = state.decryptRequests.find(
      (r) =>
        r.zoneId === "community" &&
        r.cardIndices.includes(1) &&
        r.status === "pending",
    );
    expect(r1).toBeDefined();
  });
});
