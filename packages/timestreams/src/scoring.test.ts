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

  it("applies score:to:all-players bonus", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config.scoringSlots = 6;

    putInEra(G, "stone",
      makeCard({ id: "0-card-1", ownerId: "0", scoreValue: 1, tags: ["score:bonus-points", "bonus-points:amount:3", "score:to:all-players"] }),
    );

    resolveScoring(G);
    expect(G.scores).toEqual({ "0": 4, "1": 3 });  // 1 + 3 to both
  });

  it("applies bonus-points:copy with offset-above target (e.g. Cloning)", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;

    // stack order: above at index 0, cloner at 1 (topmost when scoring cloner)
    putInEra(G, "stone",
      makeCard({ id: "above#0", ownerId: "0", scoreValue: 4 }),
      makeCard({ id: "cloner#0", ownerId: "0", scoreValue: 0, tags: [
        "score:bonus-points", "bonus-points:copy",
        "copy:target:offset-above:1", "copy:scope:today", "copy:value:current"
      ] }),
    );

    resolveScoring(G);
    // above contributes 4, cloner contributes 0 + copy of above (4) = 8 total
    expect(G.scores).toEqual({ "0": 8 });
    expect(G.players["0"].scorePile?.length).toBe(2);
  });

  it("applies score:perform-other (basic target resolution)", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;

    putInEra(G, "stone",
      makeCard({ id: "target#0", ownerId: "0", scoreValue: 5 }),
      makeCard({ id: "performer#0", ownerId: "0", scoreValue: 0, tags: ["score:perform-other", "perform:target-filter:any", "target:scope:today"] }),
    );

    resolveScoring(G);
    // target 5 + performer performs target's value (5) = 10
    expect(G.scores).toEqual({ "0": 10 });
  });

  it("applies score:branch with condition:first-score (basic)", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;

    putInEra(G, "stone",
      makeCard({ id: "brancher#0", ownerId: "0", scoreValue: 1, tags: [
        "score:branch", "condition:first-score",
        "if-true:bonus-points:amount:4", "if-false:bonus-points:amount:1"
      ] }),
    );

    resolveScoring(G);
    // 1 + branch if-true 4 = 5
    expect(G.scores).toEqual({ "0": 5 });
  });

  it("respects react:cancel for score effects (basic)", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;

    putInEra(G, "stone",
      makeCard({ id: "cancellable#0", ownerId: "0", scoreValue: 2, tags: [
        "score:bonus-points", "bonus-points:amount:10",
        "react:cancel", "cancel:score-effects"
      ] }),
    );

    resolveScoring(G);
    // printed 2, but tag bonus cancelled by react -> only 2
    expect(G.scores).toEqual({ "0": 2 });
  });
});
