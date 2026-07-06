/**
 * Paillier cryptosystem (demo)
 *
 * This implementation is intended for educational / demonstration use.
 * It uses BigInt and small-ish key sizes by default for browser performance.
 *
 * Security notes:
 * - Do NOT use this for real-world cryptographic security.
 * - Key sizes here are far below modern recommendations.
 */

type Bytes = Uint8Array;

export type PaillierPublicKey = {
  n: bigint;
  n2: bigint;
  // We use g = n + 1 (standard choice).
};

export type PaillierPrivateKey = {
  lambda: bigint;
  mu: bigint;
};

export type PaillierKeypair = {
  publicKey: PaillierPublicKey;
  privateKey: PaillierPrivateKey;
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function getCrypto(): Crypto {
  const c = (globalThis as any).crypto as Crypto | undefined;
  assert(c && typeof c.getRandomValues === "function", "crypto.getRandomValues unavailable");
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

function randomBigIntBits(bits: number): bigint {
  assert(bits > 1, "bits too small");
  const bytes = Math.ceil(bits / 8);
  const b = randomBytes(bytes);
  // Ensure top bit set for exact-ish bit length.
  const topBit = 1 << ((bits - 1) % 8);
  b[0] |= topBit;
  // Ensure odd.
  b[b.length - 1] |= 1;
  return bytesToBigInt(b);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return r;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function lcm(a: bigint, b: bigint): bigint {
  return (a / gcd(a, b)) * b;
}

function egcd(a: bigint, b: bigint): { g: bigint; x: bigint; y: bigint } {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { g: oldR, x: oldS, y: oldT };
}

function modInv(a: bigint, mod: bigint): bigint {
  const { g, x } = egcd(a, mod);
  assert(g === 1n || g === -1n, "no modular inverse");
  const inv = x % mod;
  return inv < 0n ? inv + mod : inv;
}

// Deterministic Miller-Rabin bases for 64-bit integers.
// Ref: https://miller-rabin.appspot.com/ (commonly used base set)
const MR_BASES_64: bigint[] = [
  2n,
  325n,
  9375n,
  28178n,
  450775n,
  9780504n,
  1795265022n,
];

function isProbablePrime64(n: bigint): boolean {
  if (n < 2n) return false;
  const smallPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of smallPrimes) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }

  // Write n-1 = d * 2^s
  let d = n - 1n;
  let s = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    s += 1n;
  }

  const nMinus1 = n - 1n;
  for (const a0 of MR_BASES_64) {
    const a = a0 % n;
    if (a === 0n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === nMinus1) continue;

    let cont = false;
    for (let r = 1n; r < s; r += 1n) {
      x = (x * x) % n;
      if (x === nMinus1) {
        cont = true;
        break;
      }
    }
    if (cont) continue;
    return false;
  }
  return true;
}

function randomPrime64(): bigint {
  // 64-bit prime (top bit set by caller via randomBigIntBits(64)).
  // We loop until probable prime.
  // NOTE: This is a demo; no side-channel protections.
  for (;;) {
    const cand = randomBigIntBits(64);
    if (isProbablePrime64(cand)) return cand;
  }
}

function L(u: bigint, n: bigint): bigint {
  // L(u) = (u - 1) / n, assumes u = 1 mod n
  return (u - 1n) / n;
}

function randomCoprime(n: bigint): bigint {
  // Sample r in [1, n-1] with gcd(r, n) = 1
  // Uses rejection sampling.
  const bits = n.toString(2).length;
  for (;;) {
    let r = randomBigIntBits(bits);
    r = r % n;
    if (r === 0n) continue;
    if (gcd(r, n) === 1n) return r;
  }
}

export function paillierGenerateKeypair(opts?: {
  // Demo default: 128-bit modulus (two 64-bit primes).
  modulusBits?: 128;
}): PaillierKeypair {
  const modulusBits = opts?.modulusBits ?? 128;
  assert(modulusBits === 128, "only modulusBits=128 supported in demo");

  let p = 0n;
  let q = 0n;
  // Ensure p != q
  for (;;) {
    p = randomPrime64();
    q = randomPrime64();
    if (p !== q) break;
  }

  const n = p * q;
  const n2 = n * n;
  const lambda = lcm(p - 1n, q - 1n);

  // With g = n + 1, L(g^lambda mod n^2) = lambda mod n
  const mu = modInv(lambda % n, n);

  return {
    publicKey: { n, n2 },
    privateKey: { lambda, mu },
  };
}

export function paillierEncrypt(
  pk: PaillierPublicKey,
  m: bigint,
  // Optionally provide r for deterministic test vectors.
  r?: bigint,
): bigint {
  assert(m >= 0n && m < pk.n, "message out of range");
  const rr = r ?? randomCoprime(pk.n);
  const g = pk.n + 1n;
  const gm = modPow(g, m, pk.n2);
  const rn = modPow(rr, pk.n, pk.n2);
  return (gm * rn) % pk.n2;
}

export function paillierDecrypt(
  pk: PaillierPublicKey,
  sk: PaillierPrivateKey,
  c: bigint,
): bigint {
  assert(c > 0n && c < pk.n2, "ciphertext out of range");
  const u = modPow(c, sk.lambda, pk.n2);
  const lu = L(u, pk.n) % pk.n;
  return (lu * sk.mu) % pk.n;
}

export function paillierAdd(pk: PaillierPublicKey, c1: bigint, c2: bigint): bigint {
  return (c1 * c2) % pk.n2;
}

export function paillierScalarMul(pk: PaillierPublicKey, c: bigint, k: bigint): bigint {
  assert(k >= 0n, "k must be non-negative");
  return modPow(c, k, pk.n2);
}

export function paillierRerandomize(pk: PaillierPublicKey, c: bigint): bigint {
  // Multiply by E(0) with fresh randomness.
  const e0 = paillierEncrypt(pk, 0n);
  return paillierAdd(pk, c, e0);
}

export function paillierPublicKeyFromNHex(nHex: string): PaillierPublicKey {
  const clean = nHex.startsWith("0x") ? nHex.slice(2) : nHex;
  assert(/^[0-9a-fA-F]+$/.test(clean) && clean.length > 0, "invalid n hex");
  const n = BigInt("0x" + clean);
  assert(n > 3n, "invalid n");
  return { n, n2: n * n };
}

export function bigintToHex(x: bigint): string {
  const h = x.toString(16);
  return h.length % 2 === 0 ? h : "0" + h;
}
