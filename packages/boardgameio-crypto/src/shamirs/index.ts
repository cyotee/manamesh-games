/**
 * Shamir's Secret Sharing
 *
 * Implementation of threshold secret sharing for key escrow in mental poker.
 * Allows K-of-N players to reconstruct any player's private key for
 * abandonment recovery when players disconnect.
 *
 * @example
 * ```typescript
 * import { splitSecret, reconstructSecret, createKeyShares } from './shamirs';
 *
 * // Split a private key into 4 shares where any 3 can reconstruct
 * const result = splitSecret(privateKey, { threshold: 3, totalShares: 4 });
 *
 * // Later, reconstruct from 3 shares
 * const recovered = reconstructSecret(result.shares.slice(0, 3), 3);
 * // recovered === privateKey
 *
 * // For game use: create shares for other players
 * const keyShares = createKeyShares(privateKey, 'alice', ['bob', 'carol', 'dave']);
 * // Send each keyShare to the appropriate player
 * ```
 */

export type { SecretShare, KeyShare, SplitResult, ShamirConfig } from "./types";

export { PRIME, ReconstructionError, ShareValidationError } from "./types";

export {
  splitSecret,
  validateShare,
  createKeyShares,
  encryptShare,
  decryptShare,
} from "./split";

export {
  reconstructSecret,
  canReconstruct,
  reconstructKeyFromShares,
} from "./reconstruct";
