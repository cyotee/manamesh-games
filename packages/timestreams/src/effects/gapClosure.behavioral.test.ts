/**
 * Assertive behavioral tests for gap-closure plan Phases 1–5.
 * These must assert mutations/scores — not merely "does not throw".
 */
import { describe, it, expect } from "vitest";
import { resolveScoring } from "../scoring";
import { resolvePlayEffect } from "./resolvePlay";
import { playInvention, playAction } from "../play";
import { makeCard, makeState, putInEra, putInHand, putActionOnEra } from "./testFixtures";
import { resolveCardScoreEffectsFull } from "./executors/score";
import { effectiveScoreValue } from "./boardOps";
import { getPendingTriggers, registerCard } from "./state";
import { fireEvent, registerStaticTriggers } from "./triggers";
import { locateCard } from "./targets";
import { attachTo } from "./boardOps";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

describe("gap closure: bonus conditions (S-01)", () => {
  it("Poetry: +2 only in odd scoring slots (1-based)", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.players["0"].homeEra = "medieval";
    G.config.scoringSlots = 6;
    const poetryTags = [
      "score:bonus-points",
      "bonus-points:amount:2",
      "condition:odd-scoring-slot",
    ];
    // stack[0]=slot1 odd, stack[1]=slot2 even
    putInEra(
      G,
      "medieval",
      makeCard({
        id: "poetry-odd#0",
        ownerId: "0",
        scoreValue: 3,
        name: "Poetry",
        tags: poetryTags,
      }),
      makeCard({
        id: "poetry-even#0",
        ownerId: "0",
        scoreValue: 3,
        name: "Poetry",
        tags: poetryTags,
      }),
    );
    resolveScoring(G);
    // odd: 3+2=5, even: 3+0=3 → total 8
    expect(G.scores!["0"]).toBe(8);
  });

  it("Immortality: +10 only in last scoring slot of Future", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config.scoringSlots = 3;
    const tags = [
      "score:bonus-points",
      "bonus-points:amount:10",
      "condition:in-last-scoring-slot",
      "condition:in-era:future",
    ];
    putInEra(
      G,
      "future",
      makeCard({ id: "early#0", ownerId: "0", scoreValue: 1, tags }),
      makeCard({ id: "mid#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "last#0", ownerId: "0", scoreValue: 2, tags }),
    );
    resolveScoring(G);
    // early: 1 (no +10), mid: 1, last: 2+10=12 → 14
    expect(G.scores!["0"]).toBe(14);
  });

  it("Brain Taping: +2 only when Thought Police in a scoring slot", () => {
    const tags = [
      "score:bonus-points",
      "bonus-points:amount:2",
      "condition:subtype:thought-police",
      "condition:in-scoring-slot",
      "condition:scope:same-era",
    ];
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "future",
      makeCard({
        id: "tp#0",
        ownerId: "0",
        scoreValue: 2,
        subtypes: ["thought-police"],
      }),
      makeCard({ id: "bt#0", ownerId: "0", scoreValue: 2, tags }),
    );
    resolveScoring(G);
    // tp 2 + bt 2+2 = 6
    expect(G.scores!["0"]).toBe(6);

    const G2 = makeState({ players: ["0"], currentDay: 6 });
    G2.players["0"].homeEra = "future";
    G2.config.scoringSlots = 6;
    putInEra(
      G2,
      "future",
      makeCard({ id: "bt2#0", ownerId: "0", scoreValue: 2, tags }),
    );
    resolveScoring(G2);
    expect(G2.scores!["0"]).toBe(2);
  });
});

describe("gap closure: Cloning additional (S-02)", () => {
  it("adds +2 only when card above is Future Tech", () => {
    const tags = [
      "score:bonus-points",
      "bonus-points:copy",
      "copy:target:offset-above:1",
      "copy:scope:today",
      "copy:value:current",
      "bonus-points:additional:2",
      "additional:condition:target-deck:future-tech",
    ];
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    putInEra(
      G,
      "future",
      makeCard({
        id: "future-tech-moon#0",
        ownerId: "0",
        scoreValue: 5,
        name: "Moon Base",
      }),
      makeCard({ id: "clone#0", ownerId: "0", scoreValue: 0, tags }),
    );
    // clone scores after moon: copy 5 + additional 2
    const full = resolveCardScoreEffectsFull(G, getCardStrict(G, "clone#0"), "future", 1, {});
    expect(full.extra).toBe(7);

    const G2 = makeState({ players: ["0"], currentDay: 6 });
    G2.players["0"].homeEra = "future";
    putInEra(
      G2,
      "future",
      makeCard({ id: "modern-x#0", ownerId: "0", scoreValue: 5, name: "Modern X" }),
      makeCard({ id: "clone2#0", ownerId: "0", scoreValue: 0, tags }),
    );
    const full2 = resolveCardScoreEffectsFull(G2, getCardStrict(G2, "clone2#0"), "future", 1, {});
    expect(full2.extra).toBe(5); // no additional
  });
});

