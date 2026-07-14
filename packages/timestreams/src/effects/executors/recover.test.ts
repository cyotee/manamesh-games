import { describe, it, expect } from "vitest";
import { playInvention, submitPlayChoice } from "../../play";
import { makeCard, makeState, putInHand } from "../testFixtures";

const WATER_WHEEL = [
  "play:recover",
  "recover:optional",
  "recover:from-discard:1",
  "recover:to-hand",
  "cost:discard-from-hand:1",
];

describe("recover executor — Water Wheel", () => {
  it("prompts discard selection first (even with cost tag)", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.phase = "play";
    G.players["0"].discard.push(
      makeCard({ id: "old#0", name: "Cloth", ownerId: "0" }),
    );
    putInHand(
      G,
      "0",
      makeCard({
        id: "medieval-water-wheel#0",
        name: "Water Wheel",
        ownerId: "0",
        cardType: "invention",
        tags: WATER_WHEEL,
      }),
      makeCard({ id: "pay#0", name: "Taxes", ownerId: "0" }),
    );

    playInvention(
      G,
      { currentPlayer: "0" } as any,
      "0",
      "medieval-water-wheel#0",
      {},
    );

    expect(G.pendingPrompts?.[0]).toMatchObject({
      id: "medieval-water-wheel#0:recover",
      reason: "recover:from-discard",
      deciderId: "0",
    });
    expect(G.pendingPrompts?.[0]?.options).toContain("old#0");
    expect(G.pendingPrompts?.[0]?.options).toContain("__none__");
    // Cost is NOT asked until recover is chosen
    expect(G.pendingPrompts?.some((p) => p.id.endsWith(":recover-cost"))).toBe(
      false,
    );
  });

  it("after recover pick, prompts hand cost then recovers", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.phase = "play";
    G.players["0"].discard.push(
      makeCard({ id: "old#0", name: "Cloth", ownerId: "0" }),
    );
    putInHand(
      G,
      "0",
      makeCard({
        id: "medieval-water-wheel#0",
        name: "Water Wheel",
        ownerId: "0",
        cardType: "invention",
        tags: WATER_WHEEL,
      }),
      makeCard({ id: "pay#0", name: "Taxes", ownerId: "0" }),
    );

    playInvention(
      G,
      { currentPlayer: "0" } as any,
      "0",
      "medieval-water-wheel#0",
      {},
    );
    expect(
      submitPlayChoice(G, "0", "medieval-water-wheel#0:recover", "old#0"),
    ).not.toBe("INVALID_MOVE");

    expect(G.pendingPrompts?.[0]).toMatchObject({
      id: "medieval-water-wheel#0:recover-cost",
      reason: "cost:discard-from-hand:1",
    });
    expect(G.pendingPrompts?.[0]?.options).toContain("pay#0");

    expect(
      submitPlayChoice(G, "0", "medieval-water-wheel#0:recover-cost", "pay#0"),
    ).not.toBe("INVALID_MOVE");

    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players["0"].hand.map((c) => c.id)).toContain("old#0");
    expect(G.players["0"].hand.map((c) => c.id)).not.toContain("pay#0");
    expect(G.players["0"].discard.map((c) => c.id)).toContain("pay#0");
  });

  it("optional None skips without charging cost", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.phase = "play";
    G.players["0"].discard.push(makeCard({ id: "old#0", ownerId: "0" }));
    putInHand(
      G,
      "0",
      makeCard({
        id: "medieval-water-wheel#0",
        ownerId: "0",
        cardType: "invention",
        tags: WATER_WHEEL,
      }),
      makeCard({ id: "pay#0", ownerId: "0" }),
    );
    playInvention(
      G,
      { currentPlayer: "0" } as any,
      "0",
      "medieval-water-wheel#0",
      {},
    );
    submitPlayChoice(G, "0", "medieval-water-wheel#0:recover", "__none__");
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players["0"].hand.map((c) => c.id)).toContain("pay#0");
    expect(G.players["0"].discard.map((c) => c.id)).toContain("old#0");
  });
});
