import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
  resolveScoring,
  computeScoringSlotsForEra,
} from "./scoring";
import { makeCard, makeState, putInEra, putActionOnEra } from "./effects/testFixtures";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

function finishScoring(G: any) {
  let guard = 0;
  while (G.phase === "scoring" && guard++ < 80) {
    if (G.scoringWalk?.stepPhase === "choice") {
      const front = G.pendingPrompts?.[0];
      if (!front) break;
      const pick =
        front.min === 0 ? "" : front.options?.[0] ?? "";
      submitScoreChoice(G, front.deciderId, front.id, pick);
    } else if (G.scoringWalk?.stepPhase === "ack") {
      dualAck(G);
    } else {
      break;
    }
  }
}

describe("Irrigation score:count per-player (score:to:all-players + count:own-inventions)", () => {
  it("each player gets 1 point per their own invention in a scoring slot", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;

    // Stone Age (P0) owns Irrigation + 2 other inventions in slots
    // Future player owns 1 invention in stone scoring slots
    putInEra(
      G,
      "stone",
      makeCard({
        id: "irr#0",
        ownerId: "0",
        name: "Irrigation",
        scoreValue: 2,
        cardType: "invention",
        tags: [
          "score:count",
          "score:to:all-players",
          "score:per:1",
          "count:own-inventions",
          "count:in-scoring-slot",
          "count:scope:today",
        ],
      }),
      makeCard({
        id: "p0a#0",
        ownerId: "0",
        scoreValue: 1,
        cardType: "invention",
      }),
      makeCard({
        id: "p0b#0",
        ownerId: "0",
        scoreValue: 1,
        cardType: "invention",
      }),
      makeCard({
        id: "p1a#0",
        ownerId: "1",
        scoreValue: 1,
        cardType: "invention",
      }),
    );

    resolveScoring(G);

    // Printed: P0 = 2+1+1=4, P1 = 1
    // Irrigation bonus: P0 owns 3 inventions in slots → +3; P1 owns 1 → +1
    // NOT: both get +3 from P0's count
    expect(G.bonusPoints!["0"]).toBe(3);
    expect(G.bonusPoints!["1"]).toBe(1);
    expect(G.scores!["0"]).toBe(4 + 3);
    expect(G.scores!["1"]).toBe(1 + 1);
  });

  it("does not award the owner's count to every player", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;

    putInEra(
      G,
      "stone",
      makeCard({
        id: "irr#0",
        ownerId: "0",
        scoreValue: 2,
        cardType: "invention",
        tags: [
          "score:count",
          "score:to:all-players",
          "score:per:1",
          "count:own-inventions",
          "count:in-scoring-slot",
          "count:scope:today",
        ],
      }),
      makeCard({ id: "only#0", ownerId: "0", scoreValue: 1, cardType: "invention" }),
    );

    resolveScoring(G);
    // P0: 2 inventions in slots → +2; P1: 0 → +0
    expect(G.bonusPoints!["0"]).toBe(2);
    expect(G.bonusPoints!["1"]).toBe(0);
    expect(G.scores!["1"]).toBe(0);
  });
});

describe("scoring slots: Slow Time + QC fill all open slots", () => {
  it("two Slow Times (+4) and QC option-a (+1) process all inventions that fit", () => {
    // base 6 + 2 + 2 + 1 = 11 slots; 11 inventions should all score
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;

    putActionOnEra(
      G,
      "stone",
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

    const cards = [];
    for (let i = 0; i < 11; i++) {
      cards.push(
        makeCard({
          id: `c${i}#0`,
          ownerId: "0",
          scoreValue: 1,
          cardType: "invention",
        }),
      );
    }
    // Put QC early so +1 applies while slots remain
    cards[2] = makeCard({
      id: "qc#0",
      ownerId: "0",
      name: "Quantum Computing",
      scoreValue: 1,
      cardType: "invention",
      subtypes: ["quantum-computing"],
      tags: [
        "score:choice",
        "option-a:add-scoring-slots:1",
        "option-b:remove-scoring-slots:1",
        "slots:scope:today",
      ],
    });
    putInEra(G, "stone", ...cards);

    expect(computeScoringSlotsForEra(G, "stone")).toBe(10); // before QC choice

    beginScoringPhase(G);
    // Walk through; when QC comes up, pick option-a
    let guard = 0;
    while (G.phase === "scoring" && guard++ < 100) {
      if (G.scoringWalk?.stepPhase === "choice") {
        const front = G.pendingPrompts?.[0];
        if (!front) break;
        if (front.id === "qc#0:score-choice") {
          submitScoreChoice(G, "0", front.id, "option-a");
        } else {
          submitScoreChoice(
            G,
            front.deciderId,
            front.id,
            front.options?.[0] ?? "",
          );
        }
      } else if (G.scoringWalk?.stepPhase === "ack") {
        dualAck(G);
      } else break;
    }

    expect(G.phase).toBe("gameOver");
    // All 11 inventions in pile (each 1 pt); no leftover unprocessed on board
    expect(G.players["0"].scorePile.length).toBe(11);
    expect(G.scores!["0"]).toBe(11);
    expect(G.timeline.stone.stack).toEqual([]);
  });

  it("QC option-a still adds a slot after Nanotech steals QC off the board", () => {
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
        scoreValue: 1,
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
        scoreValue: 1,
        tags: [
          "score:choice",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
          "slots:scope:today",
        ],
      }),
      makeCard({ id: "extra#0", ownerId: "0", scoreValue: 5 }),
      makeCard({ id: "extra2#0", ownerId: "0", scoreValue: 7 }),
    );

    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("nt#0");
    submitScoreChoice(G, "0", "nt#0:score-target", "qc#0");
    submitScoreChoice(G, "0", "qc#0:score-choice", "option-a");
    dualAck(G);

    // base 2 + QC +1 = 3 slots; nt used 1; qc stolen; extra and extra2 should both process
    finishScoring(G);
    expect(G.phase).toBe("gameOver");
    const pile = G.players["0"].scorePile.map((c) => c.id);
    expect(pile).toEqual(
      expect.arrayContaining(["nt#0", "qc#0", "extra#0", "extra2#0"]),
    );
    // printed: 1+1+5+7 = 14
    expect(G.scores!["0"]).toBe(14);
  });
});
