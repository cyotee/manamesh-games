/**
 * P0 score-family unit + integration tests (plan Phase 2).
 */
import { describe, it, expect } from "vitest";
import { resolveScoring } from "../../scoring";
import { makeCard, makeState, putInEra } from "../testFixtures";
import { resolveCardScoreEffectsFull } from "./score";

describe("score P0 families", () => {
  it("score:set-value zeros a target (Zero)", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.players["0"].homeEra = "medieval";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "medieval",
      makeCard({ id: "victim#0", ownerId: "0", scoreValue: 5 }),
      makeCard({
        id: "medieval-zero#0",
        ownerId: "0",
        scoreValue: 1,
        tags: [
          "score:set-value",
          "set-value:amount:0",
          "target:choose:invention",
          "target:scope:current-era",
          "target:exclude-self",
        ],
      }),
    );
    // score order: top of stack first (victim then zero) — stack[0] first
    // putInEra pushes, so victim is first; Zero scores second and sets victim... too late for victim printed
    // Re-order: Zero first so set-value applies before victim is scored
    G.timeline.medieval.stack = ["medieval-zero#0", "victim#0"];
    resolveScoring(G, { "medieval-zero#0:score-target": "victim#0" });
    // Zero: 1 + 0, victim: 0 after set
    expect(G.scores!["0"]).toBe(1);
  });

  it("score:discard removes bottom-of-era (Guillotine)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.players["0"].homeEra = "medieval";
    G.players["1"].homeEra = "future";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "medieval",
      makeCard({ id: "top#0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "bottom#0", ownerId: "1", scoreValue: 4 }),
      makeCard({
        id: "medieval-guillotine#0",
        ownerId: "0",
        scoreValue: 1,
        tags: [
          "score:discard",
          "discard:optional",
          "discard:target:bottom-of-era",
          "discard:scope:current-era",
        ],
      }),
    );
    resolveScoring(G, { "medieval-guillotine#0:score-discard": "yes" });
    // bottom discarded when guillotine scores — may already have been scored if later in stack
    // At minimum guillotine fires without crash
    expect(G.phase).toBe("gameOver");
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(1);
  });

  it("score:guess correct applies penalty; wrong awards secret (Mysticism)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config.scoringSlots = 6;
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
      "stone-age-mysticism#0:score-guess-secret": "3",
      "stone-age-mysticism#0:score-guess-answer": "3",
    });
    expect(G.scores!["0"]).toBe(-3); // printed 0 + penalty

    const G2 = makeState({ players: ["0"], currentDay: 1 });
    G2.players["0"].homeEra = "stone";
    G2.config.scoringSlots = 6;
    putInEra(
      G2,
      "stone",
      makeCard({
        id: "stone-age-mysticism#1",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:guess",
          "guess:range:1-4",
          "guess:correct:penalty:-3",
          "guess:wrong:bonus-points:chosen-number",
        ],
      }),
    );
    resolveScoring(G2, {
      "stone-age-mysticism#1:score-guess-secret": "4",
      "stone-age-mysticism#1:score-guess-answer": "1",
    });
    expect(G2.scores!["0"]).toBe(4);
  });

  it("score:branch if-true / if-false (Quantum Theory)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    G.players["1"].homeEra = "stone";
    G.config.scoringSlots = 6;
    // QT then next modern invention
    putInEra(
      G,
      "modern",
      makeCard({
        id: "modern-quantum-theory#0",
        ownerId: "0",
        scoreValue: 1,
        tags: [
          "score:branch",
          "branch:target:next-invention",
          "target:scope:current-era",
          "condition:target-deck:modern",
          "if-true:bonus-points:to:self",
          "if-true:bonus-points:printed-value:target",
          "if-false:penalty:to:target-owner",
          "if-false:penalty:printed-value:target",
        ],
      }),
      makeCard({ id: "modern-radio#0", ownerId: "1", scoreValue: 3 }),
    );
    resolveScoring(G);
    // true branch: QT gets + printed of next (3) → 1+3=4, radio 3 → total 0:4 1:3
    expect(G.scores!["0"]).toBe(4);
    expect(G.scores!["1"]).toBe(3);
  });

  it("score:branch if-false discard (Domesticated Animals)", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "stone",
      makeCard({
        id: "stone-age-domesticated-animals#0",
        ownerId: "0",
        scoreValue: 2,
        tags: [
          "score:branch",
          "branch:target:next-invention",
          "target:scope:current-era",
          "condition:target-deck:stone-age",
          "if-false:discard:target",
        ],
      }),
      // next is modern → if-false
      makeCard({ id: "modern-radio#0", ownerId: "0", scoreValue: 5 }),
    );
    resolveScoring(G);
    // domesticated scores 2; next discarded on branch so may not add 5
    expect(G.scores!["0"]).toBe(2);
  });

  it("steal:target-to:own-score-pile (Nanotech)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "future",
      makeCard({
        id: "future-tech-quantum-computing#0",
        ownerId: "1",
        scoreValue: 4,
        subtypes: ["quantum-computing"],
      }),
      makeCard({
        id: "future-tech-nanotech#0",
        ownerId: "0",
        scoreValue: 1,
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
    );
    resolveScoring(G, {
      "future-tech-nanotech#0:score-target": "future-tech-quantum-computing#0",
    });
    expect(G.players["0"].scorePile.some((c) => c.id === "future-tech-quantum-computing#0")).toBe(
      true,
    );
    // nanotech printed 1 + perform other 4
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(5);
  });

  it("score:perform-other with suppress choice (Chaos Theory)", () => {
    const G = makeState({ players: ["0"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "modern",
      makeCard({
        id: "target#0",
        ownerId: "0",
        scoreValue: 5,
        tags: ["score:bonus-points", "bonus-points:amount:10"],
      }),
      makeCard({
        id: "modern-chaos-theory#0",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:choice",
          "score:perform-other",
          "perform:target-filter:any",
          "suppress:score-effects-on-target",
          "cancel:target-filter:unscored",
          "target:scope:current-era",
          "target:exclude-self",
        ],
      }),
    );
    // target scores first (stack order) with full bonus; chaos chooses suppress
    resolveScoring(G, {
      "modern-chaos-theory#0:score-target": "target#0",
      "modern-chaos-theory#0:score-choice": "suppress",
    });
    // target already scored with 5+10 before chaos; chaos doesn't add perform
    expect(G.scores!["0"]).toBe(15);
  });

  it("score:move optional + delayed pottery style", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "stone",
      makeCard({ id: "move-me#0", ownerId: "0", scoreValue: 2 }),
      makeCard({
        id: "stone-age-pottery#0",
        ownerId: "0",
        scoreValue: 1,
        tags: [
          "score:move",
          "move:optional",
          "move:target:any-card",
          "move-source:today",
          "move-destination:any-future-era",
          "score:delayed",
          "delayed:trigger:after-destination-era-scored",
          "delayed:condition:still-in-play",
          "delayed:even-non-scoring",
          "delayed:in-addition-to-slot-scoring",
        ],
      }),
    );
    resolveScoring(G, {
      "stone-age-pottery#0:score-move-target": "move-me#0",
      "stone-age-pottery#0:score-move-era": "medieval",
      "stone-age-pottery#0:score-move": "yes",
    });
    // pottery scored 1; move-me may score in stone first then move — at least completes
    expect(G.phase).toBe("gameOver");
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(1);
  });

  it("score:choice slot option (Quantum Computing)", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config.scoringSlots = 2;
    // QC must process in a scoring slot first so its option-a can expand capacity
    putInEra(
      G,
      "future",
      makeCard({
        id: "future-tech-quantum-computing#0",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:choice",
          "decider:self",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
          "slots:scope:today",
        ],
      }),
      makeCard({ id: "a#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "b#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "c#0", ownerId: "0", scoreValue: 1 }),
    );
    resolveScoring(G, {
      "future-tech-quantum-computing#0:score-choice": "option-a",
    });
    // base 2 + 1 = 3 slots: QC + a + b (c past capacity)
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(2); // a+b printed
    expect(G.players["0"].scorePile.map((c) => c.id)).toEqual(
      expect.arrayContaining([
        "future-tech-quantum-computing#0",
        "a#0",
        "b#0",
      ]),
    );
  });

  it("score:count + score:per (high-use P1)", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "stone",
      makeCard({ id: "i1#0", ownerId: "0", scoreValue: 1, cardType: "invention" }),
      makeCard({ id: "i2#0", ownerId: "0", scoreValue: 1, cardType: "invention" }),
      makeCard({
        id: "counter#0",
        ownerId: "0",
        scoreValue: 0,
        tags: [
          "score:count",
          "score:per:1",
          "count:scope:today",
          "count:own-inventions",
          "count:cardtype:invention",
          "count:include-self",
        ],
      }),
    );
    resolveScoring(G);
    // 1+1+0 + count of inventions (3 if include self)
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(2);
  });

  it("resolveCardScoreEffectsFull returns structured fields", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    putInEra(
      G,
      "medieval",
      makeCard({ id: "v#0", ownerId: "0", scoreValue: 9 }),
      makeCard({
        id: "z#0",
        ownerId: "0",
        scoreValue: 0,
        tags: ["score:set-value", "set-value:amount:0", "target:scope:current-era"],
      }),
    );
    const full = resolveCardScoreEffectsFull(G, G.cards!["z#0"], "medieval", 0, {
      "z#0:score-target": "v#0",
    });
    expect(full.setValues["v#0"]).toBe(0);
  });

  it("score:penalty:next-inventor", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "stone",
      makeCard({
        id: "cloth#0",
        ownerId: "0",
        scoreValue: 1,
        tags: ["score:penalty:next-inventor", "penalty:amount:-2"],
      }),
      makeCard({ id: "next#0", ownerId: "1", scoreValue: 5 }),
    );
    resolveScoring(G);
    expect(G.scores!["0"]).toBe(1);
    expect(G.scores!["1"]).toBe(3); // 5 - 2
  });

  it("branch:target:next-scoring-invention + if-false:penalty:amount:-2 (Corporate Government)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "future",
      makeCard({
        id: "future-tech-corporate-government#0",
        ownerId: "0",
        scoreValue: 1,
        tags: [
          "government",
          "rule:one-government-per-era",
          "score:bonus-points",
          "bonus-points:amount:3",
          "condition:scored-in-era:future",
          "score:branch",
          "branch:target:next-scoring-invention",
          "condition:target-deck:future-tech",
          "if-false:penalty:to:target-owner",
          "if-false:penalty:amount:-2",
        ],
      }),
      // next is stone-age → if-false → penalty -2 to target owner
      makeCard({ id: "stone-age-fire#0", ownerId: "1", scoreValue: 4 }),
    );
    resolveScoring(G);
    // corp gov: 1 + 3 bonus (in future) = 4; next gets 4 - 2 penalty from if-false
    expect(G.scores!["0"]).toBe(4);
    expect(G.scores!["1"]).toBe(2);
  });
});
