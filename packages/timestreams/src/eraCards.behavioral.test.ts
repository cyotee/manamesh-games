/**
 * Era card abilities: medieval steal-bonus, stone tags, modern era-begin tags.
 */
import { describe, it, expect } from "vitest";
import { resolveScoring } from "./scoring";
import { makeCard, makeState, putInEra, putInHand } from "./effects/testFixtures";
import { tryStealBonusPoints, isOncePerGameSpent } from "./effects/react";

describe("era-medieval steal:bonus-points", () => {
  it("steals positive bonus once-per-game during scoring", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.players["0"].homeEra = "medieval";
    G.players["1"].homeEra = "stone";
    G.config.scoringSlots = 6;

    // Medieval player holds era card in hand
    putInHand(
      G,
      "0",
      makeCard({
        id: "era-medieval",
        ownerId: "0",
        tags: [
          "react:bonus-points",
          "steal:bonus-points",
          "suppress:original-bonus-points",
          "limit:once-per-game",
        ],
      }),
    );

    // Stone board: Poetry-like odd-slot bonus for P1
    putInEra(
      G,
      "medieval",
      makeCard({
        id: "medieval-poetry#0",
        ownerId: "1",
        scoreValue: 1,
        tags: [
          "score:bonus-points",
          "bonus-points:amount:3",
          "condition:odd-scoring-slot",
        ],
      }),
    );

    resolveScoring(G, {
      "era-medieval:steal-bonus:medieval-poetry#0:0": "yes",
    });
    expect(G.phase).toBe("gameOver");
    // P0 (medieval) should have stolen the +3; P1 printed only
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(3);
    expect(isOncePerGameSpent(G, "era-medieval")).toBe(true);
    // Second resolve would not steal again — already spent
    const r2 = tryStealBonusPoints(G, "era-medieval", "1", 5);
    expect(r2.stolen).toBe(0);
  });

  it("tryStealBonusPoints enforces once-per-game", () => {
    const G = makeState({ players: ["0", "1"] });
    putInHand(
      G,
      "0",
      makeCard({
        id: "era-medieval",
        ownerId: "0",
        tags: ["steal:bonus-points", "limit:once-per-game"],
      }),
    );
    expect(tryStealBonusPoints(G, "era-medieval", "1", 4).stolen).toBe(4);
    expect(tryStealBonusPoints(G, "era-medieval", "1", 4).stolen).toBe(0);
  });
});

describe("era-stone once-per-game cancel tags", () => {
  it("registers protect/cancel tags for stone inventions", () => {
    const tags = [
      "react:move",
      "react:cancel",
      "protect:move",
      "protect:discard",
      "protect:target:era-invention",
      "limit:once-per-game",
    ];
    const G = makeState({ players: ["0"] });
    putInHand(
      G,
      "0",
      makeCard({ id: "era-stone", ownerId: "0", tags }),
    );
    expect(G.players["0"].hand[0].tags).toEqual(expect.arrayContaining(tags));
  });
});

describe("era-modern era-begin recover tags", () => {
  it("carries recover-from-discard tags for begin-of-modern react", () => {
    const tags = [
      "react:era-begin",
      "recover:from-discard:1",
      "recover:to-hand",
    ];
    const G = makeState({ players: ["0"] });
    putInHand(
      G,
      "0",
      makeCard({ id: "era-modern", ownerId: "0", tags }),
    );
    expect(G.players["0"].hand[0].tags).toEqual(expect.arrayContaining(tags));
  });
});
