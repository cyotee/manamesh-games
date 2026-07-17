/**
 * Keychain — pure public-key registry with pluggable admission policy.
 *
 * Inspired by GPG keyrings: validate encoding, normalize, fingerprint, and
 * admit under consumer-defined uniqueness rules. No game phases or move I/O.
 */

import { hexToBytes, sha256Hex } from "../sha256";
import {
  secpIsValidPointHex,
  secpPointNormalizeHex,
  secp256k1,
  type SecpPointHex,
} from "../secp256k1";
import type {
  KeychainAddResult,
  KeychainPolicy,
  KeychainState,
  KeyEntry,
  KeyFingerprint,
  KeyOwnerId,
  PublicKeyHex,
} from "./types";

// ---------------------------------------------------------------------------
// Defaults & named policies
// ---------------------------------------------------------------------------

/** Strict defaults suitable for multi-party mental poker. */
export const STRICT_KEYCHAIN_POLICY: KeychainPolicy = {
  requireValidCurve: true,
  rejectInfinity: true,
  normalize: true,
  uniqueIds: true,
  allowReplace: false,
  uniquePublicKeys: true,
};

/**
 * Mental-poker table policy: valid finite points only, one key per seat,
 * no two seats share the same public key.
 */
export const MENTAL_POKER_KEYCHAIN_POLICY: KeychainPolicy =
  STRICT_KEYCHAIN_POLICY;

/**
 * Permissive registry: still validates curve by default, but allows
 * duplicate keys across owners and replacement (import-style).
 */
export const PERMISSIVE_KEYCHAIN_POLICY: KeychainPolicy = {
  requireValidCurve: true,
  rejectInfinity: true,
  normalize: true,
  uniqueIds: true,
  allowReplace: true,
  uniquePublicKeys: false,
};

