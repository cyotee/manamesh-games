import { describe, it, expect } from "vitest";
import { playAction, submitPlayChoice } from "../../play";
import { makeCard, makeState, putInHand } from "../testFixtures";
import { markPlayEffectsComplete } from "../playOnce";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

describe("searchDeckExecutor (Think About The Future)", () => {
  it("prompts with remaining deck cards, then adds pick to hand and shuffles", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.phase = "play";
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), playMode: "plaintext" } as any;

    // Remaining deck as plaintext encrypted cards (layers 0).
    const deckIds = ["future-tech-nanotech", "future-tech-cloning", "future-tech-holograms"];
    G.encryptedDecks["0"] = deckIds.map((id) => ({ ciphertext: id, layers: 0 }));
    G.cards = {};
    for (const id of deckIds) {
      G.cards[id] = makeCard({
        id,
        name: id.replace("future-tech-", ""),
        ownerId: "0",
        cardType: "invention",
      });
    }

    const think = makeCard({
      id: "future-tech-think-about-the-future",
      name: "Think About The Future",
      ownerId: "0",
      cardType: "action",
      tags: ["play:search-deck", "play:to-hand", "play:shuffle-after"],
    });
    putInHand(G, "0", think);

    // First play: discard action + prompt for deck search
    playAction(G, ctxFor("0"), "0", think.id);
    expect(G.pendingPrompts?.length).toBe(1);
    const prompt = G.pendingPrompts![0];
    expect(prompt.reason).toBe("play:search-deck");
    expect(prompt.options.sort()).toEqual(deckIds.slice().sort());
    expect(G.players["0"].hand.map((c) => c.id)).not.toContain(think.id);
    expect(G.players["0"].discard.some((c) => c.id === think.id)).toBe(true);
    expect(G.pendingPlayEffect?.cardId).toBe(think.id);

    const beforeLen = G.encryptedDecks["0"].length;
    const pick = "future-tech-cloning";
    // UI path: submitPlayChoice (not re-playAction)
    const r = submitPlayChoice(G, "0", prompt.id, pick);
    expect(r).not.toBe("INVALID_MOVE");

    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players["0"].hand.map((c) => c.id)).toContain(pick);
    expect(G.encryptedDecks["0"].map((c) => c.ciphertext)).not.toContain(pick);
    expect(G.encryptedDecks["0"]).toHaveLength(beforeLen - 1);
  });

  it("survives decrypt→choose gap when play effects were marked complete early", () => {
    // Simulates mental-poker: decrypt returned done() → complete flag set →
    // then choose prompt appears. Confirm must still take the card.
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.phase = "play";
    G.players["0"].homeEra = "future";
    G.config = { ...(G.config || {}), playMode: "mental-poker" } as any;

    const deckIds = ["future-tech-nanotech", "future-tech-cloning"];
    G.encryptedDecks["0"] = deckIds.map((id) => ({ ciphertext: id, layers: 0 }));
    G.cards = {};
    for (const id of deckIds) {
      G.cards[id] = makeCard({ id, ownerId: "0", cardType: "invention" });
    }

    const think = makeCard({
      id: "future-tech-think-about-the-future#0",
      name: "Think About The Future",
      ownerId: "0",
      cardType: "action",
      tags: ["play:search-deck", "play:to-hand", "play:shuffle-after"],
    });
    putInHand(G, "0", think);
    playAction(G, ctxFor("0"), "0", think.id);

    // After play with plaintext remaining, choose should be open
    expect(G.activeDeckOp?.phase).toBe("choose");
    expect(G.pendingPrompts?.[0]?.reason).toBe("play:search-deck");

    // Simulate the bug: decrypt path marked complete and cleared pending
    markPlayEffectsComplete(G, think.id);
    delete G.pendingPlayEffect;

    // Re-open like finishSearchDecrypt does
    G.pendingPrompts = [
      {
        id: `${think.id}:search-deck`,
        deciderId: "0",
        kind: "choose-card",
        options: [...(G.activeDeckOp?.revealed || deckIds)],
        min: 1,
        max: 1,
        reason: "play:search-deck",
      },
    ];
    // finishSearchDecrypt restores pending — call path without it to test revive
    const pick = "future-tech-cloning";
    const r = submitPlayChoice(G, "0", `${think.id}:search-deck`, pick);
    expect(r).not.toBe("INVALID_MOVE");
    expect(G.players["0"].hand.map((c) => c.id)).toContain(pick);
  });

  it("fizzles cleanly when deck is empty", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.phase = "play";
    G.encryptedDecks["0"] = [];
    const think = makeCard({
      id: "future-tech-think-about-the-future",
      ownerId: "0",
      cardType: "action",
      tags: ["play:search-deck", "play:to-hand", "play:shuffle-after"],
    });
    putInHand(G, "0", think);
    playAction(G, ctxFor("0"), "0", think.id);
    expect(G.pendingPrompts ?? []).toEqual([]);
  });
});
