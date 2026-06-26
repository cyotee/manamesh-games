import { describe, it, expect } from "vitest";
import { playInvention, playAction, pass, INVALID_MOVE } from "./play";
import { createTimeline } from "./timeline";

function ctx(player: string) {
  return { currentPlayer: player, numPlayers: 2, playOrder: ["0", "1"], phase: "play" } as any;
}
function G() {
  return {
    phase: "play", currentDay: 1, playerOrder: ["0", "1"],
    timeline: createTimeline(), cardVisibility: {}, proofChain: [],
    config: { scoringSlots: 6, drawTable: { 2: 6 } },
    encryptedDecks: { "0": [], "1": [] },
    dayFirstPlayer: "0",
    pendingDecryptRequests: [],
    players: {
      "0": { homeEra: "stone", hand: [
        { id: "0-i", ownerId: "0", name: "Score 1 Point", cardType: "invention", scoreEffect: "Score 1 Point" },
        { id: "0-a", ownerId: "0", name: "Score 1 Point", cardType: "action", scoreEffect: "Score 1 Point" },
      ], discard: [], scorePile: [], hasPassedThisDay: false },
      "1": { homeEra: "future", hand: [], discard: [], scorePile: [], hasPassedThisDay: false },
    },
  } as any;
}

describe("play-phase moves", () => {
  it("plays an invention into the current era", () => {
    const g = G();
    playInvention(g, ctx("0"), "0", "0-i");
    expect(g.timeline.stone.stack).toEqual(["0-i"]);
    expect(g.players["0"].hand.map((c: any) => c.id)).toEqual(["0-a"]);
    expect(g.cardVisibility["0-i"]).toBe("public");
  });

  it("rejects playing an action via playInvention", () => {
    const g = G();
    expect(playInvention(g, ctx("0"), "0", "0-a")).toBe(INVALID_MOVE);
  });

  it("action goes to discard with no effect", () => {
    const g = G();
    playAction(g, ctx("0"), "0", "0-a");
    expect(g.players["0"].discard.map((c: any) => c.id)).toEqual(["0-a"]);
  });

  it("rejects a non-current player", () => {
    const g = G();
    expect(playInvention(g, ctx("1"), "0", "0-i")).toBe(INVALID_MOVE);
  });

  it("advances the day when all players pass", () => {
    const g = G();
    pass(g, ctx("0"), "0");
    expect(g.currentDay).toBe(1);
    pass(g, ctx("1"), "1");
    expect(g.currentDay).toBe(2);
    expect(g.players["0"].hasPassedThisDay).toBe(false);
  });
});
