import { describe, it, expect } from "vitest";
import { playAction } from "../../play";
import { startPeekReveal, submitDecryptionShare } from "../../crypto";
import { makeCard, makeState, putInHand } from "../testFixtures";

const FT = [
  "play:peek",
  "peek:own-deck:3",
  "to-hand:choose:1",
  "target:choose:opponent",
  "peek:opponent-deck:3",
  "discard:opponent-deck-card",
];

describe("Fortune Teller peek decrypt must not stall", () => {
  it("plain layers=0 tops complete immediately and open choose prompt", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.phase = "play";
    G.config = { ...G.config, playMode: "mental-poker" } as any;
    // Mix: plain tops + one "encrypted" deeper card so deckHasEncryption is true
    G.encryptedDecks["0"] = [
      { ciphertext: "a#0", layers: 0 },
      { ciphertext: "b#0", layers: 0 },
      { ciphertext: "c#0", layers: 0 },
      { ciphertext: "enc#0", layers: 2 },
    ];
    G.cards = {};
    for (const id of ["a#0", "b#0", "c#0", "enc#0"]) {
      G.cards[id] = makeCard({ id, ownerId: "0", name: id });
    }
    putInHand(
      G,
      "0",
      makeCard({
        id: "medieval-fortune-teller#0",
        name: "Fortune Teller",
        ownerId: "0",
        cardType: "action",
        tags: FT,
      }),
    );

    playAction(G, { currentPlayer: "0" } as any, "0", "medieval-fortune-teller#0", {});

    // Should not be stuck at decrypt 0/3
    expect(G.activeDeckOp?.phase === "decrypt").toBe(false);
    expect(G.pendingPrompts?.[0]?.reason).toBe("peek:own-to-hand");
    expect(G.pendingPrompts?.[0]?.options).toEqual(
      expect.arrayContaining(["a#0", "b#0", "c#0", "__none__"]),
    );
  });

  it("submitDecryptionShare materializes plain target without peeling", () => {
    const G = makeState({ players: ["0", "1"] });
    G.phase = "play";
    G.encryptedDecks["0"] = [
      { ciphertext: "x#0", layers: 0 },
      { ciphertext: "y#0", layers: 0 },
      { ciphertext: "enc#0", layers: 2 },
    ];
    G.cards = {
      "x#0": makeCard({ id: "x#0", ownerId: "0" }),
      "y#0": makeCard({ id: "y#0", ownerId: "0" }),
      "enc#0": makeCard({ id: "enc#0", ownerId: "0" }),
    };

    // Force encrypted path by having deeper layers, but only need 2 plain tops
    startPeekReveal(G, "0", "ft#0", 2, {
      allowNone: true,
      reason: "peek:own-to-hand",
      deciderId: "0",
    });

    // Plain tops should have been drained without pending peels
    expect(G.pendingPrompts?.[0]?.reason).toBe("peek:own-to-hand");
    expect(G.activeDeckOp?.phase).not.toBe("decrypt");
    expect(G.pendingPrompts?.[0]?.options).toEqual(
      expect.arrayContaining(["x#0", "y#0", "__none__"]),
    );
  });

  it("stuck plain request is completed by submitDecryptionShare", () => {
    const G = makeState({ players: ["0", "1"] });
    G.phase = "play";
    G.encryptedDecks["0"] = [{ ciphertext: "z#0", layers: 0 }];
    G.cards = { "z#0": makeCard({ id: "z#0", ownerId: "0" }) };
    G.pendingDecryptRequests = [
      {
        id: "peek:stuck",
        playerId: "0",
        deckOwnerId: "0",
        cardIndex: 0,
        requestedBy: "0",
        requiredLayers: ["1", "0"],
        currentLayer: 0,
        status: "pending",
        materialized: false,
        purpose: "peek",
      },
    ];
    G.activeDeckOp = {
      id: "peek-op",
      kind: "peek-deck",
      sourceCardId: "ft#0",
      ownerId: "0",
      phase: "decrypt",
      decryptTotal: 1,
      decryptDone: 0,
      revealed: [],
      toHand: true,
      shuffleAfter: false,
      shuffleCommits: {},
      shuffleReveals: {},
      finalSeedHex: null,
      reencryptPlayerIndex: 0,
      statusMessage: "Decrypting for peek… 0/1",
      peekAllowNone: true,
      peekReason: "peek:own-to-hand",
    };

    const r = submitDecryptionShare(G, {} as any, "0", "peek:stuck", {
      ciphertext: "z#0",
      layers: 0,
    } as any);
    expect(r).not.toBe("INVALID_MOVE");
    expect(G.pendingPrompts?.[0]?.reason).toBe("peek:own-to-hand");
  });
});
