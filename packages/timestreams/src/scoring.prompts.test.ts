import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  collectInteractivePromptsForCard,
  submitScoreChoice,
  ackScoreStep,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

describe("score prompts: Pottery, Nanotech, Genetic Modification", () => {
  it("Pottery prompts move when scored as its own slot", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;
    putInEra(
      G,
      "stone",
      makeCard({
        id: "pottery#0",
        ownerId: "0",
        name: "Pottery",
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
        ],
      }),
      makeCard({ id: "other#0", ownerId: "0", scoreValue: 1 }),
    );
    G.scoringActiveEra = "stone";
    const prompts = collectInteractivePromptsForCard(G, "pottery#0");
    expect(prompts[0]?.reason).toBe("score:move-optional");
    expect(prompts[0]?.options).toEqual(["yes", "no"]);
  });

  it("Pottery re-prompts after Alphabet used it (choices cleared per card step)", () => {
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
        id: "pottery#0",
        ownerId: "0",
        scoreValue: 3,
        tags: [
          "score:move",
          "move:optional",
          "move:target:any-card",
          "move-source:today",
          "move-destination:any-future-era",
        ],
      }),
      makeCard({ id: "x#0", ownerId: "0", scoreValue: 1 }),
    );
    beginScoringPhase(G);
    // Alphabet first
    expect(G.scoringWalk?.currentCardId).toBe("alpha#0");
    submitScoreChoice(G, "0", "alpha#0:score-target", "pottery#0");
    submitScoreChoice(G, "0", "pottery#0:score-move", "no");
    dualAck(G);
    // Pottery's own turn — must ask again (not reuse Alphabet's "no")
    expect(G.scoringWalk?.currentCardId).toBe("pottery#0");
    expect(G.scoringWalk?.stepPhase).toBe("choice");
    expect(G.pendingPrompts?.[0]?.id).toBe("pottery#0:score-move");
  });

  it("Nanotech prompts for NT/QC target even with steal tags", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.scoringActiveEra = "future";
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
        id: "nt#1",
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
        ],
      }),
      makeCard({
        id: "qc#0",
        ownerId: "0",
        subtypes: ["quantum-computing"],
        scoreValue: 2,
        tags: [
          "score:choice",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
        ],
      }),
    );
    const prompts = collectInteractivePromptsForCard(G, "nt#0");
    expect(prompts[0]?.reason).toBe("score:steal-perform");
    expect(prompts[0]?.options.sort()).toEqual(["nt#1", "qc#0"].sort());
    expect(prompts[0]?.min).toBe(1);
  });

  it("Cave Paintings prompts optional art target even with one art card", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.scoringActiveEra = "stone";
    putInEra(
      G,
      "stone",
      makeCard({
        id: "cave#0",
        ownerId: "0",
        scoreValue: 2,
        subtypes: ["cave-paintings", "art"],
        tags: [
          "score:penalty",
          "penalty:optional",
          "penalty:target:art",
          "penalty:amount:-3",
          "penalty:to:target-owner",
          "target:scope:today",
          "target:exclude-self",
        ],
      }),
      makeCard({
        id: "holo#0",
        ownerId: "1",
        name: "Holograms",
        subtypes: ["holograms", "art"],
        scoreValue: 2,
      }),
    );
    const prompts = collectInteractivePromptsForCard(G, "cave#0");
    expect(prompts[0]?.reason).toBe("score:penalty-target");
    expect(prompts[0]?.min).toBe(0);
    expect(prompts[0]?.options).toEqual(["holo#0"]);
  });

  it("Cybertechnology does not prompt for era (fixed top of future)", () => {
    const G = makeState({ players: ["0"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    G.scoringActiveEra = "modern";
    putInEra(
      G,
      "modern",
      makeCard({
        id: "cyber#0",
        ownerId: "0",
        tags: [
          "score:move",
          "move:optional",
          "move:target:invention",
          "move-source:today",
          "move-destination:top-future",
        ],
      }),
      makeCard({ id: "inv#0", ownerId: "0", scoreValue: 1 }),
    );
    const prompts = collectInteractivePromptsForCard(G, "cyber#0");
    expect(prompts.some((p) => p.reason === "score:move-optional")).toBe(true);
    // after yes
    G.scoreChoices = { "cyber#0:score-move": "yes" };
    const p2 = collectInteractivePromptsForCard(G, "cyber#0");
    expect(p2.some((p) => p.reason === "score:move-target")).toBe(true);
    expect(p2.some((p) => p.reason === "score:move-era")).toBe(false);
  });

  it("Nanotech → Nanotech prompts nested target for second activation", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.scoringActiveEra = "future";
    const ntTags = [
      "score:perform-other",
      "target:subtype:nanotech",
      "target:subtype:quantum-computing",
      "target:exclude-self",
      "target:scope:today",
      "steal:target-to:own-score-pile",
      "steal:even-non-scoring",
    ];
    putInEra(
      G,
      "future",
      makeCard({
        id: "nt#0",
        ownerId: "0",
        subtypes: ["nanotech"],
        tags: ntTags,
      }),
      makeCard({
        id: "nt#1",
        ownerId: "0",
        subtypes: ["nanotech"],
        tags: ntTags,
      }),
      makeCard({
        id: "qc#0",
        ownerId: "0",
        subtypes: ["quantum-computing"],
        tags: [
          "score:choice",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
        ],
      }),
    );
    G.scoreChoices = { "nt#0:score-target": "nt#1" };
    const prompts = collectInteractivePromptsForCard(G, "nt#0");
    // Nested NT1 can target QC or outer NT0 (chain loop), not itself
    const nested = prompts.find((p) => p.id === "nt#1:score-target");
    expect(nested).toBeTruthy();
    expect(nested!.options).toContain("qc#0");
    expect(nested!.options).toContain("nt#0");
    expect(nested!.options).not.toContain("nt#1");

    // After NT1 picks QC, Quantum Computing's slot choice must appear (holistic nest)
    G.scoreChoices = {
      "nt#0:score-target": "nt#1",
      "nt#1:score-target": "qc#0",
    };
    const afterQc = collectInteractivePromptsForCard(G, "nt#0");
    const qcChoice = afterQc.find((p) => p.id === "qc#0:score-choice");
    expect(qcChoice).toBeTruthy();
    expect(qcChoice!.options).toEqual(["option-a", "option-b"]);
  });

  it("Genetic Modification prompts to copy another card's value", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.scoringActiveEra = "future";
    putInEra(
      G,
      "future",
      makeCard({
        id: "gm#0",
        ownerId: "0",
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
      makeCard({ id: "poor#0", ownerId: "0", scoreValue: 1 }),
    );
    const prompts = collectInteractivePromptsForCard(G, "gm#0");
    expect(prompts[0]?.reason).toBe("score:bonus-copy");
    expect(prompts[0]?.options).toContain("rich#0");
    expect(prompts[0]?.options).toContain("poor#0");
    expect(prompts[0]?.options).not.toContain("gm#0");
  });
});
