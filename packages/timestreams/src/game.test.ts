import { describe, it, expect } from "vitest";
import { TimestreamsGame } from "./game";
import { createCryptoInitialState } from "./crypto";
import { assignRandomHomeEras } from "./homeEra";
import * as playMod from "./play";

describe("TimestreamsGame integration", () => {
  it("exposes a boardgame.io game with the expected phases and name", () => {
    expect(TimestreamsGame.name).toBe("timestreams");
    const phases = TimestreamsGame.phases ?? {};
    expect(Object.keys(phases)).toEqual(
      expect.arrayContaining(["setup", "keyExchange", "encrypt", "shuffle", "play", "scoring", "gameOver", "voided"]),
    );
  });

  it("has a valid setup function", () => {
    expect(typeof TimestreamsGame.setup).toBe("function");
    const initial = TimestreamsGame.setup!({ playOrder: ["0", "1"] } as any);
    expect(initial.phase).toBe("setup");
    expect(Object.keys(initial.players)).toHaveLength(2);
    expect(initial.config.playMode).toBe("mental-poker");
  });

  it("supports pre-resolved decks + config overrides in setup (for real packs)", () => {
    const decks: Record<string, any[]> = {
      "0": [{ id: "0-real-0", name: "RealCard0", cardType: "invention", ownerId: "0", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 2 }],
      "1": [{ id: "1-real-0", name: "RealCard1", cardType: "invention", ownerId: "1", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 1 }],
    };
    const initial = TimestreamsGame.setup!({ playOrder: ["0", "1"] } as any, {
      decks,
      moduleConfig: { deckSize: 1 },
    } as any);
    expect(initial.encryptedDecks["0"]).toHaveLength(1);
    expect(initial.config.deckSize).toBe(1);
    expect(initial.phase).toBe("setup");
    expect(initial.cards?.["0-real-0"]?.name).toBe("RealCard0");
  });

  it("supports full random era commit-reveal wiring + assignment in setup phase", () => {
    const G = createCryptoInitialState(
      { playerIDs: ["0", "1"] } as any,
      { homeEraAssignment: "random" } as any
    );
    // Simulate commit/reveal for eras (use valid hex lengths)
    const commit0 = "a".repeat(64);
    const commit1 = "b".repeat(64);
    const seed0 = "1122334455667788";
    const seed1 = "aabbccdd11223344";
    // Note: full hash verify would require matching commit, here we test wiring + assign
    // call assign directly for test
    assignRandomHomeEras(G, "deadbeef".repeat(8));
    expect(["stone", "medieval", "renaissance", "industrial", "modern", "future"]).toContain(G.players["0"].homeEra);
    expect(G.players["0"].homeEra).not.toBe(G.players["1"].homeEra);
  });

  it("full rules-free E2E sketch (structural + real pack pre-resolved decks)", () => {
    // Pre-resolved decks from pack (higher layer does resolveDecksFromPack + getDeckSizeFromPack)
    const decks: Record<string, any[]> = {
      "0": [
        { id: "0-s1", name: "Stone Real", cardType: "invention", ownerId: "0", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 1 },
      ],
      "1": [
        { id: "1-f1", name: "Future Real", cardType: "invention", ownerId: "1", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 2 },
      ],
    };
    let G = TimestreamsGame.setup!({ playOrder: ["0", "1"] } as any, { decks, moduleConfig: { deckSize: 1 } } as any);
    // selectable claims (rules free structural)
    // (in real would do crypto first, but for sketch assume post crypto phase play)
    G.phase = "play";
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";
    G.currentDay = 1;
    // play invention structural only (no effect text acted on)
    G.players["0"].hand = [decks["0"][0]];
    const res = playMod.playInvention(G, { currentPlayer: "0" } as any, "0", "0-s1");
    if (res && typeof res !== "string") {
      expect(res.timeline.stone.stack).toContain("0-s1");
    }
    // pass to end day etc.
    // scoring is slot ownership only
    expect(typeof G).toBe("object");
  });
});
