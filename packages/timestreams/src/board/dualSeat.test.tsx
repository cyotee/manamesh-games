/**
 * Dual-seat board expectations (plan Phase 5.B) — render both seats' views
 * against shared G and assert asymmetric UI (prompt actionability, timeline).
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TimestreamsBoard } from "./TimestreamsBoard";
import { makeBoardProps, makePlayState, makeSetupState } from "./boardTestHelpers";
import { makeCard } from "../effects/testFixtures";

describe("dual-seat board (5.B)", () => {
  it("5.B.1 Ready disabled until own era claimed (each seat)", () => {
    const G = makeSetupState({
      players: {
        "0": {
          homeEra: "stone",
          ready: false,
          hand: [],
          discard: [],
          scorePile: [],
          hasPassedThisDay: false,
          publicKey: null,
          hasEncrypted: false,
          hasShuffled: false,
        },
        "1": {
          homeEra: null,
          ready: false,
          hand: [],
          discard: [],
          scorePile: [],
          hasPassedThisDay: false,
          publicKey: null,
          hasEncrypted: false,
          hasShuffled: false,
        },
      },
    });
    const p0 = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({ G, playerID: "0", ctx: { phase: "setup", currentPlayer: "0" } })}
      />,
    );
    const p1 = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({ G, playerID: "1", ctx: { phase: "setup", currentPlayer: "0" } })}
      />,
    );
    // P0 has era — Ready not forced-disabled by missing era (label path)
    expect(p0).toContain("set-ready");
    // P1 no era — Ready disabled
    expect(p1).toContain("disabled");
    expect(p1).toContain("setup-claim");
  });

  it("5.B.2 prompt only actionable for decider seat; non-decider sees no options", () => {
    const invent = makeCard({ id: "opt-a", name: "Opt A", ownerId: "0" });
    const G = makePlayState({
      cards: { "opt-a": invent },
      pendingPrompts: [
        {
          id: "card:search",
          deciderId: "0",
          kind: "choose-card",
          options: ["opt-a"],
          min: 1,
          max: 1,
          reason: "play:search-deck",
        },
      ],
    });
    const p0 = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "0" })} />,
    );
    const p1 = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "1" })} />,
    );
    expect(p0).toContain('data-testid="rules-prompt"');
    expect(p0).toContain("confirm-prompt");
    expect(p0).toContain("prompt-option-opt-a");
    expect(p0).toContain("Opt A");
    expect(p1).toContain('data-testid="rules-prompt"');
    expect(p1).toContain("prompt-waiting");
    expect(p1).toContain("Waiting for P0");
    // Non-decider must not see deck/choice options (private search, etc.)
    expect(p1).not.toContain("prompt-option-opt-a");
    expect(p1).not.toContain("confirm-prompt");
    expect(p1).not.toContain("Opt A");
  });

  it("5.B.3 shared timeline visible on both seats after invent", () => {
    const G = makePlayState();
    const card = makeCard({
      id: "shared-inv#0",
      name: "Shared Invention",
      ownerId: "0",
      cardType: "invention",
    });
    G.cards = { [card.id]: card };
    G.timeline.stone.stack = [card.id];
    const p0 = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "0" })} />,
    );
    const p1 = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "1", ctx: { currentPlayer: "1" } })} />,
    );
    expect(p0).toContain("Shared Invention");
    expect(p1).toContain("Shared Invention");
  });

  it("game-over panel shows scores on both seats (5.D.1)", () => {
    const G = makePlayState({
      phase: "gameOver",
      scores: { "0": 12, "1": 7 },
      winner: "0",
    });
    for (const pid of ["0", "1"] as const) {
      const html = renderToStaticMarkup(
        <TimestreamsBoard
          {...makeBoardProps({
            G,
            playerID: pid,
            ctx: { phase: "gameOver", currentPlayer: pid },
          })}
        />,
      );
      expect(html).toContain('data-testid="game-over-panel"');
      expect(html).toContain('data-testid="score-player-0"');
      expect(html).toContain("12");
      expect(html).toContain("Winner: P0");
    }
  });

  it("copy / play-invention prompt reasons render human copy", () => {
    const G = makePlayState({
      cards: {
        t1: makeCard({ id: "t1", name: "Target Inv", ownerId: "0" }),
      },
      pendingPrompts: [
        {
          id: "bio:copy-target",
          deciderId: "0",
          kind: "choose-card",
          options: ["t1"],
          min: 1,
          max: 1,
          reason: "play:copy",
        },
      ],
    });
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps({ G })} />);
    expect(html).toContain("rules-prompt");
    expect(html).toContain("Copy play ability");
  });

  it("Surgical Strike: target-owner seat sees option panel; actor sees waiting", () => {
    const ss = makeCard({
      id: "modern-surgical-strike#0",
      name: "Surgical Strike",
      ownerId: "0",
      cardType: "action",
      tags: [
        "play:choice",
        "option-a:discard:target",
        "option-b:discard:hand:3",
      ],
    });
    const victim = makeCard({
      id: "victim#0",
      name: "Victim Invention",
      ownerId: "1",
      cardType: "invention",
    });
    const G = makePlayState({
      currentDay: 5,
      cards: { [ss.id]: ss, [victim.id]: victim },
      pendingPlayEffect: {
        cardId: ss.id,
        actorPlayerId: "0",
        kind: "action",
        choices: { [`${ss.id}:choose-target`]: victim.id },
      },
      pendingPrompts: [
        {
          id: `${ss.id}:option`,
          deciderId: "1",
          kind: "choose-option",
          options: ["option-a", "option-b"],
          min: 1,
          max: 1,
          reason: "play:choice",
          labelCardId: victim.id,
        },
      ],
    });

    // Actor (current player) — waiting only
    const p0 = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          playerID: "0",
          ctx: { currentPlayer: "0", phase: "play" },
        })}
      />,
    );
    expect(p0).toContain('data-testid="rules-prompt"');
    expect(p0).toContain("prompt-waiting");
    expect(p0).toContain("Waiting for P1");
    expect(p0).not.toContain("confirm-prompt");
    expect(p0).not.toContain("Discard that invention from play");

    // Target owner (off-turn) — must see actionable choice panel + labels from SS tags
    const p1 = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          playerID: "1",
          ctx: { currentPlayer: "0", phase: "play" },
        })}
      />,
    );
    expect(p1).toContain('data-testid="rules-prompt"');
    expect(p1).toContain("play-choice-attention");
    expect(p1).toContain("confirm-prompt");
    expect(p1).toContain("prompt-option-option-a");
    expect(p1).toContain("prompt-option-option-b");
    expect(p1).toContain("Discard that invention from play");
    expect(p1).toMatch(/Discard 3 cards from (your )?hand/);
    expect(p1).toMatch(/YOUR invention/);
    expect(p1).toContain("Victim Invention");
    expect(p1).not.toContain("prompt-waiting");
  });
});
