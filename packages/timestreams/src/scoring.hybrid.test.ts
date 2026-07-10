import { describe, it, expect } from "vitest";
import { resolveScoring } from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";

describe("hybrid scoring (piles + bonus, perform vs steal)", () => {
  it("Nanotech processes QC then steals QC to stealer pile", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    putInEra(
      G,
      "future",
      makeCard({
        id: "nt#0",
        ownerId: "0",
        name: "Nanotech",
        scoreValue: 2,
        subtypes: ["nanotech"],
        tags: [
          "score:perform-other",
          "perform:target-filter:any",
          "target:subtype:nanotech",
          "target:subtype:quantum-computing",
          "target:exclude-self",
          "target:scope:today",
          "steal:target-to:own-score-pile",
          "steal:even-non-scoring",
        ],
      }),
      makeCard({
        id: "qc#0",
        ownerId: "1",
        name: "Quantum Computing",
        scoreValue: 2,
        subtypes: ["quantum-computing"],
        tags: [
          "score:choice",
          "decider:self",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
          "slots:scope:today",
        ],
      }),
      makeCard({ id: "filler#0", ownerId: "1", scoreValue: 1 }),
    );

    resolveScoring(G, {
      "nt#0:score-target": "qc#0",
      "qc#0:score-choice": "option-a",
    });

    // QC stolen to P0 pile
    expect(G.players["0"].scorePile.map((c) => c.id)).toContain("qc#0");
    expect(G.timeline.future.stack).not.toContain("qc#0");
    // NT itself collected to inventor pile at era end
    expect(G.players["0"].scorePile.map((c) => c.id)).toContain("nt#0");
    // Printed values: NT 2 + QC 2 = 4 for P0
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(4);
  });

  it("Alphabet perform does not steal target", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    putInEra(
      G,
      "stone",
      makeCard({
        id: "alpha#0",
        ownerId: "0",
        scoreValue: 2,
        tags: [
          "score:perform-other",
          "perform:optional",
          "target:scope:today",
          "target:exclude-self",
          "decider:target-owner",
        ],
      }),
      makeCard({
        id: "other#0",
        ownerId: "0",
        scoreValue: 3,
        tags: ["score:bonus-points", "bonus-points:amount:1"],
      }),
    );
    resolveScoring(G, { "alpha#0:score-target": "other#0" });
    // both in inventor pile (no steal)
    const pileIds = G.players["0"].scorePile.map((c) => c.id);
    expect(pileIds).toContain("alpha#0");
    expect(pileIds).toContain("other#0");
    // printed 2+3 + bonus 1 (from other's ability performed) + other's own bonus 1 when scored
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(5);
  });
});
