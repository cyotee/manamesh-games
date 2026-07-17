/**
 * Mental-poker privacy adversarial tests (M2, M5, M6, M8, M9, M12)
 * for table sizes 2–5. Real keys + production handlers only.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import { decrypt } from "@manamesh/boardgameio-crypto/mental-poker";
import {
  runMentalPokerSetup,
  tryRecoverWithKeys,
  assertProperSubsetsCannotRecover,
  mockCtx,
  TABLE_SIZES,
} from "./mentalPoker.harness";
import {
  peekHoleCards,
  approveDecrypt,
  submitDecryptedShare,
} from "./crypto";

describe.each(TABLE_SIZES)("Mental poker privacy — %i players", (n) => {
  it("M5: other players cannot recover hand:0 with only their own private key", async () => {
    const { G, players, lookup } = await runMentalPokerSetup({ numPlayers: n });
    for (let a = 1; a < n; a++) {
      const attacker = players[a];
      for (const card of G.crypto.encryptedZones["hand:0"]!) {
        expect(
          tryRecoverWithKeys(card, [attacker.keys.privateKey], lookup),
        ).toBeNull();
        const peeled = decrypt(card, attacker.keys.privateKey);
        expect(peeled.layers).toBe(n - 1);
        expect(peeled.layers).toBeGreaterThan(0);
      }
    }
  });

  it("M6: undealt deck unreadable with any single key", async () => {
    const { G, players, lookup } = await runMentalPokerSetup({ numPlayers: n });
    const deck = G.crypto.encryptedZones["deck"] ?? [];
    expect(deck.length).toBe(52 - 2 * n);
    // Sample first 5 deck cards for speed at larger N
    const sample = deck.slice(0, 5);
    for (const card of sample) {
      for (const p of players) {
        expect(
          tryRecoverWithKeys(card, [p.keys.privateKey], lookup),
        ).toBeNull();
      }
    }
  });

  it("M2+M7+M12: full key set recovers; any proper subset fails", async () => {
    const { G, players, lookup } = await runMentalPokerSetup({ numPlayers: n });
    const card = G.crypto.encryptedZones["hand:1"]![0];
    const allKeys = players.map((p) => p.keys.privateKey);

    assertProperSubsetsCannotRecover(card, allKeys, lookup);

    const full = tryRecoverWithKeys(card, allKeys, lookup);
    expect(full).not.toBeNull();
    expect(G.cardIds).toContain(full!);
  });

  it("M8: peekHoleCards for player0 only targets hand:0", async () => {
    const { G } = await runMentalPokerSetup({ numPlayers: n });
    G.bettingRound.isComplete = true;
    G.bettingRound.actedPlayers = [];

    const res = peekHoleCards(G, mockCtx("0", { numPlayers: n }), "0");
    expect(res).not.toBe(INVALID_MOVE);
    const next = res as typeof G;
    expect(next.decryptRequests.length).toBeGreaterThan(0);
    const req = next.decryptRequests[next.decryptRequests.length - 1];
    expect(req.zoneId).toBe("hand:0");
    expect(req.requestingPlayer).toBe("0");
  });

  it("M5b: single attacker share does not complete opponent hand", async () => {
    const { G, players } = await runMentalPokerSetup({ numPlayers: n });
    G.bettingRound.isComplete = true;

    const afterPeek = peekHoleCards(G, mockCtx("0", { numPlayers: n }), "0");
    expect(afterPeek).not.toBe(INVALID_MOVE);
    const state = afterPeek as typeof G;
    const req = state.decryptRequests.find(
      (r) => r.zoneId === "hand:0" && r.status === "pending",
    )!;
    expect(req).toBeDefined();

    const zone = state.crypto.encryptedZones["hand:0"]!;
    const attacker = players[1];
    const peels = req.cardIndices.map((idx) => {
      const peeled = decrypt(zone[idx], attacker.keys.privateKey);
      expect(peeled.layers).toBe(n - 1);
      return peeled;
    });

    const approved = approveDecrypt(
      state,
      mockCtx("1", { numPlayers: n }),
      "1",
      req.id,
      peels,
    );
    expect(approved).not.toBe(INVALID_MOVE);
    const after = approved as typeof G;
    const updated = after.decryptRequests.find((r) => r.id === req.id)!;

    expect(after.players["0"].hasPeeked).toBe(false);
    expect(after.players["0"].peekedCards.length).toBe(0);
    expect(updated.status).toBe("pending");
    // Progressive peels apply immediately: one honest share reduces each card by 1 layer.
    // Privacy holds: cards remain multi-layer (n-1 >= 1 for n>=2) and hasPeeked stays false.
    for (const c of after.crypto.encryptedZones["hand:0"]!) {
      expect(c.layers).toBe(n - 1);
      expect(c.layers).toBeGreaterThan(0);
    }
  });

  it("M9: garbage share is INVALID_MOVE and does not grant approval", async () => {
    const { G } = await runMentalPokerSetup({ numPlayers: n });
    G.crypto.encryptedZones["community"] = [
      { ...G.crypto.encryptedZones["deck"]![0] },
    ];
    const approvals: Record<string, boolean> = {};
    for (let i = 0; i < n; i++) approvals[`${i}`] = false;
    G.decryptRequests.push({
      id: `adv-community-m9-${n}`,
      requestingPlayer: "community",
      zoneId: "community",
      cardIndices: [0],
      timestamp: 0,
      status: "pending",
      approvals,
      decryptionShares: {},
    } as any);

    const layersBefore = G.crypto.encryptedZones["community"][0].layers;
    const invalid = { ciphertext: "deadbeef", layers: 1 } as any;
    const result = submitDecryptedShare(
      G,
      mockCtx("0", { numPlayers: n }),
      "0",
      invalid,
      "community",
      0,
    );
    expect(result).toBe(INVALID_MOVE);
    expect(
      G.decryptRequests.find((r) => r.id === `adv-community-m9-${n}`)!.approvals[
        "0"
      ],
    ).toBe(false);
    expect(G.crypto.encryptedZones["community"][0].layers).toBe(layersBefore);
  });
});
