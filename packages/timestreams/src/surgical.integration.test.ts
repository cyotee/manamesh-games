import { describe, it, expect } from "vitest";
import { playAction, submitPlayChoice } from "./play";
import { makeCard, makeState, putInEra, putInHand } from "./effects/testFixtures";

const SURGICAL = [
  "play:choice",
  "target:choose:invention",
  "target:scope:today",
  "decider:target-owner",
  "option-a:discard:target",
  "option-b:discard:hand:3",
  "option-b:discard:by:target-owner",
  "forced:option-a:if-hand-under-3",
];

describe("Surgical Strike dual-seat prompt chain", () => {
  it("P0 chooses target → P1 is decider for option prompt", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.phase = "play";
    putInEra(
      G,
      "modern",
      makeCard({ id: "victim#0", name: "Victim", ownerId: "1", scoreValue: 2 }),
    );
    for (let i = 0; i < 4; i++) {
      putInHand(G, "1", makeCard({ id: `h${i}#0`, ownerId: "1" }));
    }
    const ss = makeCard({
      id: "modern-surgical-strike#0",
      name: "Surgical Strike",
      ownerId: "0",
      cardType: "action",
      tags: SURGICAL,
    });
    putInHand(G, "0", ss);

    playAction(G, { currentPlayer: "0" } as any, "0", ss.id, {});
    expect(G.pendingPrompts?.[0]?.deciderId).toBe("0");
    expect(G.pendingPrompts?.[0]?.id).toContain("choose-target");

    expect(
      submitPlayChoice(
        G,
        "0",
        "modern-surgical-strike#0:choose-target",
        "victim#0",
      ),
    ).not.toBe("INVALID_MOVE");

    expect(G.pendingPrompts?.[0]).toMatchObject({
      id: "modern-surgical-strike#0:option",
      deciderId: "1",
      reason: "play:choice",
      options: ["option-a", "option-b"],
      labelCardId: "victim#0",
    });
    expect(G.pendingPlayEffect?.actorPlayerId).toBe("0");
    expect(G.pendingPlayEffect?.cardId).toBe(ss.id);

    // Non-actor (P1) can answer
    expect(
      submitPlayChoice(G, "1", "modern-surgical-strike#0:option", "option-b"),
    ).not.toBe("INVALID_MOVE");
    expect(G.pendingPrompts?.[0]?.id).toBe(
      "modern-surgical-strike#0:option-b-hand",
    );
    expect(G.pendingPrompts?.[0]?.deciderId).toBe("1");

    expect(
      submitPlayChoice(G, "1", "modern-surgical-strike#0:option-b-hand", [
        "h0#0",
        "h1#0",
        "h2#0",
      ]),
    ).not.toBe("INVALID_MOVE");
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players["1"].hand).toHaveLength(1);
    expect(G.timeline.modern.stack).toContain("victim#0");
  });

  it("P0 cannot answer P1's option prompt", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.phase = "play";
    putInEra(G, "modern", makeCard({ id: "victim#0", ownerId: "1" }));
    for (let i = 0; i < 4; i++) {
      putInHand(G, "1", makeCard({ id: `h${i}#0`, ownerId: "1" }));
    }
    putInHand(
      G,
      "0",
      makeCard({
        id: "modern-surgical-strike#0",
        ownerId: "0",
        cardType: "action",
        tags: SURGICAL,
      }),
    );
    playAction(G, { currentPlayer: "0" } as any, "0", "modern-surgical-strike#0");
    submitPlayChoice(
      G,
      "0",
      "modern-surgical-strike#0:choose-target",
      "victim#0",
    );
    expect(
      submitPlayChoice(G, "0", "modern-surgical-strike#0:option", "option-a"),
    ).toBe("INVALID_MOVE");
  });
});
