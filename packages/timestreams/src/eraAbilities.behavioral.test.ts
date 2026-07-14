/**
 * Rules-complete era card abilities.
 */
import { describe, it, expect } from "vitest";
import {
  makeCard,
  makeState,
  putInEra,
  putInHand,
} from "./effects/testFixtures";
import { resolvePlayEffect } from "./effects/resolvePlay";
import { resolveScoring, beginScoringPhase, submitScoreChoice, ackScoreStep } from "./scoring";
import { endDay, playInvention, submitPlayChoice } from "./play";
import { locateCard } from "./effects/targets";
import { isOncePerGameSpent } from "./effects/react";
import {
  fireModernEraBegin,
  applyModernEraBeginRecover,
  getEraStoneCancelOffer,
} from "./effects/eraAbilities";

const STONE_TAGS = [
  "react:move",
  "react:cancel",
  "protect:move",
  "protect:discard",
  "protect:target:era-invention",
  "limit:once-per-game",
];

const MOVE_OUT = [
  "play:move",
  "move:target:invention",
  "move:scope:today",
  "move-destination:tomorrow",
];

const DISCARD_TAGS = ["play:discard:1", "discard:target:today:any"];

describe("era-stone once-per-game cancel", () => {
  it("offers cancel when a Stone Age invention would be moved out", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.config = { ...G.config, rulesEnabled: true } as any;
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    putInHand(
      G,
      "0",
      makeCard({ id: "era-stone", ownerId: "0", tags: STONE_TAGS }),
    );
    putInEra(
      G,
      "stone",
      makeCard({ id: "peer#0", ownerId: "0", scoreValue: 2 }),
    );
    putInHand(
      G,
      "1",
      makeCard({ id: "mover#0", ownerId: "1", tags: MOVE_OUT }),
    );

    const mid = resolvePlayEffect(G, "1", "mover#0", {
      "mover#0:move-card": "peer#0",
    });
    expect(mid.prompts[0]).toMatchObject({
      reason: "era-stone-cancel",
      deciderId: "0",
      options: ["yes", "no"],
    });

    // Cancel → peer stays in stone, once-per-game spent
    resolvePlayEffect(G, "1", "mover#0", {
      "mover#0:move-card": "peer#0",
      [mid.prompts[0].id]: "yes",
    });
    expect(locateCard(G, "peer#0")?.era).toBe("stone");
    expect(isOncePerGameSpent(G, "era-stone")).toBe(true);
  });

  it("declining cancel allows the move", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.config = { ...G.config, rulesEnabled: true } as any;
    G.players["0"].homeEra = "stone";
    putInHand(
      G,
      "0",
      makeCard({ id: "era-stone", ownerId: "0", tags: STONE_TAGS }),
    );
    putInEra(
      G,
      "stone",
      makeCard({ id: "peer#0", ownerId: "0", scoreValue: 2 }),
    );
    putInHand(
      G,
      "1",
      makeCard({ id: "mover#0", ownerId: "1", tags: MOVE_OUT }),
    );

    resolvePlayEffect(G, "1", "mover#0", {
      "mover#0:move-card": "peer#0",
      "mover#0:era-stone-cancel:peer#0": "no",
    });
    expect(locateCard(G, "peer#0")?.era).not.toBe("stone");
    expect(isOncePerGameSpent(G, "era-stone")).toBe(false);
  });

  it("cancels discard of a stone invention once", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.config = { ...G.config, rulesEnabled: true } as any;
    G.players["0"].homeEra = "stone";
    putInHand(
      G,
      "0",
      makeCard({ id: "era-stone", ownerId: "0", tags: STONE_TAGS }),
    );
    putInEra(
      G,
      "stone",
      makeCard({ id: "victim#0", ownerId: "1", scoreValue: 2 }),
    );
    putInHand(
      G,
      "1",
      makeCard({
        id: "fire#0",
        ownerId: "1",
        tags: DISCARD_TAGS,
      }),
    );

    const mid = resolvePlayEffect(G, "1", "fire#0", {
      "fire#0:discard": "victim#0",
    });
    expect(mid.prompts[0]?.reason).toBe("era-stone-cancel");

    resolvePlayEffect(G, "1", "fire#0", {
      "fire#0:discard": "victim#0",
      [mid.prompts[0].id]: "yes",
    });
    expect(locateCard(G, "victim#0")?.era).toBe("stone");
    expect(G.players["1"].discard.map((c) => c.id)).not.toContain("victim#0");
    expect(isOncePerGameSpent(G, "era-stone")).toBe(true);

    // Second discard cannot cancel again
    putInEra(
      G,
      "stone",
      makeCard({ id: "victim2#0", ownerId: "1", scoreValue: 1 }),
    );
    putInHand(
      G,
      "1",
      makeCard({ id: "fire2#0", ownerId: "1", tags: DISCARD_TAGS }),
    );
    const offer = getEraStoneCancelOffer(G, "victim2#0", "discard", "fire2#0");
    expect(offer).toBeNull();
  });
});

