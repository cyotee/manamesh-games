/**
 * Deck Commitment
 *
 * Hash-based commitments for deck state verification.
 * Used to prevent players from changing their deck after seeing opponent's cards.
 *
 * Commitment scheme: commit(deck, nonce) = SHA-256(deck || nonce)
 * - Binding: Cannot find different deck that opens to same commitment
 * - Hiding: Commitment reveals nothing about deck without nonce
 */

import type { DeckCommitment, EncryptedCard, EncryptedDeck } from './types';

/**
 * Generate a cryptographic nonce for commitment.
 *
 * @param length - Nonce length in bytes (default: 32)
 * @returns Random nonce
 */
export function generateNonce(length = 32): Uint8Array {
  const nonce = new Uint8Array(length);
  crypto.getRandomValues(nonce);
  return nonce;
}

/**
 * Serialize a deck to bytes for hashing.
 *
 * @param deck - The deck to serialize
 * @returns Byte representation
 */
export function serializeDeck(deck: EncryptedCard[]): Uint8Array {
  // Serialize each card's ciphertext and layer count
  const parts: string[] = [];

  for (const card of deck) {
    parts.push(`${card.ciphertext}:${card.layers}`);
  }

  const serialized = parts.join('|');
  return new TextEncoder().encode(serialized);
}

/**
 * Serialize an EncryptedDeck to bytes.
 *
 * @param deck - The encrypted deck
 * @returns Byte representation
 */
export function serializeEncryptedDeck(deck: EncryptedDeck): Uint8Array {
  return serializeDeck(deck.cards);
}

/**
 * Create a commitment to a deck state.
 *
 * @param deck - The deck to commit to
 * @param nonce - Optional nonce (generated if not provided)
 * @returns Commitment object with hash and nonce
 */
export async function createCommitment(
  deck: EncryptedCard[],
  nonce?: Uint8Array
): Promise<DeckCommitment> {
  const actualNonce = nonce ?? generateNonce();
  const deckBytes = serializeDeck(deck);

  // Concatenate deck and nonce
  const input = new Uint8Array(deckBytes.length + actualNonce.length);
  input.set(deckBytes);
  input.set(actualNonce, deckBytes.length);

  // Hash with SHA-256
  const hashBuffer = await crypto.subtle.digest('SHA-256', input);
  const hash = new Uint8Array(hashBuffer);

  return {
    hash,
    nonce: actualNonce,
    timestamp: Date.now(),
  };
}

/**
 * Verify a commitment matches a revealed deck and nonce.
 *
 * @param commitment - The commitment to verify
 * @param deck - The revealed deck
 * @param nonce - The revealed nonce
 * @returns True if commitment is valid
 */
export async function verifyCommitment(
  commitment: DeckCommitment,
  deck: EncryptedCard[],
  nonce: Uint8Array
): Promise<boolean> {
  const deckBytes = serializeDeck(deck);

  // Concatenate deck and nonce
  const input = new Uint8Array(deckBytes.length + nonce.length);
  input.set(deckBytes);
  input.set(nonce, deckBytes.length);

  // Hash and compare
  const hashBuffer = await crypto.subtle.digest('SHA-256', input);
  const computedHash = new Uint8Array(hashBuffer);

  return constantTimeEqual(commitment.hash, computedHash);
}

/**
 * Verify a commitment using its own stored nonce.
 *
 * @param commitment - The commitment (with nonce)
 * @param deck - The deck to verify against
 * @returns True if commitment is valid
 */
export async function verifySelfCommitment(
  commitment: DeckCommitment,
  deck: EncryptedCard[]
): Promise<boolean> {
  return verifyCommitment(commitment, deck, commitment.nonce);
}

/**
 * Create a commitment hash without storing the nonce.
 * Used when you want to send just the hash first, nonce later.
 *
 * @param deck - The deck to commit to
 * @param nonce - The nonce to use
 * @returns Just the hash bytes
 */
export async function computeCommitmentHash(
  deck: EncryptedCard[],
  nonce: Uint8Array
): Promise<Uint8Array> {
  const deckBytes = serializeDeck(deck);

  const input = new Uint8Array(deckBytes.length + nonce.length);
  input.set(deckBytes);
  input.set(nonce, deckBytes.length);

  const hashBuffer = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(hashBuffer);
}

/**
 * Hash a deck state (without nonce) for quick comparison.
 *
 * @param deck - The deck to hash
 * @returns SHA-256 hash
 */
export async function hashDeck(deck: EncryptedCard[]): Promise<Uint8Array> {
  const deckBytes = serializeDeck(deck);
  const hashBuffer = await crypto.subtle.digest('SHA-256', deckBytes);
  return new Uint8Array(hashBuffer);
}

/**
 * Convert hash bytes to hex string for display.
 *
 * @param hash - Hash bytes
 * @returns Hex string
 */
export function hashToHex(hash: Uint8Array): string {
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to hash bytes.
 *
 * @param hex - Hex string
 * @returns Hash bytes
 */
export function hexToHash(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Constant-time comparison to prevent timing attacks.
 *
 * @param a - First array
 * @param b - Second array
 * @returns True if equal
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
}

/**
 * Create a commitment message for the protocol.
 *
 * @param playerId - The player creating the commitment
 * @param deck - The deck being committed to
 * @returns Commitment ready for exchange
 */
export async function createCommitmentMessage(
  playerId: string,
  deck: EncryptedDeck
): Promise<{ playerId: string; commitment: DeckCommitment }> {
  const commitment = await createCommitment(deck.cards);
  return { playerId, commitment };
}

/**
 * Batch verify multiple commitments.
 *
 * @param commitments - Map of player ID to commitment
 * @param decks - Map of player ID to revealed deck
 * @param nonces - Map of player ID to revealed nonce
 * @returns Map of player ID to verification result
 */
export async function batchVerifyCommitments(
  commitments: Map<string, DeckCommitment>,
  decks: Map<string, EncryptedCard[]>,
  nonces: Map<string, Uint8Array>
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  const verifications = Array.from(commitments.entries()).map(
    async ([playerId, commitment]) => {
      const deck = decks.get(playerId);
      const nonce = nonces.get(playerId);

      if (!deck || !nonce) {
        return { playerId, valid: false };
      }

      const valid = await verifyCommitment(commitment, deck, nonce);
      return { playerId, valid };
    }
  );

  const verificationResults = await Promise.all(verifications);

  for (const { playerId, valid } of verificationResults) {
    results.set(playerId, valid);
  }

  return results;
}
