/**
 * Crop Rotation + invent play-effect interactions (Organ Transplant stall).
 *
 * Bugs fixed:
 * 1. Organ's swap:target:self was misrouted as an event prompt → swap never ran,
 *    pending state desynced, turn stalled.
 * 2. finishPlayResolve wiped Crop prompts installed at place-time invention-played.
 *    Order is now: place → invent play effects → invention-played (Crop).
 */
import { describe, it, expect } from "vitest";
import { playInvention, submitPlayChoice } from "./play";
import { registerStaticTriggers } from "./effects/triggers";
import { makeCard, makeState, putInEra, putInHand } from "./effects/testFixtures";

const ctx = (pid: string) => ({ currentPlayer: pid } as any);

const CROP_TAGS = [
  "react:invention-played",
  "ongoing:trigger:invention-played",
  "trigger:scope:same-era",
  "trigger:persists:after-today-advances",
  "swap:optional",
  "swap:target:self",
  "swap:with:invention",
  "swap:scope:adjacent",
];

const ORGAN_TAGS = [
  "play:swap",
  "swap:target:self",
  "swap:with:invention",
  "swap:scope:today",
];

describe("Organ Transplant via submitPlayChoice (UI path)", () => {
  it("actually swaps when answered through submitPlayChoice", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.phase = "play";
    G.config = { ...G.config, rulesEnabled: true };

    putInEra(
      G,
      "modern",
      makeCard({ id: "peer#0", ownerId: "1", name: "Peer" }),
    );
    const organ = makeCard({
      id: "modern-organ-transplant#0",
      ownerId: "0",
      name: "Organ Transplant",
      tags: ORGAN_TAGS,
    });
    putInHand(G, "0", organ);

    playInvention(G, ctx("0"), "0", organ.id);
    expect(G.timeline.modern.stack).toContain(organ.id);
    expect(G.pendingPrompts?.[0]).toMatchObject({
      id: `${organ.id}:swap-with`,
      reason: "swap:target:self",
    });
    expect(G.pendingPlayEffect?.cardId).toBe(organ.id);

    const r = submitPlayChoice(G, "0", `${organ.id}:swap-with`, "peer#0");
    expect(r).not.toBe("INVALID_MOVE");
    // Organ was top; after swap with peer (below), peer is top, organ second
    expect(G.timeline.modern.stack).toEqual([organ.id, "peer#0"]);
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.pendingPlayEffect).toBeUndefined();
    expect(G.playEffectsComplete?.[organ.id]).toBe(true);
  });

  it("clears pending state after decline so turn can advance", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.phase = "play";
    G.config = { ...G.config, rulesEnabled: true };

    putInEra(G, "modern", makeCard({ id: "peer#0", ownerId: "1" }));
    const organ = makeCard({
      id: "modern-organ-transplant#0",
      ownerId: "0",
      tags: [...ORGAN_TAGS, "swap:optional"],
    });
    putInHand(G, "0", organ);

    playInvention(G, ctx("0"), "0", organ.id);
    submitPlayChoice(G, "0", `${organ.id}:swap-with`, "");
    expect(G.timeline.modern.stack).toEqual(["peer#0", organ.id]);
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.pendingPlayEffect).toBeUndefined();
  });
});

