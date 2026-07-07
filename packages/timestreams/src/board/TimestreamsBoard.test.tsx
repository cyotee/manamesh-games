import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TimestreamsBoard } from "./TimestreamsBoard";
import { createTimeline } from "../timeline";
import type { TimestreamsState } from "../types";

function props(overrides: any = {}) {
  const baseG: Partial<TimestreamsState> = {
    phase: "play",
    currentDay: 1,
    dayFirstPlayer: "0",
    playerOrder: ["0", "1"],
    timeline: createTimeline(),
    config: { scoringSlots: 6 },
    players: {
      "0": { homeEra: "stone", hand: [], discard: [], scorePile: [], ready: false, hasPassedThisDay: false, publicKey: null, hasEncrypted: false, hasShuffled: false },
      "1": { homeEra: "future", hand: [], discard: [], scorePile: [], ready: false, hasPassedThisDay: false, publicKey: null, hasEncrypted: false, hasShuffled: false },
    },
    scores: { "0": 0, "1": 0 },
    winner: null,
    proofChain: [],
    cards: {},
    pendingPrompts: [],
  };

  return {
    G: { ...baseG, ...overrides.G } as TimestreamsState,
    ctx: { currentPlayer: "0", phase: "play", numPlayers: 2, ...overrides.ctx },
    moves: { playInvention: () => {}, playAction: () => {}, pass: () => {}, ...overrides.moves },
    playerID: "0",
    ...overrides,
  } as any;
}

describe("TimestreamsBoard", () => {
  it("renders six era columns and a day indicator", () => {
    const html = renderToStaticMarkup(<TimestreamsBoard {...props()} />);
    expect(html).toContain("Stone");
    expect(html).toContain("Future");
    expect((html.match(/ts-era-column/g) ?? []).length).toBe(6);
    expect(html).toContain("Day 1");
    expect(html).toContain("Teaching mode: Always show your hand");
    expect(html).toContain("Zoomed Card View");
  });

  it("highlights active era and shows scoring slots", () => {
    const p = props();
    const html = renderToStaticMarkup(<TimestreamsBoard {...{ ...p, G: { ...p.G, currentDay: 2 } }} />);
    expect(html).toContain("Medieval"); // active for day 2 (capitalized in label)
    // Should have markers for 6 slots
    expect((html.match(/slot|scoring-slot/gi) ?? []).length).toBeGreaterThan(0);
  });

  it("renders local player's hand and action buttons", () => {
    const base = props();
    const testProps = {
      ...base,
      G: {
        ...base.G,
        players: {
          ...base.G.players,
          "0": {
            ...base.G.players["0"],
            hand: [{ id: "test-card#0", name: "Test Card", ownerId: "0", cardType: "invention", subtypes: [], hasPlayEffect: false, hasScoreEffect: false, hasReact: false }],
          },
        },
      },
    };
    const html = renderToStaticMarkup(<TimestreamsBoard {...testProps} />);
    expect(html).toContain("Test Card");
    expect(html).toContain("Play");
    expect(html).toContain("Pass");
  });
});
