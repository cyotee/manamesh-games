/**
 * L4 — game phase transitions without full boardgame.io Client.
 */
import { describe, it, expect } from "vitest";
import { TimestreamsGame } from "./game";
import { claimHomeEra, setReady, allReadyWithDistinctEras } from "./homeEra";
import { playInvention, playAction, pass } from "./play";
import { materializeHomeEraDecks } from "./deckResolver";
import { dealPlaintextHands } from "./crypto";
import type { PackCatalog } from "./packCatalog";
import type { TimestreamsState } from "./types";

describe("game lifecycle (plan Phase 5.A)", () => {
  it("setup: both ready with distinct eras ends setup condition", () => {
    const setup = TimestreamsGame.setup as any;
    const G = setup({ playOrder: ["0", "1"], numPlayers: 2 }) as TimestreamsState;
    expect(G.phase).toBe("setup");
    claimHomeEra(G, "0", "stone");
    claimHomeEra(G, "1", "future");
    setReady(G, "0", true);
    expect(allReadyWithDistinctEras(G)).toBe(false);
    setReady(G, "1", true);
    expect(allReadyWithDistinctEras(G)).toBe(true);
  });

  it("beginPlay via materialize + deal leaves hands non-empty with pack catalog", () => {
    const setup = TimestreamsGame.setup as any;
    const catalog: PackCatalog = {
      stone: [
        {
          id: "stone-age-fire",
          name: "Fire",
          front: "/f.png",
          metadata: {
            cardType: "invention",
            hasPlayEffect: false,
            hasScoreEffect: true,
            hasReact: false,
            scoreValue: 1,
          },
          quantity: 8,
        },
      ],
      future: [
        {
          id: "future-tech-nanotech",
          name: "Nanotech",
          front: "/n.png",
          metadata: {
            cardType: "invention",
            hasPlayEffect: false,
            hasScoreEffect: true,
            hasReact: false,
            scoreValue: 2,
          },
          quantity: 8,
        },
      ],
    };
    const G = setup(
      { playOrder: ["0", "1"], numPlayers: 2 },
      { packCatalog: catalog, packName: "Test Pack", moduleConfig: { playMode: "plaintext" } },
    ) as TimestreamsState;

    claimHomeEra(G, "0", "stone");
    claimHomeEra(G, "1", "future");
    setReady(G, "0", true);
    setReady(G, "1", true);

    // Simulate play onBegin
    materializeHomeEraDecks(G);
    dealPlaintextHands(G, 1);

    expect(G.players["0"].hand.length).toBe(6);
    expect(G.players["1"].hand.length).toBe(6);
    expect(G.players["0"].hand[0].name).toBe("Fire");
    expect(G.phase).toBe("play");
  });

  it("invention play updates timeline; pass advances day when all pass", () => {
    const setup = TimestreamsGame.setup as any;
    const G = setup(
      { playOrder: ["0", "1"] },
      { moduleConfig: { playMode: "plaintext", rulesEnabled: false } },
    ) as TimestreamsState;
    G.phase = "play";
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.players["0"].hand = [
      {
        id: "0-card-0",
        name: "Wheel",
        ownerId: "0",
        cardType: "invention",
        subtypes: [],
        hasPlayEffect: false,
        hasScoreEffect: true,
        hasReact: false,
        scoreValue: 1,
        tags: [],
      },
    ];
    G.cards = { "0-card-0": G.players["0"].hand[0] };
    G.encryptedDecks = { "0": [], "1": [] };

    playInvention(G, { currentPlayer: "0" } as any, "0", "0-card-0");
    expect(G.timeline.stone.stack).toContain("0-card-0");

    pass(G, { currentPlayer: "0" } as any, "0");
    expect(G.currentDay).toBe(1);
    pass(G, { currentPlayer: "1" } as any, "1");
    expect(G.currentDay).toBe(2);
  });

  it("action with search-deck holds pendingPrompts until answered", () => {
    const setup = TimestreamsGame.setup as any;
    const G = setup(
      { playOrder: ["0", "1"] },
      { moduleConfig: { playMode: "plaintext", rulesEnabled: true } },
    ) as TimestreamsState;
    G.phase = "play";
    G.players["0"].homeEra = "future";
    G.encryptedDecks["0"] = [
      { ciphertext: "a", layers: 0 },
      { ciphertext: "b", layers: 0 },
    ];
    G.cards = {
      a: {
        id: "a",
        name: "A",
        ownerId: "0",
        cardType: "invention",
        subtypes: [],
        hasPlayEffect: false,
        hasScoreEffect: true,
        hasReact: false,
        tags: [],
      },
      b: {
        id: "b",
        name: "B",
        ownerId: "0",
        cardType: "invention",
        subtypes: [],
        hasPlayEffect: false,
        hasScoreEffect: true,
        hasReact: false,
        tags: [],
      },
    };
    const think = {
      id: "think",
      name: "Think",
      ownerId: "0",
      cardType: "action" as const,
      subtypes: [],
      hasPlayEffect: true,
      hasScoreEffect: false,
      hasReact: false,
      tags: ["play:search-deck", "play:to-hand", "play:shuffle-after"],
    };
    G.players["0"].hand = [think];
    G.cards.think = think;

    playAction(G, { currentPlayer: "0" } as any, "0", "think");
    expect(G.pendingPrompts?.length).toBe(1);
    playAction(G, { currentPlayer: "0" } as any, "0", "think", {
      "think:search-deck": "b",
    });
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players["0"].hand.map((c) => c.id)).toContain("b");
  });
});