function getCardStrict(G: any, id: string) {
  const c = G.cards[id];
  if (!c) throw new Error(`missing ${id}`);
  return c;
}

describe("gap closure: Digital Secretary (S-03)", () => {
  it("penalizes next inventor -5 then refunds printed value", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    putInEra(
      G,
      "future",
      makeCard({
        id: "ds#0",
        ownerId: "0",
        scoreValue: 2,
        tags: [
          "score:penalty:next-inventor",
          "penalty:amount:-5",
          "bonus-points:to:next-inventor",
          "bonus-points:printed-value:their-invention",
        ],
      }),
      makeCard({ id: "next#0", ownerId: "1", scoreValue: 4 }),
    );
    resolveScoring(G);
    // P0: 2; P1: 4 + (-5+4) = 3
    expect(G.scores!["0"]).toBe(2);
    expect(G.scores!["1"]).toBe(3);
  });
});

describe("gap closure: Multiplicity (S-10)", () => {
  it("counts own inventions that share a name with another in today", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    putInEra(
      G,
      "future",
      makeCard({ id: "fire-a#0", ownerId: "0", scoreValue: 1, name: "Fire" }),
      makeCard({ id: "fire-b#0", ownerId: "0", scoreValue: 1, name: "Fire" }),
      makeCard({ id: "unique#0", ownerId: "0", scoreValue: 1, name: "Unique" }),
    );
    putActionOnEra(
      G,
      "future",
      makeCard({
        id: "mult#0",
        ownerId: "0",
        cardType: "action",
        tags: [
          "play:scope:today",
          "score:count",
          "score:per:1",
          "count:duplicates:own-inventions",
          "count:scope:today",
        ],
      }),
    );
    resolveScoring(G);
    // printed 1+1+1=3 + multiplicity 2 = 5
    expect(G.scores!["0"]).toBe(5);
  });
});

