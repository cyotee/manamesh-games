/**
 * Plain-draw path: layers === 0 materializes immediately (no decrypt queue).
 */
import { describe, it, expect } from "vitest";
import { requestDraws } from "./crypto";
import { makeCard, makeState } from "./effects/testFixtures";

describe("plain draw (layers 0)", () => {
  it("materializes N plain top cards into hand without pendingDecryptRequests", () => {
    const G = makeState({ players: ["0", "1"] });
    G.encryptedDecks["0"] = [
      { ciphertext: "plain-a#0", layers: 0 },
      { ciphertext: "plain-b#0", layers: 0 },
      { ciphertext: "plain-c#0", layers: 0 },
    ];
    G.cards = {
      "plain-a#0": makeCard({ id: "plain-a#0", ownerId: "0" }),
      "plain-b#0": makeCard({ id: "plain-b#0", ownerId: "0" }),
      "plain-c#0": makeCard({ id: "plain-c#0", ownerId: "0" }),
    };
    const before = G.players["0"].hand.length;
    const n = requestDraws(G, "0", 2);
    expect(n).toBe(2);
    expect(G.pendingDecryptRequests.length).toBe(0);
    expect(G.pendingDealRemaining?.["0"] ?? 0).toBe(0);
    expect(G.players["0"].hand.length).toBe(before + 2);
    expect(G.players["0"].hand.map((c) => c.id)).toEqual(
      expect.arrayContaining(["plain-a#0", "plain-b#0"]),
    );
    expect(G.encryptedDecks["0"]).toHaveLength(1);
  });

  it("encrypted layers still queue cooperative decrypt", () => {
    const G = makeState({ players: ["0", "1"] });
    G.encryptedDecks["0"] = [
      { ciphertext: "opaque-0", layers: 1 },
      { ciphertext: "opaque-1", layers: 1 },
    ];
    requestDraws(G, "0", 2);
    expect(G.pendingDealRemaining?.["0"]).toBe(2);
    expect(G.pendingDecryptRequests.length).toBe(1);
    expect(G.pendingDecryptRequests[0].deckOwnerId).toBe("0");
    expect(G.players["0"].hand.length).toBe(0);
  });

  it("mixed plain-then-encrypted drains plain prefix then queues decrypt", () => {
    const G = makeState({ players: ["0", "1"] });
    G.encryptedDecks["0"] = [
      { ciphertext: "plain-a#0", layers: 0 },
      { ciphertext: "opaque-1", layers: 2 },
    ];
    G.cards = {
      "plain-a#0": makeCard({ id: "plain-a#0", ownerId: "0" }),
    };
    requestDraws(G, "0", 2);
    expect(G.players["0"].hand.map((c) => c.id)).toContain("plain-a#0");
    expect(G.pendingDealRemaining?.["0"]).toBe(1);
    expect(G.pendingDecryptRequests.some((r) => r.deckOwnerId === "0")).toBe(
      true,
    );
  });
});
