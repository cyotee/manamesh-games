import { describe, it, expect } from "vitest";
import { makeState } from "./effects/testFixtures";
import { debugSeedBoard } from "./debugSeed";
import { TimestreamsGame } from "./game";

describe("debugSeedBoard", () => {
  it("stages scoring phase timeline with rules off", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, debugSeed: true, rulesEnabled: false };
    const ok = debugSeedBoard(G, {
      phase: "scoring",
      rulesEnabled: false,
      timeline: {
        stone: [
          { id: "s0#0", name: "S0", ownerId: "0", scoreValue: 2 },
          { id: "s1#0", name: "S1", ownerId: "0", scoreValue: 1 },
        ],
      },
    });
    expect(ok).toBe(true);
    expect(G.phase).toBe("scoring");
    expect(G.timeline.stone.stack).toEqual(["s0#0", "s1#0"]);
    expect(G.manualBonus).toBeDefined();
  });

  it("game move accepts debugSeedBoard when config.debugSeed", () => {
    const setup = TimestreamsGame.setup as any;
    const G = setup(
      { playOrder: ["0", "1"], numPlayers: 2 },
      {
        moduleConfig: {
          playMode: "plaintext",
          rulesEnabled: false,
          debugSeed: true,
        },
      },
    );
    G.phase = "play";
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    const move = (TimestreamsGame as any).phases.play.moves.debugSeedBoard;
    expect(move).toBeDefined();
    const result = move.move(
      { G, ctx: { currentPlayer: "0" }, playerID: "0" },
      {
        phase: "scoring",
        rulesEnabled: false,
        timeline: {
          stone: [{ id: "s0#0", ownerId: "0", scoreValue: 2 }],
        },
      },
    );
    expect(result).not.toBe("INVALID_MOVE");
    expect(G.timeline.stone.stack).toContain("s0#0");
    expect(G.phase).toBe("scoring");
  });
});
