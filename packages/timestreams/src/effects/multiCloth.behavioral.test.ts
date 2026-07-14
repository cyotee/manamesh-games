/**
 * Multi-Cloth redirect (PRD §3.13–3.14) + Hibernation fizzle combo.
 */
import { describe, it, expect } from "vitest";
import { resolvePlayEffect } from "./resolvePlay";
import {
  makeCard,
  makeState,
  putInEra,
  putInHand,
} from "./testFixtures";
import { attachTo } from "./boardOps";
import {
  findClothMoveRedirectClaimants,
  applyClothMoveRedirect,
} from "./react";
import { locateCard } from "./targets";

const CLOTH_TAGS = [
  "react:move",
  "trigger:move-out-of-era",
  "trigger:source:action",
  "trigger:mandatory",
  "protect:target:own-inventions",
  "target:exclude-self",
  "protect:scope:same-era",
  "redirect:target-to:self",
  "redirect:decider:owner",
  "redirect:target-filter:any",
  "redirect:on-immovable:fizzle",
];

const HIB_TAGS = [
  "protect:target:attached",
  "protect:move",
  "protect:discard",
  "suppress:score-effects-on-target",
];

/** Action that moves a chosen invention to bottom of tomorrow (out of era). */
const MOVE_OUT_TAGS = [
  "play:move",
  "move:target:invention",
  "move:scope:today",
  "move-destination:tomorrow",
];

describe("multi-Cloth redirect claimants", () => {
  it("finds same-era Cloths protecting owner's peer inventions", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(
      G,
      "stone",
      makeCard({
        id: "cloth-a#0",
        ownerId: "0",
        tags: CLOTH_TAGS,
      }),
      makeCard({
        id: "cloth-b#0",
        ownerId: "0",
        tags: CLOTH_TAGS,
      }),
      makeCard({ id: "peer#0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "enemy#0", ownerId: "1", scoreValue: 1 }),
    );
    expect(findClothMoveRedirectClaimants(G, "peer#0").sort()).toEqual([
      "cloth-a#0",
      "cloth-b#0",
    ]);
    // Enemy inventions not protected by P0 cloths
    expect(findClothMoveRedirectClaimants(G, "enemy#0")).toEqual([]);
    // Cloth does not claim for itself
    expect(findClothMoveRedirectClaimants(G, "cloth-a#0")).not.toContain(
      "cloth-a#0",
    );
  });

  it("single Cloth auto-redirects out-of-era move onto Cloth", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(
      G,
      "stone",
      makeCard({ id: "cloth#0", ownerId: "0", tags: CLOTH_TAGS }),
      makeCard({ id: "peer#0", ownerId: "0", scoreValue: 2 }),
    );
    putInHand(
      G,
      "1",
      makeCard({
        id: "mover#0",
        ownerId: "1",
        tags: MOVE_OUT_TAGS,
      }),
    );

    const res = resolvePlayEffect(G, "1", "mover#0", {
      "mover#0:move-card": "peer#0",
    });
    expect(res.prompts).toEqual([]);
    // Peer stays in stone; cloth moved out (tomorrow = medieval on day 1)
    expect(locateCard(G, "peer#0")?.era).toBe("stone");
    expect(locateCard(G, "cloth#0")?.era).not.toBe("stone");
  });

  it("two Cloths prompt owner to choose which absorbs", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(
      G,
      "stone",
      makeCard({ id: "cloth-a#0", ownerId: "0", tags: CLOTH_TAGS }),
      makeCard({ id: "cloth-b#0", ownerId: "0", tags: CLOTH_TAGS }),
      makeCard({ id: "peer#0", ownerId: "0", scoreValue: 2 }),
    );
    putInHand(
      G,
      "1",
      makeCard({
        id: "mover#0",
        ownerId: "1",
        tags: MOVE_OUT_TAGS,
      }),
    );

    const mid = resolvePlayEffect(G, "1", "mover#0", {
      "mover#0:move-card": "peer#0",
    });
    expect(mid.prompts[0]).toMatchObject({
      reason: "redirect:multi-cloth",
      deciderId: "0",
    });
    expect(mid.prompts[0].options.sort()).toEqual(["cloth-a#0", "cloth-b#0"]);

    resolvePlayEffect(G, "1", "mover#0", {
      "mover#0:move-card": "peer#0",
      "mover#0:cloth-absorb:peer#0": "cloth-b#0",
    });
    expect(locateCard(G, "peer#0")?.era).toBe("stone");
    expect(locateCard(G, "cloth-b#0")?.era).not.toBe("stone");
    expect(locateCard(G, "cloth-a#0")?.era).toBe("stone");
  });

  it("Hibernated Cloth redirect fizzles the whole move (PRD §3.14)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    const cloth = makeCard({ id: "cloth#0", ownerId: "0", tags: CLOTH_TAGS });
    putInEra(
      G,
      "stone",
      cloth,
      makeCard({ id: "peer#0", ownerId: "0", scoreValue: 2 }),
    );
    const hib = makeCard({
      id: "hib#0",
      ownerId: "0",
      cardType: "action",
      tags: HIB_TAGS,
    });
    G.cards![hib.id] = hib;
    attachTo(G, hib.id, cloth.id);

    const r = applyClothMoveRedirect(G, "peer#0", "1", "cloth#0");
    expect(r.cancelled).toBe(true);
    expect(r.log).toMatch(/immovable|fizzle/);

    putInHand(
      G,
      "1",
      makeCard({ id: "mover#0", ownerId: "1", tags: MOVE_OUT_TAGS }),
    );
    resolvePlayEffect(G, "1", "mover#0", {
      "mover#0:move-card": "peer#0",
    });
    // Both stay in stone — move fizzled
    expect(locateCard(G, "peer#0")?.era).toBe("stone");
    expect(locateCard(G, "cloth#0")?.era).toBe("stone");
  });
});
