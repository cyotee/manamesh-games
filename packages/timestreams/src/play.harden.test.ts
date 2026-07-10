import { describe, it, expect } from "vitest";
import { playInvention, submitPlayChoice, INVALID_MOVE } from "./play";
import { makeCard, makeState, putInHand } from "./effects/testFixtures";
import { locateCard } from "./effects/targets";

const ctx = (currentPlayer = "0") =>
  ({ currentPlayer, playOrder: ["0", "1"] } as any);

describe("play move hardening (idempotent re-resolve)", () => {
  it("optional self-move (Air Cars style) applies only once across re-submits", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config = { ...(G.config || {}), rulesEnabled: true } as any;

    const air = makeCard({
      id: "air#0",
      ownerId: "0",
      name: "Air Cars",
      cardType: "invention",
      tags: [
        "play:move",
        "move:optional",
        "move:target:self",
        "move:amount:2",
        "move:direction:up",
      ],
    });
    // Stack of fillers so "up 2" is meaningful
    putInHand(G, "0", air);
    G.timeline.stone.stack = ["a#0", "b#0", "c#0"];
    // register fillers
    for (const id of ["a#0", "b#0", "c#0"]) {
      G.cards![id] = makeCard({ id, ownerId: "0", scoreValue: 1 });
    }

    // First play — needs optional yes/no
    let r = playInvention(G, ctx(), "0", "air#0");
    expect(r).not.toBe(INVALID_MOVE);
    expect(G.timeline.stone.stack).toContain("air#0");
    expect(G.pendingPrompts?.[0]?.id).toBe("air#0:move-card");

    // Answer move
    r = submitPlayChoice(G, "0", "air#0:move-card", "move");
    expect(r).not.toBe(INVALID_MOVE);
    expect(G.playEffectsComplete?.["air#0"]).toBe(true);

    const idxAfter = G.timeline.stone.stack.indexOf("air#0");
    expect(idxAfter).toBeLessThan(3); // moved up

    // Spam re-submit / re-play — must not move again or re-place
    const stackSnap = [...G.timeline.stone.stack];
    playInvention(G, ctx(), "0", "air#0", { "air#0:move-card": "move" });
    playInvention(G, ctx(), "0", "air#0", { "air#0:move-card": "move" });
    submitPlayChoice(G, "0", "air#0:move-card", "move");
    expect(G.timeline.stone.stack).toEqual(stackSnap);
    expect(G.timeline.stone.stack.filter((id) => id === "air#0")).toHaveLength(
      1,
    );
  });

  it("choice draw (Laser option-a) does not re-queue draws on re-submit", () => {
    const G = makeState({ players: ["0"], currentDay: 5 });
    G.players["0"].homeEra = "future";
    G.config = {
      ...(G.config || {}),
      rulesEnabled: true,
      playMode: "plaintext",
    } as any;

    const laser = makeCard({
      id: "laser#0",
      ownerId: "0",
      name: "High-powered Laser",
      cardType: "invention",
      tags: [
        "play:choice",
        "option-a:draw:2",
        "option-a:draw:to:self",
        "option-b:discard:1",
      ],
    });
    putInHand(G, "0", laser);

    playInvention(G, ctx(), "0", "laser#0");
    expect(G.pendingPrompts?.[0]?.id).toBe("laser#0:option");

    const drawsBefore = G.pendingDecryptRequests?.length ?? 0;
    // plaintext may deal immediately — track hand growth or fired tags
    submitPlayChoice(G, "0", "laser#0:option", "option-a");
    expect(G.playEffectsComplete?.["laser#0"]).toBe(true);

    const firedDraws = (G.firedTags || []).filter((t) =>
      t.includes("play-once:laser#0:choice-draw"),
    );
    expect(firedDraws.length).toBe(1);

    // Re-submit must not fire another draw
    playInvention(G, ctx(), "0", "laser#0", {
      "laser#0:option": "option-a",
    });
    const firedAfter = (G.firedTags || []).filter((t) =>
      t.includes("play-once:laser#0:choice-draw"),
    );
    expect(firedAfter.length).toBe(1);
    expect(G.timeline.modern.stack.filter((id) => id === "laser#0")).toHaveLength(
      1,
    );
    void drawsBefore;
  });

  it("cannot play the same invention twice while it is already on the board", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    const card = makeCard({
      id: "fire#0",
      ownerId: "0",
      name: "Fire",
      cardType: "invention",
      tags: [],
    });
    putInHand(G, "0", card);
    playInvention(G, ctx(), "0", "fire#0");
    expect(locateCard(G, "fire#0")?.era).toBe("stone");

    // Put a fake copy back in hand with same id (pathological) — still blocked
    G.players["0"].hand.push(card);
    const r = playInvention(G, ctx(), "0", "fire#0");
    expect(r).toBe(INVALID_MOVE);
    expect(G.timeline.stone.stack.filter((id) => id === "fire#0")).toHaveLength(
      1,
    );
  });
});
