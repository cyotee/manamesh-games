/**
 * S2 — Wrong / out-of-order progressive peels (adversarial).
 *
 * Real keys + production handlers only. Malicious-but-well-formed peels must
 * not complete an opponent hand or grant hasPeeked with wrong card ids.
 *
 * Product notes (aligned with M5b):
 * - A correct single-key peel reduces layers by 1 and may update the zone.
 * - Privacy still holds while layers > 0 and hasPeeked stays false.
 * - Completion requires all players' shares and layers === 0 with lookup hits.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import { decrypt } from "@manamesh/boardgameio-crypto/mental-poker";
import {
  runMentalPokerSetup,
  progressiveCoopPeekHand,
  tryRecoverWithKeys,
  mockCtx,
} from "./mentalPoker.harness";
import {
  peekHoleCards,
  approveDecrypt,
  type CryptoPokerState,
} from "./crypto";

const PEEL_TABLE_SIZES = [2, 3] as const;

function openPeek(
  G: CryptoPokerState,
  n: number,
  requesterId = "0",
): { state: CryptoPokerState; reqId: string; zoneId: string } {
  G.bettingRound.isComplete = true;
  const afterPeek = peekHoleCards(
    G,
    mockCtx(requesterId, { numPlayers: n }),
    requesterId,
  );
  expect(afterPeek).not.toBe(INVALID_MOVE);
  const state = afterPeek as CryptoPokerState;
  const zoneId = `hand:${requesterId}`;
  const req = state.decryptRequests.find(
    (r) => r.zoneId === zoneId && r.status === "pending",
  );
  expect(req).toBeDefined();
  return { state, reqId: req!.id, zoneId };
}

function zoneLayers(G: CryptoPokerState, zoneId: string): number[] {
  return (G.crypto.encryptedZones[zoneId] ?? []).map((c) => c.layers);
}

describe.each(PEEL_TABLE_SIZES)(
  "S2 wrong/out-of-order progressive peels — %i players",
  (n) => {
    it("S2.1: peel with another player's key (wrong layer) → hasPeeked false, not completed", async () => {
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      const { state, reqId, zoneId } = openPeek(G, n, "0");
      const layersBefore = zoneLayers(state, zoneId);

      // Attacker (seat 1) peels seat 0's hand with attacker's own key — valid SRA peel, wrong sole authority
      const attacker = players[1];
      const zone = state.crypto.encryptedZones[zoneId]!;
      const peels = [0, 1].map((idx) =>
        decrypt(zone[idx], attacker.keys.privateKey),
      );
      // Wrong-key peels still reduce layers by 1 (SRA); assert progress + no completion
      for (const p of peels) {
        expect(p.layers).toBe(n - 1);
      }

      const approved = approveDecrypt(
        state,
        mockCtx("1", { numPlayers: n }),
        "1",
        reqId,
        peels,
      );
      expect(approved).not.toBe(INVALID_MOVE);
      const after = approved as CryptoPokerState;
      const req = after.decryptRequests.find((r) => r.id === reqId)!;

      expect(after.players["0"].hasPeeked).toBe(false);
      expect(after.players["0"].peekedCards.length).toBe(0);
      expect(req.status).toBe("pending");
      // Zone may reduce by 1 under progressive peels — privacy holds while layers > 0
      for (const c of after.crypto.encryptedZones[zoneId]!) {
        expect(c.layers).toBe(n - 1);
        expect(c.layers).toBeGreaterThan(0);
      }
      expect(zoneLayers(after, zoneId).every((l, i) => l <= layersBefore[i])).toBe(
        true,
      );
    });

    it("S2.2: identity / no-progress peel cannot complete reveal", async () => {
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      const { state, reqId, zoneId } = openPeek(G, n, "0");
      const layersBefore = zoneLayers(state, zoneId);
      const zone = state.crypto.encryptedZones[zoneId]!;

      // Identity shares: same ciphertext + same layers (well-formed, no progress)
      const identity = zone.map((c) => ({
        ciphertext: c.ciphertext,
        layers: c.layers,
      }));

      // All seats submit identity peels
      let cur = state;
      for (const p of players) {
        const res = approveDecrypt(
          cur,
          mockCtx(p.id, { numPlayers: n }),
          p.id,
          reqId,
          identity,
        );
        // Product: may accept as approval (no layer progress) or INVALID_MOVE
        if (res === INVALID_MOVE) {
          expect(cur.players["0"].hasPeeked).toBe(false);
          return;
        }
        cur = res as CryptoPokerState;
      }

      const req = cur.decryptRequests.find((r) => r.id === reqId)!;
      expect(cur.players["0"].hasPeeked).toBe(false);
      expect(req.status).toBe("pending");
      expect(zoneLayers(cur, zoneId)).toEqual(layersBefore);
    });

    it("S2.3: increased layers or garbage EncryptedCard → INVALID_MOVE, no approval", async () => {
      const { G } = await runMentalPokerSetup({ numPlayers: n });
      const { state, reqId, zoneId } = openPeek(G, n, "0");
      const zone = state.crypto.encryptedZones[zoneId]!;
      const layersBefore = zoneLayers(state, zoneId);
      const reqBefore = state.decryptRequests.find((r) => r.id === reqId)!;

      // Garbage ciphertext (not a curve point)
      const garbage = { ciphertext: "deadbeef", layers: 1 };
      const gRes = approveDecrypt(
        state,
        mockCtx("1", { numPlayers: n }),
        "1",
        reqId,
        [garbage, garbage] as any,
      );
      expect(gRes).toBe(INVALID_MOVE);
      expect(reqBefore.approvals["1"]).toBe(false);
      expect(reqBefore.decryptionShares["1"]).toBeUndefined();
      expect(zoneLayers(state, zoneId)).toEqual(layersBefore);

      // Increased layers with valid curve point shape (reuse real ciphertext)
      const increased = zone.map((c) => ({
        ciphertext: c.ciphertext,
        layers: c.layers + 2,
      }));
      const iRes = approveDecrypt(
        state,
        mockCtx("1", { numPlayers: n }),
        "1",
        reqId,
        increased,
      );
      // Must not complete; prefer INVALID_MOVE and no approval
      if (iRes === INVALID_MOVE) {
        expect(reqBefore.approvals["1"]).toBe(false);
        expect(reqBefore.decryptionShares["1"]).toBeUndefined();
      } else {
        const after = iRes as CryptoPokerState;
        expect(after.players["0"].hasPeeked).toBe(false);
        const req = after.decryptRequests.find((r) => r.id === reqId)!;
        expect(req.status).toBe("pending");
        // Zone layers must not increase
        for (let i = 0; i < layersBefore.length; i++) {
          expect(after.crypto.encryptedZones[zoneId]![i].layers).toBe(
            layersBefore[i],
          );
        }
      }
    });

    it("S2.4: swapped multi-card array recovers same multiset; duplicated slot cannot forge foreign ids", async () => {
      // (a) Full swap of correct peels — SRA commutative; hole cards unordered multiset.
      // Compare against tryRecoverWithKeys on the *same* pre-peel zone (shuffle is random).
      const { G, players, lookup } = await runMentalPokerSetup({ numPlayers: n });
      const zoneId = "hand:0";
      const allKeys = players.map((p) => p.keys.privateKey);
      const expectedIds = G.crypto.encryptedZones[zoneId]!.map((c) => {
        const id = tryRecoverWithKeys(c, allKeys, lookup);
        expect(id).not.toBeNull();
        return id!;
      }).sort();

      const { state, reqId } = openPeek(G, n, "0");
      let cur = state;
      let rejected = false;
      for (const p of players) {
        const zone = cur.crypto.encryptedZones[zoneId]!;
        const peel0 = decrypt(zone[0], p.keys.privateKey);
        const peel1 = decrypt(zone[1], p.keys.privateKey);
        const res = approveDecrypt(
          cur,
          mockCtx(p.id, { numPlayers: n }),
          p.id,
          reqId,
          [peel1, peel0],
        );
        if (res === INVALID_MOVE) {
          rejected = true;
          break;
        }
        cur = res as CryptoPokerState;
      }
      if (!rejected && cur.players["0"].hasPeeked) {
        const swappedIds = cur.players["0"].peekedCards.map((c) => c.id).sort();
        expect(swappedIds).toEqual(expectedIds);
        for (const id of swappedIds) {
          expect(id).not.toBe("unknown");
          expect(G.cardIds).toContain(id);
        }
      } else if (!rejected) {
        expect(cur.players["0"].hasPeeked).toBe(false);
      }

      // (b) Duplicate peel of card[0] into both slots — must not invent foreign ids.
      const dupSetup = await runMentalPokerSetup({ numPlayers: n });
      const opened = openPeek(dupSetup.G, n, "0");
      let d = opened.state;
      for (const p of dupSetup.players) {
        const zone = d.crypto.encryptedZones[opened.zoneId]!;
        const peel0 = decrypt(zone[0], p.keys.privateKey);
        const res = approveDecrypt(
          d,
          mockCtx(p.id, { numPlayers: n }),
          p.id,
          opened.reqId,
          [peel0, peel0],
        );
        if (res === INVALID_MOVE) {
          expect(d.players["0"].hasPeeked).toBe(false);
          return;
        }
        d = res as CryptoPokerState;
      }
      if (d.players["0"].hasPeeked) {
        for (const c of d.players["0"].peekedCards) {
          expect(c.id).not.toBe("unknown");
          expect(dupSetup.G.cardIds).toContain(c.id);
        }
        expect(d.players["0"].peekedCards.length).toBe(2);
      } else {
        expect(
          d.decryptRequests.find((r) => r.id === opened.reqId)!.status,
        ).toBe("pending");
      }
    });

    it("S2.5: double-submit after partial progress → INVALID_MOVE", async () => {
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      const { state, reqId, zoneId } = openPeek(G, n, "0");

      const p0 = players[0];
      const zone = state.crypto.encryptedZones[zoneId]!;
      const peels = [0, 1].map((idx) =>
        decrypt(zone[idx], p0.keys.privateKey),
      );

      const first = approveDecrypt(
        state,
        mockCtx(p0.id, { numPlayers: n }),
        p0.id,
        reqId,
        peels,
      );
      expect(first).not.toBe(INVALID_MOVE);
      const after = first as CryptoPokerState;
      const req = after.decryptRequests.find((r) => r.id === reqId)!;
      expect(req.approvals[p0.id]).toBe(true);
      expect(req.decryptionShares[p0.id]).toBeDefined();
      expect(after.players["0"].hasPeeked).toBe(false);

      // Same player re-submits after partial progress
      const zone2 = after.crypto.encryptedZones[zoneId]!;
      const peels2 = [0, 1].map((idx) =>
        decrypt(zone2[idx], p0.keys.privateKey),
      );
      const second = approveDecrypt(
        after,
        mockCtx(p0.id, { numPlayers: n }),
        p0.id,
        reqId,
        peels2,
      );
      expect(second).toBe(INVALID_MOVE);
      expect(after.players["0"].hasPeeked).toBe(false);
      expect(req.status).toBe("pending");
    });

    it("S2.6: honest progressive peels still complete after attacker-only partial fail", async () => {
      // Sanity: attack path does not brick cooperative completion when starting fresh
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      const after = progressiveCoopPeekHand(G, players, "0");
      expect(after.players["0"].hasPeeked).toBe(true);
      expect(after.players["0"].peekedCards.length).toBe(2);
      for (const c of after.players["0"].peekedCards) {
        expect(c.id).not.toBe("unknown");
        expect(G.cardIds).toContain(c.id);
      }
    });
  },
);

describe("S2 layer-jump garbage (layers:0 skip) cannot forge completion", () => {
  it("attacker layers:0 valid point without full coop → hasPeeked false", async () => {
    const { G, players } = await runMentalPokerSetup({ numPlayers: 2 });
    const { state, reqId, zoneId } = openPeek(G, 2, "0");
    const zone = state.crypto.encryptedZones[zoneId]!;

    // Forge a "fully peeled" share using a random valid keypair point-looking ciphertext:
    // use real zone ciphertext but claim layers 0 (skip remaining peels).
    // If accepted, zone may corrupt; completion still requires all seats + lookup.
    const forged = zone.map((c) => ({
      ciphertext: c.ciphertext,
      layers: 0,
    }));

    const res = approveDecrypt(
      state,
      mockCtx("1", { numPlayers: 2 }),
      "1",
      reqId,
      forged,
    );
    if (res === INVALID_MOVE) {
      expect(state.players["0"].hasPeeked).toBe(false);
      return;
    }
    const after = res as CryptoPokerState;
    // Only one seat shared — cannot complete
    expect(after.players["0"].hasPeeked).toBe(false);
    const req = after.decryptRequests.find((r) => r.id === reqId)!;
    expect(req.status).toBe("pending");

    // Even if p0 also "shares" the same forge, layers 0 ciphertext is still multi-layer
    // encrypted point — lookup should fail → no hasPeeked
    const res0 = approveDecrypt(
      after,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      reqId,
      forged,
    );
    if (res0 !== INVALID_MOVE) {
      const done = res0 as CryptoPokerState;
      // Lookup fails on multi-layer ciphertext forced to layers:0 → no hasPeeked
      expect(done.players["0"].hasPeeked).toBe(false);
    }

    // Honest path on a fresh hand still works
    const { G: G2, players: p2 } = await runMentalPokerSetup({ numPlayers: 2 });
    const honest = progressiveCoopPeekHand(G2, p2, "0");
    expect(honest.players["0"].hasPeeked).toBe(true);
    void players;
  });
});
