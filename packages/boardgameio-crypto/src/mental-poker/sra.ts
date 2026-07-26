/**
 * SRA Commutative Encryption
 *
 * Implementation of Shamir-Rivest-Adleman commutative encryption for mental poker.
 * Uses elliptic curve cryptography for efficient operations.
 *
 * Key property: Enc_A(Enc_B(m)) can be decrypted as Dec_B(Dec_A(...)) or Dec_A(Dec_B(...))
 * This is achieved by using EC point multiplication: k1 * (k2 * G) = k2 * (k1 * G)
 *
 * Curve backend: @noble/curves secp256k1 (wire-compatible with the prior elliptic.js build).
 */

import type { CryptoKeyPair, EncryptedCard } from "./types.js";
import { sha256 } from "../sha256.js";
import {
  SecpProjectivePoint,
  secpInvN,
  secpPointNormalizeHex,
  secpPrivateKeyBytesFromSeed,
  secpPublicKeyFromPrivateHex,
  secpRandomPrivateKeyBytes,
  secpScalarFromHex,
  secpBytesToHex,
  type SecpPointHex,
} from "../secp256k1.js";

const P = SecpProjectivePoint;
const CURVE_P = // secp256k1 field prime
  0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const CURVE_B = 7n;

/**
 * Generate a new SRA key pair.
 * The private key is a random scalar, public key is the corresponding point.
 *
 * @param seed - Optional seed for deterministic key generation (for testing/replay)
 * @returns Key pair with hex-encoded keys (private: 32-byte hex; public: compressed)
 */
export function generateKeyPair(seed?: Uint8Array): CryptoKeyPair {
  const skBytes = seed
    ? secpPrivateKeyBytesFromSeed(seed)
    : secpRandomPrivateKeyBytes();
  const privateKey = secpBytesToHex(skBytes);
  return {
    publicKey: secpPublicKeyFromPrivateHex(privateKey),
    privateKey,
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
  const k = secpScalarFromHex(privateKey);
  if (k === 0n) throw new Error("private key cannot be zero");

  let point: InstanceType<typeof P>;
  let currentLayers: number;

  if (typeof card === "string") {
    if (cardPointLookup && cardPointLookup.has(card)) {
      point = P.fromHex(cardPointLookup.get(card)!);
    } else {
      point = pointFromHashToPoint(card);
    }
    currentLayers = 0;
  } else {
    point = P.fromHex(card.ciphertext);
    currentLayers = card.layers;
  }

  const encrypted = point.multiply(k);

  return {
    ciphertext: secpPointNormalizeHex(encrypted.toHex(false)),
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

  const k = secpScalarFromHex(privateKey);
  if (k === 0n) throw new Error("private key cannot be zero");
  const point = P.fromHex(card.ciphertext);
  const inverse = secpInvN(k);
  const decrypted = point.multiply(inverse);

  return {
    ciphertext: secpPointNormalizeHex(decrypted.toHex(false)),
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

  for (const [cardId, point] of cardIdToPoint) {
    if (secpPointNormalizeHex(point) === pointHex) {
      return cardId;
    }
  }

  return null;
}

/**
 * Hash a card ID to a curve point using try-and-increment (even-y preference).
 * Deterministic: same card ID always maps to same point.
 *
 * @returns Compressed point hex (no 0x)
 *
 * Wire-compatible with the previous elliptic.js `pointFromX(x, false)` path.
 */
export function hashToPoint(cardId: string): SecpPointHex {
  return secpPointNormalizeHex(pointFromHashToPoint(cardId).toHex(false));
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return r;
}

function pointFromHashToPoint(cardId: string): InstanceType<typeof P> {
  const encoder = new TextEncoder();
  const data = encoder.encode(cardId);

  for (let counter = 0; counter < 256; counter++) {
    const input = new Uint8Array(data.length + 1);
    input.set(data);
    input[data.length] = counter;

    const hash = sha256(input);
    const xHex = Array.from(hash)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const x = BigInt("0x" + xHex);
    if (x >= CURVE_P) continue;

    // y^2 = x^3 + 7 (mod p); p ≡ 3 (mod 4) ⇒ sqrt via (p+1)/4
    const y2 = (modPow(x, 3n, CURVE_P) + CURVE_B) % CURVE_P;
    let y = modPow(y2, (CURVE_P + 1n) / 4n, CURVE_P);
    if ((y * y) % CURVE_P !== y2) continue;
    // even y (elliptic pointFromX(x, false))
    if (y % 2n === 1n) y = CURVE_P - y;

    try {
      const point = P.fromAffine({ x, y });
      point.assertValidity();
      return point;
    } catch {
      continue;
    }
  }

  throw new Error(`Failed to hash card ID to curve point: ${cardId}`);
}

export async function getCardPoint(cardId: string): Promise<string> {
  return hashToPoint(cardId);
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

  const encA = encrypt(cardId, keyA.privateKey);
  const encAB = encrypt(encA, keyB.privateKey);

  const decA = decrypt(encAB, keyA.privateKey);
  const decAB = decrypt(decA, keyB.privateKey);

  const decB = decrypt(encAB, keyB.privateKey);
  const decBA = decrypt(decB, keyA.privateKey);

  return (
    decAB.ciphertext === originalPoint && decBA.ciphertext === originalPoint
  );
}

/**
 * Encrypt an entire deck of cards.
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
 */
export function reencryptDeck(
  deck: EncryptedCard[],
  privateKey: string,
): EncryptedCard[] {
  return deck.map((card) => encrypt(card, privateKey));
}

/**
 * Decrypt a layer from an entire deck.
 */
export function decryptDeck(
  deck: EncryptedCard[],
  privateKey: string,
): EncryptedCard[] {
  return deck.map((card) => decrypt(card, privateKey));
}

