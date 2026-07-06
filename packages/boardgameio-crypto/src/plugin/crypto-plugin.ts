/**
 * Crypto Plugin for boardgame.io
 *
 * Wraps the DeckPlugin with mental poker encryption.
 * Provides cryptographic fair play for P2P card games.
 *
 * Key features:
 * - Commutative encryption of deck
 * - Shuffle proofs
 * - Collaborative card reveal
 * - Commitment verification
 */

import type { Ctx } from "boardgame.io";
/**
 * Minimal card contract the crypto plugin operates over. The frontend's
 * `game/modules/types.ts` defines a structurally-compatible `CoreCard`;
 * any card with at least an `id` and `name` satisfies this bound.
 */
export interface CoreCard {
  id: string;
  name: string;
  imageCid?: string;
  backImageCid?: string;
}
import {
  generateKeyPair,
  encrypt,
  decrypt,
  encryptDeck,
  reencryptDeck,
  decryptDeck,
  buildCardPointLookup,
  getCardPoint,
  type CryptoKeyPair,
  type EncryptedCard,
  type EncryptedDeck,
  type ShuffleProof,
  type DeckCommitment,
  createCommitment,
  verifyCommitment,
  shuffleWithProof,
  verifyShuffleProof,
  type Permutation,
} from "../mental-poker";

// =============================================================================
// Types
// =============================================================================

/**
 * Zone identifier (matches DeckPlugin).
 */
export type ZoneId = string;

/**
 * Crypto plugin state stored in game state.
 */
export interface CryptoPluginState {
  /** Current protocol phase */
  phase:
    | "init"
    | "keyExchange"
    | "encrypt"
    | "shuffle"
    | "ready"
    | "playing"
    | "reveal";

  /** Player public keys (playerId -> publicKey hex) */
  publicKeys: Record<string, string>;

  /** Deck commitments (playerId -> commitment) */
  commitments: Record<string, SerializedCommitment>;

  /** Shuffle proofs (playerId -> proof) */
  shuffleProofs: Record<string, SerializedShuffleProof>;

  /** Encrypted zones (zoneId -> encrypted cards) */
  encryptedZones: Record<string, EncryptedCard[]>;

  /** Card point lookup table (cardId -> point hex) */
  cardPointLookup: Record<string, string>;

  /** Revealed cards (card index -> cardId) */
  revealedCards: Record<string, string>;

  /** Pending reveal shares (cardIndex -> playerId -> share) */
  pendingReveals: Record<string, Record<string, string>>;
}

/**
 * Serialized commitment for storage in game state.
 */
export interface SerializedCommitment {
  hash: string; // hex
  nonce: string; // hex
  timestamp: number;
}

/**
 * Serialized shuffle proof for storage in game state.
 */
export interface SerializedShuffleProof {
  commitment: string; // hex
  proof: string; // base64
  publicInputs: string[];
  inputHash: string;
  outputHash: string;
  nonce: string; // hex
}

/**
 * Game state with crypto plugin data.
 */
export interface CryptoPluginGameState<TCard extends CoreCard = CoreCard> {
  /** Zones with plaintext cards (for revealed cards) */
  zones: Record<string, Record<string, TCard[]>>;
  /** Crypto plugin state */
  crypto: CryptoPluginState;
}

/**
 * Player's private crypto context (not stored in game state).
 */
export interface CryptoPlayerContext {
  playerId: string;
  keyPair: CryptoKeyPair;
  shuffleNonces: Map<string, Uint8Array>; // zoneId -> nonce
}

/**
 * Crypto plugin API.
 */
export interface CryptoPluginApi {
  /** Initialize crypto for a game */
  init: (cardIds: string[], playerIds: string[]) => void;

  /** Submit player's public key */
  submitPublicKey: (playerId: string, publicKey: string) => void;

  /** Check if all keys are submitted */
  allKeysSubmitted: () => boolean;

  /** Get current phase */
  getPhase: () => CryptoPluginState["phase"];

  /** Encrypt deck with player's key (call in order) */
  encryptDeckForPlayer: (
    zoneId: ZoneId,
    playerId: string,
    privateKey: string,
  ) => void;

  /** Shuffle deck with proof */
  shuffleDeckWithProof: (
    zoneId: ZoneId,
    playerId: string,
    privateKey: string,
  ) => Promise<{ proof: SerializedShuffleProof }>;

  /** Submit decrypted share for revealing a card (V2: decrypt locally, send result not key) */
  submitDecryptedShare: (
    zoneId: ZoneId,
    cardIndex: number,
    playerId: string,
    decryptedCard: EncryptedCard,
  ) => void;

  /** Check if card is fully revealed */
  isCardRevealed: (zoneId: ZoneId, cardIndex: number) => boolean;

  /** Get revealed card ID */
  getRevealedCardId: (zoneId: ZoneId, cardIndex: number) => string | null;

