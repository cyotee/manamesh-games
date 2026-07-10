import { describe, it, expect } from "vitest";
import {
  beginScoringPhase,
  submitScoreChoice,
  ackScoreStep,
} from "./scoring";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";

const ntTags = [
  "score:perform-other",
  "target:subtype:nanotech",
  "target:subtype:quantum-computing",
  "target:exclude-self",
  "target:scope:today",
  "steal:target-to:own-score-pile",
  "steal:even-non-scoring",
];

function dualAck(G: any) {
  for (const pid of G.playerOrder) {
    const r = ackScoreStep(G, pid);
    expect(r).not.toBe("INVALID_MOVE");
  }
}

describe("scoring walk continues after Nanotech loop", () => {
  it("2p dual-ack advances past NT0→NT1→NT0 cycle to next card", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 3 } as any;
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
      makeCard({ id: "z#0", ownerId: "0", scoreValue: 9 }),
    );

    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("nt#0");
    expect(submitScoreChoice(G, "0", "nt#0:score-target", "nt#1")).not.toBe(
      "INVALID_MOVE",
    );
    expect(submitScoreChoice(G, "0", "nt#1:score-target", "nt#0")).not.toBe(
      "INVALID_MOVE",
    );
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.timeline.future.stack).toEqual(["z#0"]);
    expect(G.players["0"].scorePile.map((c) => c.id)).toEqual(
      expect.arrayContaining(["nt#0", "nt#1"]),
    );

    dualAck(G);
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(G.scoringWalk?.currentCardId).toBe("z#0");
    expect(G.scoringWalk?.acks).toEqual({ "0": false, "1": false });

    // Next card button works for both seats
    expect(ackScoreStep(G, "0")).toBe(false);
    expect(ackScoreStep(G, "1")).not.toBe("INVALID_MOVE");
  });

  it("recovers from stuck choice+empty pending via ackScoreStep", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.players["0"].homeEra = "future";
    G.players["1"].homeEra = "stone";
    G.config = { ...(G.config || {}), scoringSlots: 2 } as any;
    putInEra(
      G,
      "future",
      makeCard({ id: "a#0", ownerId: "0", scoreValue: 3 }),
      makeCard({ id: "b#0", ownerId: "0", scoreValue: 4 }),
    );
    beginScoringPhase(G);
    expect(G.scoringWalk?.currentCardId).toBe("a#0");
    expect(G.scoringWalk?.stepPhase).toBe("ack");

    // Simulate corrupt stuck state after a multi-step chain bug
    G.scoringWalk!.stepPhase = "choice";
    G.pendingPrompts = [];
    G.scoringWalk!.acks = { "0": false, "1": false };

    expect(ackScoreStep(G, "0")).toBe(false);
    expect(G.scoringWalk?.stepPhase).toBe("ack");
    expect(ackScoreStep(G, "1")).not.toBe("INVALID_MOVE");
    expect(G.scoringWalk?.currentCardId).toBe("b#0");
  });
});