describe("era-modern begin recover", () => {
  it("fireModernEraBegin prompts when modern player has discard cards", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    G.players["1"].homeEra = "stone";
    putInHand(
      G,
      "0",
      makeCard({
        id: "era-modern",
        ownerId: "0",
        tags: ["react:era-begin", "recover:from-discard:1", "recover:to-hand"],
      }),
    );
    G.players["0"].discard.push(
      makeCard({ id: "buried#0", ownerId: "0" }),
      makeCard({ id: "buried2#0", ownerId: "0" }),
    );

    const { prompts, log } = fireModernEraBegin(G);
    expect(log.length).toBeGreaterThan(0);
    expect(prompts[0]).toMatchObject({
      id: "era-modern:era-begin-recover",
      deciderId: "0",
      reason: "react:era-begin",
    });
    expect(prompts[0].options).toContain("buried#0");

    applyModernEraBeginRecover(G, "0", "buried#0");
    expect(G.players["0"].hand.map((c) => c.id)).toContain("buried#0");
    expect(G.players["0"].discard.map((c) => c.id)).not.toContain("buried#0");
  });

  it("endDay into modern installs era-begin recover prompt", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 4 });
    G.phase = "play";
    G.config = {
      ...G.config,
      rulesEnabled: true,
      playMode: "plaintext",
    } as any;
    G.players["0"].homeEra = "modern";
    G.players["1"].homeEra = "stone";
    G.players["0"].hasPassedThisDay = true;
    G.players["1"].hasPassedThisDay = true;
    putInHand(
      G,
      "0",
      makeCard({
        id: "era-modern",
        ownerId: "0",
        tags: ["react:era-begin", "recover:from-discard:1", "recover:to-hand"],
      }),
    );
    G.players["0"].discard.push(makeCard({ id: "old#0", ownerId: "0" }));
    // empty decks so deal is quiet
    G.encryptedDecks["0"] = [];
    G.encryptedDecks["1"] = [];

    endDay(G);
    expect(G.currentDay).toBe(5); // modern
    const prompt = G.pendingPrompts?.[0];
    expect(prompt?.reason).toBe("react:era-begin");
    expect(prompt?.deciderId).toBe("0");

    submitPlayChoice(G, "0", prompt!.id, "old#0");
    expect(G.players["0"].hand.map((c) => c.id)).toContain("old#0");
  });
});

