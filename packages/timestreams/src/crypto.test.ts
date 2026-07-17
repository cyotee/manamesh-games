import { describe, it, expect, beforeEach } from "vitest";
import type { Ctx } from "boardgame.io";
import {
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  buildEncryptionLayer,
  prepareEncryptionLayer,
  commitShuffleSeed,
  revealShuffleSeed,
  shuffleEncryptedDeck,
  hashSeedCommit,
} from "./crypto";
import { generateKeyPair } from "@manamesh/boardgameio-crypto/mental-poker";
import { normalizeSecp256k1PublicKey } from "@manamesh/boardgameio-crypto/keychain";

function ctx(player = "0", phase = "keyExchange"): Ctx {
  return { currentPlayer: player, numPlayers: 2, playOrder: ["0", "1"], phase, turn: 0, numMoves: 0 } as unknown as Ctx;
}
function state(ids = ["0", "1"]) {
  return createCryptoInitialState({ numPlayers: ids.length, playerIDs: ids } as any);
}

describe("crypto setup — initial state & key exchange", () => {
  let G: any;
  beforeEach(() => { G = state(); });

  it("starts in setup with null public keys and an empty timeline", () => {
    expect(G.phase).toBe("setup");
    expect(G.players["0"].publicKey).toBeNull();
    expect(Object.keys(G.timeline)).toHaveLength(6);
    expect(G.currentDay).toBe(1);
  });

  it("advances to encrypt once both keys are submitted", () => {
    G.phase = "keyExchange";
    const k0 = generateKeyPair(); const k1 = generateKeyPair();
    submitPublicKey(G, ctx("0"), "0", k0.publicKey);
    expect(G.phase).toBe("keyExchange");
    submitPublicKey(G, ctx("1"), "1", k1.publicKey);
    expect(G.phase).toBe("encrypt");
    expect(G.players["0"].publicKey).toBe(
      normalizeSecp256k1PublicKey(k0.publicKey),
    );
  });

  it("is idempotent on double-submit of the same key", () => {
    G.phase = "keyExchange";
    const k0 = generateKeyPair();
    submitPublicKey(G, ctx("0"), "0", k0.publicKey);
    expect(submitPublicKey(G, ctx("0"), "0", k0.publicKey)).not.toBe("INVALID_MOVE");
    expect(G.players["0"].publicKey).toBe(
      normalizeSecp256k1PublicKey(k0.publicKey),
    );
    // Different key after submit is rejected
    expect(submitPublicKey(G, ctx("0"), "0", generateKeyPair().publicKey)).toBe("INVALID_MOVE");
  });

  it("ignores late submit when already past keyExchange", () => {
    G.phase = "encrypt";
    expect(submitPublicKey(G, ctx("0"), "0", generateKeyPair().publicKey)).not.toBe("INVALID_MOVE");
    expect(G.players["0"].publicKey).toBeNull();
  });

  it("returns INVALID_MOVE for an unknown player", () => {
    G.phase = "keyExchange";
    expect(submitPublicKey(G, ctx("9"), "9", generateKeyPair().publicKey)).toBe("INVALID_MOVE");
  });
});

describe("crypto setup — encrypt with preEncrypted payload", () => {
  it("accepts client-built encryption layers", () => {
    const ids = ["0", "1"];
    const G: any = createCryptoInitialState({ numPlayers: 2, playerIDs: ids } as any, {
      playMode: "mental-poker",
    } as any);
    G.phase = "keyExchange";
    const keys: Record<string, any> = { "0": generateKeyPair(), "1": generateKeyPair() };
    submitPublicKey(G, ctx("0"), "0", keys["0"].publicKey);
    submitPublicKey(G, ctx("1"), "1", keys["1"].publicKey);
    expect(G.phase).toBe("encrypt");

    // Client-side binding + layer; multiplayer move gets ciphertexts only.
    const layer0 = prepareEncryptionLayer(G, "0", keys["0"].privateKey);
    expect(encryptDeck(G, ctx("0", "encrypt"), "0", null, layer0)).not.toBe(
      "INVALID_MOVE",
    );
    expect(G.players["0"].hasEncrypted).toBe(true);
    expect(G.encryptedDecks["0"][0].layers).toBe(1);

    const layer1 = prepareEncryptionLayer(G, "1", keys["1"].privateKey);
    expect(encryptDeck(G, ctx("1", "encrypt"), "1", null, layer1)).not.toBe(
      "INVALID_MOVE",
    );
    expect(G.phase).toBe("shuffle");
    expect(G.encryptedDecks["0"][0].layers).toBe(2);
  });

  it("prepareEncryptionLayer rejects sk that does not match published pubkey", () => {
    const ids = ["0", "1"];
    const G: any = createCryptoInitialState({ numPlayers: 2, playerIDs: ids } as any, {
      playMode: "mental-poker",
    } as any);
    G.phase = "keyExchange";
    const keys: Record<string, any> = { "0": generateKeyPair(), "1": generateKeyPair() };
    submitPublicKey(G, ctx("0"), "0", keys["0"].publicKey);
    submitPublicKey(G, ctx("1"), "1", keys["1"].publicKey);
    expect(() =>
      prepareEncryptionLayer(G, "0", generateKeyPair().privateKey),
    ).toThrow(/private_key_does_not_match/);
  });

  it("encryptDeck with preEncrypted does not require privateKey arg", () => {
    const ids = ["0", "1"];
    const G: any = createCryptoInitialState({ numPlayers: 2, playerIDs: ids } as any, {
      playMode: "mental-poker",
    } as any);
    G.phase = "keyExchange";
    const keys: Record<string, any> = { "0": generateKeyPair(), "1": generateKeyPair() };
    submitPublicKey(G, ctx("0"), "0", keys["0"].publicKey);
    submitPublicKey(G, ctx("1"), "1", keys["1"].publicKey);
    const layer = prepareEncryptionLayer(G, "0", keys["0"].privateKey);
    // Explicit: null privateKey + preEncrypted is the multiplayer shape
    expect(encryptDeck(G, ctx("0", "encrypt"), "0", null, layer)).not.toBe(
      "INVALID_MOVE",
    );
  });
});

