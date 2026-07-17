/**
 * Keychain types — GPG-style public-key registry with pluggable admission policy.
 *
 * No game phases, no boardgame.io state. Consumers supply opaque owner `id`s
 * (seat, playerID, wallet address, etc.) and a {@link KeychainPolicy}.
 */

/** Canonical stored public key (normalized compressed hex, no 0x). */
export type PublicKeyHex = string;

/** Opaque owner label chosen by the consumer (not interpreted by the keychain). */
export type KeyOwnerId = string;

/** Stable fingerprint of a public key (hex of SHA-256 over normalized point). */
export type KeyFingerprint = string;

export interface KeyEntry {
  /** Consumer-supplied owner id. */
  id: KeyOwnerId;
  /** Normalized compressed secp256k1 public key hex (no 0x). */
  publicKey: PublicKeyHex;
  /** Fingerprint for equality / uniqueness (SHA-256 of publicKey bytes). */
  fingerprint: KeyFingerprint;
}

/**
 * Immutable keychain snapshot. Safe to embed in shared game state or keep local.
 */
export interface KeychainState {
  /** Owner id → entry */
  entries: Record<KeyOwnerId, KeyEntry>;
}

/**
 * Admission policy — which keys may enter the keychain.
 * Analogous to GPG import / trust filters, not a game rules engine.
 */
export interface KeychainPolicy {
  /**
   * Require a valid secp256k1 curve point encoding.
   * Default: `true`.
   */
  requireValidCurve: boolean;

  /**
   * Reject the point at infinity (`00`). Public keys must be finite points.
   * Default: `true` when `requireValidCurve` is true; otherwise ignored unless set.
   */
  rejectInfinity: boolean;

  /**
   * Normalize keys to compressed form before store/compare.
   * Default: `true`.
   */
  normalize: boolean;

  /**
   * At most one entry per owner id.
   * Default: `true`.
   */
  uniqueIds: boolean;

  /**
   * If the owner id already has a key, replace it (only meaningful with uniqueIds).
   * Default: `false`.
   */
  allowReplace: boolean;

  /**
   * Distinct owner ids may not share the same public-key fingerprint.
   * Default: `true` (mental-poker / multi-party SRA wants independent keys).
   */
  uniquePublicKeys: boolean;
}

/** Why {@link keychainAdd} rejected a key. */
export type KeychainRejectReason =
  | "empty_id"
  | "empty_key"
  | "invalid_curve"
  | "infinity"
  | "duplicate_id"
  | "duplicate_key";

export type KeychainAddSuccess = {
  ok: true;
  keychain: KeychainState;
  entry: KeyEntry;
  /** True when an existing entry for this id was replaced. */
  replaced: boolean;
};

export type KeychainAddFailure = {
  ok: false;
  reason: KeychainRejectReason;
  /** Unchanged keychain (no mutation). */
  keychain: KeychainState;
};

export type KeychainAddResult = KeychainAddSuccess | KeychainAddFailure;
