/**
 * Mental-poker honest workflow (M4, M7, M10, M11) for table sizes 2–5.
 * Drives production handlers via mentalPoker.harness.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import { decrypt } from "@manamesh/boardgameio-crypto/mental-poker";
import { normalizeSecp256k1PublicKey } from "@manamesh/boardgameio-crypto/keychain";
import {
  runMentalPokerSetup,
  assertNoPrivateKeysInSharedState,
  tryRecoverWithKeys,
  mockCtx,
  TABLE_SIZES,
} from "./mentalPoker.harness";
import { peekHoleCards, approveDecrypt } from "./crypto";

describe.each(TABLE_SIZES)("Mental poker workflow — %i players", (n) => {
  it(`M4: setup yields ${n}-layer encrypted hole cards after encrypt/shuffle/deal`, async () => {
    const { G, players, numPlayers } = await runMentalPokerSetup({ numPlayers: n });
    expect(players).toHaveLength(n);
    expect(numPlayers).toBe(n);
    expect(G.phase).toBe("preflop");

    for (let i = 0; i < n; i++) {
      const zone = `hand:${i}`;
      expect(G.crypto.encryptedZones[zone]?.length).toBe(2);
      for (const c of G.crypto.encryptedZones[zone]!) {
        expect(c.layers).toBe(n);
        expect(c.ciphertext).toBeTruthy();
        expect(c.ciphertext.length).toBeGreaterThan(8);
      }
    }

    const deck = G.crypto.encryptedZones["deck"] ?? [];
    expect(deck.length).toBe(52 - 2 * n);
    for (const c of deck) {
      expect(c.layers).toBe(n);
    }
  });

  it("M10: private keys are not in shared G", async () => {
    const { G, players } = await runMentalPokerSetup({ numPlayers: n });
    assertNoPrivateKeysInSharedState(
      G,
      players.map((p) => p.keys.privateKey),
    );
    for (const p of players) {
      // Keychain stores canonical compressed form (may differ from generateKeyPair encoding).
      expect(G.players[p.id].publicKey).toBe(
        normalizeSecp256k1PublicKey(p.keys.publicKey),
      );
    }
  });

  it("M11: shuffle does not strip encryption layers", async () => {
    const { G } = await runMentalPokerSetup({ numPlayers: n });
    const allZones = Object.values(G.crypto.encryptedZones).flat();
    for (const c of allZones) {
      expect(c.layers).toBe(n);
    }
  });

  it("M7: cooperative peel of own hole card recovers a deck card id", async () => {
    const { G, players, lookup } = await runMentalPokerSetup({ numPlayers: n });
    const card = { ...G.crypto.encryptedZones["hand:0"]![0] };
    const allKeys = players.map((p) => p.keys.privateKey);

    // Peel all keys in reverse order (commutativity)
    let cur = { ...card };
    for (let i = players.length - 1; i >= 0; i--) {
      expect(cur.layers).toBe(i + 1);
      cur = decrypt(cur, players[i].keys.privateKey);
    }
    expect(cur.layers).toBe(0);

    const id = tryRecoverWithKeys(card, allKeys, lookup);
    expect(id).not.toBeNull();
    expect(G.cardIds).toContain(id!);
  });

  it("M7-moves: peek + multi-player approveDecrypt stays privacy-safe for incomplete peels", async () => {
    const { G, players } = await runMentalPokerSetup({ numPlayers: n });
    G.bettingRound.isComplete = true;

    let state = peekHoleCards(G, mockCtx("0", { numPlayers: n }), "0");
    expect(state).not.toBe(INVALID_MOVE);
    state = state as typeof G;
    const req = state.decryptRequests.find((r) => r.zoneId === "hand:0")!;
    expect(req).toBeDefined();

    // Each player peels all requested hole cards once from *current* zone
    for (const p of players) {
      const zone = state.crypto.encryptedZones["hand:0"]!;
      const peels = req.cardIndices.map((idx) => decrypt(zone[idx], p.keys.privateKey));
      expect(peels[0].layers).toBeLessThan(n);
      const next = approveDecrypt(
        state,
        mockCtx(p.id, { numPlayers: n }),
        p.id,
        req.id,
        peels,
      );
      expect(next).not.toBe(INVALID_MOVE);
      state = next as typeof G;
    }

    // Single peel per player is not a full multi-layer reveal of both cards
    expect(state.players["1"]?.hasPeeked ?? false).toBe(false);
    // Opponents other than requester
    for (let i = 1; i < n; i++) {
      expect(state.players[`${i}`].hasPeeked).toBe(false);
      expect(state.players[`${i}`].peekedCards.length).toBe(0);
    }

    if (state.players["0"].hasPeeked) {
      for (const c of state.players["0"].peekedCards) {
        expect(c.id).not.toBe("unknown");
        expect(G.cardIds).toContain(c.id);
      }
    } else {
      expect(state.decryptRequests.find((r) => r.id === req.id)!.status).toBe(
        "pending",
      );
    }
  });
});
