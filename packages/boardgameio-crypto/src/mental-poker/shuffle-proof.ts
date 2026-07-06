/**
 * Shuffle Proof
 *
 * Verifiable shuffle proofs for mental poker.
 *
 * ===========================================================================
 * THREAT MODEL NOTE
 * ===========================================================================
 * This implementation uses commit-and-reveal, NOT true ZK proofs.
 *
 * After the game concludes, the full permutation is revealed and verified.
 * This means:
 *   - During the game (while cards are encrypted): permutation is hidden ✓
 *   - After the game ends: permutation is fully visible ✗
 *
 * Threat model applicability:
 *   - Honest-but-curious (HBC): ACCEPTABLE — opponent follows protocol
 *     but tries to learn information. Cards remain encrypted during play.
 *   - Malicious: INSUFFICIENT — opponent may deviate from protocol
 *     or use the revealed permutation to construct post-hoc challenges.
 *
 * For untrusted P2P play with malicious adversaries, a true ZK shuffle
 * proof (Groth16/PLONK SNARK or Neff shuffle) is recommended.
 *
 * ===========================================================================
 * CURRENT IMPLEMENTATION
 * ===========================================================================
 * 1. Shuffler commits to permutation (SHA-256) before shuffling
 * 2. After game, permutation is revealed and verified against commitment
 * 3. This is "commit-and-reveal" — permutation leaks after game end
 *
 * Production ZK upgrade options (not implemented):
 *   - Bayer-Groth: Constant-size shuffle proofs, trusted setup (Groth16)
 *   - Neff shuffle: Transparent (no trusted setup), larger proofs (IPA)
 *   - PLONK: Universal trusted setup, larger proofs
 *
 * Estimated effort for ZK upgrade: 2-4 weeks (circuit + setup + testing)
 */

import type { EncryptedCard, ShuffleProof } from "./types";
import { hashDeck, hashToHex, generateNonce } from "./commitment";

/**
 * A permutation represented as an array of indices.
 * permutation[i] = j means card at position i came from position j.
 */
export type Permutation = number[];

/**
 * Generate a random permutation using Fisher-Yates.
 *
 * @param length - Number of elements
 * @returns Random permutation
 */
export function generatePermutation(length: number): Permutation {
  const perm: Permutation = Array.from({ length }, (_, i) => i);

  function randomBelow(n: number): number {
    const bytes = new Uint32Array(1);
    do {
      crypto.getRandomValues(bytes);
    } while (bytes[0] >= 0xffffffff - (0xffffffff % n));
    return bytes[0] % n;
  }

  for (let i = length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }

  return perm;
}

/**
 * Apply a permutation to a deck.
 *
 * @param deck - Original deck
 * @param permutation - Permutation to apply
 * @returns Shuffled deck
 */
export function applyPermutation(
  deck: EncryptedCard[],
  permutation: Permutation,
): EncryptedCard[] {
  if (deck.length !== permutation.length) {
    throw new Error("Deck and permutation must have same length");
  }

  const result: EncryptedCard[] = new Array(deck.length);
  for (let i = 0; i < deck.length; i++) {
    result[i] = deck[permutation[i]];
  }

  return result;
}

/**
 * Verify a permutation is valid (bijection).
 *
 * @param permutation - Permutation to verify
 * @returns True if valid permutation
 */
export function isValidPermutation(permutation: Permutation): boolean {
  const n = permutation.length;
  const seen = new Set<number>();

  for (const p of permutation) {
    if (p < 0 || p >= n || seen.has(p)) {
      return false;
    }
    seen.add(p);
  }

  return seen.size === n;
}

/**
 * Invert a permutation.
 *
 * @param permutation - Original permutation
 * @returns Inverse permutation
 */
export function invertPermutation(permutation: Permutation): Permutation {
  const inverse: Permutation = new Array(permutation.length);

  for (let i = 0; i < permutation.length; i++) {
    inverse[permutation[i]] = i;
  }

  return inverse;
}

/**
 * Serialize a permutation to bytes.
 *
 * @param permutation - Permutation to serialize
 * @returns Byte representation
 */
export function serializePermutation(permutation: Permutation): Uint8Array {
  const json = JSON.stringify(permutation);
  return new TextEncoder().encode(json);
}

/**
 * Deserialize a permutation from bytes.
 *
 * @param bytes - Serialized permutation
 * @returns Permutation
 */
