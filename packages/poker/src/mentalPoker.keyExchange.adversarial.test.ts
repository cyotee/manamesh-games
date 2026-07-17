/**
 * S10 — Key-exchange adversarial matrix.
 *
 * Poker admits keys via boardgameio-crypto keychain + MENTAL_POKER_KEYCHAIN_POLICY:
 * valid finite secp256k1 points, one key per seat, unique public keys across seats.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import {
  generateKeyPair,
  buildCardPointLookup,
} from "@manamesh/boardgameio-crypto/mental-poker";
import {
  normalizeSecp256k1PublicKey,
  MENTAL_POKER_KEYCHAIN_POLICY,
} from "@manamesh/boardgameio-crypto/keychain";
import { mockCtx } from "./mentalPoker.harness";
import {
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  type CryptoPokerState,
} from "./crypto";

async function freshKeyExchangeState(
  numPlayers: number,
): Promise<{ G: CryptoPokerState; keys: ReturnType<typeof generateKeyPair>[] }> {
  const playerIDs = Array.from({ length: numPlayers }, (_, i) => `${i}`);
  let G = createCryptoInitialState({
    numPlayers,
    playerIDs,
    options: {},
  });
  const lookup = await buildCardPointLookup(G.cardIds);
  for (const [id, pt] of lookup) G.crypto.cardPointLookup[id] = pt;

  const keys = playerIDs.map((_, i) => {
    const seed = new Uint8Array(32);
    seed[0] = 0xb2;
    seed[1] = i + 1;
    seed[2] = 0x7c;
    seed[3] = numPlayers;
    for (let j = 4; j < 32; j++) seed[j] = (i * 19 + j) & 0xff;
    return generateKeyPair(seed);
  });
  return { G, keys };
}

describe("S10 key-exchange adversarial", () => {
  it("S10.1: duplicate public key for two seats → INVALID_MOVE", async () => {
    const { G, keys } = await freshKeyExchangeState(2);
    const sharedPub = keys[0].publicKey;

    const r0 = submitPublicKey(G, mockCtx("0", { numPlayers: 2 }), "0", sharedPub);
    expect(r0).not.toBe(INVALID_MOVE);
    const state = r0 as CryptoPokerState;
    expect(state.players["0"].publicKey).toBe(
      normalizeSecp256k1PublicKey(sharedPub),
    );

    const r1 = submitPublicKey(
      state,
      mockCtx("1", { numPlayers: 2 }),
      "1",
      sharedPub,
    );
    expect(r1).toBe(INVALID_MOVE);
    expect(state.players["1"].publicKey).toBeNull();
    expect(state.phase).toBe("keyExchange");
    expect(MENTAL_POKER_KEYCHAIN_POLICY.uniquePublicKeys).toBe(true);
  });

  it("S10.2: invalid / non-curve public key → INVALID_MOVE", async () => {
    const { G } = await freshKeyExchangeState(2);
    const invalidKeys = [
      "",
      "not-a-point",
      "deadbeef",
      "00",
      "02" + "00".repeat(31),
    ];

    for (const bad of invalidKeys) {
      const res = submitPublicKey(
        G,
        mockCtx("0", { numPlayers: 2 }),
        "0",
        bad,
      );
      expect(res).toBe(INVALID_MOVE);
      expect(G.players["0"].publicKey).toBeNull();
    }
  });

  it("S10.3: second submitPublicKey after already set → INVALID_MOVE", async () => {
    const { G, keys } = await freshKeyExchangeState(2);
    const first = submitPublicKey(
      G,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      keys[0].publicKey,
    );
    expect(first).not.toBe(INVALID_MOVE);
    const state = first as CryptoPokerState;
    const stored = state.players["0"].publicKey;
    expect(stored).toBe(normalizeSecp256k1PublicKey(keys[0].publicKey));

    const other = generateKeyPair();
    const second = submitPublicKey(
      state,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      other.publicKey,
    );
    expect(second).toBe(INVALID_MOVE);
    expect(state.players["0"].publicKey).toBe(stored);
  });

  it("S10.4: encrypt out of turn / wrong phase → INVALID_MOVE", async () => {
    const { G, keys } = await freshKeyExchangeState(2);

    expect(
      encryptDeck(G, mockCtx("0", { numPlayers: 2 }), "0", keys[0].privateKey),
    ).toBe(INVALID_MOVE);

    let state = submitPublicKey(
      G,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      keys[0].publicKey,
    ) as CryptoPokerState;
    state = submitPublicKey(
      state,
      mockCtx("1", { numPlayers: 2 }),
      "1",
      keys[1].publicKey,
    ) as CryptoPokerState;
    expect(state.phase).toBe("encrypt");
    expect(state.setupPlayerIndex).toBe(0);

    expect(
      encryptDeck(
        state,
        mockCtx("1", { numPlayers: 2 }),
        "1",
        keys[1].privateKey,
      ),
    ).toBe(INVALID_MOVE);

    const enc0 = encryptDeck(
      state,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      keys[0].privateKey,
    );
    expect(enc0).not.toBe(INVALID_MOVE);
    state = enc0 as CryptoPokerState;

    expect(
      encryptDeck(
        state,
        mockCtx("0", { numPlayers: 2 }),
        "0",
        keys[0].privateKey,
      ),
    ).toBe(INVALID_MOVE);
  });

  it("S10.5: encrypt before key exchange complete → INVALID_MOVE", async () => {
    const { G, keys } = await freshKeyExchangeState(3);

    const partial = submitPublicKey(
      G,
      mockCtx("0", { numPlayers: 3 }),
      "0",
      keys[0].publicKey,
    ) as CryptoPokerState;
    expect(partial.phase).toBe("keyExchange");
    expect(
      encryptDeck(
        partial,
        mockCtx("0", { numPlayers: 3 }),
        "0",
        keys[0].privateKey,
      ),
    ).toBe(INVALID_MOVE);

    const partial2 = submitPublicKey(
      partial,
      mockCtx("1", { numPlayers: 3 }),
      "1",
      keys[1].publicKey,
    ) as CryptoPokerState;
    expect(partial2.phase).toBe("keyExchange");
    expect(
      encryptDeck(
        partial2,
        mockCtx("0", { numPlayers: 3 }),
        "0",
        keys[0].privateKey,
      ),
    ).toBe(INVALID_MOVE);

    const full = submitPublicKey(
      partial2,
      mockCtx("2", { numPlayers: 3 }),
      "2",
      keys[2].publicKey,
    ) as CryptoPokerState;
    expect(full.phase).toBe("encrypt");
    const enc = encryptDeck(
      full,
      mockCtx("0", { numPlayers: 3 }),
      "0",
      keys[0].privateKey,
    );
    expect(enc).not.toBe(INVALID_MOVE);
  });

  it("S10.6: stores canonical compressed public keys", async () => {
    const { G, keys } = await freshKeyExchangeState(2);
    const state = submitPublicKey(
      G,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      keys[0].publicKey,
    ) as CryptoPokerState;
    const stored = state.players["0"].publicKey!;
    expect(stored).toBe(normalizeSecp256k1PublicKey(keys[0].publicKey));
    // Compressed form starts with 02 or 03
    expect(stored.startsWith("02") || stored.startsWith("03")).toBe(true);
    expect(state.crypto.keychain?.entries["0"]?.fingerprint).toBeTruthy();
  });

  it("S10.7: encryptDeck rejects private key that does not match published pubkey", async () => {
    const { G, keys } = await freshKeyExchangeState(2);
    let state = submitPublicKey(
      G,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      keys[0].publicKey,
    ) as CryptoPokerState;
    state = submitPublicKey(
      state,
      mockCtx("1", { numPlayers: 2 }),
      "1",
      keys[1].publicKey,
    ) as CryptoPokerState;
    expect(state.phase).toBe("encrypt");

    const wrongSk = generateKeyPair().privateKey;
    expect(
      encryptDeck(state, mockCtx("0", { numPlayers: 2 }), "0", wrongSk),
    ).toBe(INVALID_MOVE);

    const ok = encryptDeck(
      state,
      mockCtx("0", { numPlayers: 2 }),
      "0",
      keys[0].privateKey,
    );
    expect(ok).not.toBe(INVALID_MOVE);
  });
});
