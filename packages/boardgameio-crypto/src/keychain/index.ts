/**
 * Keychain — GPG-style public key registry with pluggable admission policy.
 */

export type {
  PublicKeyHex,
  KeyOwnerId,
  KeyFingerprint,
  KeyEntry,
  KeychainState,
  KeychainPolicy,
  KeychainRejectReason,
  KeychainAddSuccess,
  KeychainAddFailure,
  KeychainAddResult,
} from "./types";

export {
  STRICT_KEYCHAIN_POLICY,
  MENTAL_POKER_KEYCHAIN_POLICY,
  PERMISSIVE_KEYCHAIN_POLICY,
  resolveKeychainPolicy,
  isValidSecp256k1PublicKey,
  normalizeSecp256k1PublicKey,
  publicKeyFingerprint,
  publicKeysEqual,
  privateKeyMatchesPublicKey,
  requirePrivateKeyMatchesPublished,
  createKeychain,
  cloneKeychain,
  keychainFromRecord,
  keychainToRecord,
  keychainGet,
  keychainHas,
  keychainSize,
  keychainList,
  keychainAdd,
  keychainRemove,
} from "./keychain";