export function resolveKeychainPolicy(
  partial?: Partial<KeychainPolicy>,
): KeychainPolicy {
  return {
    ...STRICT_KEYCHAIN_POLICY,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Point / key primitives (public-key oriented; reject infinity)
// ---------------------------------------------------------------------------

/**
 * True if `hex` is a finite secp256k1 public point (not empty, not infinity).
 * Accepts compressed or uncompressed hex; optional `0x` prefix.
 */
export function isValidSecp256k1PublicKey(hex: string): boolean {
  if (typeof hex !== "string" || hex.length === 0) return false;
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (clean.length === 0) return false;
  if (clean.toLowerCase() === "00") return false; // infinity is not a public key
  if (!secpIsValidPointHex(clean)) return false;
  return true;
}

/**
 * Normalize a public key to compressed hex (no 0x), or `null` if invalid.
 */
export function normalizeSecp256k1PublicKey(hex: string): PublicKeyHex | null {
  if (!isValidSecp256k1PublicKey(hex)) return null;
  try {
    return secpPointNormalizeHex(hex);
  } catch {
    return null;
  }
}

/**
 * Fingerprint of a public key (SHA-256 of the normalized compressed point hex).
 * Returns `null` if the key is invalid.
 */
export function publicKeyFingerprint(hex: string): KeyFingerprint | null {
  const normalized = normalizeSecp256k1PublicKey(hex);
  if (!normalized) return null;
  return fingerprintOfNormalized(normalized);
}

function fingerprintOfNormalized(normalized: PublicKeyHex): KeyFingerprint {
  // Fingerprint over compressed point bytes (not ASCII hex).
  return sha256Hex(hexToBytes(normalized));
}

/**
 * Compare two public keys after normalization.
 */
export function publicKeysEqual(a: string, b: string): boolean {
  const na = normalizeSecp256k1PublicKey(a);
  const nb = normalizeSecp256k1PublicKey(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * True if the private scalar derives the given public point.
 */
export function privateKeyMatchesPublicKey(
  privateKeyHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const skClean = privateKeyHex.startsWith("0x")
      ? privateKeyHex.slice(2)
      : privateKeyHex;
    if (!/^[0-9a-fA-F]+$/.test(skClean)) return false;
    const kp = secp256k1.keyFromPrivate(skClean, "hex");
    const derived = kp.getPublic(true, "hex") as SecpPointHex;
    return publicKeysEqual(derived, publicKeyHex);
  } catch {
    return false;
  }
}

/**
 * Encrypt-time binding: published keychain pubkey must match the private key
 * used for SRA layers. Call from game `encryptDeck` moves.
 *
 * @returns false if published key missing, sk invalid, or sk does not derive pk
 */
export function requirePrivateKeyMatchesPublished(
  privateKeyHex: string | null | undefined,
  publishedPublicKey: string | null | undefined,
): boolean {
  if (
    typeof privateKeyHex !== "string" ||
    privateKeyHex.length === 0 ||
    typeof publishedPublicKey !== "string" ||
    publishedPublicKey.length === 0
  ) {
    return false;
  }
  return privateKeyMatchesPublicKey(privateKeyHex, publishedPublicKey);
}

// ---------------------------------------------------------------------------
// Keychain state
// ---------------------------------------------------------------------------

export function createKeychain(): KeychainState {
  return { entries: {} };
}

/** Snapshot clone (shallow entries map). */
export function cloneKeychain(state: KeychainState): KeychainState {
  return {
    entries: { ...state.entries },
  };
}

/**
 * Build a keychain from a plain `id → publicKey` record under the given policy.
 * Invalid or conflicting keys are skipped (does not throw).
 * Prefer {@link keychainAdd} for explicit error reporting.
 */
export function keychainFromRecord(
  record: Record<string, string>,
  policy: Partial<KeychainPolicy> = MENTAL_POKER_KEYCHAIN_POLICY,
): KeychainState {
  let state = createKeychain();
  const p = resolveKeychainPolicy(policy);
  for (const [id, pk] of Object.entries(record)) {
    const res = keychainAdd(state, id, pk, p);
    if (res.ok) state = res.keychain;
  }
  return state;
}

/** Export owner id → normalized public key for game `publicKeys` maps. */
export function keychainToRecord(
  state: KeychainState,
): Record<KeyOwnerId, PublicKeyHex> {
  const out: Record<string, string> = {};
  for (const [id, entry] of Object.entries(state.entries)) {
    out[id] = entry.publicKey;
  }
  return out;
}

export function keychainGet(
  state: KeychainState,
  id: KeyOwnerId,
): KeyEntry | undefined {
  return state.entries[id];
}

export function keychainHas(state: KeychainState, id: KeyOwnerId): boolean {
  return state.entries[id] !== undefined;
}

export function keychainSize(state: KeychainState): number {
  return Object.keys(state.entries).length;
}

export function keychainList(state: KeychainState): KeyEntry[] {
  return Object.values(state.entries);
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

/**
 * Attempt to admit a public key for `id` under `policy`.
 * Pure: returns a new keychain on success; never mutates `state`.
 */
export function keychainAdd(
  state: KeychainState,
  id: KeyOwnerId,
  publicKey: string,
  policy: Partial<KeychainPolicy> = MENTAL_POKER_KEYCHAIN_POLICY,
): KeychainAddResult {
  const p = resolveKeychainPolicy(policy);

  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "empty_id", keychain: state };
  }
  if (typeof publicKey !== "string" || publicKey.length === 0) {
    return { ok: false, reason: "empty_key", keychain: state };
  }

  const existing = state.entries[id];
  let replaced = false;

  if (existing) {
    if (p.uniqueIds && !p.allowReplace) {
      return { ok: false, reason: "duplicate_id", keychain: state };
    }
    if (p.allowReplace) {
      replaced = true;
    } else if (!p.uniqueIds) {
      // uniqueIds false without replace: still treat as one slot — refuse second write
      return { ok: false, reason: "duplicate_id", keychain: state };
    }
  }

  let normalized: PublicKeyHex;
  let fingerprint: KeyFingerprint;

  if (p.requireValidCurve) {
    if (!isValidSecp256k1PublicKey(publicKey)) {
      // Distinguish infinity for clearer diagnostics
      const clean =
        publicKey.startsWith("0x") || publicKey.startsWith("0X")
          ? publicKey.slice(2)
          : publicKey;
      if (p.rejectInfinity && clean.toLowerCase() === "00") {
        return { ok: false, reason: "infinity", keychain: state };
      }
      return { ok: false, reason: "invalid_curve", keychain: state };
    }
    if (p.normalize) {
      const n = normalizeSecp256k1PublicKey(publicKey);
      if (!n) return { ok: false, reason: "invalid_curve", keychain: state };
      normalized = n;
    } else {
      normalized = publicKey.startsWith("0x")
        ? publicKey.slice(2)
        : publicKey;
    }
    fingerprint = fingerprintOfNormalized(
      normalizeSecp256k1PublicKey(publicKey) ?? normalized,
    );
  } else {
    // Policy allows non-curve material (import raw strings).
    if (isValidSecp256k1PublicKey(publicKey) && p.normalize) {
      normalized = normalizeSecp256k1PublicKey(publicKey) as string;
      fingerprint = fingerprintOfNormalized(normalized);
    } else {
      normalized = publicKey;
      // Stable fingerprint for arbitrary material: SHA-256 of UTF-8 bytes via hex round-trip of char codes is awkward;
      // hash the UTF-8 encoding of the string.
      const utf8 = new TextEncoder().encode(publicKey);
      fingerprint = sha256Hex(utf8);
    }
  }

  if (p.uniquePublicKeys) {
    for (const [otherId, entry] of Object.entries(state.entries)) {
      if (otherId === id) continue; // replace path: ignore self
      if (entry.fingerprint === fingerprint) {
        return { ok: false, reason: "duplicate_key", keychain: state };
      }
    }
  }

  const entry: KeyEntry = {
    id,
    publicKey: normalized,
    fingerprint,
  };

  const next: KeychainState = {
    entries: {
      ...state.entries,
      [id]: entry,
    },
  };

  return { ok: true, keychain: next, entry, replaced };
}

/**
 * Remove an owner’s key. Pure; returns new state.
 */
export function keychainRemove(
  state: KeychainState,
  id: KeyOwnerId,
): KeychainState {
  if (!state.entries[id]) return state;
  const entries = { ...state.entries };
  delete entries[id];
  return { entries };
}
