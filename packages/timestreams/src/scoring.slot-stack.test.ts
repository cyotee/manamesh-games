import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
  computeScoringSlotsForEra,
  resolveScoring,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

const qcTags = [
  "score:choice",
  "decider:self",
  "option-a:add-scoring-slots:1",
  "option-b:remove-scoring-slots:1",
  "slots:scope:today",
];

describe("scoring slot counter stacks (no per-card lock)", () => {
  it("two Quantum Computing cards each option-a → +2 capacity", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    putInEra(
      G,
      "future",
      makeCard({
        id: "qc#0",
        ownerId: "0",
        name: "Quantum Computing",
        scoreValue: 2,
        subtypes: ["quantum-computing"],
        tags: qcTags,
      }),
      makeCard({
        id: "qc#1",
        ownerId: "0",
        name: "Quantum Computing",
        scoreValue: 2,
        subtypes: ["quantum-computing"],
        tags: qcTags,
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeCard({ id: `f${i}#0`, ownerId: "0", scoreValue: 1 }),
      ),
    );

    beginScoringPhase(G);
    // QC #0
    expect(G.scoringWalk?.currentCardId).toBe("qc#0");
    submitScoreChoice(G, "0", "qc#0:score-choice", "option-a");
    dualAck(G);
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(computeScoringSlotsForEra(G, "future")).toBe(7);

    // QC #1 — must stack, not ignore
    expect(G.scoringWalk?.currentCardId).toBe("qc#1");
    submitScoreChoice(G, "0", "qc#1:score-choice", "option-a");
    dualAck(G);
    expect(G.scoringSlotBonusByEra?.future).toBe(2);
    expect(computeScoringSlotsForEra(G, "future")).toBe(8);

    // Process remaining until game over — 8 capacity
    let guard = 0;
    while (G.phase === "scoring" && guard++ < 40) {
      if (G.scoringWalk?.stepPhase === "ack") dualAck(G);
      else if (G.scoringWalk?.stepPhase === "choice") {
        const f = G.pendingPrompts?.[0];
        if (f) submitScoreChoice(G, f.deciderId, f.id, f.options?.[0] ?? "");
        else break;
      } else break;
    }
    expect(G.phase).toBe("gameOver");
    // 2 QC + 6 fillers of the 8 fillers that fit in 8 slots
    expect(G.players["0"].scorePile.length).toBe(8);
  });

  it("batch resolve: two QC option-a both stack", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 2 } as any;
    putInEra(
      G,
      "future",
      makeCard({
        id: "qc#0",
        ownerId: "0",
        tags: qcTags,
        scoreValue: 0,
      }),
      makeCard({
        id: "qc#1",
        ownerId: "0",
        tags: qcTags,
        scoreValue: 0,
      }),
      makeCard({ id: "a#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "b#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "c#0", ownerId: "0", scoreValue: 1 }),
    );
    resolveScoring(G, {
      "qc#0:score-choice": "option-a",
      "qc#1:score-choice": "option-a",
    });
    // base 2 + 2 = 4 slots: qc0, qc1, a, b (c discarded)
    expect(G.scoringSlotBonusByEra?.future).toBe(2);
    expect(G.players["0"].scorePile.map((c) => c.id).sort()).toEqual(
      ["a#0", "b#0", "qc#0", "qc#1"].sort(),
    );
  });

  it("Nanotech → QC option-a increments counter once (steal does not reverse it)", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 2 } as any;
    putInEra(
      G,
      "future",
      makeCard({
        id: "nt#0",
        ownerId: "0",
        subtypes: ["nanotech"],
        tags: [
          "score:perform-other",
          "target:subtype:quantum-computing",
          "target:exclude-self",
          "target:scope:today",
          "steal:target-to:own-score-pile",
        ],
      }),
      makeCard({
        id: "qc#0",
        ownerId: "0",
        subtypes: ["quantum-computing"],
        tags: qcTags,
      }),
      makeCard({ id: "x#0", ownerId: "0", scoreValue: 5 }),
      makeCard({ id: "y#0", ownerId: "0", scoreValue: 5 }),
    );
    beginScoringPhase(G);
    submitScoreChoice(G, "0", "nt#0:score-target", "qc#0");
    submitScoreChoice(G, "0", "qc#0:score-choice", "option-a");
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(computeScoringSlotsForEra(G, "future")).toBe(3);
    expect(G.timeline.future.stack.includes("qc#0")).toBe(false);
    // counter unchanged after steal
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
  });
});
