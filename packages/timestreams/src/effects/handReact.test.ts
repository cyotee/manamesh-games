import { describe, it, expect } from "vitest";
import {
  getAvailableHandReacts,
  applyHandReact,
} from "./handReact";
import { makeCard, makeState, putInHand } from "./testFixtures";
import { playAction, submitReact } from "../play";

const HERBALISM_TAGS = [
  "react:action",
  "react:from:hand",
  "trigger:source:opponent",
  "react:cancel",
  "cancel:all-effects-of-source",
  "cost:discard-self",
];

function ctxFor(pid: string) {
  return { currentPlayer: pid } as any;
}

describe("hand reacts (Herbalism shape)", () => {
  it("getAvailableHandReacts finds opponent-held react:from:hand on action-played", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInHand(
      G,
      "0",
      makeCard({
        id: "herb#0",
        ownerId: "0",
        name: "Herbalism",
        cardType: "invention",
        tags: HERBALISM_TAGS,
      }),
    );
    const opps = getAvailableHandReacts(G, {
      type: "action-played",
      cardId: "act#0",
      actorPlayerId: "1",
    });
    expect(opps).toHaveLength(1);
    expect(opps[0].reactorCardId).toBe("herb#0");
    expect(opps[0].ownerId).toBe("0");
  });

  it("does not offer react to the Action's owner (trigger:source:opponent)", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    putInHand(
      G,
      "0",
      makeCard({
        id: "herb#0",
        ownerId: "0",
        tags: HERBALISM_TAGS,
      }),
    );
    const opps = getAvailableHandReacts(G, {
      type: "action-played",
      cardId: "act#0",
      actorPlayerId: "0",
    });
    expect(opps).toHaveLength(0);
  });

  it("ignores hand cards without react:from:hand", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInHand(
      G,
      "0",
      makeCard({
        id: "x#0",
        ownerId: "0",
        tags: ["react:action", "react:cancel", "cancel:all-effects-of-source"],
      }),
    );
    expect(
      getAvailableHandReacts(G, {
        type: "action-played",
        cardId: "a#0",
        actorPlayerId: "1",
      }),
    ).toHaveLength(0);
  });

  it("playAction pauses for hand react; yes cancels Action draw effect", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    // Seed decks so draw can work if not cancelled
    G.players["1"].deck = [
      { id: "d1", ownerId: "1" } as any,
      { id: "d2", ownerId: "1" } as any,
    ];
    // Actually decks are encrypted structure — use plaintext hand growth via tags carefully
    putInHand(
      G,
      "0",
      makeCard({
        id: "herb#0",
        ownerId: "0",
        name: "Herbalism",
        cardType: "invention",
        scoreValue: 2,
        tags: HERBALISM_TAGS,
      }),
    );
    putInHand(
      G,
      "1",
      makeCard({
        id: "think#0",
        ownerId: "1",
        name: "Think About The Future",
        cardType: "action",
        tags: ["play:draw:2"],
      }),
    );
    // Ensure draw has cards: materialize via cards registry + fake deck array if needed
    const beforeHand1 = G.players["1"].hand.length;

    const r = playAction(G, ctxFor("1"), "1", "think#0");
    expect(r).not.toBe("INVALID_MOVE");
    expect(G.pendingActionResolve?.cardId).toBe("think#0");
    expect(G.pendingPrompts?.[0]?.reason).toBe("react:from:hand");
    expect(G.pendingPrompts?.[0]?.deciderId).toBe("0");
    expect(G.pendingPrompts?.[0]?.options).toEqual(["yes", "no"]);

    // Action left player 1 hand already
    expect(G.players["1"].hand.map((c) => c.id)).not.toContain("think#0");
    // Effects not yet resolved — hand size of actor still same minus the action
    expect(G.players["1"].hand.length).toBe(beforeHand1 - 1);

    const ans = submitReact(G, "0", "herb#0:use-react", "yes");
    expect(ans).not.toBe("INVALID_MOVE");
    expect(G.pendingActionResolve).toBeUndefined();
    expect(G.players["0"].hand.map((c) => c.id)).not.toContain("herb#0");
    expect(G.players["0"].discard.map((c) => c.id)).toContain("herb#0");
    // Draw did not run (no pending prompts from draw; hand not grown)
    expect(G.players["1"].hand.length).toBe(beforeHand1 - 1);
  });

  it("declining hand react allows Action effects to resolve", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInHand(
      G,
      "0",
      makeCard({
        id: "herb#0",
        ownerId: "0",
        tags: HERBALISM_TAGS,
      }),
    );
    putInHand(
      G,
      "1",
      makeCard({
        id: "noop#0",
        ownerId: "1",
        cardType: "action",
        tags: ["play:draw:0"], // no-op-ish
      }),
    );

    playAction(G, ctxFor("1"), "1", "noop#0");
    expect(G.pendingActionResolve).toBeTruthy();

    submitReact(G, "0", "herb#0:use-react", "no");
    expect(G.pendingActionResolve).toBeUndefined();
    // Herbalism still in hand
    expect(G.players["0"].hand.map((c) => c.id)).toContain("herb#0");
  });

  it("applyHandReact is tag-shaped for a new invented card id", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInHand(
      G,
      "0",
      makeCard({
        id: "custom-counter#0",
        ownerId: "0",
        name: "Custom Counter",
        tags: HERBALISM_TAGS,
      }),
    );
    const event = {
      type: "action-played" as const,
      cardId: "enemy-act#0",
      actorPlayerId: "1",
    };
    const r = applyHandReact(G, "0", "custom-counter#0", event);
    expect(r.cancelled).toBe(true);
    expect(G.players["0"].discard.map((c) => c.id)).toContain("custom-counter#0");
  });
});
