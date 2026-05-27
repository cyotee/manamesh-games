/**
 * SRA Commutative Encryption
 *
 * Implementation of Shamir-Rivest-Adleman commutative encryption for mental poker.
 * Uses elliptic curve cryptography for efficient operations.
 *
 * Key property: Enc_A(Enc_B(m)) can be decrypted as Dec_B(Dec_A(...)) or Dec_A(Dec_B(...))
 * This is achieved by using EC point multiplication: k1 * (k2 * G) = k2 * (k1 * G)
 */

import { ec as EC } from "elliptic";
import type { CryptoKeyPair, EncryptedCard } from "./types";
import { sha256 } from "../sha256";
import { secpPointNormalizeHex } from "../secp256k1";

// Use secp256k1 curve (same as Bitcoin/Ethereum)
const ec = new EC("secp256k1");

/**
 * Generate a new SRA key pair.
 * The private key is a random scalar, public key is the corresponding point.
 *
 * @param seed - Optional seed for deterministic key generation (for testing/replay)
 * @returns Key pair with hex-encoded keys
 */
export function generateKeyPair(seed?: Uint8Array): CryptoKeyPair {
  let keyPair;

  if (seed) {
    // Deterministic generation from seed
    // Hash the seed to get a valid scalar
    keyPair = ec.keyFromPrivate(seed);
  } else {
    // Random generation
    keyPair = ec.genKeyPair();
  }

  return {
    publicKey: keyPair.getPublic("hex"),
    privateKey: keyPair.getPrivate("hex"),
  };
}

/**
 * Encrypt a card (represented as a point) with a private key.
 * Uses EC point multiplication: encrypted = privateKey * cardPoint
 *
 * For the first encryption, the card ID is hashed to a curve point.
 * For subsequent encryptions, the ciphertext is already a point.
 *
 * @param card - Either a card ID string or an already-encrypted card
 * @param privateKey - The private key to encrypt with (hex string)
 * @param cardPointLookup - Optional pre-computed map of card ID to curve point
 * @returns Encrypted card with incremented layer count
 */
export function encrypt(
  card: string | EncryptedCard,
  privateKey: string,
  cardPointLookup?: Map<string, string>,
): EncryptedCard {
  const key = ec.keyFromPrivate(privateKey, "hex");

  let point: InstanceType<typeof EC>["curve"]["point"];
  let currentLayers: number;

  if (typeof card === "string") {
    // First encryption: use lookup or hash card ID to a curve point
    if (cardPointLookup && cardPointLookup.has(card)) {
      // Use pre-computed point from lookup
      const pointHex = cardPointLookup.get(card)!;
      point = ec.curve.decodePoint(pointHex, "hex");
    } else {
      // Fallback: hash card ID (cardPointLookup should be provided)
      point = hashToPoint(card);
    }
    currentLayers = 0;
  } else {
    // Re-encryption: use existing ciphertext as point
    point = ec.curve.decodePoint(card.ciphertext, "hex");
    currentLayers = card.layers;
  }

  // Multiply point by private key scalar
  const encrypted = point.mul(key.getPrivate());

  return {
    ciphertext: secpPointNormalizeHex(encrypted.encode("hex", false)),
    layers: currentLayers + 1,
  };
}

/**
 * Decrypt a card with a private key.
 * Uses EC point multiplication with the modular inverse of the private key.
 *
 * @param card - The encrypted card
 * @param privateKey - The private key to decrypt with (hex string)
 * @returns Decrypted card with decremented layer count
 */
export function decrypt(
  card: EncryptedCard,
  privateKey: string,
): EncryptedCard {
  if (card.layers === 0) {
    throw new Error("Cannot decrypt a plaintext card");
  }

  const key = ec.keyFromPrivate(privateKey, "hex");
  const point = ec.curve.decodePoint(card.ciphertext, "hex");

  // Multiply by modular inverse of private key
  // Since encrypted = k * P, then decrypted = k^(-1) * encrypted = P
  const inverse = key.getPrivate().invm(ec.curve.n);
  const decrypted = point.mul(inverse);

  return {
    ciphertext: secpPointNormalizeHex(decrypted.encode("hex", false)),
    layers: card.layers - 1,
  };
}

/**
 * Decrypt fully and recover the original card ID.
 * The card must have exactly 0 layers after decryption.
 *
 * @param card - The encrypted card (should have 1 layer)
 * @param privateKey - The private key to decrypt with
 * @param cardIdToPoint - Map of card IDs to their curve points for lookup
 * @returns The original card ID
 */