describe("crypto setup — encrypt & shuffle round-trip", () => {
  it("runs keyExchange -> encrypt -> shuffle -> play deterministically", () => {
    const ids = ["0", "1"];
    const G: any = createCryptoInitialState({ numPlayers: 2, playerIDs: ids } as any, {
      playMode: "mental-poker",
    } as any);
    // Mental-poker path starts after setup; enter keyExchange explicitly.
    G.phase = "keyExchange";
    const keys: Record<string, any> = { "0": generateKeyPair(), "1": generateKeyPair() };

    submitPublicKey(G, ctx("0"), "0", keys["0"].publicKey);
    submitPublicKey(G, ctx("1"), "1", keys["1"].publicKey);
    expect(G.phase).toBe("encrypt");

    encryptDeck(G, ctx("0", "encrypt"), "0", keys["0"].privateKey);
    encryptDeck(G, ctx("1", "encrypt"), "1", keys["1"].privateKey);
    expect(G.phase).toBe("shuffle");

    const seeds: Record<string, string> = { "0": "aa".repeat(32), "1": "bb".repeat(32) };
    for (const id of ids) commitShuffleSeed(G, ctx(id, "shuffle"), id, hashSeedCommit(seeds[id]));
    for (const id of ids) revealShuffleSeed(G, ctx(id, "shuffle"), id, seeds[id]);
    shuffleEncryptedDeck(G, ctx("0", "shuffle"), "0");
    shuffleEncryptedDeck(G, ctx("1", "shuffle"), "1");

    expect(G.phase).toBe("play");
    // every player's deck is fully layered (encrypted by both players)
    expect(G.encryptedDecks["0"].every((c: any) => c.layers === 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BINDING REGRESSION: commit must be bound to a specific seed (RED before fix)
// ---------------------------------------------------------------------------

describe("crypto — shuffle seed commit binding (regression)", () => {
  function reachShufflePhase() {
    const ids = ["0", "1"];
    const G: any = createCryptoInitialState({ numPlayers: 2, playerIDs: ids } as any, {
      playMode: "mental-poker",
    } as any);
    G.phase = "keyExchange";
    const keys: Record<string, any> = { "0": generateKeyPair(), "1": generateKeyPair() };
    submitPublicKey(G, ctx("0"), "0", keys["0"].publicKey);
    submitPublicKey(G, ctx("1"), "1", keys["1"].publicKey);
    encryptDeck(G, ctx("0", "encrypt"), "0", keys["0"].privateKey);
    encryptDeck(G, ctx("1", "encrypt"), "1", keys["1"].privateKey);
    return G;
  }

  it("BINDING: a different same-length seed is rejected at reveal", () => {
    const G = reachShufflePhase();

    const seedA = "aa".repeat(32); // 64-char hex — player 0's true seed
    const seedB = "bb".repeat(32); // different 64-char hex — the attacker's substitute seed
    const seedC = "cc".repeat(32); // player 1's seed

    // Commit using the CORRECT byte-hashing helper (single source of truth).
    commitShuffleSeed(G, ctx("0", "shuffle"), "0", hashSeedCommit(seedA));
    commitShuffleSeed(G, ctx("1", "shuffle"), "1", hashSeedCommit(seedC));

    // Attack: player 0 reveals seedB instead of seedA.
    // hashSeedCommit(seedB) != hashSeedCommit(seedA), so the fixed code rejects this.
    const attackResult = revealShuffleSeed(G, ctx("0", "shuffle"), "0", seedB);
    expect(attackResult).toBe("INVALID_MOVE");

    // The correct seed is accepted.
    const correctResult = revealShuffleSeed(G, ctx("0", "shuffle"), "0", seedA);
    expect(correctResult).not.toBe("INVALID_MOVE");
  });
});

describe("crypto — deckSize derivation from pack/realDecks", () => {
  it("uses provided realDecks length for deckSize instead of default 36", () => {
    const ids = ["0", "1"];
    // Simulate real decks coming from a pack that has e.g. 38 cards (Future Tech)
    const fake38CardDeck = Array.from({ length: 38 }, (_, i) => ({ id: `card-${i}` })) as any;
    const realDecks = { "0": fake38CardDeck, "1": fake38CardDeck };

    const G: any = createCryptoInitialState(
      { numPlayers: 2, playerIDs: ids } as any,
      undefined,
      realDecks
    );

    expect(G.config.deckSize).toBe(38);
    expect(G.encryptedDecks["0"]).toHaveLength(38);
  });

  it("falls back to moduleConfig or DEFAULT when no realDecks", () => {
    const ids = ["0", "1"];
    const G: any = createCryptoInitialState(
      { numPlayers: 2, playerIDs: ids } as any,
      { deckSize: 42 }
    );
    expect(G.config.deckSize).toBe(42);
  });
});
