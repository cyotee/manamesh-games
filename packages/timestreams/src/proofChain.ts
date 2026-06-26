/**
 * Cryptographic Proof Chain
 *
 * Maintains an auditable chain of all game state transitions.
 * Each proof links to the previous, forming a tamper-evident log
 * that both players can verify for dispute resolution.
 *
 * Adapted from packages/onepiece/src/proofChain.ts:
 * - OnePieceState replaced with TimestreamsState
 * - verifyProofChain now accepts a state object (with proofChain array)
 *   rather than a raw array, matching the TimestreamsState shape.
 */

import type { CryptographicProof, TimestreamsState } from "./types";
import { sha256Hex } from "@manamesh/boardgameio-crypto/sha256";
import { stableStringify } from "@manamesh/boardgameio-crypto/stable-json";
import {
  ecdsaSignDigestHex,
  ecdsaVerifyDigestHex,
} from "@manamesh/boardgameio-crypto/ecdsa";

// =============================================================================
// Proof Creation
// =============================================================================

let proofCounter = 0;

/**
 * Generate a unique transition ID.
 */
function generateTransitionId(): string {
  return `proof-${Date.now()}-${proofCounter++}`;
}

/**
 * Compute a SHA-256 hash of proof data.
 * Uses a deterministic string representation for consistency.
 */
export function hashProofData(data: string): string {
  const bytes = new TextEncoder().encode(data);
  const hex = sha256Hex(bytes);
  return hex; // 64-char hex string (32 bytes)
}

/**
 * Create a new cryptographic proof for a state transition.
 */
export function createProof(
  action: string,
  data: Record<string, unknown>,
  previousProofHash: string | null,
): CryptographicProof {
  const transitionId = generateTransitionId();
  const timestamp = Date.now();

  // Use stableStringify to ensure deterministic serialization for hashing
  const proofData = stableStringify({
    transitionId,
    previousProofHash,
    action,
    data,
    timestamp,
  });

  const hash = hashProofData(proofData);

  return {
    transitionId,
    previousProofHash,
    action,
    data,
    signatures: {},
    timestamp,
    hash,
  };
}

/**
 * Sign a proof with a player's signature.
 * In production, this would use ECDSA or similar.
 */
export function signProof(
  proof: CryptographicProof,
  playerId: string,
  signatureOrPrivateKeyHex: string,
): CryptographicProof {
  // Backwards-compatible: if caller provided a precomputed signature (arbitrary string),
  // store it directly. If they provided a 64-char hex private key, use it to sign the
  // proof.hash with ECDSA and store the resulting signature.
  let signature = signatureOrPrivateKeyHex;
  const maybeKey = signatureOrPrivateKeyHex.replace(/^0x/, "");
  const isLikelyPrivateKey = /^[0-9a-fA-F]{64}$/.test(maybeKey);
  if (isLikelyPrivateKey) {
    signature = ecdsaSignDigestHex(proof.hash, maybeKey);
  }

  return {
    ...proof,
    signatures: {
      ...proof.signatures,
      [playerId]: signature,
    },
  };
}

/**
 * Verify that the stored proof.hash matches a recomputed hash of the proof fields.
 */
export function verifyProofHash(proof: CryptographicProof): boolean {
  const recomputed = hashProofData(
    stableStringify({
      transitionId: proof.transitionId,
      previousProofHash: proof.previousProofHash,
      action: proof.action,
      data: proof.data,
      timestamp: proof.timestamp,
    }),
  );
  return recomputed === proof.hash;
}

/**
 * Verify a single player's signature on a proof using their public key.
 */
export function verifyProofSignature(
  proof: CryptographicProof,
  playerId: string,
  publicKeyHex: string,
): boolean {
  const signature = proof.signatures[playerId];
  if (!signature) return false;
  return ecdsaVerifyDigestHex(proof.hash, signature, publicKeyHex);
}

// =============================================================================
// Proof Chain Operations
// =============================================================================

/**
 * Append a proof to the game state's proof chain.
 */
export function appendProof(
  state: Pick<TimestreamsState, "proofChain">,
  proof: CryptographicProof,
): void {
  state.proofChain.push(proof);
}

// =============================================================================
// Verification Types
// =============================================================================

export interface ProofChainError {
  index: number;
  transitionId: string;
  error: string;
}

export interface ProofChainVerification {
  valid: boolean;
  errors: ProofChainError[];
}

export interface SignatureVerification {
  valid: boolean;
  missing: string[];
}

// =============================================================================
// Internal chain verifier (operates on a raw array)
// =============================================================================

function verifyChainArray(chain: CryptographicProof[]): ProofChainVerification {
  if (chain.length === 0) {
    return { valid: true, errors: [] };
  }

  const errors: ProofChainError[] = [];

  // First proof must have null previous hash
  if (chain[0].previousProofHash !== null) {
    errors.push({
      index: 0,
      transitionId: chain[0].transitionId,
      error: "First proof must have null previousProofHash",
    });
  }

  // Verify the first proof's own hash integrity
  if (!verifyProofHash(chain[0])) {
    errors.push({
      index: 0,
      transitionId: chain[0].transitionId,
      error: "Invalid proof hash at index 0",
    });
  }

  for (let i = 1; i < chain.length; i++) {
    const current = chain[i];
    const previous = chain[i - 1];

    // Check chain linkage
    if (current.previousProofHash !== previous.hash) {
      errors.push({
        index: i,
        transitionId: current.transitionId,
        error: `Chain broken: expected previousProofHash "${previous.hash}", got "${current.previousProofHash}"`,
      });
    }

    // Check timestamp ordering
    if (current.timestamp < previous.timestamp) {
      errors.push({
        index: i,
        transitionId: current.transitionId,
        error: `Timestamp regression: ${current.timestamp} < ${previous.timestamp}`,
      });
    }

    // Verify the proof hash integrity
    if (!verifyProofHash(current)) {
      errors.push({
        index: i,
        transitionId: current.transitionId,
        error: `Invalid proof hash: recomputed hash does not match stored hash`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Verify the integrity of the entire proof chain stored in game state.
 *
 * Checks that:
 * 1. Each proof's previousProofHash matches the prior proof's hash
 * 2. The chain starts with a null previousProofHash
 * 3. Timestamps are monotonically increasing
 *
 * @returns Result with validity and any error details.
 */
export function verifyProofChain(
  state: Pick<TimestreamsState, "proofChain">,
): ProofChainVerification {
  return verifyChainArray(state.proofChain);
}

/**
 * Get the latest proof in the chain.
 */
export function getLatestProof(
  state: Pick<TimestreamsState, "proofChain">,
): CryptographicProof | null {
  if (state.proofChain.length === 0) return null;
  return state.proofChain[state.proofChain.length - 1];
}

/**
 * Get the hash of the latest proof (for chaining).
 */
export function getLatestProofHash(
  state: Pick<TimestreamsState, "proofChain">,
): string | null {
  const latest = getLatestProof(state);
  return latest?.hash ?? null;
}

/**
 * Find all proofs for a specific card.
 */
export function getProofsForCard(
  state: Pick<TimestreamsState, "proofChain">,
  cardId: string,
): CryptographicProof[] {
  return state.proofChain.filter((proof) => proof.data.cardId === cardId);
}

/**
 * Verify that a specific proof has signatures from the required players.
 */
export function verifyProofSignatures(
  proof: CryptographicProof,
  requiredSigners: string[],
): SignatureVerification {
  const missing = requiredSigners.filter(
    (signer) => !(signer in proof.signatures),
  );

  return {
    valid: missing.length === 0,
    missing,
  };
}
