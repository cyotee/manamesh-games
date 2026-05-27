import { describe, expect, it, beforeAll } from "vitest";
import {
  generateKeyPair,
  encrypt,
  decrypt,
  encryptDeck,
  reencryptDeck,
  decryptDeck,
  getCardPoint,
  buildCardPointLookup,
  verifyCommutative,
  decryptToCardId,
} from "./sra";
import type { CryptoKeyPair, EncryptedCard } from "./types";

describe("SRA Commutative Encryption", () => {
  let keyA: CryptoKeyPair;
  let keyB: CryptoKeyPair;

  beforeAll(() => {
    keyA = generateKeyPair();
    keyB = generateKeyPair();
  });

  describe("generateKeyPair", () => {
    it("generates valid key pairs", () => {
      const keyPair = generateKeyPair();

      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey.length).toBeGreaterThan(0);
      expect(keyPair.privateKey.length).toBeGreaterThan(0);
    });

    it("generates different keys each time", () => {
      const key1 = generateKeyPair();
      const key2 = generateKeyPair();

      expect(key1.privateKey).not.toBe(key2.privateKey);
      expect(key1.publicKey).not.toBe(key2.publicKey);
    });

    it("generates deterministic keys from seed", () => {
      const seed = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]);
      const key1 = generateKeyPair(seed);
      const key2 = generateKeyPair(seed);

      expect(key1.privateKey).toBe(key2.privateKey);
      expect(key1.publicKey).toBe(key2.publicKey);
    });
  });

  describe("encrypt/decrypt", () => {
    it("encrypts a card ID", () => {
      const cardId = "ace-of-spades";
      const encrypted = encrypt(cardId, keyA.privateKey);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.layers).toBe(1);
      expect(encrypted.ciphertext).not.toBe(cardId);
    });

    it("decrypts back to original point", async () => {
      const cardId = "king-of-hearts";
      const originalPoint = await getCardPoint(cardId);

      const encrypted = encrypt(cardId, keyA.privateKey);
      const decrypted = decrypt(encrypted, keyA.privateKey);

      expect(decrypted.layers).toBe(0);
      expect(decrypted.ciphertext).toBe(originalPoint);
    });

    it("throws when decrypting plaintext", () => {
      const plaintext: EncryptedCard = {
        ciphertext: "some-point",
        layers: 0,
      };

      expect(() => decrypt(plaintext, keyA.privateKey)).toThrow(
        "Cannot decrypt a plaintext card",
      );
    });

    it("handles multiple encryption layers", async () => {
      const cardId = "queen-of-diamonds";
      const originalPoint = await getCardPoint(cardId);

      const enc1 = encrypt(cardId, keyA.privateKey);
      expect(enc1.layers).toBe(1);

      const enc2 = encrypt(enc1, keyB.privateKey);
      expect(enc2.layers).toBe(2);

      const dec1 = decrypt(enc2, keyB.privateKey);
      expect(dec1.layers).toBe(1);

      const dec2 = decrypt(dec1, keyA.privateKey);
      expect(dec2.layers).toBe(0);
      expect(dec2.ciphertext).toBe(originalPoint);
    });
  });

  describe("commutative property", () => {
    it("verifies commutative encryption with verifyCommutative", async () => {
      const result = await verifyCommutative("ace-of-clubs", keyA, keyB);
      expect(result).toBe(true);
    });

    it("decryption order does not matter", async () => {
      const cardId = "two-of-hearts";
      const originalPoint = await getCardPoint(cardId);

      // Encrypt with A then B
      const encA = encrypt(cardId, keyA.privateKey);
      const encAB = encrypt(encA, keyB.privateKey);

      // Decrypt A first, then B
      const decA_first = decrypt(encAB, keyA.privateKey);
      const result1 = decrypt(decA_first, keyB.privateKey);

      // Decrypt B first, then A
      const decB_first = decrypt(encAB, keyB.privateKey);
      const result2 = decrypt(decB_first, keyA.privateKey);

      // Both should equal original
      expect(result1.ciphertext).toBe(originalPoint);
      expect(result2.ciphertext).toBe(originalPoint);
      expect(result1.ciphertext).toBe(result2.ciphertext);
    });

    it("works with three players", async () => {
      const keyC = generateKeyPair();
      const cardId = "jack-of-spades";
      const originalPoint = await getCardPoint(cardId);

      // Encrypt A -> B -> C
      const encA = encrypt(cardId, keyA.privateKey);
      const encAB = encrypt(encA, keyB.privateKey);
      const encABC = encrypt(encAB, keyC.privateKey);

      // Decrypt in different orders
      // Order: C -> A -> B
      const d1 = decrypt(encABC, keyC.privateKey);
      const d2 = decrypt(d1, keyA.privateKey);
      const d3 = decrypt(d2, keyB.privateKey);

      // Order: B -> C -> A
      const e1 = decrypt(encABC, keyB.privateKey);
      const e2 = decrypt(e1, keyC.privateKey);
      const e3 = decrypt(e2, keyA.privateKey);

      expect(d3.ciphertext).toBe(originalPoint);
      expect(e3.ciphertext).toBe(originalPoint);
    });
  });

  describe("hashToPoint", () => {
    it("same card ID produces same point", async () => {
      const point1 = await getCardPoint("ace-of-spades");
      const point2 = await getCardPoint("ace-of-spades");

      expect(point1).toBe(point2);
    });

    it("different card IDs produce different points", async () => {
      const point1 = await getCardPoint("ace-of-spades");
      const point2 = await getCardPoint("ace-of-hearts");

      expect(point1).not.toBe(point2);
    });

    it("produces valid curve points", () => {
      // If the point is invalid, encryption would fail
      const cardId = "random-card-123";
      const encrypted = encrypt(cardId, keyA.privateKey);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    });
  });

  describe("buildCardPointLookup", () => {
    it("builds lookup table for card IDs", async () => {
      const cardIds = ["card-1", "card-2", "card-3"];
      const lookup = await buildCardPointLookup(cardIds);

      expect(lookup.size).toBe(3);
      expect(lookup.has("card-1")).toBe(true);
      expect(lookup.has("card-2")).toBe(true);
      expect(lookup.has("card-3")).toBe(true);
    });

    it("lookup values are valid points", async () => {
      const cardIds = ["ace", "king", "queen"];
      const lookup = await buildCardPointLookup(cardIds);

      for (const [cardId, point] of lookup) {
        const expected = await getCardPoint(cardId);
        expect(point).toBe(expected);
      }
    });
  });

  describe("decryptToCardId", () => {
    it("recovers original card ID after decryption", async () => {
      const cardIds = ["ace-spades", "king-hearts", "queen-diamonds"];
      const lookup = await buildCardPointLookup(cardIds);

      const cardId = "king-hearts";
      const encrypted = encrypt(cardId, keyA.privateKey);
      const decrypted = decrypt(encrypted, keyA.privateKey);

      // Re-encrypt to have 1 layer for decryptToCardId
      const reencrypted = encrypt(decrypted.ciphertext, keyA.privateKey);

      const finalEnc = encrypt(cardId, keyA.privateKey);
      const recovered = decryptToCardId(finalEnc, keyA.privateKey, lookup);

      expect(recovered).toBe(cardId);
    });

    it("returns null for unknown card", async () => {
      const cardIds = ["ace", "king"];
      const lookup = await buildCardPointLookup(cardIds);

      // Encrypt a card not in the lookup
      const encrypted = encrypt("unknown-card", keyA.privateKey);
      const recovered = decryptToCardId(encrypted, keyA.privateKey, lookup);

      expect(recovered).toBeNull();
    });
  });

  describe("deck operations", () => {
    const testDeck = ["card-1", "card-2", "card-3", "card-4"];

    it("encrypts entire deck", () => {
      const encrypted = encryptDeck(testDeck, keyA.privateKey);

      expect(encrypted.length).toBe(testDeck.length);
      encrypted.forEach((card) => {
        expect(card.layers).toBe(1);
      });
    });

    it("reencrypts already encrypted deck", () => {
      const encrypted = encryptDeck(testDeck, keyA.privateKey);
      const reencrypted = reencryptDeck(encrypted, keyB.privateKey);

      expect(reencrypted.length).toBe(testDeck.length);
      reencrypted.forEach((card) => {
        expect(card.layers).toBe(2);
      });
    });

    it("decrypts deck layer", () => {
      const encrypted = encryptDeck(testDeck, keyA.privateKey);
      const reencrypted = reencryptDeck(encrypted, keyB.privateKey);
      const decrypted = decryptDeck(reencrypted, keyA.privateKey);

      expect(decrypted.length).toBe(testDeck.length);
      decrypted.forEach((card) => {
        expect(card.layers).toBe(1);
      });
    });

    it("full encrypt/decrypt cycle preserves card points", async () => {
      const lookup = await buildCardPointLookup(testDeck);

      // Player A encrypts
      const encA = encryptDeck(testDeck, keyA.privateKey);

      // Player B re-encrypts
      const encAB = reencryptDeck(encA, keyB.privateKey);

      // Decrypt in any order
      const decA = decryptDeck(encAB, keyA.privateKey);
      const decAB = decryptDeck(decA, keyB.privateKey);

      // All should be back to original points
      testDeck.forEach((cardId, i) => {
        expect(decAB[i].layers).toBe(0);
        expect(decAB[i].ciphertext).toBe(lookup.get(cardId));
      });
    });
  });

  describe("performance", () => {
    it("encrypts 52 cards in reasonable time", async () => {
      const deck = Array.from({ length: 52 }, (_, i) => `card-${i}`);

      const start = performance.now();
      const encrypted = encryptDeck(deck, keyA.privateKey);
      const duration = performance.now() - start;

      expect(encrypted.length).toBe(52);
      // Should complete in under 10 seconds (generous for CI/slow machines)
      expect(duration).toBeLessThan(10000);
    });

    it("reencrypts 52 cards in reasonable time", () => {
      const deck = Array.from({ length: 52 }, (_, i) => `card-${i}`);
      const encrypted = encryptDeck(deck, keyA.privateKey);

      const start = performance.now();
      const reencrypted = reencryptDeck(encrypted, keyB.privateKey);
      const duration = performance.now() - start;

      expect(reencrypted.length).toBe(52);
      // Should complete in under 5 seconds (generous for CI/slow machines)
      expect(duration).toBeLessThan(5000);
    });
  });
});
