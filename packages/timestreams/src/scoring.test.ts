import { describe, it, expect } from "vitest";
import { resolveScoring, cardOwner } from "./scoring";
import { createTimeline } from "./timeline";

describe("placeholder scoring", () => {
  it("derives owner from card id", () => {
    expect(cardOwner("0-card-12")).toBe("0");
    expect(cardOwner("1-card-3")).toBe("1");
  });

  it("awards 1 point per owned card in a scoring slot and picks a winner", () => {
    const timeline = createTimeline();
    timeline.stone.stack = ["0-card-1", "0-card-2", "1-card-1"];
    timeline.future.stack = ["1-card-2"];
    const G: any = {
      phase: "scoring", timeline, playerOrder: ["0", "1"],
      players: { "0": { homeEra: "stone" }, "1": { homeEra: "future" } },
      config: { scoringSlots: 6 }, scores: { "0": 0, "1": 0 }, winner: null,
    };
    resolveScoring(G);
    expect(G.scores).toEqual({ "0": 2, "1": 2 });
    expect(G.winner).toBe("0"); // tie broken by era chronology (stone < future)
    expect(G.phase).toBe("gameOver");
  });
});
