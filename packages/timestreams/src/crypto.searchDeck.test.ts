import { describe, it, expect } from "vitest";
import {
  createCryptoInitialState,
  startSearchDeckReveal,
  completeSearchDeckPick,
  commitDeckOpSeed,
  revealDeckOpSeed,
  hashSeedCommit,
  submitDeckOpReencrypt,
  buildDeckOpReencryptLayer,
} from "./crypto";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";
import { playAction } from "./play";
import { makeCard, putInHand } from "./effects/testFixtures";

describe("search-deck mental-poker path", () => {
  it("plaintext remaining deck under mental-poker goes straight to choose", () => {
    const G = createCryptoInitialState(
      { numPlayers: 2, playerIDs: ["0", "1"] } as any,
      { playMode: "mental-poker" } as any,
    );
    G.phase = "play";
    G.encryptedDecks["0"] = [
      { ciphertext: "a", layers: 0 },
      { ciphertext: "b", layers: 0 },
      { ciphertext: "c", layers: 0 },
    ];
    G.cards = {
      a: makeCard({ id: "a", ownerId: "0" }),
      b: makeCard({ id: "b", ownerId: "0" }),
      c: makeCard({ id: "c", ownerId: "0" }),
    };

    const op = startSearchDeckReveal(G, "0", "think", {
      toHand: true,
      shuffleAfter: true,
    });
    expect(op.phase).toBe("choose");
    expect(op.revealed).toEqual(["a", "b", "c"]);
    expect(G.pendingPrompts?.[0]?.reason).toBe("play:search-deck");

    expect(completeSearchDeckPick(G, "b")).toBe(true);
    expect(G.players["0"].hand.map((c) => c.id)).toContain("b");
    expect(G.encryptedDecks["0"].map((c) => c.ciphertext).sort()).toEqual(["a", "c"]);
    // reshuffle starts
    expect(G.activeDeckOp?.phase).toBe("reshuffle-commit");
  });

  it("fair reshuffle + reencrypt after search pick", () => {
    const G = createCryptoInitialState(
      { numPlayers: 2, playerIDs: ["0", "1"] } as any,
      { playMode: "mental-poker" } as any,
    );
    G.phase = "play";
    G.encryptedDecks["0"] = [
      { ciphertext: "a", layers: 0 },
      { ciphertext: "b", layers: 0 },
      { ciphertext: "c", layers: 0 },
    ];
    G.cards = {
      a: makeCard({ id: "a", ownerId: "0" }),
      b: makeCard({ id: "b", ownerId: "0" }),
      c: makeCard({ id: "c", ownerId: "0" }),
    };
    startSearchDeckReveal(G, "0", "think", { toHand: true, shuffleAfter: true });
    completeSearchDeckPick(G, "a");

    const s0 = "11".repeat(32);
    const s1 = "22".repeat(32);
    expect(commitDeckOpSeed(G, "0", hashSeedCommit(s0))).not.toBe("INVALID_MOVE");
    expect(commitDeckOpSeed(G, "1", hashSeedCommit(s1))).not.toBe("INVALID_MOVE");
    expect(G.activeDeckOp?.phase).toBe("reshuffle-reveal");
    expect(revealDeckOpSeed(G, "0", s0)).not.toBe("INVALID_MOVE");
    expect(revealDeckOpSeed(G, "1", s1)).not.toBe("INVALID_MOVE");
    // after both reveals: shuffle applied then reencrypt starts
    expect(G.activeDeckOp?.phase).toBe("reencrypt");
    expect(G.encryptedDecks["0"]).toHaveLength(2);

    const k0 = generateKeyPair();
    const k1 = generateKeyPair();
    const layer0 = buildDeckOpReencryptLayer(G, k0.privateKey)!;
    expect(submitDeckOpReencrypt(G, "0", null, layer0)).not.toBe("INVALID_MOVE");
    expect(G.activeDeckOp?.reencryptPlayerIndex).toBe(1);
    const layer1 = buildDeckOpReencryptLayer(G, k1.privateKey)!;
    expect(submitDeckOpReencrypt(G, "1", null, layer1)).not.toBe("INVALID_MOVE");
    expect(G.activeDeckOp).toBeNull();
    expect(G.encryptedDecks["0"][0].layers).toBe(2);
  });

  it("playAction search-deck holds turn while deck op active (plaintext deck)", () => {
    const G = createCryptoInitialState(
      { numPlayers: 2, playerIDs: ["0", "1"] } as any,
      { playMode: "mental-poker" } as any,
    );
    G.phase = "play";
    G.encryptedDecks["0"] = [
      { ciphertext: "x1", layers: 0 },
      { ciphertext: "x2", layers: 0 },
    ];
    G.cards = {
      x1: makeCard({ id: "x1", ownerId: "0" }),
      x2: makeCard({ id: "x2", ownerId: "0" }),
    };
    const think = makeCard({
      id: "future-tech-think",
      ownerId: "0",
      cardType: "action",
      tags: ["play:search-deck", "play:to-hand", "play:shuffle-after"],
    });
    putInHand(G, "0", think);
    playAction(G, { currentPlayer: "0" } as any, "0", think.id);
    expect(G.activeDeckOp?.phase).toBe("choose");
    expect(G.pendingPrompts?.length).toBe(1);
  });
});
