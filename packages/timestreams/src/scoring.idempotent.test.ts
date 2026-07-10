import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
  computeScoringSlotsForEra,
} from "./scoring";
import { makeCard, makeState, putInEra, putActionOnEra } from "./effects/testFixtures";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

describe("scoring walk idempotency (no double slot burn)", () => {
  it("duplicate submitScoreChoice does not re-apply bonus or burn slots", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 3 } as any;

    putInEra(
      G,
      "stone",
      makeCard({
        id: "gm#0",
        ownerId: "0",
        name: "Genetic Modification",
        scoreValue: 0,
        tags: [
          "score:bonus-points",
          "bonus-points:copy",
          "copy:target:any-card",
          "copy:value:current",
          "target:scope:today",
          "target:exclude-self",
        ],
      }),
      makeCard({ id: "rich#0", ownerId: "0", scoreValue: 5 }),
      makeCard({ id: "mid#0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "low#0", ownerId: "0", scoreValue: 1 }), // 4th card — needs all 3 slots for first three
    );

    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("gm#0");
    expect(G.scoringWalk?.stepPhase).toBe("choice");

    submitScoreChoice(G, "0", "gm#0:score-target", "rich#0");
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(G.bonusPoints!["0"]).toBe(5);

    // Duplicate submit must be rejected and must not double bonus / slot
    const dup = submitScoreChoice(G, "0", "gm#0:score-target", "rich#0");
    expect(dup).toBe("INVALID_MOVE");
    expect(G.bonusPoints!["0"]).toBe(5);
    expect(G.scoringWalk?.slotsUsedInEra).toBe(1);

    dualAck(G);
    // Next should still be rich#0 (slot 2 of 3), not skip to end
    expect(G.scoringWalk?.currentCardId).toBe("rich#0");
    dualAck(G);
    expect(G.scoringWalk?.currentCardId).toBe("mid#0");
    dualAck(G);
    // low#0 is outside 3 slots — should not process; era completes
    expect(G.phase).toBe("gameOver");
    expect(G.players["0"].scorePile.map((c) => c.id)).toEqual(
      expect.arrayContaining(["gm#0", "rich#0", "mid#0"]),
    );
    expect(G.players["0"].scorePile.map((c) => c.id)).not.toContain("low#0");
    // printed 0+5+2 + bonus 5 = 12
    expect(G.scores!["0"]).toBe(12);
  });

  it("Slow Time slots process all inventions that fit capacity", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;

    putActionOnEra(
      G,
      "future",
      makeCard({
        id: "slow#0",
        ownerId: "0",
        name: "Slow Time",
        cardType: "action",
        tags: ["score:add-scoring-slots:2"],
      }),
      makeCard({
        id: "slow#1",
        ownerId: "0",
        name: "Slow Time",
        cardType: "action",
        tags: ["score:add-scoring-slots:2"],
      }),
    );

    // 10 inventions for 6+2+2 = 10 slots
    const cards = [];
    for (let i = 0; i < 10; i++) {
      cards.push(
        makeCard({
          id: `f${i}#0`,
          ownerId: "0",
          scoreValue: 1,
          name: `Future${i}`,
        }),
      );
    }
    putInEra(G, "future", ...cards);
    expect(computeScoringSlotsForEra(G, "future")).toBe(10);

    beginScoringPhase(G);
    let guard = 0;
    while (G.phase === "scoring" && guard++ < 40) {
      if (G.scoringWalk?.stepPhase === "choice") {
        const front = G.pendingPrompts?.[0];
        if (front) {
          submitScoreChoice(G, front.deciderId, front.id, front.options?.[0] ?? "");
        } else break;
      } else if (G.scoringWalk?.stepPhase === "ack") {
        dualAck(G);
      } else break;
    }

    expect(G.phase).toBe("gameOver");
    // All 10 inventions banked; none discarded for lack of slot
    expect(G.players["0"].scorePile.length).toBe(10);
    expect(G.scores!["0"]).toBe(10);
  });
});
