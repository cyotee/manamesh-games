import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
  collectInteractivePromptsForCard,
  resolveScoring,
  processedInEra,
  computeScoringSlotsForEra,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";

function dualAck(G: any) {
  for (const pid of G.playerOrder) ackScoreStep(G, pid);
}

function advanceThroughCard(G: any, cardId: string) {
  // Answer any pending choices for this card, then dual-ack.
  let guard = 0;
  while (G.scoringWalk?.currentCardId === cardId && guard++ < 40) {
    if (G.scoringWalk.stepPhase === "choice") {
      const front = G.pendingPrompts?.[0];
      if (!front) break;
      const pick =
        front.min === 0
          ? ""
          : front.options?.[0] ?? "";
      const r = submitScoreChoice(G, front.deciderId, front.id, pick);
      expect(r).not.toBe("INVALID_MOVE");
    } else if (G.scoringWalk.stepPhase === "ack") {
      dualAck(G);
      break;
    } else {
      break;
    }
  }
}

describe("per-era reprocess (moved cards fill open slots again)", () => {
  it("card processed in stone then moved to medieval is processed again there", () => {
    // Stack stone: Mover (moves Target to medieval), Target (bonus +2).
    // Medieval has an open scoring slot. Target should re-run ability in medieval.
    // Printed value banks once (score pile).
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;

    putInEra(
      G,
      "stone",
      makeCard({
        id: "mover#0",
        ownerId: "0",
        name: "Mover",
        scoreValue: 1,
        tags: [
          "score:move",
          "move:target:any-card",
          "move-source:today",
          "move-destination:any-future-era",
          "target:exclude-self",
        ],
      }),
      makeCard({
        id: "target#0",
        ownerId: "0",
        name: "Target",
        scoreValue: 3,
        tags: ["score:bonus-points", "bonus-points:amount:2"],
      }),
    );
    // Empty medieval so moved card is in an open slot
    G.timeline.medieval.stack = [];

    beginScoringPhase(G);
    // Mover first — choose target + medieval era
    expect(G.scoringWalk?.currentCardId).toBe("mover#0");
    expect(G.scoringWalk?.stepPhase).toBe("choice");
    submitScoreChoice(G, "0", "mover#0:score-move-target", "target#0");
    submitScoreChoice(G, "0", "mover#0:score-move-era", "medieval");
    dualAck(G);

    // Target was moved before its stone slot — should NOT process in stone
    // Next in stone: nothing left → complete stone → medieval processes Target
    expect(G.scoringWalk?.currentCardId).toBe("target#0");
    expect(G.scoringWalk?.activeEraId).toBe("medieval");
    expect(processedInEra(G, "stone").includes("target#0")).toBe(false);
    dualAck(G);

    // Finish remaining empty eras
    let guard = 0;
    while (G.phase === "scoring" && guard++ < 30) {
      if (G.scoringWalk?.stepPhase === "ack") dualAck(G);
      else if (G.scoringWalk?.stepPhase === "choice") {
        const front = G.pendingPrompts?.[0];
        if (front) {
          submitScoreChoice(
            G,
            front.deciderId,
            front.id,
            front.options?.[0] ?? "",
          );
        } else break;
      } else break;
    }

    expect(G.phase).toBe("gameOver");
    // Printed once: mover 1 + target 3 = 4; bonus from target ability once in medieval = +2 → 6
    expect(G.players["0"].scorePile.map((c) => c.id).sort()).toEqual(
      ["mover#0", "target#0"].sort(),
    );
    expect(G.scores!["0"]).toBe(6);
    expect(processedInEra(G, "medieval")).toContain("target#0");
  });

  it("card processed in stone then moved mid-ability is reprocessed in destination", () => {
    // Self-ish: process Target in stone (bonus fires), THEN a later card moves it
    // to medieval — ability re-runs; printed still once.
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 6 } as any;

    putInEra(
      G,
      "stone",
      makeCard({
        id: "target#0",
        ownerId: "0",
        name: "Target",
        scoreValue: 3,
        tags: ["score:bonus-points", "bonus-points:amount:2"],
      }),
      makeCard({
        id: "mover#0",
        ownerId: "0",
        name: "Mover",
        scoreValue: 1,
        tags: [
          "score:move",
          "move:target:any-card",
          "move-source:today",
          "move-destination:any-future-era",
          "target:exclude-self",
        ],
      }),
    );

    beginScoringPhase(G);
    // Target processes in stone
    expect(G.scoringWalk?.currentCardId).toBe("target#0");
    dualAck(G);
    expect(processedInEra(G, "stone")).toContain("target#0");
    expect(G.bonusPoints!["0"]).toBe(2);

    // Mover moves Target to medieval
    expect(G.scoringWalk?.currentCardId).toBe("mover#0");
    submitScoreChoice(G, "0", "mover#0:score-move-target", "target#0");
    submitScoreChoice(G, "0", "mover#0:score-move-era", "medieval");
    dualAck(G);

    // Target should process again in medieval
    expect(G.scoringWalk?.currentCardId).toBe("target#0");
    expect(G.scoringWalk?.activeEraId).toBe("medieval");
    dualAck(G);

    let guard = 0;
    while (G.phase === "scoring" && guard++ < 30) {
      if (G.scoringWalk?.stepPhase === "ack") dualAck(G);
      else break;
    }

    expect(G.phase).toBe("gameOver");
    // Printed once: 3+1=4; bonus 2+2 from two ability runs = 4 → total 8
    expect(G.players["0"].scorePile.filter((c) => c.id === "target#0")).toHaveLength(
      1,
    );
    expect(G.scores!["0"]).toBe(8);
    expect(G.bonusPoints!["0"]).toBe(4);
  });
});