export function deserializePermutation(bytes: Uint8Array): Permutation {
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

/**
 * Create a commitment to a permutation.
 *
 * @param permutation - The permutation to commit to
 * @param nonce - Random nonce for hiding
 * @returns Commitment hash
 */
export async function commitPermutation(
  permutation: Permutation,
  nonce: Uint8Array,
): Promise<Uint8Array> {
  const permBytes = serializePermutation(permutation);

  const input = new Uint8Array(permBytes.length + nonce.length);
  input.set(permBytes);
  input.set(nonce, permBytes.length);

  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(hashBuffer);
}

/**
 * Verify a permutation commitment.
 *
 * @param commitment - The commitment hash
 * @param permutation - The revealed permutation
 * @param nonce - The revealed nonce
 * @returns True if commitment is valid
 */
export async function verifyPermutationCommitment(
  commitment: Uint8Array,
  permutation: Permutation,
  nonce: Uint8Array,
): Promise<boolean> {
  const computed = await commitPermutation(permutation, nonce);

  if (commitment.length !== computed.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < commitment.length; i++) {
    result |= commitment[i] ^ computed[i];
  }

  return result === 0;
}

/**
 * Create a shuffle proof.
 *
 * This creates a commitment-based "proof" that can be verified later.
 * Not a true ZK proof - the permutation is revealed at verification time.
 *
 * @param inputDeck - Deck before shuffling
 * @param outputDeck - Deck after shuffling
 * @param permutation - The permutation used
 * @returns Shuffle proof
 */
export async function createShuffleProof(
  inputDeck: EncryptedCard[],
  outputDeck: EncryptedCard[],
  permutation: Permutation,
): Promise<{ proof: ShuffleProof; nonce: Uint8Array }> {
  const nonce = generateNonce();
  const commitment = await commitPermutation(permutation, nonce);

  const inputHash = await hashDeck(inputDeck);
  const outputHash = await hashDeck(outputDeck);

  const proof: ShuffleProof = {
    commitment,
    proof: serializePermutation(permutation), // In real ZK, this would be a SNARK
    publicInputs: [hashToHex(inputHash), hashToHex(outputHash)],
    inputHash: hashToHex(inputHash),
    outputHash: hashToHex(outputHash),
  };

  return { proof, nonce };
}

/**
 * Verify a shuffle proof.
 *
 * Checks:
 * 1. Permutation commitment is valid
 * 2. Applying permutation to input gives output
 * 3. Permutation is valid (bijection)
 *
 * @param proof - The shuffle proof
 * @param inputDeck - The original deck
 * @param outputDeck - The shuffled deck
 * @param nonce - The nonce for the commitment
 * @returns True if shuffle is valid
 */
export async function verifyShuffleProof(
  proof: ShuffleProof,
  inputDeck: EncryptedCard[],
  outputDeck: EncryptedCard[],
  nonce: Uint8Array,
): Promise<boolean> {
  // Deserialize the permutation
  const permutation = deserializePermutation(proof.proof);

  // Verify permutation is valid
  if (!isValidPermutation(permutation)) {
    return false;
  }

  // Verify permutation commitment
  const commitmentValid = await verifyPermutationCommitment(
    proof.commitment,
    permutation,
    nonce,
  );
  if (!commitmentValid) {
    return false;
  }

  // Verify input/output hashes
  const inputHash = await hashDeck(inputDeck);
  const outputHash = await hashDeck(outputDeck);

  if (hashToHex(inputHash) !== proof.inputHash) {
    return false;
  }
  if (hashToHex(outputHash) !== proof.outputHash) {
    return false;
  }

  // Verify applying permutation to input gives output
  const expected = applyPermutation(inputDeck, permutation);
  const expectedHash = await hashDeck(expected);

  return hashToHex(expectedHash) === hashToHex(outputHash);
}

/**
 * Perform a shuffle with proof generation.
 *
 * @param deck - Deck to shuffle
 * @returns Shuffled deck, proof, and private nonce
 */
export async function shuffleWithProof(deck: EncryptedCard[]): Promise<{
  shuffledDeck: EncryptedCard[];
  proof: ShuffleProof;
  permutation: Permutation;
  nonce: Uint8Array;
}> {
  const permutation = generatePermutation(deck.length);
  const shuffledDeck = applyPermutation(deck, permutation);

  const { proof, nonce } = await createShuffleProof(
    deck,
    shuffledDeck,
    permutation,
  );

  return { shuffledDeck, proof, permutation, nonce };
}

/**
 * Quick shuffle without proof (for non-critical shuffles like reshuffling won pile).
 *
 * @param deck - Deck to shuffle
 * @returns Shuffled deck
 */
export function quickShuffle(deck: EncryptedCard[]): EncryptedCard[] {
  const permutation = generatePermutation(deck.length);
  return applyPermutation(deck, permutation);
}
