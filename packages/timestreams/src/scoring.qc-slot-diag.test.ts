import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
  computeScoringSlotsForEra,
} from "./src/scoring";
import { makeCard, makeState, putInEra, putActionOnEra } from "./src/effects/testFixtures";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

describe("QC slot capacity when removed", () => {
  it("capacity stays +1 after Nanotech steals QC mid-era with Slow Times", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    putActionOnEra(
      G,
      "future",
      makeCard({
        id: "slow#0",
        ownerId: "0",
        cardType: "action",
        tags: ["score:add-scoring-slots:2"],
      }),
    );
    // base 6 + 2 = 8 before QC
    putInEra(
      G,
      "future",
      makeCard({
        id: "nt#0",
        ownerId: "0",
        subtypes: ["nanotech"],
        scoreValue: 2,
        tags: [
          "score:perform-other",
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
        ownerId: "0",
        name: "Quantum Computing",
        subtypes: ["quantum-computing"],
        scoreValue: 2,
        tags: [
          "score:choice",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
          "slots:scope:today",
        ],
      }),
      // fillers so capacity matters
      ...Array.from({ length: 10 }, (_, i) =>
        makeCard({ id: `f${i}#0`, ownerId: "0", scoreValue: 1 }),
      ),
    );

    expect(computeScoringSlotsForEra(G, "future")).toBe(8);
    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("nt#0");
    submitScoreChoice(G, "0", "nt#0:score-target", "qc#0");
    submitScoreChoice(G, "0", "qc#0:score-choice", "option-a");

    // Immediately after apply: QC stolen
    expect(G.timeline.future.stack.includes("qc#0")).toBe(false);
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(computeScoringSlotsForEra(G, "future")).toBe(9); // 6+2+1
    expect(G.scoringWalk?.eraSlotTotal).toBe(9);
  });

  it("records durable +1 at choice submit, before apply/steal", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
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
        tags: [
          "score:choice",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
          "slots:scope:today",
        ],
      }),
      makeCard({ id: "x#0", ownerId: "0", scoreValue: 1 }),
    );
    beginScoringPhase(G);
    submitScoreChoice(G, "0", "nt#0:score-target", "qc#0");
    // After QC option-a, capacity must be 7 *before* dual-ack/apply
    submitScoreChoice(G, "0", "qc#0:score-choice", "option-a");
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(computeScoringSlotsForEra(G, "future")).toBe(7);
    // Choice completes the NT step → apply steals QC immediately
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(G.timeline.future.stack.includes("qc#0")).toBe(false);
    // Capacity must remain +1 after steal
    expect(G.scoringWalk?.eraSlotTotal).toBe(7);
    expect(computeScoringSlotsForEra(G, "future")).toBe(7);
  });
});