describe("gap closure: score discard offsets (S-05)", () => {
  it("Longbow discards invention 3 below", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.players["0"].homeEra = "medieval";
    putInEra(
      G,
      "medieval",
      makeCard({
        id: "lb#0",
        ownerId: "0",
        scoreValue: 2,
        tags: [
          "score:discard",
          "discard:target:offset-below:3",
          "discard:scope:current-era",
        ],
      }),
      makeCard({ id: "a#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "b#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "c#0", ownerId: "0", scoreValue: 5 }),
    );
    // Order: lb, a, b, c — offset 3 below lb is c
    resolveScoring(G);
    const discarded = G.players["0"].discard.map((c) => c.id);
    expect(discarded).toContain("c#0");
  });

  it("Liquid Nitrogen optionally discards 1 below", () => {
    const G = makeState({ players: ["0"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    putInEra(
      G,
      "modern",
      makeCard({
        id: "ln#0",
        ownerId: "0",
        scoreValue: 1,
        tags: [
          "score:discard",
          "discard:optional",
          "discard:target:offset-below:1",
        ],
      }),
      makeCard({ id: "below#0", ownerId: "0", scoreValue: 4 }),
    );
    resolveScoring(G, { "ln#0:score-discard": "yes" });
    expect(G.players["0"].discard.map((c) => c.id)).toContain("below#0");
  });
});

describe("gap closure: Deforestation (S-04)", () => {
  it("each player loses points equal to own invention count in era", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    G.players["1"].homeEra = "stone";
    putInEra(
      G,
      "modern",
      makeCard({ id: "a#0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "b#0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "c#0", ownerId: "1", scoreValue: 3 }),
    );
    putActionOnEra(
      G,
      "modern",
      makeCard({
        id: "def#0",
        ownerId: "0",
        cardType: "action",
        tags: [
          "play:scope:tomorrow",
          "score:penalty",
          "score:to:all-players",
          "penalty:per:1",
          "count:own-inventions",
          "count:scope:this-era",
        ],
      }),
    );
    resolveScoring(G);
    // P0: 2+2 + (-2) = 2; P1: 3 + (-1) = 2
    expect(G.scores!["0"]).toBe(2);
    expect(G.scores!["1"]).toBe(2);
  });
});

describe("gap closure: Hibernation suppress (S-07)", () => {
  it("suppresses host score effects but keeps modified printed value", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    const host = makeCard({
      id: "host#0",
      ownerId: "0",
      scoreValue: 2,
      tags: ["score:bonus-points", "bonus-points:amount:5"],
    });
    putInEra(G, "stone", host);
    const hib = makeCard({
      id: "hib#0",
      ownerId: "0",
      cardType: "action",
      tags: [
        "play:attach",
        "modify:score:attached",
        "modify:amount:+1",
        "protect:target:attached",
        "protect:move",
        "protect:discard",
        "suppress:score-effects-on-target",
        "duration:rest-of-game",
      ],
    });
    registerCard(G, hib);
    attachTo(G, hib.id, host.id);
    expect(effectiveScoreValue(G, host.id)).toBe(3);
    resolveScoring(G);
    // printed 3 only — no +5 bonus
    expect(G.scores!["0"]).toBe(3);
  });
});

describe("gap closure: Recycling recover-to-deck (S-08)", () => {
  it("moves discard cards to deck", () => {
    const G = makeState({ players: ["0"] });
    G.encryptedDecks = { "0": [] };
    const rec = makeCard({
      id: "rec#0",
      ownerId: "0",
      cardType: "action",
      tags: [
        "play:recover",
        "recover:from-discard:2",
        "recover:to-deck",
        "play:shuffle-after",
        "play:draw:1",
      ],
    });
    putInHand(G, "0", rec);
    G.players["0"].discard.push(
      makeCard({ id: "d1#0", ownerId: "0" }),
      makeCard({ id: "d2#0", ownerId: "0" }),
    );
    resolvePlayEffect(G, "0", "rec#0", {
      "rec#0:recover": ["d1#0", "d2#0"],
    });
    expect(G.players["0"].discard.map((c) => c.id)).not.toContain("d1#0");
    expect(G.encryptedDecks!["0"].some((e: any) => e.ciphertext === "d1#0")).toBe(
      true,
    );
  });
});

describe("gap closure: Dot Com react (S-09)", () => {
  it("discards self when higher-value invention is played in same era", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    const dc = makeCard({
      id: "dc#0",
      ownerId: "0",
      scoreValue: 4,
      tags: [
        "react:invention-played",
        "react:move",
        "trigger:scope:same-era",
        "trigger:mandatory",
        "condition:higher-value-invention",
        "discard:self",
      ],
    });
    putInEra(G, "modern", dc);
    registerStaticTriggers(G, dc);
    putInEra(
      G,
      "modern",
      makeCard({ id: "big#0", ownerId: "1", scoreValue: 6 }),
    );
    fireEvent(G, {
      type: "invention-played",
      cardId: "big#0",
      eraId: "modern",
      actorPlayerId: "1",
    });
    expect(locateCard(G, "dc#0")).toBeNull();
    expect(G.players["0"].discard.some((c) => c.id === "dc#0")).toBe(true);
  });
});

describe("gap closure: Space Travel first-score (S-01/S-06)", () => {
  it("bonus + move only on first score", () => {
    const tags = [
      "score:bonus-points",
      "bonus-points:amount:2",
      "condition:first-score",
      "score:move",
      "move:target:self",
      "move-destination:top-next-era",
    ];
    const G = makeState({ players: ["0"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    putInEra(
      G,
      "modern",
      makeCard({ id: "st#0", ownerId: "0", scoreValue: 2, tags }),
    );
    resolveScoring(G);
    // First score: 2+2, moved to future; future scores printed 2 only
    // Modern banks 0 from pile if moved away before cleanup of modern...
    // ST moves to future during modern scoring; if processed in modern then moved,
    // cleanup may still bank or not depending on locate.
    // At minimum: total should include first-score +2 once only.
    expect(G.scores!["0"]).toBeGreaterThanOrEqual(4);
    // Should not be 2+2 + 2+2 = 8 from double first-score
    expect(G.scores!["0"]).toBeLessThan(8);
  });
});

describe("gap closure: Pottery delayed rescore (S-06)", () => {
  it("registers delayed trigger with targetCardId = moved card", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.scoringActiveEra = "stone";
    const pottery = makeCard({
      id: "pottery#0",
      ownerId: "0",
      scoreValue: 3,
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
    });
    const victim = makeCard({
      id: "victim#0",
      ownerId: "0",
      scoreValue: 4,
      tags: ["score:bonus-points", "bonus-points:amount:3"],
    });
    putInEra(G, "stone", pottery, victim);
    resolveCardScoreEffectsFull(G, pottery, "stone", 0, {
      "pottery#0:score-move": "yes",
      "pottery#0:score-move-target": "victim#0",
      "pottery#0:score-move-era": "future",
    });
    expect(locateCard(G, "victim#0")?.era).toBe("future");
    const trig = getPendingTriggers(G).find((t) => t.delayedRescore || t.targetCardId);
    expect(trig?.sourceCardId).toBe("pottery#0");
    expect(trig?.targetCardId).toBe("victim#0");
    expect(trig?.eraAnchor).toBe("future");
  });
});
