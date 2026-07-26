/**
 * ECDSA over secp256k1 (compact r||s signatures).
 * Backend: @noble/curves — produces low-s (canonical) signatures compatible
 * with the previous elliptic.js implementation for the same (key, digest) pairs.
 */

import { secp256k1 as noble } from "@noble/curves/secp256k1";
import {
  secpPrivateKeyBytesFromSeed,
  secpPublicKeyFromPrivateHex,
  secpRandomPrivateKeyBytes,
  secpBytesToHex,
  secpHexToBytes,
  secpStrip0x,
} from "./secp256k1.js";

export interface EcdsaKeyPair {
  /** Compressed secp256k1 public key hex (no 0x). */
  publicKey: string;
  /** 32-byte private key hex (no 0x). */
  privateKey: string;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function isHex(s: string): boolean {
  return /^[0-9a-fA-F]*$/.test(s);
}

export function ecdsaGenerateKeyPair(seed?: Uint8Array): EcdsaKeyPair {
  const skBytes = seed
    ? secpPrivateKeyBytesFromSeed(seed)
    : secpRandomPrivateKeyBytes();
  const privateKey = secpBytesToHex(skBytes);
  return {
    publicKey: secpPublicKeyFromPrivateHex(privateKey),
    privateKey,
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
  const d = secpStrip0x(digestHex);
  const sk = secpStrip0x(privateKeyHex);
  assert(d.length === 64 && isHex(d), "digestHex must be 32-byte hex");
  assert(sk.length === 64 && isHex(sk), "privateKeyHex must be 32-byte hex");

  const sig = noble.sign(secpHexToBytes(d), secpHexToBytes(sk));
  return secpBytesToHex(sig.toCompactRawBytes());
}

export function ecdsaVerifyDigestHex(
  digestHex: string,
  signatureHex: string,
  publicKeyHex: string,
): boolean {
  const d = secpStrip0x(digestHex);
  const sig = secpStrip0x(signatureHex);
  const pk = secpStrip0x(publicKeyHex);
  if (d.length !== 64 || !isHex(d)) return false;
  if (sig.length !== 128 || !isHex(sig)) return false;
  if (pk.length < 2 || !isHex(pk)) return false;

  try {
    // Accept compressed or uncompressed public keys
    const pubBytes = secpHexToBytes(pk);
    return noble.verify(secpHexToBytes(sig), secpHexToBytes(d), pubBytes);
  } catch {
    return false;
  }
}
