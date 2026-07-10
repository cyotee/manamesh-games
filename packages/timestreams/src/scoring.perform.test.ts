import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
  collectInteractivePromptsForCard,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";
import { resolveCardScoreEffectsFull } from "./effects/executors/score";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

const POTTERY_TAGS = [
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
];

const ALPHABET_TAGS = [
  "score:perform-other",
  "perform:optional",
  "perform:target-filter:any",
  "decider:target-owner",
  "target:scope:today",
  "target:exclude-self",
];

describe("Shipbuilding score:move offset-below → bottom of today", () => {
  it("moves the invention below Shipbuilding to bottom of scoring era", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    putInEra(
      G,
      "stone",
      makeCard({
        id: "ship#0",
        ownerId: "0",
        name: "Shipbuilding",
        scoreValue: 2,
        tags: [
          "score:move",
          "move:target:offset-below:1",
          "move-destination:bottom-today",
        ],
      }),
      makeCard({ id: "below#0", ownerId: "0", name: "Below", scoreValue: 1 }),
      makeCard({ id: "bottom#0", ownerId: "0", name: "WasBottom", scoreValue: 1 }),
    );
    G.scoringActiveEra = "stone";
    const res = resolveCardScoreEffectsFull(
      G,
      G.cards!["ship#0"],
      "stone",
      0,
      {},
    );
    expect(res.log.join(" ")).toMatch(/moved below#0 to stone \(bottom\)/);
    expect(G.timeline.stone.stack).toEqual([
      "ship#0",
      "bottom#0",
      "below#0",
    ]);
  });
});

describe("Alphabet perform-other + Pottery prompts", () => {
  it("collectInteractivePromptsForCard requires choose among today inventions", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 3 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.scoringActiveEra = "renaissance";
    putInEra(
      G,
      "renaissance",
      makeCard({
        id: "alpha#0",
        ownerId: "0",
        name: "Alphabet",
        scoreValue: 2,
        tags: ALPHABET_TAGS,
      }),
      makeCard({
        id: "pottery#0",
        ownerId: "0",
        name: "Pottery",
        scoreValue: 3,
        tags: POTTERY_TAGS,
      }),
      makeCard({
        id: "ds#0",
        ownerId: "1",
        name: "Digital Secretary",
        scoreValue: 1,
        tags: [],
      }),
    );
    const prompts = collectInteractivePromptsForCard(G, "alpha#0");
    expect(prompts[0]?.reason).toBe("score:perform-other");
    expect(prompts[0]?.options.sort()).toEqual(["ds#0", "pottery#0"].sort());
    expect(prompts[0]?.min).toBe(0);
  });

  it("after choosing Pottery, pottery owner gets move prompts (not auto-target)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 3 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.scoringActiveEra = "renaissance";
    putInEra(
      G,
      "renaissance",
      makeCard({
        id: "alpha#0",
        ownerId: "0",
        scoreValue: 2,
        tags: ALPHABET_TAGS,
      }),
      makeCard({
        id: "pottery#0",
        ownerId: "0",
        scoreValue: 3,
        tags: POTTERY_TAGS,
      }),
      makeCard({ id: "ds#0", ownerId: "1", scoreValue: 1 }),
    );
    G.scoreChoices = { "alpha#0:score-target": "pottery#0" };
    const prompts = collectInteractivePromptsForCard(G, "alpha#0");
    // optional yes/no for pottery move first
    expect(prompts.some((p) => p.id === "pottery#0:score-move")).toBe(true);
    expect(prompts[0]?.deciderId).toBe("0"); // target owner
  });

  it("walk: Alphabet → choose Pottery → move Alphabet to future era", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 3 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    // Only renaissance has cards so walk starts there; other eras empty
    putInEra(
      G,
      "renaissance",
      makeCard({
        id: "alpha#0",
        ownerId: "0",
        name: "Alphabet",
        scoreValue: 2,
        tags: ALPHABET_TAGS,
      }),
      makeCard({
        id: "pottery#0",
        ownerId: "0",
        name: "Pottery",
        scoreValue: 3,
        tags: POTTERY_TAGS,
      }),
      makeCard({
        id: "ds#0",
        ownerId: "1",
        name: "Digital Secretary",
        scoreValue: 1,
      }),
    );

    expect(beginScoringPhase(G)).toBe(false);
    // First unscored is alphabet (top of stack)
    expect(G.scoringWalk?.currentCardId).toBe("alpha#0");
    expect(G.scoringWalk?.stepPhase).toBe("choice");
    expect(G.pendingPrompts?.[0]?.reason).toBe("score:perform-other");
    expect(G.pendingPrompts?.[0]?.options).toContain("pottery#0");
    expect(G.pendingPrompts?.[0]?.options).toContain("ds#0");

    submitScoreChoice(G, "0", "alpha#0:score-target", "pottery#0");
    // Pottery optional move
    expect(G.pendingPrompts?.[0]?.id).toBe("pottery#0:score-move");
    submitScoreChoice(G, "0", "pottery#0:score-move", "yes");
    // Choose card to move — Alphabet itself
    expect(G.pendingPrompts?.[0]?.id).toBe("pottery#0:score-move-target");
    submitScoreChoice(G, "0", "pottery#0:score-move-target", "alpha#0");
    // Choose future era
    expect(G.pendingPrompts?.[0]?.id).toBe("pottery#0:score-move-era");
    expect(G.pendingPrompts?.[0]?.options).toContain("industrial");
    expect(G.pendingPrompts?.[0]?.options).toContain("future");
    submitScoreChoice(G, "0", "pottery#0:score-move-era", "future");

    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(G.timeline.future.stack).toContain("alpha#0");
    expect(G.timeline.renaissance.stack).not.toContain("alpha#0");
    // Printed value not banked until pile; ability moved Alphabet away
    expect(G.scoringWalk!.provisionalScores["0"]).toBe(0);

    dualAck(G);
    // Next card pottery still in renaissance
    expect(G.scoringWalk?.currentCardId).toBe("pottery#0");
  });
});