describe("Crop Rotation on invention-played", () => {
  it("prompts adjacent swap after invent effects settle (not wiped)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.phase = "play";
    G.config = { ...G.config, rulesEnabled: true };

    const below = makeCard({ id: "below#0", ownerId: "1", name: "Below" });
    const crop = makeCard({
      id: "medieval-crop-rotation#0",
      ownerId: "0",
      name: "Crop Rotation",
      tags: CROP_TAGS,
    });
    putInEra(G, "medieval", below, crop);
    registerStaticTriggers(G, crop);

    const invent = makeCard({
      id: "new-inv#0",
      ownerId: "0",
      name: "New Invention",
      tags: [],
    });
    putInHand(G, "0", invent);

    playInvention(G, ctx("0"), "0", invent.id);

    expect(G.timeline.medieval.stack).toEqual([
      "below#0",
      crop.id,
      invent.id,
    ]);
    // Crop must surface — not wiped by finishPlayResolve
    expect(G.pendingPrompts?.[0]).toMatchObject({
      id: `${crop.id}:crop-swap:${invent.id}`,
      reason: "crop-swap",
      deciderId: "0",
    });
    expect(G.pendingPrompts![0].options).toEqual(
      expect.arrayContaining(["below#0", invent.id, "__none__"]),
    );
    expect(G.pendingPlayEffect).toBeDefined();

    // Decline swap — board clears so turn can end
    submitPlayChoice(G, "0", `${crop.id}:crop-swap:${invent.id}`, "__none__");
    expect(G.timeline.medieval.stack).toEqual([
      "below#0",
      crop.id,
      invent.id,
    ]);
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.pendingPlayEffect).toBeUndefined();
  });

  it("applies adjacent swap when Crop owner accepts", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.phase = "play";
    G.config = { ...G.config, rulesEnabled: true };

    const below = makeCard({ id: "below#0", ownerId: "1" });
    const crop = makeCard({
      id: "medieval-crop-rotation#0",
      ownerId: "0",
      tags: CROP_TAGS,
    });
    putInEra(G, "medieval", below, crop);
    registerStaticTriggers(G, crop);

    const invent = makeCard({ id: "new-inv#0", ownerId: "1", tags: [] });
    putInHand(G, "0", invent);
    // player 0 invents even though invent owner was set — ownership updated on play
    playInvention(G, ctx("0"), "0", invent.id);

    submitPlayChoice(G, "0", `${crop.id}:crop-swap:${invent.id}`, "below#0");
    expect(G.timeline.medieval.stack).toEqual([
      crop.id,
      "below#0",
      invent.id,
    ]);
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.pendingPlayEffect).toBeUndefined();
  });

  it("Organ swap then Crop in same era: both resolve, no stall", () => {
    // Synthetic: Organ-like swap invent in medieval with Crop present
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.phase = "play";
    G.config = { ...G.config, rulesEnabled: true };

    const peer = makeCard({ id: "peer#0", ownerId: "1", name: "Peer" });
    const crop = makeCard({
      id: "medieval-crop-rotation#0",
      ownerId: "0",
      tags: CROP_TAGS,
    });
    putInEra(G, "medieval", peer, crop);
    registerStaticTriggers(G, crop);

    const organLike = makeCard({
      id: "swap-inv#0",
      ownerId: "0",
      name: "Swap Invent",
      tags: ORGAN_TAGS,
    });
    putInHand(G, "0", organLike);

    playInvention(G, ctx("0"), "0", organLike.id);

    // Invent play-effect prompt first (Crop deferred until swap settles)
    expect(G.pendingPrompts?.[0]).toMatchObject({
      id: `${organLike.id}:swap-with`,
      reason: "swap:target:self",
    });
    // Crop must NOT have wiped or replaced this
    expect(
      G.pendingPrompts?.some((p) => p.id.includes("crop-swap")),
    ).toBe(false);

    submitPlayChoice(G, "0", `${organLike.id}:swap-with`, "peer#0");

    // After invent effects, Crop fires
    const cropPrompt = G.pendingPrompts?.[0];
    expect(cropPrompt).toMatchObject({
      reason: "crop-swap",
      deciderId: "0",
    });
    expect(cropPrompt!.id).toContain(`${crop.id}:crop-swap:`);

    // Swap happened: organLike and peer exchanged
    expect(G.timeline.medieval.stack).toContain(organLike.id);
    expect(G.timeline.medieval.stack).toContain("peer#0");

    submitPlayChoice(G, "0", cropPrompt!.id, "__none__");
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.pendingPlayEffect).toBeUndefined();
    expect(G.playEffectsComplete?.[organLike.id]).toBe(true);
  });

  it("does not fire Crop for invention in a different era", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 5 });
    G.phase = "play";
    G.config = { ...G.config, rulesEnabled: true };

    const crop = makeCard({
      id: "medieval-crop-rotation#0",
      ownerId: "0",
      tags: CROP_TAGS,
    });
    putInEra(
      G,
      "medieval",
      makeCard({ id: "a#0", ownerId: "1" }),
      crop,
    );
    registerStaticTriggers(G, crop);

    putInEra(G, "modern", makeCard({ id: "m#0", ownerId: "1" }));
    const organ = makeCard({
      id: "modern-organ-transplant#0",
      ownerId: "0",
      tags: ORGAN_TAGS,
    });
    putInHand(G, "0", organ);

    playInvention(G, ctx("0"), "0", organ.id);
    expect(G.pendingPrompts?.[0]?.reason).toBe("swap:target:self");
    submitPlayChoice(G, "0", `${organ.id}:swap-with`, "m#0");
    // No Crop prompt after modern invent
    expect(
      (G.pendingPrompts || []).some((p) => p.reason === "crop-swap"),
    ).toBe(false);
    expect(G.pendingPlayEffect).toBeUndefined();
  });
});