export function decryptToCardId(
  card: EncryptedCard,
  privateKey: string,
  cardIdToPoint: Map<string, string>,
): string | null {
  if (card.layers !== 1) {
    throw new Error(`Expected 1 layer, got ${card.layers}`);
  }

  const decrypted = decrypt(card, privateKey);
  const pointHex = secpPointNormalizeHex(decrypted.ciphertext);

  // Look up the card ID from the point
  for (const [cardId, point] of cardIdToPoint) {
    if (secpPointNormalizeHex(point) === pointHex) {
      return cardId;
    }
  }

  return null;
}

/**
 * Hash a card ID to a curve point using try-and-increment.
 * This is deterministic: same card ID always maps to same point.
 *
 * @param cardId - The card identifier
 * @returns Point on the curve (hex encoded)
 */
export function hashToPoint(
  cardId: string,
): InstanceType<typeof EC>["curve"]["point"] {
  // Use a simple hash-to-curve approach
  // In production, use a more robust method like hash_to_curve from RFC 9380
  const encoder = new TextEncoder();
  const data = encoder.encode(cardId);

  // Try incrementing a counter until we find a valid x-coordinate
  for (let counter = 0; counter < 256; counter++) {
    const input = new Uint8Array(data.length + 1);
    input.set(data);
    input[data.length] = counter;

    // Hash to get x-coordinate candidate
    const hash = sha256Sync(input);
    const x = uint8ArrayToHex(hash);

    try {
      // Try to construct point with this x-coordinate (even y)
      const point = ec.curve.pointFromX(x, false);
      if (point && point.validate()) {
        return point;
      }
    } catch {
      // Not a valid x-coordinate, try next counter
      continue;
    }
  }

  throw new Error(`Failed to hash card ID to curve point: ${cardId}`);
}

export async function getCardPoint(cardId: string): Promise<string> {
  const point = await hashToPoint(cardId);
  return secpPointNormalizeHex(point.encode("hex", false));
}

export async function buildCardPointLookup(
  cardIds: string[],
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();

  for (const cardId of cardIds) {
    lookup.set(cardId, await getCardPoint(cardId));
  }

  return lookup;
}

export async function verifyCommutative(
  cardId: string,
  keyA: CryptoKeyPair,
  keyB: CryptoKeyPair,
): Promise<boolean> {
  const originalPoint = await getCardPoint(cardId);

  // Encrypt with A then B
  const encA = encrypt(cardId, keyA.privateKey);
  const encAB = encrypt(encA, keyB.privateKey);

  // Decrypt with A then B
  const decA = decrypt(encAB, keyA.privateKey);
  const decAB = decrypt(decA, keyB.privateKey);

  // Decrypt with B then A
  const decB = decrypt(encAB, keyB.privateKey);
  const decBA = decrypt(decB, keyA.privateKey);

  // Both should equal original
  return (
    decAB.ciphertext === originalPoint && decBA.ciphertext === originalPoint
  );
}

/**
 * Encrypt an entire deck of cards.
 *
 * @param cardIds - Array of card IDs to encrypt
 * @param privateKey - Key to encrypt with
 * @param cardPointLookup - Pre-computed map of card ID to curve point
 * @returns Array of encrypted cards in same order
 */
export function encryptDeck(
  cardIds: string[],
  privateKey: string,
  cardPointLookup?: Map<string, string>,
): EncryptedCard[] {
  return cardIds.map((cardId) => encrypt(cardId, privateKey, cardPointLookup));
}

/**
 * Re-encrypt an already-encrypted deck.
 *
 * @param deck - Array of encrypted cards
 * @param privateKey - Key to add encryption layer with
 * @returns Array of re-encrypted cards
 */
export function reencryptDeck(
  deck: EncryptedCard[],
  privateKey: string,
): EncryptedCard[] {
  return deck.map((card) => encrypt(card, privateKey));
}

/**
 * Decrypt a layer from an entire deck.
 *
 * @param deck - Array of encrypted cards
 * @param privateKey - Key to decrypt with
 * @returns Array of partially decrypted cards
 */
export function decryptDeck(
  deck: EncryptedCard[],
  privateKey: string,
): EncryptedCard[] {
  return deck.map((card) => decrypt(card, privateKey));
}

// ============================================================================
// Internal helpers
// ============================================================================

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256 for hash-to-curve.
 * Delegates to the audited synchronous implementation in sha256.ts.
 */
function sha256Sync(data: Uint8Array): Uint8Array {
  return sha256(data);
}
