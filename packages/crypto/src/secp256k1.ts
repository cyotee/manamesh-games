import { ec as EC } from "elliptic";

type Bytes = Uint8Array;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function getCrypto(): Crypto {
  const c = (globalThis as any).crypto as Crypto | undefined;
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
  // Extended Euclid
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
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  assert(clean.length > 0 && /^[0-9a-fA-F]+$/.test(clean), "invalid hex");
  return BigInt("0x" + clean);
}

function bigintToHexNo0x(x: bigint): string {
  const h = x.toString(16);
  return h.length % 2 === 0 ? h : "0" + h;
}

export const secp256k1 = new EC("secp256k1");

// Curve order (n) for secp256k1.
export const SECP256K1_N = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);

export type SecpPointHex = string; // compressed point hex, no 0x
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
  // Rejection sampling in [1..n-1]
  for (;;) {
    const x = bytesToBigInt(randomBytes(32));
    const v = x % SECP256K1_N;
    if (v !== 0n) return v;
  }
}

export function secpIsValidPointHex(hex: string): boolean {
  try {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.toLowerCase() === "00") return true;
    if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length < 2) return false;
    const p = secp256k1.curve.decodePoint(clean, "hex");
    return !!p && p.validate();
  } catch {
    return false;
  }
}

export function secpPointNormalizeHex(hex: string): SecpPointHex {
  assert(secpIsValidPointHex(hex), "invalid point");
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.toLowerCase() === "00") return "00";
  const p = secp256k1.curve.decodePoint(clean, "hex");
  return p.encode("hex", true);
}

export function secpBaseMulHex(k: bigint): SecpPointHex {
  const kk = secpModN(k);
  assert(kk !== 0n, "scalar cannot be zero");
  const p = secp256k1.g.mul(
    secp256k1.keyFromPrivate(secpScalarToHex32(kk), "hex").getPrivate(),
  );
  return p.encode("hex", true);
}

export function secpPointAddHex(aHex: string, bHex: string): SecpPointHex {
  const aN = secpPointNormalizeHex(aHex);
  const bN = secpPointNormalizeHex(bHex);
  if (aN === "00") return bN;
  if (bN === "00") return aN;
  const a = secp256k1.curve.decodePoint(aN, "hex");
  const b = secp256k1.curve.decodePoint(bN, "hex");
  const c = a.add(b);
  return c.encode("hex", true);
}

export function secpPointNegHex(aHex: string): SecpPointHex {
  const aN = secpPointNormalizeHex(aHex);
  if (aN === "00") return "00";
  const a = secp256k1.curve.decodePoint(aN, "hex");
  const c = a.neg();
  return c.encode("hex", true);
}

export function secpPointMulHex(pHex: string, k: bigint): SecpPointHex {
  const pN = secpPointNormalizeHex(pHex);
  if (pN === "00") return "00";
  const kk = secpModN(k);
  if (kk === 0n) return "00";
  const p = secp256k1.curve.decodePoint(pN, "hex");
  const bn = secp256k1
    .keyFromPrivate(secpScalarToHex32(kk), "hex")
    .getPrivate();
  const c = p.mul(bn);
  return c.encode("hex", true);
}

export function secpLagrangeCoeffAt0(xs: bigint[], i: number): bigint {
  // lambda_i = Π_{j!=i} (-x_j) / (x_i - x_j) mod n
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
