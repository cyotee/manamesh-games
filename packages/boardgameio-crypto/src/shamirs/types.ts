/**
 * Shamir's Secret Sharing Types
 *
 * Used for threshold key escrow in mental poker.
 * Allows K-of-N players to reconstruct any player's private key
 * for abandonment recovery.
 */

/**
 * A single share of a secret
 */
export interface SecretShare {
  /** Index of this share (1-based, used in reconstruction) */
  index: number;
  /** The share value as hex string */
  value: string;
}

/**
 * A share intended for a specific recipient
 */
export interface KeyShare {
  /** Player who owns the original key */
  fromPlayer: string;
  /** Player who receives this share */
  forPlayer: string;
  /** The share data */
  share: SecretShare;
  /** Share encrypted with recipient's public key (optional) */
  encryptedShare?: string;
}

/**
 * Result of splitting a secret
 */
export interface SplitResult {
  /** The threshold needed to reconstruct */
  threshold: number;
  /** Total number of shares created */
  totalShares: number;
  /** The generated shares */
  shares: SecretShare[];
}

/**
 * Configuration for secret sharing
 */
export interface ShamirConfig {
  /** Minimum shares needed to reconstruct (K) */
  threshold: number;
  /** Total shares to generate (N) */
  totalShares: number;
}

/**
 * Prime field for GF(p) arithmetic
 * Using a 256-bit prime for compatibility with secp256k1 private keys
 */
export const PRIME =
  BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

/**
 * Error thrown when reconstruction fails
 */
export class ReconstructionError extends Error {
  constructor(
    message: string,
    public readonly sharesProvided: number,
    public readonly thresholdRequired: number
  ) {
    super(message);
    this.name = 'ReconstructionError';
  }
}

/**
 * Error thrown when share validation fails
 */
export class ShareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareValidationError';
  }
}