describe("nested perform chain (holistic, not card-specific depth)", () => {
  const ntTags = [
    "score:perform-other",
    "target:subtype:nanotech",
    "target:subtype:quantum-computing",
    "target:exclude-self",
    "target:scope:today",
    "steal:target-to:own-score-pile",
    "steal:even-non-scoring",
  ];

  it("Nanotech → Nanotech → Quantum Computing asks for score-choice (slot option)", () => {
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
        tags: ntTags,
      }),
      makeCard({
        id: "nt#1",
        ownerId: "0",
        subtypes: ["nanotech"],
        scoreValue: 2,
        tags: ntTags,
      }),
      makeCard({
        id: "qc#0",
        ownerId: "0",
        name: "Quantum Computing",
        subtypes: ["quantum-computing"],
        scoreValue: 2,
        tags: [
          "score:choice",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
        ],
      }),
    );

    G.scoreChoices = {
      "nt#0:score-target": "nt#1",
      "nt#1:score-target": "qc#0",
    };
    const prompts = collectInteractivePromptsForCard(G, "nt#0");
    const qcChoice = prompts.find((p) => p.id === "qc#0:score-choice");
    expect(qcChoice).toBeTruthy();
    expect(qcChoice!.reason).toBe("score:choice");
    expect(qcChoice!.options).toEqual(["option-a", "option-b"]);
  });

  it("two Nanotechs: nested can target outer so both steal to score pile", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.scoringActiveEra = "future";
    G.config = { ...(G.config || {}), scoringSlots: 2 } as any;
    putInEra(
      G,
      "future",
      makeCard({
        id: "nt#0",
        ownerId: "0",
        name: "Nanotech",
        subtypes: ["nanotech"],
        scoreValue: 2,
        tags: ntTags,
      }),
      makeCard({
        id: "nt#1",
        ownerId: "0",
        name: "Nanotech",
        subtypes: ["nanotech"],
        scoreValue: 2,
        tags: ntTags,
      }),
      makeCard({ id: "filler#0", ownerId: "0", scoreValue: 1 }),
    );

    // After NT0→NT1, nested NT1 must be able to target outer NT0 (chain loop).
    G.scoreChoices = { "nt#0:score-target": "nt#1" };
    const nested = collectInteractivePromptsForCard(G, "nt#0").find(
      (p) => p.id === "nt#1:score-target",
    );
    expect(nested).toBeTruthy();
    expect(nested!.options).toContain("nt#0");
    expect(nested!.options).not.toContain("nt#1"); // exclude-self

    // Closing the loop: no infinite re-prompt of NT0's perform.
    G.scoreChoices = {
      "nt#0:score-target": "nt#1",
      "nt#1:score-target": "nt#0",
    };
    const afterLoop = collectInteractivePromptsForCard(G, "nt#0");
    expect(afterLoop.find((p) => p.id === "nt#0:score-target")).toBeUndefined();
    expect(afterLoop.find((p) => p.id === "nt#1:score-target")).toBeUndefined();

    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("nt#0");
    submitScoreChoice(G, "0", "nt#0:score-target", "nt#1");
    submitScoreChoice(G, "0", "nt#1:score-target", "nt#0");
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    dualAck(G);

    const pile = G.players["0"].scorePile.map((c) => c.id);
    expect(pile).toEqual(expect.arrayContaining(["nt#0", "nt#1"]));
    expect(G.timeline.future.stack).not.toContain("nt#0");
    expect(G.timeline.future.stack).not.toContain("nt#1");
  });

  it("interactive walk: NT→NT→QC applies option-a slot increase", () => {
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
        scoreValue: 2,
        tags: ntTags,
      }),
      makeCard({
        id: "nt#1",
        ownerId: "0",
        subtypes: ["nanotech"],
        scoreValue: 2,
        tags: ntTags,
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
          "slots:scope:today",
        ],
      }),
      makeCard({ id: "extra#0", ownerId: "0", scoreValue: 5 }),
    );

    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("nt#0");
    submitScoreChoice(G, "0", "nt#0:score-target", "nt#1");
    submitScoreChoice(G, "0", "nt#1:score-target", "qc#0");
    // Must get QC choice before applying
    expect(G.scoringWalk?.stepPhase).toBe("choice");
    expect(G.pendingPrompts?.[0]?.id).toBe("qc#0:score-choice");
    submitScoreChoice(G, "0", "qc#0:score-choice", "option-a");
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    // Durable +1 recorded even though QC is stolen
    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(computeScoringSlotsForEra(G, "future")).toBe(3); // 2 base + 1 QC
    // NT1 + QC stolen to pile; slots should include +1 from option-a
    dualAck(G);

    // With base 2 slots +1 = 3: nt#0 used 1; nt#1 and qc stolen so not on board;
    // extra#0 should fill another slot
    expect(G.players["0"].scorePile.map((c) => c.id)).toEqual(
      expect.arrayContaining(["nt#1", "qc#0"]),
    );
  });

  it("Nanotech steals QC option-a: +1 slot lets one more invention score", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    // base 2 slots; QC +1 → 3. Stack: NT, QC, extra, leftover
    G.config = { ...(G.config || {}), scoringSlots: 2 } as any;
    putInEra(
      G,
      "future",
      makeCard({
        id: "nt#0",
        ownerId: "0",
        name: "Nanotech",
        subtypes: ["nanotech"],
        scoreValue: 2,
        tags: ntTags,
      }),
      makeCard({
        id: "qc#0",
        ownerId: "0",
        name: "Quantum Computing",
        subtypes: ["quantum-computing"],
        scoreValue: 2,
        tags: [
          "score:choice",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
          "slots:scope:today",
        ],
      }),
      makeCard({ id: "extra#0", ownerId: "0", name: "Moon Base", scoreValue: 5 }),
      makeCard({ id: "left#0", ownerId: "0", name: "Cloning", scoreValue: 1 }),
    );

    beginScoringPhase(G);
    submitScoreChoice(G, "0", "nt#0:score-target", "qc#0");
    expect(G.pendingPrompts?.[0]?.id).toBe("qc#0:score-choice");
    submitScoreChoice(G, "0", "qc#0:score-choice", "option-a");

    expect(G.scoringSlotBonusByEra?.future).toBe(1);
    expect(G.scoringWalk?.eraSlotTotal).toBe(3);
    expect(G.scoringWalk?.remainingSlots).toBe(2); // used 1 (NT), total 3

    dualAck(G);
    // QC stolen — next should be extra#0 (not left#0 yet)
    expect(G.scoringWalk?.currentCardId).toBe("extra#0");
    dualAck(G);
    // third slot — left#0 scores
    expect(G.scoringWalk?.currentCardId).toBe("left#0");
    dualAck(G);

    let guard = 0;
    while (G.phase === "scoring" && guard++ < 20) {
      if (G.scoringWalk?.stepPhase === "ack") dualAck(G);
      else break;
    }

    expect(G.phase).toBe("gameOver");
    // All four printed values banked (NT, QC steal, extra, left) = 2+2+5+1 = 10
    expect(G.players["0"].scorePile.map((c) => c.id).sort()).toEqual(
      ["extra#0", "left#0", "nt#0", "qc#0"].sort(),
    );
    expect(G.scores!["0"]).toBe(10);
  });
});

describe("score inventory helpers", () => {
  it("bonus ledger and pile are populated for verification", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    putInEra(
      G,
      "stone",
      makeCard({
        id: "b#0",
        ownerId: "0",
        name: "BonusCard",
        scoreValue: 2,
        tags: ["score:bonus-points", "bonus-points:amount:3"],
      }),
    );
    resolveScoring(G, {});
    expect(G.players["0"].scorePile.map((c) => c.id)).toContain("b#0");
    expect(G.bonusPoints!["0"]).toBe(3);
    expect(G.bonusLedger?.some((e) => e.amount === 3 && e.playerId === "0")).toBe(
      true,
    );
    expect(G.scores!["0"]).toBe(5);
  });
});
