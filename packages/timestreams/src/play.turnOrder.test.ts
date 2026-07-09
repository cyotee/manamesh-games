import { describe, it, expect } from "vitest";
import { pass, endDay, playInvention } from "./play";
import { dayFirstPlayer, homeEraTurnOrder } from "./homeEra";
import { createCryptoInitialState } from "./crypto";
import { createTimeline } from "./timeline";
import { resolveNextPlayOrderPos, playOrderIndexForPlayer } from "./game";
import { getTurnFlags } from "./effects/state";
import { makeCard, putInHand, putInEra } from "./effects/testFixtures";

function playState() {
  const G = createCryptoInitialState(
    { numPlayers: 2, playerIDs: ["0", "1"] } as any,
    { playMode: "plaintext", rulesEnabled: true } as any,
  );
  G.phase = "play";
  G.currentDay = 1;
  G.players["0"].homeEra = "future";
  G.players["1"].homeEra = "stone";
  G.players["0"].ready = true;
  G.players["1"].ready = true;
  G.timeline = createTimeline();
  G.dayFirstPlayer = dayFirstPlayer(G, 1);
  G.startOfDayPending = true;
  return G;
}

describe("turn order (RULES.md home-era chronology)", () => {
  it("day 1 first player is earliest home era (stone before future)", () => {
    const G = playState();
    expect(homeEraTurnOrder(G)).toEqual(["1", "0"]);
    expect(dayFirstPlayer(G, 1)).toBe("1");
    expect(G.dayFirstPlayer).toBe("1");
  });

  it("after both pass, day advances and dayFirstPlayer rotates", () => {
    const G = playState();
    // Stone (1) passes, then Future (0) passes → all passed → endDay
    expect(pass(G, { currentPlayer: "1" } as any, "1")).not.toBe("INVALID_MOVE");
    expect(G.currentDay).toBe(1);
    expect(pass(G, { currentPlayer: "0" } as any, "0")).not.toBe("INVALID_MOVE");
    // Both passed → day 2
    expect(G.currentDay).toBe(2);
    expect(G.dayFirstPlayer).toBe("0"); // future goes first on day 2
    expect(G.startOfDayPending).toBe(true);
  });

  it("endDay sets startOfDayPending for turn.order.next", () => {
    const G = playState();
    G.currentDay = 1;
    endDay(G);
    expect(G.currentDay).toBe(2);
    expect(G.dayFirstPlayer).toBe(dayFirstPlayer(G, 2));
    expect(G.startOfDayPending).toBe(true);
  });

  it("Androids extra turn keeps the same current player after endTurn", () => {
    const G = playState();
    G.startOfDayPending = false;
    G.currentDay = 6; // future day for Androids context
    // Stone is P1 first in order, but current player is Future (0)
    const ctx = {
      currentPlayer: "0",
      playOrderPos: playOrderIndexForPlayer(G, "0"),
      numPlayers: 2,
      playOrder: ["0", "1"],
    } as any;

    putInEra(
      G,
      "modern",
      makeCard({ id: "nanotech#0", ownerId: "0", subtypes: ["nanotech"] }),
    );
    const androids = makeCard({
      id: "future-tech-androids#0",
      ownerId: "0",
      cardType: "invention",
      tags: [
        "play:requires-card",
        "requires:subtype:nanotech",
        "requires:scope:today-or-past",
        "play:extra-turn",
        "extra-turn:optional",
        "extra-turn:restriction:no-invention-play",
      ],
    });
    putInHand(G, "0", androids);

    playInvention(G, ctx, "0", androids.id);
    expect(G.pendingPrompts?.[0]?.reason).toBe("play:extra-turn");

    playInvention(G, ctx, "0", androids.id, {
      [`${androids.id}:extra-turn`]: "yes",
    });
    expect(getTurnFlags(G, "0").extraTurns).toBe(1);
    expect(getTurnFlags(G, "0").noInventionThisTurn).toBe(true);

    // Simulate endTurn → turn.order.next
    const nextPos = resolveNextPlayOrderPos(G, ctx);
    expect(nextPos).toBe(playOrderIndexForPlayer(G, "0"));
    expect(getTurnFlags(G, "0").extraTurns).toBe(0);
    // Restriction still holds for the extra turn
    expect(getTurnFlags(G, "0").noInventionThisTurn).toBe(true);

    // After the extra turn ends with no remaining extras, advance to next player
    const nextPos2 = resolveNextPlayOrderPos(G, {
      ...ctx,
      currentPlayer: "0",
      playOrderPos: playOrderIndexForPlayer(G, "0"),
    });
    expect(nextPos2).toBe(playOrderIndexForPlayer(G, "1"));
    expect(getTurnFlags(G, "0").noInventionThisTurn).toBe(false);
  });

  it("skipNextTurn skips that player once", () => {
    const G = playState();
    G.startOfDayPending = false;
    getTurnFlags(G, "0").skipNextTurn = true;
    // Current is stone (1); next would be future (0) but skipped → back to stone (1)
    // order is ["1","0"]
    const ctx = {
      currentPlayer: "1",
      playOrderPos: playOrderIndexForPlayer(G, "1"),
      numPlayers: 2,
      playOrder: ["0", "1"],
    } as any;
    const nextPos = resolveNextPlayOrderPos(G, ctx);
    // next after 1 is 0, but 0 is skipped → only 0 was candidate then wrap to 1
    // After skip 0, continue loop: next is 1
    expect(nextPos).toBe(playOrderIndexForPlayer(G, "1"));
    expect(getTurnFlags(G, "0").skipNextTurn).toBe(false);
  });
});
