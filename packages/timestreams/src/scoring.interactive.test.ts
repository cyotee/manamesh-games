import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  collectScoreInteractivePrompts,
  leftNeighborId,
  resolveScoring,
  ackScoreStep,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";
import { resolveCardScoreEffectsFull } from "./effects/executors/score";

/** Both players ack the current scoring step (walk mode). */
function dualAck(G: any) {
  for (const pid of G.playerOrder) {
    ackScoreStep(G, pid);
  }
}

describe("interactive score prompts (Mysticism number picker)", () => {
  it("leftNeighborId wraps playerOrder", () => {
    const G = makeState({ players: ["0", "1"] });
    expect(leftNeighborId(G, "0")).toBe("1");
    expect(leftNeighborId(G, "1")).toBe("0");
  });

  it("collects secret then guess prompts for Mysticism", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(
      G,
      "stone",
      makeCard({
        id: "stone-age-mysticism#0",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:guess",
          "guess:range:1-4",
          "guess:by:left-neighbor",
          "guess:correct:penalty:-3",
          "guess:wrong:bonus-points:chosen-number",
        ],
      }),
    );
    const prompts = collectScoreInteractivePrompts(G);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].id).toBe("stone-age-mysticism#0:score-guess-secret");
    expect(prompts[0].deciderId).toBe("0");
    expect(prompts[0].kind).toBe("choose-number");
    expect(prompts[0].options).toEqual(["1", "2", "3", "4"]);
    expect(prompts[1].id).toBe("stone-age-mysticism#0:score-guess-answer");
    expect(prompts[1].deciderId).toBe("1"); // left neighbor
    expect(prompts[1].reason).toBe("score:guess");
  });

  it("beginScoringPhase walks card-by-card with choices then dual-ack", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    putInEra(
      G,
      "stone",
      makeCard({
        id: "stone-age-mysticism#0",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:guess",
          "guess:range:1-4",
          "guess:by:left-neighbor",
          "guess:correct:penalty:-3",
          "guess:wrong:bonus-points:chosen-number",
        ],
      }),
    );

    const done0 = beginScoringPhase(G);
    expect(done0).toBe(false);
    expect(G.phase).toBe("scoring");
    expect(G.scoringWalk?.steps.length).toBe(1);
    expect(G.scoringWalk?.stepPhase).toBe("choice");
    expect(G.pendingPrompts?.length).toBe(2);
    // Official totals stay zero until the walk finishes
    expect(G.scores!["0"]).toBe(0);

    const r1 = submitScoreChoice(G, "0", "stone-age-mysticism#0:score-guess-secret", "3");
    expect(r1).toBe(false);
    expect(G.pendingPrompts?.length).toBe(1);

    // wrong player cannot answer
    expect(
      submitScoreChoice(G, "0", "stone-age-mysticism#0:score-guess-answer", "1"),
    ).toBe("INVALID_MOVE");

    const r2 = submitScoreChoice(G, "1", "stone-age-mysticism#0:score-guess-answer", "1");
    expect(r2).toBe(false);
    // Bonus ledger updated immediately; printed value waits for pile
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(G.bonusPoints!["0"]).toBe(3); // wrong guess → secret bonus 3
    expect(G.scoringWalk!.provisionalScores["0"]).toBe(3);

    expect(ackScoreStep(G, "0")).toBe(false);
    expect(G.scoringWalk?.acks["0"]).toBe(true);
    const finished = ackScoreStep(G, "1");
    expect(finished).toBe(true);
    expect(G.phase).toBe("gameOver");
    expect(G.scores!["0"]).toBe(3); // pile (0) + bonus 3
  });

  it("Virtual Reality queues optional two-card score:swap prompt and applies swap", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    const vr = makeCard({
      id: "future-tech-virtual-reality#0",
      ownerId: "0",
      name: "Virtual Reality",
      scoreValue: 2,
      tags: [
        "score:swap",
        "swap:optional",
        "swap:target:invention",
        "swap:count:2",
        "swap:scope:today",
      ],
    });
    putInEra(
      G,
      "future",
      makeCard({ id: "a#0", ownerId: "0", name: "A", scoreValue: 1 }),
      makeCard({ id: "b#0", ownerId: "1", name: "B", scoreValue: 1 }),
      vr,
      makeCard({ id: "c#0", ownerId: "0", name: "C", scoreValue: 1 }),
    );

    const prompts = collectScoreInteractivePrompts(G);
    const swap = prompts.find((p) => p.reason === "score:swap");
    expect(swap).toBeTruthy();
    expect(swap!.id).toBe("future-tech-virtual-reality#0:score-swap-pair");
    expect(swap!.deciderId).toBe("0");
    expect(swap!.min).toBe(0);
    expect(swap!.max).toBe(2);
    expect(swap!.options).toEqual(
      expect.arrayContaining(["a#0", "b#0", "future-tech-virtual-reality#0", "c#0"]),
    );

    // Direct effect path (stack still present): swap a#0 and c#0
    const res = resolveCardScoreEffectsFull(G, vr, "future", 2, {
      [`${vr.id}:score-swap-pair`]: ["a#0", "c#0"],
    });
    expect(res.log.join(" ")).toMatch(/score-swapped a#0 <-> c#0/);
    expect(G.timeline.future.stack).toEqual([
      "c#0",
      "b#0",
      "future-tech-virtual-reality#0",
      "a#0",
    ]);

    // Interactive scoring walk: decline is valid for optional
    const G2 = makeState({ players: ["0"], currentDay: 6 });
    G2.players["0"].homeEra = "future";
    putInEra(
      G2,
      "future",
      makeCard({ id: "x#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "y#0", ownerId: "0", scoreValue: 1 }),
      makeCard({
        id: "vr#0",
        ownerId: "0",
        scoreValue: 2,
        tags: [
          "score:swap",
          "swap:optional",
          "swap:target:invention",
          "swap:count:2",
          "swap:scope:today",
        ],
      }),
    );
    expect(beginScoringPhase(G2)).toBe(false);
    // steps: x, y, vr — first is x with no choices → ack
    expect(G2.scoringWalk?.stepPhase).toBe("ack");
    dualAck(G2);
    dualAck(G2);
    // vr needs choice
    expect(G2.scoringWalk?.stepPhase).toBe("choice");
    expect(submitScoreChoice(G2, "0", "vr#0:score-swap-pair", [])).toBe(false);
    expect(G2.scoringWalk?.stepPhase).toBe("ack");
    dualAck(G2);
    expect(G2.phase).toBe("gameOver");
    expect(G2.scores!["0"]).toBeGreaterThan(0);
  });

  it("correct guess applies penalty via interactive path", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    putInEra(
      G,
      "stone",
      makeCard({
        id: "stone-age-mysticism#0",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:guess",
          "guess:range:1-4",
          "guess:by:left-neighbor",
          "guess:correct:penalty:-3",
          "guess:wrong:bonus-points:chosen-number",
        ],
      }),
    );
    beginScoringPhase(G);
    submitScoreChoice(G, "0", "stone-age-mysticism#0:score-guess-secret", "2");
    submitScoreChoice(G, "1", "stone-age-mysticism#0:score-guess-answer", "2");
    dualAck(G);
    expect(G.phase).toBe("gameOver");
    expect(G.scores!["0"]).toBe(-3);
  });

  it("no interactive tags still uses walk with dual-ack per card", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    putInEra(G, "stone", makeCard({ id: "s#0", ownerId: "0", scoreValue: 2 }));
    putInEra(G, "future", makeCard({ id: "f#0", ownerId: "1", scoreValue: 5 }));
    expect(beginScoringPhase(G)).toBe(false);
    // stone card first — printed value not banked until era pile collect
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(G.scoringWalk?.currentCardId).toBe("s#0");
    expect(G.scores!["0"]).toBe(0);
    expect(G.scoringWalk!.provisionalScores["0"]).toBe(0);
    dualAck(G);
    // stone era cleaned → s#0 in pile; future card processing
    expect(G.phase).toBe("scoring");
    expect(G.scoringWalk?.currentCardId).toBe("f#0");
    expect(G.scores!["0"]).toBe(2); // stone pile
    expect(G.scores!["1"]).toBe(0); // future not piled yet
    dualAck(G);
    expect(G.phase).toBe("gameOver");
    expect(G.scores).toEqual({ "0": 2, "1": 5 });
    expect(G.winner).toBe("1");
  });

  it("Wonky rule: discard mid-era changes which card fills the next slot", () => {
    // Stack: discarder, A (value 10), B (value 3). Only 2 slots.
    // Discarder auto-discards A (first other candidate); next unscored is B.
    // A frozen step list would still try to score A.
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 2 } as any;
    putInEra(
      G,
      "stone",
      makeCard({
        id: "d#0",
        ownerId: "0",
        name: "Discarder",
        scoreValue: 1,
        tags: [
          "score:discard",
          "discard:target:invention",
          "discard:scope:today",
          "target:exclude-self",
        ],
      }),
      makeCard({ id: "a#0", ownerId: "0", name: "A", scoreValue: 10 }),
      makeCard({ id: "b#0", ownerId: "0", name: "B", scoreValue: 3 }),
    );

    expect(beginScoringPhase(G)).toBe(false);
    expect(G.scoringWalk?.currentCardId).toBe("d#0");
    expect(G.scores!["0"]).toBe(0);
    expect(G.scoringWalk!.provisionalScores["0"]).toBe(0);
    dualAck(G);

    // A discarded → B is topmost unscored for remaining slot
    expect(G.phase).toBe("scoring");
    expect(G.scoringWalk?.currentCardId).toBe("b#0");
    expect(G.timeline.stone.stack.includes("a#0")).toBe(false);
    dualAck(G);

    expect(G.phase).toBe("gameOver");
    // Piles: discarder 1 + B 3 = 4 (not 1+10)
    expect(G.scores!["0"]).toBe(4);
    expect(G.scoredThisScoring).toEqual(expect.arrayContaining(["d#0", "b#0"]));
    expect(G.scoredThisScoring?.includes("a#0")).toBe(false);
  });

  it("resolveScoring still works with pre-supplied choices (no UI)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    putInEra(
      G,
      "stone",
      makeCard({
        id: "stone-age-mysticism#0",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:guess",
          "guess:range:1-4",
          "guess:by:left-neighbor",
          "guess:correct:penalty:-3",
          "guess:wrong:bonus-points:chosen-number",
        ],
      }),
    );
    resolveScoring(G, {
      "stone-age-mysticism#0:score-guess-secret": "4",
      "stone-age-mysticism#0:score-guess-answer": "1",
    });
    expect(G.phase).toBe("gameOver");
    expect(G.scores!["0"]).toBe(4);
  });
});
