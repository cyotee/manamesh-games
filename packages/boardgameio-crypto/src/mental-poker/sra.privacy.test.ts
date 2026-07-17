/**
 * SRA privacy adversarial cases (M1–M3).
 *
 * Pins primitive privacy claims independent of poker wiring:
 * multi-layer ciphertext is not plaintext, a single key cannot recover
 * a fully layered card, and cooperative peel recovers the original id.
 *
 * Uses only shipped ./sra APIs — no reimplemented encrypt/decrypt loops.
 *
 * Note on decryptToCardId: it requires card.layers === 1 and throws otherwise.
 * Fully layered (2+) cards are therefore rejected by throw, not null.
 * After a partial peel to 1 layer, the wrong remaining key yields null.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeyPair,
  encrypt,
  decrypt,
  encryptDeck,
  reencryptDeck,
  decryptToCardId,
  buildCardPointLookup,
  getCardPoint,
} from "./sra";

describe("SRA privacy (adversarial)", () => {
  let keyA: ReturnType<typeof generateKeyPair>;
  let keyB: ReturnType<typeof generateKeyPair>;

  beforeAll(() => {
    keyA = generateKeyPair();
    keyB = generateKeyPair();
  });

  it("M1: ciphertext is not the plaintext card id or point", async () => {
    const cardId = "ace-of-spades";
    const point = await getCardPoint(cardId);
    const enc = encrypt(cardId, keyA.privateKey);
    expect(enc.ciphertext).not.toBe(cardId);
    expect(enc.ciphertext).not.toBe(point);
    expect(enc.layers).toBe(1);
  });

  it("M2: with two layers, holder of only keyA cannot recover card id", async () => {
    const cardIds = ["ace-spades", "king-hearts", "queen-diamonds"];
    const lookup = await buildCardPointLookup(cardIds);
    const cardId = "king-hearts";

    const layer1 = encrypt(cardId, keyA.privateKey);
    const layer2 = encrypt(layer1, keyB.privateKey);
    expect(layer2.layers).toBe(2);

    // decryptToCardId requires exactly 1 layer — fully layered card is rejected
    expect(() =>
      decryptToCardId(layer2, keyA.privateKey, lookup),
    ).toThrow(/Expected 1 layer/);
    expect(() =>
      decryptToCardId(layer2, keyB.privateKey, lookup),
    ).toThrow(/Expected 1 layer/);

    // Attacker A peels only their layer
    const peeledByA = decrypt(layer2, keyA.privateKey);
    expect(peeledByA.layers).toBe(1);
    // Remaining layer is B's — A's key alone still cannot map to a known card id
    expect(decryptToCardId(peeledByA, keyA.privateKey, lookup)).toBeNull();
    // After only A's peel, B's layer remains — still must not equal original point
    const original = await getCardPoint(cardId);
    expect(peeledByA.ciphertext).not.toBe(original);
  });

  it("M3: both keys recover original card id", async () => {
    const cardIds = ["ace-spades", "king-hearts"];
    const lookup = await buildCardPointLookup(cardIds);
    const cardId = "ace-spades";
    const original = await getCardPoint(cardId);

    let c = encrypt(cardId, keyA.privateKey);
    c = encrypt(c, keyB.privateKey);

    c = decrypt(c, keyB.privateKey);
    c = decrypt(c, keyA.privateKey);
    expect(c.layers).toBe(0);
    expect(c.ciphertext).toBe(original);

    // Full path via decryptToCardId after peeling to one layer then last key
    let d = encrypt(cardId, keyA.privateKey);
    d = encrypt(d, keyB.privateKey);
    d = decrypt(d, keyA.privateKey);
    expect(d.layers).toBe(1);
    expect(decryptToCardId(d, keyB.privateKey, lookup)).toBe(cardId);
  });

  it("M2-deck: reencrypted deck unreadable with single key", async () => {
    const ids = ["c0", "c1", "c2", "c3"];
    const lookup = await buildCardPointLookup(ids);
    let deck = encryptDeck(ids, keyA.privateKey);
    deck = reencryptDeck(deck, keyB.privateKey);
    for (const card of deck) {
      expect(card.layers).toBe(2);
      // Fully layered: decryptToCardId refuses (layers !== 1)
      expect(() =>
        decryptToCardId(card, keyA.privateKey, lookup),
      ).toThrow(/Expected 1 layer/);
      expect(() =>
        decryptToCardId(card, keyB.privateKey, lookup),
      ).toThrow(/Expected 1 layer/);

      // After peeling only A's layer, remaining ciphertext still unreadable with A
      const peeledByA = decrypt(card, keyA.privateKey);
      expect(peeledByA.layers).toBe(1);
      expect(decryptToCardId(peeledByA, keyA.privateKey, lookup)).toBeNull();

      // After peeling only B's layer, remaining ciphertext still unreadable with B
      const peeledByB = decrypt(card, keyB.privateKey);
      expect(peeledByB.layers).toBe(1);
      expect(decryptToCardId(peeledByB, keyB.privateKey, lookup)).toBeNull();
    }
  });

  describe.each([3, 4, 5] as const)("M12: %i-layer privacy (table-size primitives)", (n) => {
    it(`N=${n}: any proper subset of keys fails; full set recovers`, async () => {
      const keys = Array.from({ length: n }, () => generateKeyPair());
      const cardIds = ["ace-spades", "king-hearts", "queen-diamonds"];
      const lookup = await buildCardPointLookup(cardIds);
      const cardId = "queen-diamonds";
      const original = await getCardPoint(cardId);

      let c = encrypt(cardId, keys[0].privateKey);
      for (let i = 1; i < n; i++) {
        c = encrypt(c, keys[i].privateKey);
      }
      expect(c.layers).toBe(n);

      // Leave-one-out subsets cannot fully recover
      for (let skip = 0; skip < n; skip++) {
        let partial = { ...c };
        for (let i = 0; i < n; i++) {
          if (i === skip) continue;
          if (partial.layers === 0) break;
          partial = decrypt(partial, keys[i].privateKey);
        }
        expect(partial.layers).toBeGreaterThan(0);
        expect(partial.ciphertext).not.toBe(original);
      }

      // Full peel recovers
      let full = { ...c };
      for (let i = n - 1; i >= 0; i--) {
        full = decrypt(full, keys[i].privateKey);
      }
      expect(full.layers).toBe(0);
      expect(full.ciphertext).toBe(original);

      // decryptToCardId path: peel to 1 layer then last key
      let d = { ...c };
      for (let i = 0; i < n - 1; i++) {
        d = decrypt(d, keys[i].privateKey);
      }
      expect(d.layers).toBe(1);
      expect(decryptToCardId(d, keys[n - 1].privateKey, lookup)).toBe(cardId);
    });
  });
});
