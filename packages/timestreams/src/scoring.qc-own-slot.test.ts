import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
  computeScoringSlotsForEra,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";
import { getCard } from "./effects/state";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

describe("QC as its own scoring slot", () => {
  it("hydrates missing tags from packCatalog so option-a still adds a slot", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    // Simulate a live card that lost tags (registry stub)
    putInEra(
      G,
      "future",
      makeCard({
        id: "future-tech-quantum-computing#0",
        ownerId: "0",
        name: "Quantum Computing",
        scoreValue: 2,
        hasScoreEffect: true,
        tags: [], // BUG: empty tags
      }),
      makeCard({ id: "f0#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "f1#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "f2#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "f3#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "f4#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "f5#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "f6#0", ownerId: "0", scoreValue: 1 }),
    );
    G.packCatalog = {
      future: [
        {
          id: "future-tech-quantum-computing",
          name: "Quantum Computing",
          front: "x.png",
          metadata: {
            tags: [
              "score:choice",
              "decider:self",
              "option-a:add-scoring-slots:1",
              "option-b:remove-scoring-slots:1",
              "slots:scope:today",
            ],
            scoreValue: 2,
            hasScoreEffect: true,
            subtypes: ["quantum-computing"],
          },
        },
      ],
    } as any;

    const hydrated = getCard(G, "future-tech-quantum-computing#0");
    expect(hydrated?.tags?.includes("score:choice")).toBe(true);

    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe(
      "future-tech-quantum-computing#0",
    );
    expect(G.scoringWalk?.stepPhase).toBe("choice");
    submitScoreChoice(
      G,
      "0",
      "future-tech-quantum-computing#0:score-choice",
      "option-a",
    );
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(computeScoringSlotsForEra(G, "future")).toBe(7);
  });

  it("option-a increases capacity when QC is processed directly", () => {
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
        tags: [
          "score:choice",
          "decider:self",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
          "slots:scope:today",
        ],
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        makeCard({ id: `f${i}#0`, ownerId: "0", scoreValue: 1 }),
      ),
    );

    expect(computeScoringSlotsForEra(G, "future")).toBe(6);
    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("qc#0");
    expect(G.scoringWalk?.stepPhase).toBe("choice");
    const prompts = G.pendingPrompts || [];
    expect(prompts[0]?.reason).toBe("score:choice");
    expect(prompts[0]?.options).toEqual(["option-a", "option-b"]);

    submitScoreChoice(G, "0", prompts[0]!.id, "option-a");

    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(computeScoringSlotsForEra(G, "future")).toBe(7);
    expect(G.scoringWalk?.eraSlotTotal).toBe(7);

    dualAck(G);
    // Should process more than 6 inventions total
    let n = 1;
    while (G.phase === "scoring" && n < 20) {
      if (G.scoringWalk?.stepPhase === "ack") dualAck(G);
      else if (G.scoringWalk?.stepPhase === "choice") {
        const f = G.pendingPrompts?.[0];
        if (f) submitScoreChoice(G, f.deciderId, f.id, f.options?.[0] ?? "");
        else break;
      } else break;
      n++;
    }
    expect(G.players["0"].scorePile.length).toBe(7); // 6 base + 1 from QC
  });
});