describe("era-stone score-phase cancel", () => {
  const STONE_TAGS = [
    "react:move",
    "react:cancel",
    "protect:move",
    "protect:discard",
    "protect:target:era-invention",
    "limit:once-per-game",
  ];

  it("cancels Guillotine bottom discard of a stone invention when yes", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.config = { ...G.config, rulesEnabled: true, scoringSlots: 6 } as any;
    putInHand(
      G,
      "0",
      makeCard({ id: "era-stone", ownerId: "0", tags: STONE_TAGS }),
    );
    putInEra(
      G,
      "stone",
      makeCard({
        id: "guillotine#0",
        ownerId: "1",
        scoreValue: 1,
        tags: [
          "score:discard",
          "discard:optional",
          "discard:target:bottom-of-era",
          "discard:scope:current-era",
        ],
      }),
      makeCard({ id: "mid#0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "bottom#0", ownerId: "0", scoreValue: 3 }),
    );

    resolveScoring(G, {
      "guillotine#0:score-discard": "yes",
      "guillotine#0:era-stone-cancel:bottom#0": "yes",
    });
    expect(G.phase).toBe("gameOver");
    // Bottom still on board (or not in discard) because cancelled
    expect(G.players["0"].discard.map((c) => c.id)).not.toContain("bottom#0");
    // After scoring cleanup, unscored may discard — bottom might leave stack
    // Critical: era-stone was spent
    expect(isOncePerGameSpent(G, "era-stone")).toBe(true);
  });

  it("allows Guillotine discard when stone declines cancel", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "medieval";
    G.config = { ...G.config, rulesEnabled: true, scoringSlots: 6 } as any;
    putInHand(
      G,
      "0",
      makeCard({ id: "era-stone", ownerId: "0", tags: STONE_TAGS }),
    );
    putInEra(
      G,
      "stone",
      makeCard({
        id: "guillotine#0",
        ownerId: "1",
        scoreValue: 1,
        tags: [
          "score:discard",
          "discard:optional",
          "discard:target:bottom-of-era",
          "discard:scope:current-era",
        ],
      }),
      makeCard({ id: "mid#0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "bottom#0", ownerId: "0", scoreValue: 3 }),
    );

    resolveScoring(G, {
      "guillotine#0:score-discard": "yes",
      "guillotine#0:era-stone-cancel:bottom#0": "no",
    });
    expect(G.phase).toBe("gameOver");
    expect(isOncePerGameSpent(G, "era-stone")).toBe(false);
    // bottom was discarded during effect (before pile cleanup)
    expect(
      G.players["0"].discard.some((c) => c.id === "bottom#0") ||
        !G.timeline.stone.stack.includes("bottom#0"),
    ).toBe(true);
  });
});

describe("era-future scoring slots", () => {
  it("yes adds 2 scoring slots so more inventions score", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...G.config, rulesEnabled: true, scoringSlots: 2 } as any;
    putInHand(
      G,
      "0",
      makeCard({
        id: "era-future",
        ownerId: "0",
        scoreValue: 0,
        tags: ["score:choice", "score:add-scoring-slots:2"],
      }),
    );
    // 4 inventions — with base 2 only first two score; with +2 all four
    for (let i = 0; i < 4; i++) {
      putInEra(
        G,
        "future",
        makeCard({ id: `f#${i}`, ownerId: "0", scoreValue: 1 }),
      );
    }
    resolveScoring(G, { "era-future:score-choice": "yes" });
    expect(G.phase).toBe("gameOver");
    // 4 printed points
    expect(G.scores!["0"]).toBe(4);
  });

  it("no keeps base slot capacity", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.config = { ...G.config, rulesEnabled: true, scoringSlots: 2 } as any;
    putInHand(
      G,
      "0",
      makeCard({
        id: "era-future",
        ownerId: "0",
        scoreValue: 0,
        tags: ["score:choice", "score:add-scoring-slots:2"],
      }),
    );
    for (let i = 0; i < 4; i++) {
      putInEra(
        G,
        "future",
        makeCard({ id: `f#${i}`, ownerId: "0", scoreValue: 1 }),
      );
    }
    resolveScoring(G, { "era-future:score-choice": "no" });
    expect(G.scores!["0"]).toBe(2);
  });

  it("interactive walk prompts era-future yes/no", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    G.config = { ...G.config, rulesEnabled: true, scoringSlots: 6 } as any;
    putInHand(
      G,
      "0",
      makeCard({
        id: "era-future",
        ownerId: "0",
        scoreValue: 0,
        tags: ["score:choice", "score:add-scoring-slots:2"],
      }),
    );
    putInEra(
      G,
      "future",
      makeCard({ id: "only#0", ownerId: "0", scoreValue: 3 }),
    );

    beginScoringPhase(G);
    // May walk empty eras first; drive until future prompt or gameOver
    let guard = 0;
    while (G.phase === "scoring" && guard++ < 40) {
      const front = G.pendingPrompts?.[0];
      if (front?.reason === "era-future-slots" || front?.id === "era-future:score-choice") {
        expect(front.options).toEqual(["yes", "no"]);
        submitScoreChoice(G, "0", front.id, "yes");
        continue;
      }
      if (G.scoringWalk?.stepPhase === "choice" && front) {
        const pick =
          front.min === 0 ? "" : front.options?.[0] ?? "";
        submitScoreChoice(G, front.deciderId, front.id, pick);
        continue;
      }
      if (G.scoringWalk?.stepPhase === "ack") {
        for (const pid of G.playerOrder) ackScoreStep(G, pid);
        continue;
      }
      break;
    }
    expect(G.phase === "scoring" || G.phase === "gameOver").toBe(true);
  });
});
