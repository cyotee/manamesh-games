/**
 * Mental-poker cooperative decrypt pipeline — full peel + hand materialization.
 */
import { describe, it, expect } from "vitest";
import {
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  commitShuffleSeed,
  revealShuffleSeed,
  shuffleEncryptedDeck,
  submitDecryptionShare,
  dealForDay,
  hashSeedCommit,
  peelDecryptShare,
} from "./crypto";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";
import type { Ctx } from "boardgame.io";

function ctx(player: string, phase = "play"): Ctx {
  return {
    currentPlayer: player,
    numPlayers: 2,
    playOrder: ["0", "1"],
    phase,
    turn: 0,
    numMoves: 0,
  } as unknown as Ctx;
}

function reachPlayWithEncryptedDecks() {
  const ids = ["0", "1"];
  const decks = {
    "0": [
      { id: "stone-fire", name: "Fire", ownerId: "0", cardType: "invention", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 1 },
      { id: "stone-wheel", name: "Wheel", ownerId: "0", cardType: "invention", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 1 },
    ],
    "1": [
      { id: "future-nano", name: "Nano", ownerId: "1", cardType: "invention", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 1 },
      { id: "future-clone", name: "Clone", ownerId: "1", cardType: "invention", hasPlayEffect: false, hasScoreEffect: true, hasReact: false, scoreValue: 1 },
    ],
  } as any;

  const G: any = createCryptoInitialState(
    { numPlayers: 2, playerIDs: ids } as any,
    { playMode: "mental-poker", drawTable: { 2: 1 } } as any,
    decks,
  );
  G.phase = "keyExchange";
  const keys = { "0": generateKeyPair(), "1": generateKeyPair() };

  submitPublicKey(G, ctx("0", "keyExchange"), "0", keys["0"].publicKey);
  submitPublicKey(G, ctx("1", "keyExchange"), "1", keys["1"].publicKey);
  encryptDeck(G, ctx("0", "encrypt"), "0", keys["0"].privateKey);
  encryptDeck(G, ctx("1", "encrypt"), "1", keys["1"].privateKey);

  const seeds = { "0": "aa".repeat(32), "1": "bb".repeat(32) };
  for (const id of ids) {
    commitShuffleSeed(G, ctx(id, "shuffle"), id, hashSeedCommit(seeds[id as "0" | "1"]));
  }
  for (const id of ids) {
    revealShuffleSeed(G, ctx(id, "shuffle"), id, seeds[id as "0" | "1"]);
  }
  shuffleEncryptedDeck(G, ctx("0", "shuffle"), "0");
  shuffleEncryptedDeck(G, ctx("1", "shuffle"), "1");
  // shuffle no longer deals — start deal pipeline
  G.phase = "play";
  dealForDay(G, 1);

  return { G, keys };
}

describe("cooperative decrypt pipeline", () => {
  it("auto-peels all layers and materializes a card into hand with activity log", () => {
    const { G, keys } = reachPlayWithEncryptedDecks();

    // One sequential request per player (drawTable 2:1)
    expect(G.pendingDecryptRequests.length).toBeGreaterThanOrEqual(1);
    expect(G.activityLog.some((e: any) => e.kind === "deal" || e.kind === "decrypt")).toBe(true);

    // Process until both hands have 1 card (or max steps)
    let guard = 40;
    while (
      guard-- > 0 &&
      (G.players["0"].hand.length < 1 || G.players["1"].hand.length < 1 || G.pendingDecryptRequests.length > 0)
    ) {
      const active = G.pendingDecryptRequests.find((r: any) => !r.materialized);
      if (!active) {
        // may need enqueue
        break;
      }
      const next = active.requiredLayers[active.currentLayer];
      const card = G.encryptedDecks[active.deckOwnerId][active.cardIndex];
      const share = peelDecryptShare(card, keys[next as "0" | "1"].privateKey);
      const result = submitDecryptionShare(G, ctx(next), next, active.id, share);
      expect(result).not.toBe("INVALID_MOVE");
    }

    expect(G.players["0"].hand.length).toBe(1);
    expect(G.players["1"].hand.length).toBe(1);
    expect(
      G.activityLog.some((e: any) => String(e.message).includes("Decrypt complete")),
    ).toBe(true);
    // Known card ids from decks
    const allIds = ["stone-fire", "stone-wheel", "future-nano", "future-clone"];
    expect(allIds).toContain(G.players["0"].hand[0].id);
    expect(allIds).toContain(G.players["1"].hand[0].id);
  });

  it("logs decrypt request when draw is requested", () => {
    const { G } = reachPlayWithEncryptedDecks();
    const reqMsg = G.activityLog.filter((e: any) => e.kind === "decrypt" || e.kind === "deal");
    expect(reqMsg.length).toBeGreaterThan(0);
    expect(
      G.activityLog.some((e: any) => /requested decrypt|Dealing/i.test(e.message)),
    ).toBe(true);
  });
});
