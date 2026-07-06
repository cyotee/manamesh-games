import { describe, it, expect } from "vitest";
import { resolveScoring, cardOwner } from "./scoring";
import { makeState, putInEra } from "./effects/testFixtures";
import { makeCard } from "./effects/testFixtures";

describe("placeholder scoring", () => {
  it("derives owner from card id", () => {
    expect(cardOwner("0-card-12")).toBe("0");
    expect(cardOwner("1-card-3")).toBe("1");
  });

  it("awards points per owned card (using effective value) in a scoring slot and picks a winner", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config.scoringSlots = 6;

    // Stone era: 0 has 2, 1 has 1 (top 3 count as slots)
    putInEra(G, "stone",
      makeCard({ id: "0-card-1", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "0-card-2", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "1-card-1", ownerId: "1", scoreValue: 1 }),
    );

    // Future: 1 has 1
    putInEra(G, "future",
      makeCard({ id: "1-card-2", ownerId: "1", scoreValue: 1 }),
    );

    resolveScoring(G);
    expect(G.scores).toEqual({ "0": 2, "1": 2 });
    expect(G.winner).toBe("0"); // tie broken by era chronology (stone < future)
    expect(G.phase).toBe("gameOver");
  });

  it("applies score:bonus-points from card tags", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;

    putInEra(G, "stone",
      makeCard({ id: "0-card-1", ownerId: "0", scoreValue: 3, tags: ["score:bonus-points", "bonus-points:amount:5"] }),
    );

    resolveScoring(G);
    expect(G.scores).toEqual({ "0": 8 });  // 3 + 5 bonus
    expect(G.players["0"].scorePile?.length).toBe(1);
    expect(G.phase).toBe("gameOver");
  });
});
