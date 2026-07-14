import { describe, it, expect } from "vitest";
import { createCryptoInitialState, dealPlaintextHands, dealForDay } from "./crypto";
import { pass, endDay } from "./play";
import { dayFirstPlayer } from "./homeEra";
import { createTimeline } from "./timeline";
import { createDeckFromPack } from "./deck";

function makePlayReady(mode: "plaintext" | "mental-poker") {
  const G = createCryptoInitialState(
    { numPlayers: 2, playerIDs: ["0", "1"] } as any,
    { playMode: mode, rulesEnabled: true, drawTable: { 2: 6, 3: 5, 4: 4 } } as any,
  );
  G.phase = "play";
  G.currentDay = 1;
  G.players["0"].homeEra = "stone";
  G.players["1"].homeEra = "future";
  G.players["0"].ready = true;
  G.players["1"].ready = true;
  G.timeline = createTimeline();
  G.dayFirstPlayer = dayFirstPlayer(G, 1);
  // Seed decks as plain card ids in encryptedDecks
  for (const pid of ["0", "1"]) {
    const cards = Array.from({ length: 20 }, (_, i) => ({
      id: `${pid}-card-${i}`,
      name: `Card ${i}`,
      ownerId: pid,
      cardType: "invention" as const,
      subtypes: [],
      hasPlayEffect: false,
      hasScoreEffect: true,
      hasReact: false,
      scoreValue: 1,
      tags: [],
    }));
    G.encryptedDecks[pid] = cards.map((c) => ({ ciphertext: c.id, layers: 0 }));
    for (const c of cards) {
      G.cards![c.id] = c;
    }
  }
  return G;
}

describe("day deal after both pass (regression)", () => {
  it("plaintext: endDay deals 6 more cards into hand", () => {
    const G = makePlayReady("plaintext");
    dealPlaintextHands(G, 1);
    expect(G.players["0"].hand).toHaveLength(6);
    expect(G.players["1"].hand).toHaveLength(6);
    const h0 = G.players["0"].hand.length;
    const h1 = G.players["1"].hand.length;
    const d0 = G.encryptedDecks["0"].length;
    const d1 = G.encryptedDecks["1"].length;

    pass(G, { currentPlayer: "0" } as any, "0");
    pass(G, { currentPlayer: "1" } as any, "1");

    expect(G.currentDay).toBe(2);
    expect(G.players["0"].hand.length).toBe(h0 + 6);
    expect(G.players["1"].hand.length).toBe(h1 + 6);
    expect(G.encryptedDecks["0"].length).toBe(d0 - 6);
    expect(G.encryptedDecks["1"].length).toBe(d1 - 6);
  });

  it("plaintext: direct endDay from day 1 deals for day 2", () => {
    const G = makePlayReady("plaintext");
    dealPlaintextHands(G, 1);
    endDay(G);
    expect(G.currentDay).toBe(2);
    expect(G.players["0"].hand.length).toBe(12);
    expect(G.players["1"].hand.length).toBe(12);
  });

  it("mental-poker mode with plain layers=0 decks still deals on day advance", () => {
    // Regression: playMode mental-poker + layers 0 tops used to queue decrypts
    // the board never peels (skips layers===0) → hands never grew after pass.
    const G = makePlayReady("mental-poker");
    // Simulate post-pack materialize: plain card ids, no encryption layers
    for (const pid of ["0", "1"]) {
      G.encryptedDecks[pid] = G.encryptedDecks[pid].map((c) => ({
        ...c,
        layers: 0,
      }));
    }
    dealForDay(G, 1);
    expect(G.players["0"].hand).toHaveLength(6);
    expect(G.players["1"].hand).toHaveLength(6);

    pass(G, { currentPlayer: "0" } as any, "0");
    pass(G, { currentPlayer: "1" } as any, "1");

    expect(G.currentDay).toBe(2);
    expect(G.players["0"].hand.length).toBe(12);
    expect(G.players["1"].hand.length).toBe(12);
    expect(G.pendingDealRemaining?.["0"] ?? 0).toBe(0);
    expect(G.pendingDealRemaining?.["1"] ?? 0).toBe(0);
  });
});
