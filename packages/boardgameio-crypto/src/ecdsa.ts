import { ec as EC } from "elliptic";

const ec = new EC("secp256k1");

export interface EcdsaKeyPair {
  /** Compressed secp256k1 public key hex (no 0x). */
  publicKey: string;
  /** 32-byte private key hex (no 0x). */
  privateKey: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function isHex(s: string): boolean {
  return /^[0-9a-fA-F]*$/.test(s);
}

function pad32(hexNo0x: string): string {
  return hexNo0x.padStart(64, "0");
}

export function ecdsaGenerateKeyPair(seed?: Uint8Array): EcdsaKeyPair {
  const kp = seed ? ec.keyFromPrivate(seed) : ec.genKeyPair();
  return {
    publicKey: kp.getPublic(true, "hex"),
    privateKey: pad32(kp.getPrivate("hex")),
  };
}

/**
 * Sign a 32-byte message digest hex string.
 * Returns compact signature hex (r||s), no 0x.
 */
export function ecdsaSignDigestHex(
  digestHex: string,
  privateKeyHex: string,
): string {
  const d = strip0x(digestHex);
  const sk = strip0x(privateKeyHex);
  assert(d.length === 64 && isHex(d), "digestHex must be 32-byte hex");
  assert(sk.length === 64 && isHex(sk), "privateKeyHex must be 32-byte hex");

  const key = ec.keyFromPrivate(sk, "hex");
  const sig = key.sign(d, { canonical: true });
  const r = sig.r.toString("hex").padStart(64, "0");
  const s = sig.s.toString("hex").padStart(64, "0");
  return r + s;
}

export function ecdsaVerifyDigestHex(
  digestHex: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  const d = strip0x(digestHex);
  const sig = strip0x(signatureHex);
  const pk = strip0x(publicKeyHex);
  if (d.length !== 64 || !isHex(d)) return false;
  if (sig.length !== 128 || !isHex(sig)) return false;
  if (pk.length < 2 || !isHex(pk)) return false;

  const r = sig.slice(0, 64);
  const s = sig.slice(64);
  try {
    const key = ec.keyFromPublic(pk, "hex");
    return key.verify(d, { r, s });
  } catch {
    return false;
  }
}
