import { describe, expect, it, beforeEach } from "vitest";
import {
  CryptoPlugin,
  createPlayerCryptoContext,
  generateStandard52CardIds,
  type CryptoPluginGameState,
  type CryptoPlayerContext,
} from "./crypto-plugin";
import { decrypt, encrypt } from "../mental-poker";
import type { Ctx } from "boardgame.io";

describe("CryptoPlugin", () => {
  let gameState: CryptoPluginGameState;
  let ctx: Ctx;
  let playerA: CryptoPlayerContext;
  let playerB: CryptoPlayerContext;

  beforeEach(() => {
    // Initialize game state
    gameState = {
      zones: {},
      crypto: CryptoPlugin.setup(),
    };

    // Mock context
    ctx = {
      numPlayers: 2,
      playOrder: ["playerA", "playerB"],
      currentPlayer: "playerA",
    } as unknown as Ctx;

    // Create player contexts
    playerA = createPlayerCryptoContext("playerA");
    playerB = createPlayerCryptoContext("playerB");
  });

  describe("setup", () => {
    it("creates initial crypto state", () => {
      const state = CryptoPlugin.setup();

      expect(state.phase).toBe("init");
      expect(state.publicKeys).toEqual({});
      expect(state.encryptedZones).toEqual({});
    });
  });

  describe("api.init", () => {
    it("initializes card point lookup", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card1", "card2", "card3"];
      await api.init(cardIds, ["playerA", "playerB"]);

      expect(Object.keys(gameState.crypto.cardPointLookup)).toHaveLength(3);
      expect(gameState.crypto.phase).toBe("keyExchange");
    });
  });

  describe("api.submitPublicKey", () => {
    it("stores player public key", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      await api.init(["card1"], ["playerA", "playerB"]);
      api.submitPublicKey("playerA", playerA.keyPair.publicKey);

      // Stored in canonical compressed form via keychain policy.
      const { normalizeSecp256k1PublicKey } = await import("../keychain");
      expect(gameState.crypto.publicKeys["playerA"]).toBe(
        normalizeSecp256k1PublicKey(playerA.keyPair.publicKey),
      );
    });

    it("rejects invalid and duplicate public keys", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });
      await api.init(["card1"], ["playerA", "playerB"]);
      expect(() => api.submitPublicKey("playerA", "not-a-point")).toThrow(
        /keychain_reject/,
      );
      api.submitPublicKey("playerA", playerA.keyPair.publicKey);
      expect(() =>
        api.submitPublicKey("playerB", playerA.keyPair.publicKey),
      ).toThrow(/keychain_reject:duplicate_key/);
    });
  });

  describe("api.allKeysSubmitted", () => {
    it("returns false when not all keys submitted", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      await api.init(["card1"], ["playerA", "playerB"]);
      api.submitPublicKey("playerA", playerA.keyPair.publicKey);

      expect(api.allKeysSubmitted()).toBe(false);
    });

    it("returns true when all keys submitted", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      await api.init(["card1"], ["playerA", "playerB"]);
      api.submitPublicKey("playerA", playerA.keyPair.publicKey);
      api.submitPublicKey("playerB", playerB.keyPair.publicKey);

      expect(api.allKeysSubmitted()).toBe(true);
    });
  });

  describe("api.encryptDeckForPlayer", () => {
    it("encrypts deck for first player", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card1", "card2", "card3"];
      await api.init(cardIds, ["playerA", "playerB"]);

      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);

      expect(gameState.crypto.encryptedZones["deck"]).toHaveLength(3);
      expect(gameState.crypto.encryptedZones["deck"][0].layers).toBe(1);
    });

    it("re-encrypts deck for second player", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card1", "card2"];
      await api.init(cardIds, ["playerA", "playerB"]);

      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);
      api.encryptDeckForPlayer("deck", "playerB", playerB.keyPair.privateKey);

      expect(gameState.crypto.encryptedZones["deck"]).toHaveLength(2);
      expect(gameState.crypto.encryptedZones["deck"][0].layers).toBe(2);
    });
  });

  describe("api.shuffleDeckWithProof", () => {
    it("shuffles deck and creates proof", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card1", "card2", "card3", "card4", "card5"];
      await api.init(cardIds, ["playerA", "playerB"]);
      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);

      const { proof } = await api.shuffleDeckWithProof(
        "deck",
        "playerA",
        playerA.keyPair.privateKey,
      );

      expect(proof).toBeDefined();
      expect(proof.commitment).toBeDefined();
      expect(gameState.crypto.shuffleProofs["playerA"]).toBeDefined();
    });
  });

  describe("api.submitDecryptedShare", () => {
    it("decrypts one layer of a card", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card1", "card2"];
      await api.init(cardIds, ["playerA", "playerB"]);
      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);
      api.encryptDeckForPlayer("deck", "playerB", playerB.keyPair.privateKey);

      // Card has 2 layers now
      expect(gameState.crypto.encryptedZones["deck"][0].layers).toBe(2);

      // Get encrypted card and decrypt locally (V2 pattern)
      const encryptedCard = api.getEncryptedCard("deck", 0);
      const decryptedCard = decrypt(encryptedCard!, playerA.keyPair.privateKey);

      // Player A submits decrypted share
      api.submitDecryptedShare("deck", 0, "playerA", decryptedCard);

      expect(gameState.crypto.encryptedZones["deck"][0].layers).toBe(1);
    });

    it("fully reveals card after all shares", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card1", "card2"];
      await api.init(cardIds, ["playerA", "playerB"]);
      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);
      api.encryptDeckForPlayer("deck", "playerB", playerB.keyPair.privateKey);

      // Both players decrypt locally and submit results (order doesn't matter)
      const encryptedCard = api.getEncryptedCard("deck", 0)!;

      // Player A decrypts their layer
      const decryptedByA = decrypt(encryptedCard, playerA.keyPair.privateKey);
      api.submitDecryptedShare("deck", 0, "playerA", decryptedByA);

      // Player B decrypts their layer
      const currentCard = api.getEncryptedCard("deck", 0)!;
      const decryptedByB = decrypt(currentCard, playerB.keyPair.privateKey);
      api.submitDecryptedShare("deck", 0, "playerB", decryptedByB);

      expect(api.isCardRevealed("deck", 0)).toBe(true);
      expect(api.getRevealedCardId("deck", 0)).toBe("card1");
    });
  });

  describe("api.moveEncryptedCard", () => {
    it("moves card between zones", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card1", "card2", "card3"];
      await api.init(cardIds, ["playerA", "playerB"]);
      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);

      expect(api.getEncryptedCardCount("deck")).toBe(3);
      expect(api.getEncryptedCardCount("played")).toBe(0);

      api.moveEncryptedCard("deck", "played", 0);

      expect(api.getEncryptedCardCount("deck")).toBe(2);
      expect(api.getEncryptedCardCount("played")).toBe(1);
    });
  });

  describe("createPlayerCryptoContext", () => {
    it("creates context with key pair", () => {
      const context = createPlayerCryptoContext("player1");

      expect(context.playerId).toBe("player1");
      expect(context.keyPair.publicKey).toBeDefined();
      expect(context.keyPair.privateKey).toBeDefined();
    });

    it("creates deterministic context with seed", () => {
      const seed = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const context1 = createPlayerCryptoContext("player1", seed);
      const context2 = createPlayerCryptoContext("player1", seed);

      expect(context1.keyPair.privateKey).toBe(context2.keyPair.privateKey);
    });
  });

  describe("generateStandard52CardIds", () => {
    it("generates 52 card IDs", () => {
      const cardIds = generateStandard52CardIds();

      expect(cardIds).toHaveLength(52);
    });

    it("includes all suits and ranks", () => {
      const cardIds = generateStandard52CardIds();

      expect(cardIds).toContain("hearts-A");
      expect(cardIds).toContain("spades-K");
      expect(cardIds).toContain("diamonds-2");
      expect(cardIds).toContain("clubs-10");
    });

    it("generates unique IDs", () => {
      const cardIds = generateStandard52CardIds();
      const unique = new Set(cardIds);

      expect(unique.size).toBe(52);
    });
  });

  describe("full encryption/decryption cycle", () => {
    it("correctly reveals cards after full protocol", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      // Use a small deck for testing
      const cardIds = ["ace-spades", "king-hearts", "queen-diamonds"];
      await api.init(cardIds, ["playerA", "playerB"]);

      // Key exchange
      api.submitPublicKey("playerA", playerA.keyPair.publicKey);
      api.submitPublicKey("playerB", playerB.keyPair.publicKey);

      // Player A encrypts
      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);

      // Player B re-encrypts
      api.encryptDeckForPlayer("deck", "playerB", playerB.keyPair.privateKey);

      // Reveal first card - both players decrypt locally and submit results
      const encryptedCard = api.getEncryptedCard("deck", 0)!;

      // Player B decrypts first (order doesn't matter)
      const decryptedByB = decrypt(encryptedCard, playerB.keyPair.privateKey);
      api.submitDecryptedShare("deck", 0, "playerB", decryptedByB);

      // Player A decrypts second
      const currentCard = api.getEncryptedCard("deck", 0)!;
      const decryptedByA = decrypt(currentCard, playerA.keyPair.privateKey);
      api.submitDecryptedShare("deck", 0, "playerA", decryptedByA);

      // First card should be revealed as 'ace-spades'
      expect(api.isCardRevealed("deck", 0)).toBe(true);
      expect(api.getRevealedCardId("deck", 0)).toBe("ace-spades");

      // Other cards still encrypted
      expect(api.isCardRevealed("deck", 1)).toBe(false);
      expect(api.isCardRevealed("deck", 2)).toBe(false);
    });

    it("preserves card order through encryption", async () => {
      const api = CryptoPlugin.api({
        G: gameState,
        ctx,
        data: gameState.crypto,
      });

      const cardIds = ["card-0", "card-1", "card-2", "card-3", "card-4"];
      await api.init(cardIds, ["playerA", "playerB"]);

      api.encryptDeckForPlayer("deck", "playerA", playerA.keyPair.privateKey);
      api.encryptDeckForPlayer("deck", "playerB", playerB.keyPair.privateKey);

      // Reveal all cards in order
      for (let i = 0; i < cardIds.length; i++) {
        const encryptedCard = api.getEncryptedCard("deck", i)!;

        // Both players decrypt
        const decA = decrypt(encryptedCard, playerA.keyPair.privateKey);
        api.submitDecryptedShare("deck", i, "playerA", decA);

        const currentCard = api.getEncryptedCard("deck", i)!;
        const decB = decrypt(currentCard, playerB.keyPair.privateKey);
        api.submitDecryptedShare("deck", i, "playerB", decB);

        expect(api.getRevealedCardId("deck", i)).toBe(`card-${i}`);
      }
    });
  });
});
