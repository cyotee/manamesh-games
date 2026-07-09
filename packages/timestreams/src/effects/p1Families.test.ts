/**
 * P1 high-use family regression tests (plan Phase 4).
 * Parameterized smoke — proves executors/scorers still fire for common tags.
 */
import { describe, it, expect } from "vitest";
import { resolveScoring } from "../scoring";
import { playInvention, playAction } from "../play";
import { makeCard, makeState, putInEra, putInHand } from "./testFixtures";
import { erasForScope, hasTodayExtendToYesterday } from "./targets";
import { checkReactForMove, tryStealBonusPoints, isOncePerGameSpent } from "./react";
import { resolvePlayEffect } from "./resolvePlay";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

describe("P1 family regressions", () => {
  it.each([
    {
      name: "score:count + score:per:1 + count:scope:current-era",
      tags: ["score:count", "score:per:1", "count:scope:current-era", "count:cardtype:invention"],
    },
    {
      name: "count:own-inventions + count:include-self",
      tags: ["score:count", "score:per:1", "count:own-inventions", "count:include-self", "count:scope:today"],
    },
    {
      name: "count:scope:today",
      tags: ["score:count", "score:per:2", "count:scope:today"],
    },
  ])("scores with $name without throwing", ({ tags }) => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.config.scoringSlots = 6;
    putInEra(
      G,
      "stone",
      makeCard({ id: "x#0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "c#0", ownerId: "0", scoreValue: 0, tags }),
    );
    resolveScoring(G);
    expect(G.phase).toBe("gameOver");
    expect(typeof G.scores!["0"]).toBe("number");
  });

  it("play:scope:today + play:discard still targets today", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(G, "stone", makeCard({ id: "v#0", ownerId: "1" }));
    putInHand(
      G,
      "0",
      makeCard({
        id: "fire#0",
        ownerId: "0",
        tags: ["play:discard:1", "play:scope:today", "discard:target:today:any"],
      }),
    );
    playInvention(G, ctxFor("0"), "0", "fire#0");
    expect((G.pendingPrompts?.length ?? 0) + (G.players["1"].discard.length)).toBeGreaterThan(0);
  });

  it("move:target:invention + target:scope:current-era", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    putInEra(G, "stone", makeCard({ id: "m#0", ownerId: "0" }));
    putInHand(
      G,
      "0",
      makeCard({
        id: "mover#0",
        ownerId: "0",
        cardType: "action",
        tags: ["play:move", "move:target:invention", "target:scope:current-era", "move-destination:top-next-era"],
      }),
    );
    // action played on day 1 → stone is today/current
    playAction(G, ctxFor("0"), "0", "mover#0");
    // either prompt or move applied
    expect(G.phase).toBe("play");
  });

  it("bonus-points:amount:2 scores", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    putInEra(
      G,
      "stone",
      makeCard({
        id: "b#0",
        ownerId: "0",
        scoreValue: 1,
        tags: ["score:bonus-points", "bonus-points:amount:2"],
      }),
    );
    resolveScoring(G);
    expect(G.scores!["0"]).toBe(3);
  });

  it("extend:today-effects-to-yesterday expands today scope", () => {
    const G = makeState({ players: ["0"], currentDay: 2 }); // medieval today, stone yesterday
    putInEra(
      G,
      "medieval",
      makeCard({
        id: "modern-telecommunications#0",
        ownerId: "0",
        tags: ["extend:today-effects-to-yesterday", "condition:in-today"],
      }),
    );
    expect(hasTodayExtendToYesterday(G)).toBe(true);
    const eras = erasForScope(G, "today");
    expect(eras).toContain("medieval");
    expect(eras).toContain("stone");
  });

  it("limit:once-per-game + steal:bonus-points", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    const era = makeCard({
      id: "era-medieval#0",
      ownerId: "0",
      tags: [
        "react:bonus-points",
        "steal:bonus-points",
        "suppress:original-bonus-points",
        "limit:once-per-game",
      ],
    });
    G.cards = { [era.id]: era };
    const r1 = tryStealBonusPoints(G, era.id, "1", 5);
    expect(r1.stolen).toBe(5);
    expect(isOncePerGameSpent(G, era.id)).toBe(true);
    const r2 = tryStealBonusPoints(G, era.id, "1", 5);
    expect(r2.stolen).toBe(0);
  });

  it("redirect:target-to:self + on-immovable:fizzle (Cloth)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(
      G,
      "stone",
      makeCard({
        id: "stone-age-cloth#0",
        ownerId: "0",
        tags: [
          "react:move",
          "redirect:target-to:self",
          "redirect:decider:owner",
          "redirect:target-filter:any",
          "redirect:on-immovable:fizzle",
          "protect:target:own-inventions",
          "protect:scope:same-era",
        ],
      }),
    );
    // protect:target:own-inventions makes isProtected true for move → fizzle
    const d = checkReactForMove(G, "stone-age-cloth#0", "1");
    // may cancel due to protect or redirect-fizzle
    expect(d.cancelled || d.redirectTo === "stone-age-cloth#0").toBe(true);
  });

  it("play:draw family still resolves", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.encryptedDecks["0"] = [{ ciphertext: "stone-age-x", layers: 0 }];
    G.cards = { "stone-age-x": makeCard({ id: "stone-age-x", ownerId: "0" }) };
    putInHand(G, "0", makeCard({ id: "d#0", ownerId: "0", tags: ["play:draw:1"] }));
    const r = resolvePlayEffect(G, "0", "d#0");
    expect(r.ok).toBe(true);
  });

  it("score:penalty next-inventor family", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    putInEra(
      G,
      "stone",
      makeCard({
        id: "p#0",
        ownerId: "0",
        scoreValue: 0,
        tags: ["score:penalty:next-inventor", "penalty:amount:-3"],
      }),
      makeCard({ id: "n#0", ownerId: "1", scoreValue: 4 }),
    );
    resolveScoring(G);
    expect(G.scores!["1"]).toBe(1);
  });
});
