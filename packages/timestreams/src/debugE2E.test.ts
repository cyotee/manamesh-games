import { describe, it, expect } from "vitest";
import { applyDebugE2EAct } from "./debugE2E";
import { makeCard, makeState, putInEra, putInHand } from "./effects/testFixtures";
import { playAction } from "./play";
import { beginScoringPhase } from "./scoring";

describe("applyDebugE2EAct", () => {
  it("rejects when debugSeed is off", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, debugSeed: false } as any;
    const r = applyDebugE2EAct(G, { op: "ackAll" });
    expect(r.ok).toBe(false);
  });

  it("forceScoring sets phase when endPhase provided", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, debugSeed: true, rulesEnabled: true } as any;
    G.phase = "play";
    let ended = false;
    const r = applyDebugE2EAct(
      G,
      { op: "forceScoring" },
      {
        endPhase: () => {
          ended = true;
          // Simulate scoring onBegin
          beginScoringPhase(G);
        },
      },
    );
    expect(r.ok).toBe(true);
    expect(ended).toBe(true);
    expect(G.phase === "scoring" || G.phase === "gameOver").toBe(true);
  });

  it("finishScoring completes a simple board", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.config = {
      ...G.config,
      debugSeed: true,
      rulesEnabled: true,
      scoringSlots: 6,
    } as any;
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    putInEra(G, "stone", makeCard({ id: "a#0", ownerId: "0", scoreValue: 2 }));
    putInEra(G, "stone", makeCard({ id: "b#0", ownerId: "1", scoreValue: 3 }));

    applyDebugE2EAct(
      G,
      { op: "forceScoring" },
      {
        endPhase: () => {
          beginScoringPhase(G);
        },
      },
    );
    const fin = applyDebugE2EAct(G, { op: "finishScoring", maxSteps: 40 });
    expect(fin.ok).toBe(true);
    expect(G.phase).toBe("gameOver");
    expect((G.scores!["0"] ?? 0) + (G.scores!["1"] ?? 0)).toBeGreaterThanOrEqual(5);
  });

  it("react op cancels via Herbalism-style path", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, debugSeed: true, rulesEnabled: true } as any;
    G.phase = "play";
    putInHand(
      G,
      "1",
      makeCard({
        id: "herb#0",
        ownerId: "1",
        tags: [
          "react:action",
          "react:from:hand",
          "trigger:source:opponent",
          "react:cancel",
          "cancel:all-effects-of-source",
          "cost:discard-self",
        ],
      }),
    );
    putInHand(
      G,
      "0",
      makeCard({
        id: "act#0",
        ownerId: "0",
        cardType: "action",
        tags: ["play:draw:1"],
      }),
    );
    playAction(G, { currentPlayer: "0" } as any, "0", "act#0");
    const prompt = G.pendingPrompts?.[0];
    expect(prompt?.deciderId).toBe("1");
    const r = applyDebugE2EAct(G, {
      op: "react",
      playerId: "1",
      promptId: prompt!.id,
      value: "yes",
    });
    expect(r.ok).toBe(true);
    expect(G.players["1"].discard.map((c) => c.id)).toContain("herb#0");
  });
});
