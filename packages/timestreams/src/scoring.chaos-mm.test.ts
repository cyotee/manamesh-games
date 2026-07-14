/**
 * Chaos Theory perform → Mass Marketing must prompt for bonus-copy target.
 */
import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  collectInteractivePromptsForCard,
  ackScoreStep,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";

const CHAOS_TAGS = [
  "score:choice",
  "score:perform-other",
  "perform:target-filter:any",
  "suppress:score-effects-on-target",
  "cancel:target-filter:unscored",
  "target:scope:current-era",
  "target:exclude-self",
];

const MM_TAGS = [
  "score:bonus-points",
  "bonus-points:copy",
  "copy:target:invention",
  "copy:value:printed",
  "target:scope:current-era",
];

describe("Chaos Theory → Mass Marketing nested prompts", () => {
  it("re-prompts MM copy target even if MM already scored its own ability", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    G.players["1"].homeEra = "stone";
    G.config.scoringSlots = 6;

    // Stack: MM first (scores own copy), then Chaos, then a high-value victim
    putInEra(
      G,
      "modern",
      makeCard({
        id: "mm#0",
        ownerId: "1",
        scoreValue: 1,
        name: "Mass Marketing",
        tags: MM_TAGS,
      }),
      makeCard({
        id: "chaos#0",
        ownerId: "0",
        scoreValue: 2,
        name: "Chaos Theory",
        tags: CHAOS_TAGS,
      }),
      makeCard({
        id: "victim#0",
        ownerId: "0",
        scoreValue: 5,
        name: "Clean Power",
      }),
    );

    expect(beginScoringPhase(G)).toBe(false);
    // MM's own slot first
    expect(G.scoringWalk?.currentCardId).toBe("mm#0");
    expect(submitScoreChoice(G, "1", "mm#0:score-target", "victim#0")).not.toBe(
      "INVALID_MOVE",
    );
    // dual-ack MM
    ackScoreStep(G, "0");
    ackScoreStep(G, "1");

    // Chaos turn
    expect(G.scoringWalk?.currentCardId).toBe("chaos#0");
    expect(submitScoreChoice(G, "0", "chaos#0:score-target", "mm#0")).not.toBe(
      "INVALID_MOVE",
    );
    expect(submitScoreChoice(G, "0", "chaos#0:score-choice", "perform")).not.toBe(
      "INVALID_MOVE",
    );

    // Must re-prompt — old mm#0:score-target must not be treated as perform cycle
    const mmCopy = (G.pendingPrompts ?? []).find(
      (p) => p.id === "mm#0:score-target" || p.reason === "score:bonus-copy",
    );
    expect(
      mmCopy,
      `expected re-prompt for MM copy, got ${JSON.stringify(G.pendingPrompts)} choices=${JSON.stringify(G.scoreChoices)}`,
    ).toBeTruthy();
  });

  it("after perform target + perform mode, prompts for MM copy target", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    G.players["1"].homeEra = "stone";
    G.config.scoringSlots = 6;

    putInEra(
      G,
      "modern",
      makeCard({
        id: "chaos#0",
        ownerId: "0",
        scoreValue: 2,
        name: "Chaos Theory",
        tags: CHAOS_TAGS,
      }),
      makeCard({
        id: "mm#0",
        ownerId: "1",
        scoreValue: 1,
        name: "Mass Marketing",
        tags: MM_TAGS,
      }),
      makeCard({
        id: "victim#0",
        ownerId: "0",
        scoreValue: 5,
        name: "Clean Power",
      }),
    );

    expect(beginScoringPhase(G)).toBe(false);
    expect(G.scoringWalk?.currentCardId).toBe("chaos#0");
    expect(G.scoringWalk?.stepPhase).toBe("choice");

    // 1) Choose Mass Marketing as perform target
    expect(G.pendingPrompts?.[0]?.id).toBe("chaos#0:score-target");
    expect(
      submitScoreChoice(G, "0", "chaos#0:score-target", "mm#0"),
    ).not.toBe("INVALID_MOVE");

    // 2) Choose perform (not suppress)
    expect(G.pendingPrompts?.[0]?.id).toBe("chaos#0:score-choice");
    expect(
      submitScoreChoice(G, "0", "chaos#0:score-choice", "perform"),
    ).not.toBe("INVALID_MOVE");

    // 3) Must prompt for Mass Marketing's invention copy target
    const prompts = collectInteractivePromptsForCard(G, "chaos#0");
    const mmCopy = (G.pendingPrompts ?? []).find(
      (p) => p.id === "mm#0:score-target" || p.reason === "score:bonus-copy",
    );
    expect(
      mmCopy,
      `expected MM bonus-copy prompt, got: ${JSON.stringify(G.pendingPrompts)} | collect=${JSON.stringify(prompts)}`,
    ).toBeTruthy();
    expect(mmCopy!.options).toContain("victim#0");
    expect(mmCopy!.options).toContain("chaos#0"); // self-era inventions
    // Chaos player decides (as-if-own perform for Chaos; nestedDecider = chaos owner)
    expect(mmCopy!.deciderId).toBe("0");
  });
});
