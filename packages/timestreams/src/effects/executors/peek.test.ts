import { describe, it, expect } from "vitest";
import { playAction } from "../../play";
import { makeCard, makeState, putInHand } from "../testFixtures";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

function fortuneTeller() {
  return makeCard({
    id: "medieval-fortune-teller",
    name: "Fortune Teller",
    ownerId: "0",
    cardType: "action",
    tags: [
      "play:peek",
      "peek:own-deck:3",
      "to-hand:choose:1",
      "target:choose:opponent",
      "peek:opponent-deck:3",
      "discard:opponent-deck-card",
      "return:remainder:top-of-deck",
      "return-order:decider:self",
    ],
  });
}

describe("peekExecutor (Fortune Teller)", () => {
  it("multi-step: own hand pick → opponent → discard from opp deck", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.phase = "play";

    const own = ["own-a", "own-b", "own-c", "own-d"];
    const opp = ["opp-a", "opp-b", "opp-c", "opp-d"];
    G.encryptedDecks["0"] = own.map((id) => ({ ciphertext: id, layers: 0 }));
    G.encryptedDecks["1"] = opp.map((id) => ({ ciphertext: id, layers: 0 }));
    G.cards = {};
    for (const id of [...own, ...opp]) {
      G.cards[id] = makeCard({ id, name: id, ownerId: id.startsWith("own") ? "0" : "1" });
    }

    const ft = fortuneTeller();
    putInHand(G, "0", ft);

    // Step 1: own peek prompt
    playAction(G, ctxFor("0"), "0", ft.id);
    expect(G.pendingPrompts?.[0]?.reason).toBe("peek:own-to-hand");
    expect(G.pendingPrompts?.[0]?.options).toEqual(
      expect.arrayContaining(["own-a", "own-b", "own-c", "__none__"]),
    );

    // Step 2: take own-b, then need opponent
    playAction(G, ctxFor("0"), "0", ft.id, {
      [`${ft.id}:peek-own-hand`]: "own-b",
    });
    expect(G.players["0"].hand.map((c) => c.id)).toContain("own-b");
    expect(G.encryptedDecks["0"].map((c) => c.ciphertext)).not.toContain("own-b");
    expect(G.pendingPrompts?.[0]?.reason).toBe("target:choose:opponent");

    // Step 3: pick opponent 1, need discard choice
    playAction(G, ctxFor("0"), "0", ft.id, {
      [`${ft.id}:peek-own-hand`]: "own-b",
      [`${ft.id}:choose-opponent`]: "1",
    });
    expect(G.pendingPrompts?.[0]?.reason).toBe("discard:opponent-deck-card");

    // Step 4: discard opp-b
    playAction(G, ctxFor("0"), "0", ft.id, {
      [`${ft.id}:peek-own-hand`]: "own-b",
      [`${ft.id}:choose-opponent`]: "1",
      [`${ft.id}:peek-opp-discard`]: "opp-b",
    });
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players["1"].discard.map((c) => c.id)).toContain("opp-b");
    expect(G.encryptedDecks["1"].map((c) => c.ciphertext)).not.toContain("opp-b");
  });
});
