/**
 * secp256k1 helpers built on @noble/curves (constant-time-friendly, audited).
 *
 * Wire format conventions (stable across releases):
 * - Points: compressed hex (02/03 + 32-byte x), no 0x prefix
 * - Infinity: the sentinel `"00"` (not a valid public key)
 * - Scalars: 32-byte hex, no 0x prefix
 */

import { secp256k1 as noble } from "@noble/curves/secp256k1";

type Bytes = Uint8Array;

const { ProjectivePoint } = noble;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  assert(
    c && typeof c.getRandomValues === "function",
    "crypto.getRandomValues unavailable",
  );
  return c;
}

function randomBytes(len: number): Bytes {
  const out = new Uint8Array(len);
  getCrypto().getRandomValues(out);
  return out;
}

function bytesToBigInt(b: Bytes): bigint {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}

function modInv(a: bigint, mod: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = mod;
  let newR = ((a % mod) + mod) % mod;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  assert(r === 1n, "no modular inverse");
  const out = t % mod;
  return out < 0n ? out + mod : out;
}

function hexToBigInt(hex: string): bigint {
  const clean = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  assert(clean.length > 0 && /^[0-9a-fA-F]+$/.test(clean), "invalid hex");
  return BigInt("0x" + clean);
}

function bigintToHexNo0x(x: bigint): string {
  const h = x.toString(16);
  return h.length % 2 === 0 ? h : "0" + h;
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = strip0x(hex);
  assert(clean.length % 2 === 0 && /^[0-9a-fA-F]*$/.test(clean), "invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Curve order n (re-exported for consumers that need the prime field of scalars). */
export const SECP256K1_N = noble.CURVE.n;

export type SecpPointHex = string; // compressed point hex, no 0x — or "00" for infinity
export type SecpScalarHex = string; // 32-byte hex scalar, no 0x

export function secpModN(x: bigint): bigint {
  const r = x % SECP256K1_N;
  return r < 0n ? r + SECP256K1_N : r;
}

export function secpInvN(x: bigint): bigint {
  return modInv(secpModN(x), SECP256K1_N);
}

export function secpScalarFromHex(hex: string): bigint {
  return secpModN(hexToBigInt(hex));
}

export function secpScalarToHex32(x: bigint): SecpScalarHex {
  const v = secpModN(x);
  const h = bigintToHexNo0x(v);
  return h.padStart(64, "0");
}

export function secpRandomScalar(): bigint {
  for (;;) {
    const x = bytesToBigInt(randomBytes(32));
    const v = x % SECP256K1_N;
    if (v !== 0n) return v;
  }
}

/**
 * Parse a point hex (compressed, uncompressed, or infinity `"00"`).
 * Throws if invalid.
 */
export function secpPointFromHex(hex: string): InstanceType<typeof ProjectivePoint> {
  const clean = strip0x(hex);
  if (clean.toLowerCase() === "00") {
    return ProjectivePoint.ZERO;
  }
  return ProjectivePoint.fromHex(clean);
}

export function secpPointToCompressedHex(
  p: InstanceType<typeof ProjectivePoint>,
): SecpPointHex {
  if (p.equals(ProjectivePoint.ZERO)) return "00";
  return p.toHex(true);
}

export function secpPointToUncompressedHex(
  p: InstanceType<typeof ProjectivePoint>,
): string {
  if (p.equals(ProjectivePoint.ZERO)) return "00";
  return p.toHex(false);
}

export function secpIsValidPointHex(hex: string): boolean {
  try {
    const clean = strip0x(hex);
    if (clean.toLowerCase() === "00") return true;
    if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length < 2) return false;
    const p = ProjectivePoint.fromHex(clean);
    p.assertValidity();
    return true;
  } catch {
    return false;
  }
}

export function secpPointNormalizeHex(hex: string): SecpPointHex {
  assert(secpIsValidPointHex(hex), "invalid point");
  const clean = strip0x(hex);
  if (clean.toLowerCase() === "00") return "00";
  return ProjectivePoint.fromHex(clean).toHex(true);
}

export function secpBaseMulHex(k: bigint): SecpPointHex {
  const kk = secpModN(k);
  assert(kk !== 0n, "scalar cannot be zero");
  return ProjectivePoint.BASE.multiply(kk).toHex(true);
}

export function secpPointAddHex(aHex: string, bHex: string): SecpPointHex {
  const aN = secpPointNormalizeHex(aHex);
  const bN = secpPointNormalizeHex(bHex);
  if (aN === "00") return bN;
  if (bN === "00") return aN;
  const a = ProjectivePoint.fromHex(aN);
  const b = ProjectivePoint.fromHex(bN);
  return secpPointToCompressedHex(a.add(b));
}

export function secpPointNegHex(aHex: string): SecpPointHex {
  const aN = secpPointNormalizeHex(aHex);
  if (aN === "00") return "00";
  return secpPointToCompressedHex(ProjectivePoint.fromHex(aN).negate());
}

export function secpPointMulHex(pHex: string, k: bigint): SecpPointHex {
  const pN = secpPointNormalizeHex(pHex);
  if (pN === "00") return "00";
  const kk = secpModN(k);
  if (kk === 0n) return "00";
  return ProjectivePoint.fromHex(pN).multiply(kk).toHex(true);
}

/**
 * Derive compressed public key from a private scalar hex (any length; mod n).
 */
export function secpPublicKeyFromPrivateHex(privateKeyHex: string): SecpPointHex {
  const sk = secpScalarFromHex(privateKeyHex);
  assert(sk !== 0n, "private key cannot be zero");
  return ProjectivePoint.BASE.multiply(sk).toHex(true);
}

/**
 * Normalize a seed/private-key byte string to a 32-byte scalar (big-endian, mod n).
 * Matches elliptic's `keyFromPrivate` behaviour for short seeds (left-pad).
 */
export function secpPrivateKeyBytesFromSeed(seed: Uint8Array): Uint8Array {
  if (seed.length === 32) {
    const v = bytesToBigInt(seed) % SECP256K1_N;
    if (v === 0n) throw new Error("invalid private key seed (zero scalar)");
    return hexToBytes(secpScalarToHex32(v));
  }
  if (seed.length < 32) {
    const out = new Uint8Array(32);
    out.set(seed, 32 - seed.length);
    const v = bytesToBigInt(out) % SECP256K1_N;
    if (v === 0n) throw new Error("invalid private key seed (zero scalar)");
    return hexToBytes(secpScalarToHex32(v));
  }
  // Longer than 32: reduce mod n (BN-style)
  const v = bytesToBigInt(seed) % SECP256K1_N;
  if (v === 0n) throw new Error("invalid private key seed (zero scalar)");
  return hexToBytes(secpScalarToHex32(v));
}

export function secpRandomPrivateKeyBytes(): Uint8Array {
  return hexToBytes(secpScalarToHex32(secpRandomScalar()));
}

export function secpLagrangeCoeffAt0(xs: bigint[], i: number): bigint {
  assert(i >= 0 && i < xs.length, "bad index");
  const xi = secpModN(xs[i] as bigint);
  let num = 1n;
  let den = 1n;
  for (let j = 0; j < xs.length; j++) {
    if (j === i) continue;
    const xj = secpModN(xs[j] as bigint);
    num = secpModN(num * (SECP256K1_N - xj));
    den = secpModN(den * secpModN(xi - xj));
  }
  return secpModN(num * secpInvN(den));
}

/**
 * Validate an EncryptedCard received as a decryption share.
 * Ensures the ciphertext is a valid curve point and layers is a non-negative number.
 */
export function validateEncryptedCard(
  card: { ciphertext: string; layers: number } | null | undefined,
): boolean {
  if (!card || typeof card.layers !== "number" || card.layers < 0) return false;
  return secpIsValidPointHex(card.ciphertext);
}

/**
 * Strict player identity check for moves.
 * In pure P2P, we require exact match (ctx.playerID may be undefined in some host paths,
 * but game modules should pass the real sender).
 */
export function validatePlayerIdentity(
  ctxPlayerId: string | undefined,
  claimedPlayerId: string,
): boolean {
  if (!claimedPlayerId || typeof claimedPlayerId !== "string") return false;
  if (ctxPlayerId === undefined) {
    return true;
  }
  return claimedPlayerId === ctxPlayerId;
}

// Re-export noble curve for advanced consumers (no elliptic dependency).
export { noble as nobleSecp256k1, ProjectivePoint as SecpProjectivePoint };

// Internal helpers used by sibling modules
export { hexToBytes as secpHexToBytes, bytesToHex as secpBytesToHex, strip0x as secpStrip0x };
