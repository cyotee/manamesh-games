import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx } from "boardgame.io";
import { createCryptoInitialState, submitPublicKey } from "./crypto";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";

function ctx(player = "0", phase = "keyExchange"): Ctx {
  return { currentPlayer: player, numPlayers: 2, playOrder: ["0", "1"], phase, turn: 0, numMoves: 0 } as unknown as Ctx;
}
function state(ids = ["0", "1"]) {
  return createCryptoInitialState({ numPlayers: ids.length, playerIDs: ids } as any);
}

describe("crypto setup — initial state & key exchange", () => {
  let G: any;
  beforeEach(() => { G = state(); });

  it("starts in keyExchange with null public keys and an empty timeline", () => {
    expect(G.phase).toBe("keyExchange");
    expect(G.players["0"].publicKey).toBeNull();
    expect(Object.keys(G.timeline)).toHaveLength(6);
    expect(G.currentDay).toBe(1);
  });

  it("advances to encrypt once both keys are submitted", () => {
    const k0 = generateKeyPair(); const k1 = generateKeyPair();
    submitPublicKey(G, ctx("0"), "0", k0.publicKey);
    expect(G.phase).toBe("keyExchange");
    submitPublicKey(G, ctx("1"), "1", k1.publicKey);
    expect(G.phase).toBe("encrypt");
    expect(G.players["0"].publicKey).toBe(k0.publicKey);
  });
});