  /** Get encrypted card at index */
  getEncryptedCard: (zoneId: ZoneId, cardIndex: number) => EncryptedCard | null;

  /** Get number of encrypted cards in zone */
  getEncryptedCardCount: (zoneId: ZoneId) => number;

  /** Move encrypted card between zones */
  moveEncryptedCard: (
    fromZoneId: ZoneId,
    toZoneId: ZoneId,
    cardIndex: number,
  ) => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function serializeCommitment(commitment: DeckCommitment): SerializedCommitment {
  return {
    hash: bytesToHex(commitment.hash),
    nonce: bytesToHex(commitment.nonce),
    timestamp: commitment.timestamp,
  };
}

function deserializeCommitment(
  serialized: SerializedCommitment,
): DeckCommitment {
  return {
    hash: hexToBytes(serialized.hash),
    nonce: hexToBytes(serialized.nonce),
    timestamp: serialized.timestamp,
  };
}

function serializeShuffleProof(
  proof: ShuffleProof,
  nonce: Uint8Array,
): SerializedShuffleProof {
  return {
    commitment: bytesToHex(proof.commitment),
    proof: btoa(String.fromCharCode(...proof.proof)),
    publicInputs: proof.publicInputs,
    inputHash: proof.inputHash,
    outputHash: proof.outputHash,
    nonce: bytesToHex(nonce),
  };
}

function deserializeShuffleProof(serialized: SerializedShuffleProof): {
  proof: ShuffleProof;
  nonce: Uint8Array;
} {
  const proofBytes = Uint8Array.from(atob(serialized.proof), (c) =>
    c.charCodeAt(0),
  );

  return {
    proof: {
      commitment: hexToBytes(serialized.commitment),
      proof: proofBytes,
      publicInputs: serialized.publicInputs,
      inputHash: serialized.inputHash,
      outputHash: serialized.outputHash,
    },
    nonce: hexToBytes(serialized.nonce),
  };
}

// =============================================================================
// Plugin Implementation
// =============================================================================

/**
 * Initial crypto plugin state.
 */
function createInitialCryptoState(): CryptoPluginState {
  return {
    phase: "init",
    publicKeys: {},
    commitments: {},
    shuffleProofs: {},
    encryptedZones: {},
    cardPointLookup: {},
    revealedCards: {},
    pendingReveals: {},
  };
}

/**
 * The Crypto Plugin for boardgame.io.
 */
export const CryptoPlugin = {
  name: "crypto",

  setup: (): CryptoPluginState => createInitialCryptoState(),

  api: <TCard extends CoreCard = CoreCard>({
    G,
  }: {
    G: CryptoPluginGameState<TCard>;
    ctx: Ctx;
    data: CryptoPluginState;
  }): CryptoPluginApi => {
    // Ensure crypto state exists
    if (!G.crypto) {
      G.crypto = createInitialCryptoState();
    }

    return {
      init: async (cardIds: string[], playerIds: string[]): Promise<void> => {
        // Build card point lookup table using real SHA-256
        const lookupMap = await buildCardPointLookup(cardIds);
        const lookup: Record<string, string> = {};
        for (const [cardId, point] of lookupMap) {
          lookup[cardId] = point;
        }
        G.crypto.cardPointLookup = lookup;
        G.crypto.phase = "keyExchange";
      },

      submitPublicKey: (playerId: string, publicKey: string): void => {
        G.crypto.publicKeys[playerId] = publicKey;
      },

      allKeysSubmitted: (): boolean => {
        // Check if we have keys for all players
        // This needs the player list from somewhere
        return Object.keys(G.crypto.publicKeys).length >= 2;
      },

      getPhase: (): CryptoPluginState["phase"] => {
        return G.crypto.phase;
      },

      encryptDeckForPlayer: (
        zoneId: ZoneId,
        playerId: string,
        privateKey: string,
      ): void => {
        const existingDeck = G.crypto.encryptedZones[zoneId];

        if (!existingDeck) {
          // First encryption: encrypt card IDs using pre-computed lookup
          const cardIds = Object.keys(G.crypto.cardPointLookup);
          const lookupMap = new Map(Object.entries(G.crypto.cardPointLookup));
          const encrypted = encryptDeck(cardIds, privateKey, lookupMap);
          G.crypto.encryptedZones[zoneId] = encrypted;
        } else {
          // Re-encrypt existing encrypted deck
          const reencrypted = reencryptDeck(existingDeck, privateKey);
          G.crypto.encryptedZones[zoneId] = reencrypted;
        }

        G.crypto.phase = "encrypt";
      },

      shuffleDeckWithProof: async (
        zoneId: ZoneId,
        playerId: string,
        privateKey: string,
      ): Promise<{ proof: SerializedShuffleProof }> => {
        const deck = G.crypto.encryptedZones[zoneId];
        if (!deck) {
          throw new Error(`No encrypted deck in zone ${zoneId}`);
        }

        // Shuffle with proof
        const { shuffledDeck, proof, nonce } = await shuffleWithProof(deck);

        // Store shuffled deck
        G.crypto.encryptedZones[zoneId] = shuffledDeck;

        // Serialize and store proof
        const serializedProof = serializeShuffleProof(proof, nonce);
        G.crypto.shuffleProofs[playerId] = serializedProof;

        G.crypto.phase = "shuffle";

        return { proof: serializedProof };
      },

      submitDecryptedShare: (
        zoneId: ZoneId,
        cardIndex: number,
        playerId: string,
        decryptedCard: EncryptedCard,
      ): void => {
        const deck = G.crypto.encryptedZones[zoneId];
        if (!deck || cardIndex < 0 || cardIndex >= deck.length) {
          throw new Error(`Invalid card index ${cardIndex}`);
        }

        const key = `${zoneId}:${cardIndex}`;

        if (!G.crypto.pendingReveals[key]) {
          G.crypto.pendingReveals[key] = {};
        }
        G.crypto.pendingReveals[key][playerId] = decryptedCard.ciphertext;

        deck[cardIndex] = decryptedCard;

        // Check if fully decrypted
        if (decryptedCard.layers === 0) {
          // Look up the card ID from the point
          for (const [cardId, point] of Object.entries(
            G.crypto.cardPointLookup,
          )) {
            if (point === decryptedCard.ciphertext) {
              G.crypto.revealedCards[key] = cardId;
              break;
            }
          }
        }
      },

      isCardRevealed: (zoneId: ZoneId, cardIndex: number): boolean => {
        const key = `${zoneId}:${cardIndex}`;
        return key in G.crypto.revealedCards;
      },

      getRevealedCardId: (zoneId: ZoneId, cardIndex: number): string | null => {
        const key = `${zoneId}:${cardIndex}`;
        return G.crypto.revealedCards[key] ?? null;
      },

      getEncryptedCard: (
        zoneId: ZoneId,
        cardIndex: number,
      ): EncryptedCard | null => {
        const deck = G.crypto.encryptedZones[zoneId];
        if (!deck || cardIndex < 0 || cardIndex >= deck.length) {
          return null;
        }
        return deck[cardIndex];
      },

      getEncryptedCardCount: (zoneId: ZoneId): number => {
        const deck = G.crypto.encryptedZones[zoneId];
        return deck?.length ?? 0;
      },

      moveEncryptedCard: (
        fromZoneId: ZoneId,
        toZoneId: ZoneId,
        cardIndex: number,
      ): void => {
        const fromDeck = G.crypto.encryptedZones[fromZoneId];
        if (!fromDeck || cardIndex < 0 || cardIndex >= fromDeck.length) {
          throw new Error(`Invalid source card index ${cardIndex}`);
        }

        // Remove from source
        const [card] = fromDeck.splice(cardIndex, 1);

        // Add to destination
        if (!G.crypto.encryptedZones[toZoneId]) {
          G.crypto.encryptedZones[toZoneId] = [];
        }
        G.crypto.encryptedZones[toZoneId].push(card);
      },
    };
  },

  flush: ({
    data,
  }: {
    G: CryptoPluginGameState;
    ctx: Ctx;
    data: CryptoPluginState;
  }): CryptoPluginState => {
    // No additional flushing needed - state is stored in G.crypto
    return data;
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a player crypto context (stored locally, not in game state).
 *
 * @param playerId - The player's ID
 * @param seed - Optional seed for deterministic keys
 * @returns Player's crypto context
 */
export function createPlayerCryptoContext(
  playerId: string,
  seed?: Uint8Array,
): CryptoPlayerContext {
  return {
    playerId,
    keyPair: generateKeyPair(seed),
    shuffleNonces: new Map(),
  };
}

/**
 * Create a player crypto context from wallet-derived keys.
 * Same wallet + gameId always produces the same keys (deterministic).
 *
 * @param playerId - The player's ID
 * @param derivedKeys - Keys derived from wallet signature
 * @returns Player's crypto context
 */
export function createPlayerCryptoContextFromWallet(
  playerId: string,
  derivedKeys: { privateKey: string; publicKey: string },
): CryptoPlayerContext {
  return {
    playerId,
    keyPair: {
      privateKey: derivedKeys.privateKey,
      publicKey: derivedKeys.publicKey,
    },
    shuffleNonces: new Map(),
  };
}

/**
 * Generate card IDs for a standard 52-card deck.
 */
export function generateStandard52CardIds(): string[] {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = [
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
  ];

  const cardIds: string[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      cardIds.push(`${suit}-${rank}`);
    }
  }

  return cardIds;
}

export default CryptoPlugin;
