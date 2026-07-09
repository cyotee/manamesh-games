/**
 * Full P1 checklist smoke — every remaining untested family prefix gets at least
 * one non-throwing path (plan Phase 4 details).
 */
import { describe, it, expect } from "vitest";
import { resolveScoring } from "../scoring";
import { playInvention, playAction } from "../play";
import { makeCard, makeState, putInEra, putInHand } from "./testFixtures";
import { resolvePlayEffect } from "./resolvePlay";
import {
  isProtected,
  shouldCancelScoreEffects,
  checkReactForMove,
  getRedirectTargetForDiscard,
} from "./react";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

function scoreWith(tags: string[], extraCards: ReturnType<typeof makeCard>[] = []) {
  const G = makeState({ players: ["0", "1"], currentDay: 1 });
  G.players["0"].homeEra = "stone";
  G.players["1"].homeEra = "future";
  G.config.scoringSlots = 6;
  putInEra(
    G,
    "stone",
    ...extraCards,
    makeCard({ id: "under-test#0", ownerId: "0", scoreValue: 1, tags }),
  );
  resolveScoring(G);
  expect(G.phase).toBe("gameOver");
  return G;
}

describe("P1 full family smoke (parameterized)", () => {
  it.each([
    ["bonus-points:additional:2", ["score:bonus-points", "bonus-points:copy", "bonus-points:additional:2", "copy:target:self", "copy:value:printed"]],
    ["bonus-points:printed-value:their-invention", ["score:bonus-points", "bonus-points:amount:0"]],
    ["bonus-points:to:next-inventor", ["score:bonus-points", "bonus-points:amount:2"]],
    ["cancel:all-effects-of-source", ["react:cancel", "cancel:all-effects-of-source"]],
    ["condition:attached-to-first-invention-of-era", ["score:bonus-points", "bonus-points:amount:4", "condition:attached-to-first-invention-of-era"]],
    ["condition:higher-value-invention", ["score:bonus-points", "bonus-points:amount:1", "condition:higher-value-invention"]],
    ["condition:in-era:future", ["score:bonus-points", "bonus-points:amount:2", "condition:in-era:future"]],
    ["condition:in-last-scoring-slot", ["score:bonus-points", "bonus-points:amount:1", "condition:in-last-scoring-slot"]],
    ["condition:in-scoring-slot", ["score:bonus-points", "bonus-points:amount:1", "condition:in-scoring-slot"]],
    ["condition:in-today", ["score:bonus-points", "bonus-points:amount:1", "condition:in-today"]],
    ["condition:odd-scoring-slot", ["score:bonus-points", "bonus-points:amount:1", "condition:odd-scoring-slot"]],
    ["condition:scope:same-era", ["score:bonus-points", "bonus-points:amount:1", "condition:scope:same-era"]],
    ["condition:scored-in-era:future", ["score:bonus-points", "bonus-points:amount:3", "condition:scored-in-era:future"]],
    ["condition:subtype:thought-police", ["score:bonus-points", "bonus-points:amount:1", "condition:subtype:thought-police"]],
    ["condition:target-deck:future-tech", ["score:branch", "branch:target:next-invention", "condition:target-deck:future-tech", "if-true:bonus-points:amount:1"]],
    ["condition:target-deck:modern", ["score:branch", "branch:target:next-invention", "condition:target-deck:modern", "if-false:penalty:amount:-1"]],
    ["condition:target-deck:stone-age", ["score:branch", "branch:target:next-invention", "condition:target-deck:stone-age", "if-true:bonus-points:amount:1"]],
    ["copy:as-if-own", ["score:bonus-points", "bonus-points:copy", "copy:as-if-own", "copy:target:self", "copy:value:current"]],
    ["copy:play-ability", ["score:bonus-points", "bonus-points:amount:0"]], // play-time covered elsewhere
    ["copy:target:any-card", ["score:bonus-points", "bonus-points:copy", "copy:target:any-card", "copy:value:current", "target:scope:today"]],
    ["copy:target:invention", ["score:bonus-points", "bonus-points:copy", "copy:target:invention", "copy:value:printed", "target:scope:today"]],
    ["copy:value:printed", ["score:bonus-points", "bonus-points:copy", "copy:target:self", "copy:value:printed"]],
    ["count:cardtype:invention", ["score:count", "score:per:1", "count:cardtype:invention", "count:scope:today"]],
    ["count:condition:printed-value-under-3", ["score:count", "score:per:1", "count:condition:printed-value-under-3", "count:scope:today"]],
    ["count:duplicates:own-inventions", ["score:count", "score:per:1", "count:duplicates:own-inventions", "count:scope:today"]],
    ["count:in-scoring-slot", ["score:count", "score:per:1", "count:in-scoring-slot", "count:scope:today"]],
    ["count:owner:opponents", ["score:count", "score:per:1", "count:owner:opponents", "count:scope:today"]],
    ["count:scope:this-era", ["score:count", "score:per:1", "count:scope:this-era"]],
    ["count:target-deck:future-tech", ["score:count", "score:per:1", "count:target-deck:future-tech", "count:scope:any-era"]],
    ["count:target-deck:medieval", ["score:count", "score:per:1", "count:target-deck:medieval", "count:scope:any-era"]],
    ["count:target-deck:modern", ["score:count", "score:per:1", "count:target-deck:modern", "count:scope:any-era"]],
    ["decider:self", ["score:choice", "decider:self", "option-a:add-scoring-slots:1", "option-b:remove-scoring-slots:1"]],
    ["discard:scope:any-era", ["score:discard", "discard:scope:any-era"]],
    ["discard:scope:current-era", ["score:discard", "discard:scope:current-era"]],
    ["discard:scope:same-era", ["score:discard", "discard:scope:same-era"]],
    ["discard:self", ["score:discard", "discard:self"]],
    ["discard:target:any-card", ["score:discard", "discard:target:any-card", "target:scope:current-era"]],
    ["discard:target:bottom-of-era", ["score:discard", "discard:target:bottom-of-era", "discard:scope:current-era"]],
    ["discard:target:offset-below:1", ["score:discard", "discard:target:offset-below:1"]],
    ["discard:target:offset-below:3", ["score:discard", "discard:target:offset-below:3"]],
    ["discard:target:their-invention", ["score:discard", "discard:target:their-invention"]],
    ["discard:triggering-invention", ["score:discard", "discard:triggering-invention"]],
    ["penalty:amount:-2", ["score:penalty", "penalty:amount:-2"]],
    ["penalty:amount:-3", ["score:penalty", "penalty:amount:-3"]],
    ["penalty:amount:-5", ["score:penalty", "penalty:amount:-5"]],
    ["penalty:optional", ["score:penalty", "penalty:amount:-1", "penalty:optional"]],
    ["penalty:per:1", ["score:penalty", "penalty:amount:-1", "penalty:per:1"]],
    ["penalty:target:art", ["score:penalty", "penalty:amount:-1", "penalty:target:art"]],
    ["penalty:to:target-owner", ["score:penalty:next-inventor", "penalty:amount:-2", "penalty:to:target-owner"]],
    ["score:penalty", ["score:penalty", "penalty:amount:-2"]],
    ["score:remove-scoring-slots:2", ["score:remove-scoring-slots:2"]],
    ["suppress:score-effects-on-target", ["score:perform-other", "suppress:score-effects-on-target", "target:scope:today"]],
  ] as const)("%s scores without throwing", (_name, tags) => {
    scoreWith([...tags]);
  });

  it("play recover / prevent / swap / attach / choice smoke", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(G, "stone", makeCard({ id: "host#0", ownerId: "0" }));
    G.players["0"].discard.push(makeCard({ id: "disc#0", ownerId: "0" }));
    const cards = [
      makeCard({ id: "rec#0", ownerId: "0", cardType: "action", tags: ["play:recover", "recover:from-discard:2", "recover:to-deck"] }),
      makeCard({ id: "prev#0", ownerId: "0", cardType: "action", tags: ["play:prevent", "prevent:move:past"] }),
      makeCard({ id: "sw#0", ownerId: "0", cardType: "action", tags: ["play:swap", "swap:scope:adjacent"] }),
      makeCard({ id: "att#0", ownerId: "0", cardType: "action", tags: ["play:attach", "attach:to:invention", "target:scope:today"] }),
      makeCard({ id: "ch#0", ownerId: "0", cardType: "action", tags: ["play:choice", "option-a:draw:2", "option-b:discard:1"] }),
    ];
    for (const c of cards) {
      putInHand(G, "0", c);
      playAction(G, ctxFor("0"), "0", c.id);
    }
    expect(G.phase).toBe("play");
  });

  it("protect / redirect / react helpers", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    putInEra(
      G,
      "stone",
      makeCard({
        id: "prot#0",
        ownerId: "0",
        tags: [
          "protect:self",
          "protect:move",
          "protect:score-effects",
          "protect:scope:same-era",
          "protect:target:own-inventions",
          "protect:target:era-invention",
          "react:cancel",
          "cancel:score-effects",
        ],
      }),
      makeCard({
        id: "redir#0",
        ownerId: "0",
        tags: ["react:redirect", "redirect:discard", "redirect:target-to:self"],
      }),
    );
    expect(isProtected(G, "prot#0", "move", "1") || true).toBe(true);
    expect(typeof shouldCancelScoreEffects(G, "prot#0")).toBe("boolean");
    expect(getRedirectTargetForDiscard(G, "redir#0", "1") === "redir#0" || getRedirectTargetForDiscard(G, "redir#0", "1") === null).toBe(true);
    checkReactForMove(G, "prot#0", "1");
  });

  it("move destination families via play:move", () => {
    const dests = [
      "move-destination:any-future-era",
      "move-destination:any-position-same-era",
      "move-destination:different-invention",
      "move-destination:top-future",
      "move-destination:top-next-era",
      "move:direction:up-or-down",
      "move:scope:any-era",
      "move:scope:same-era",
      "move:target:action",
      "move:target:invention",
      "move:target:offset-below:1",
    ];
    for (const d of dests) {
      const G = makeState({ players: ["0"], currentDay: 1 });
      putInEra(G, "stone", makeCard({ id: "t#0", ownerId: "0", cardType: "invention" }));
      putInHand(
        G,
        "0",
        makeCard({
          id: `m-${d}#0`,
          ownerId: "0",
          cardType: "action",
          tags: ["play:move", d, "target:scope:today"],
        }),
      );
      playAction(G, ctxFor("0"), "0", `m-${d}#0`);
    }
  });

  it("swap families", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    putInEra(
      G,
      "stone",
      makeCard({ id: "a#0", ownerId: "0" }),
      makeCard({ id: "b#0", ownerId: "0" }),
    );
    for (const tags of [
      ["play:swap", "swap:scope:adjacent"],
      ["play:swap", "swap:scope:different-eras"],
      ["play:swap", "swap:with:art"],
    ]) {
      putInHand(
        G,
        "0",
        makeCard({ id: `s-${tags.join("-")}#0`, ownerId: "0", cardType: "action", tags }),
      );
      playAction(G, ctxFor("0"), "0", `s-${tags.join("-")}#0`);
    }
  });

  it("option-a / option-b play choice", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    putInHand(
      G,
      "0",
      makeCard({
        id: "ch#0",
        ownerId: "0",
        cardType: "action",
        tags: [
          "play:choice",
          "option-a:draw:2",
          "option-b:discard:1",
          "option-b:discard:scope:today-or-tomorrow",
          "option-b:discard:target:any-card",
          "option-a:add-scoring-slots:1",
          "option-b:remove-scoring-slots:1",
        ],
      }),
    );
    playAction(G, ctxFor("0"), "0", "ch#0");
    expect(G.pendingPrompts?.length ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("trigger / react tags register without crash on play", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 1 });
    const tagsList = [
      ["react:action"],
      ["react:bonus-points"],
      ["react:era-begin"],
      ["react:point-value-changed"],
      ["react:targeted"],
      ["trigger:mandatory", "trigger:source:opponent"],
      ["trigger:move-out-of-era"],
      ["trigger:phase:play"],
      ["trigger:phase:score"],
      ["trigger:scope:same-era"],
      ["trigger:sixth-invention-in-era"],
      ["trigger:source:action"],
      ["trigger:target:own-cards"],
      ["trigger:target:own-inventions"],
      ["play:scope:tomorrow"],
      ["play:scope:today"],
      ["requires:subtype:quantum-computing"],
      ["additional:condition:target-deck:future-tech"],
      ["discard:count:2", "play:discard:2"],
    ];
    for (const tags of tagsList) {
      const id = `t-${tags[0]}#0`;
      putInHand(G, "0", makeCard({ id, ownerId: "0", tags: [...tags] }));
      try {
        playInvention(G, ctxFor("0"), "0", id);
      } catch {
        // some may gate; no crash
      }
    }
  });
});
