/**
 * Shamir's Secret Sharing - Reconstruct Operation
 *
 * Reconstructs a secret from K or more shares using Lagrange interpolation.
 */

import { PRIME, SecretShare, ReconstructionError, ShareValidationError } from './types';
import { validateShare } from './split';

/**
 * Convert a hex string to BigInt
 */
function hexToBigInt(hex: string): bigint {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return BigInt('0x' + cleanHex);
}

/**
 * Convert BigInt to hex string
 */
function bigIntToHex(n: bigint, byteLength: number = 32): string {
  const hex = n.toString(16);
  return hex.padStart(byteLength * 2, '0');
}

/**
 * Modular arithmetic: (a + b) mod p
 */
function modAdd(a: bigint, b: bigint, p: bigint): bigint {
  return ((a % p) + (b % p) + p) % p;
}

/**
 * Modular arithmetic: (a - b) mod p
 */
function modSub(a: bigint, b: bigint, p: bigint): bigint {
  return ((a % p) - (b % p) + p) % p;
}

/**
 * Modular arithmetic: (a * b) mod p
 */
function modMul(a: bigint, b: bigint, p: bigint): bigint {
  return ((a % p) * (b % p) + p) % p;
}

/**
 * Modular multiplicative inverse using extended Euclidean algorithm
 * Returns a^(-1) mod p such that a * a^(-1) ≡ 1 (mod p)
 */
function modInverse(a: bigint, p: bigint): bigint {
  // Extended Euclidean Algorithm
  let [oldR, r] = [a % p, p];
  let [oldS, s] = [BigInt(1), BigInt(0)];

  while (r !== BigInt(0)) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }

  // Make sure result is positive
  return ((oldS % p) + p) % p;
}

/**
 * Compute Lagrange basis polynomial L_i(0) for a set of x-coordinates
 *
 * L_i(0) = ∏(j≠i) (0 - x_j) / (x_i - x_j)
 *        = ∏(j≠i) (-x_j) / (x_i - x_j)
 *        = ∏(j≠i) x_j / (x_j - x_i)
 */
function lagrangeBasis(xCoords: bigint[], i: number, p: bigint): bigint {
  const xi = xCoords[i];
  let numerator = BigInt(1);
  let denominator = BigInt(1);

  for (let j = 0; j < xCoords.length; j++) {
    if (i === j) continue;
    const xj = xCoords[j];

    // L_i(0) uses (0 - x_j) in numerator = -x_j = p - x_j (in modular arithmetic)
    numerator = modMul(numerator, modSub(BigInt(0), xj, p), p);
    // Denominator is (x_i - x_j)
    denominator = modMul(denominator, modSub(xi, xj, p), p);
  }

  // Return numerator * denominator^(-1) mod p
  return modMul(numerator, modInverse(denominator, p), p);
}

/**
 * Reconstruct a secret from shares using Lagrange interpolation
 *
 * @param shares - Array of shares (must have at least threshold shares)
 * @param threshold - The minimum number of shares required
 * @returns The reconstructed secret as hex string
 * @throws ReconstructionError if not enough shares
 * @throws ShareValidationError if shares are invalid
 *
 * @example
 * ```typescript
 * const secret = reconstructSecret(shares.slice(0, 3), 3);
 * // Returns the original private key hex
 * ```
 */
export function reconstructSecret(shares: SecretShare[], threshold: number): string {
  // Validate we have enough shares
  if (shares.length < threshold) {
    throw new ReconstructionError(
      `Not enough shares: have ${shares.length}, need ${threshold}`,
      shares.length,
      threshold
    );
  }

  // Validate all shares
  for (const share of shares) {
    if (!validateShare(share)) {
      throw new ShareValidationError(`Invalid share at index ${share.index}`);
    }
  }

  // Check for duplicate indices
  const indices = new Set(shares.map((s) => s.index));
  if (indices.size !== shares.length) {
    throw new ShareValidationError('Duplicate share indices detected');
  }

  // Use only the first `threshold` shares (any subset works)
  const usedShares = shares.slice(0, threshold);

  // Extract x and y coordinates
  const xCoords = usedShares.map((s) => BigInt(s.index));
  const yCoords = usedShares.map((s) => hexToBigInt(s.value));

  // Lagrange interpolation to find f(0) = secret
  // f(0) = Σ y_i * L_i(0)
  let secret = BigInt(0);
  for (let i = 0; i < usedShares.length; i++) {
    const li = lagrangeBasis(xCoords, i, PRIME);
    const term = modMul(yCoords[i], li, PRIME);
    secret = modAdd(secret, term, PRIME);
  }

  return bigIntToHex(secret);
}

/**
 * Check if enough shares are available to reconstruct
 */
export function canReconstruct(shares: SecretShare[], threshold: number): boolean {
  if (shares.length < threshold) {
    return false;
  }

  // Validate shares
  for (const share of shares) {
    if (!validateShare(share)) {
      return false;
    }
  }

  // Check for duplicates
  const indices = new Set(shares.map((s) => s.index));
  return indices.size >= threshold;
}

/**
 * Reconstruct a key from KeyShares collected from other players
 *
 * @param keyShares - Array of KeyShare objects
 * @param threshold - Minimum shares needed
 * @returns The reconstructed private key, or null if not enough shares
 */
export function reconstructKeyFromShares(
  keyShares: import('./types').KeyShare[],
  threshold: number
): string | null {
  const shares = keyShares.map((ks) => ks.share);

  if (!canReconstruct(shares, threshold)) {
    return null;
  }

  try {
    return reconstructSecret(shares, threshold);
  } catch {
    return null;
  }
}
