import { ec as EC } from "elliptic";
import {
  PRIME,
  SecretShare,
  ShamirConfig,
  SplitResult,
  ShareValidationError,
} from "./types";
import { sha256Hex } from "../sha256";

function randomBigInt(max: bigint): bigint {
  const byteLength = Math.ceil(max.toString(16).length / 2);
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);

  let result = BigInt(0);
  for (const byte of bytes) {
    result = (result << BigInt(8)) | BigInt(byte);
  }

  if (result >= max) return randomBigInt(max);
  return result;
}

function modAdd(a: bigint, b: bigint, p: bigint): bigint {
  return ((a % p) + (b % p) + p) % p;
}

function modMul(a: bigint, b: bigint, p: bigint): bigint {
  return ((a % p) * (b % p) + p) % p;
}

function evaluatePolynomial(
  coefficients: bigint[],
  x: bigint,
  p: bigint,
): bigint {
  let result = BigInt(0);
  let xPower = BigInt(1);

  for (const coef of coefficients) {
    result = modAdd(result, modMul(coef, xPower, p), p);
    xPower = modMul(xPower, x, p);
  }

  return result;
}

function hexToBigInt(hex: string): bigint {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
    throw new ShareValidationError(`Invalid hex string: ${hex}`);
  }
  return BigInt("0x" + cleanHex);
}

function bigIntToHex(n: bigint, byteLength: number = 32): string {
  const hex = n.toString(16);
  return hex.padStart(byteLength * 2, "0");
}

export function splitSecret(secret: string, config: ShamirConfig): SplitResult {
  const { threshold, totalShares } = config;

  if (threshold < 2) {
    throw new ShareValidationError("Threshold must be at least 2");
  }
  if (totalShares < threshold) {
    throw new ShareValidationError("Total shares must be >= threshold");
  }
  if (totalShares > 255) {
    throw new ShareValidationError("Maximum 255 shares supported");
  }

  const secretBigInt = hexToBigInt(secret);

  if (secretBigInt >= PRIME) {
    throw new ShareValidationError("Secret too large for prime field");
  }

  const coefficients: bigint[] = [secretBigInt];
  for (let i = 1; i < threshold; i++) {
    coefficients.push(randomBigInt(PRIME));
  }

  const shares: SecretShare[] = [];
  for (let i = 1; i <= totalShares; i++) {
    const x = BigInt(i);
    const y = evaluatePolynomial(coefficients, x, PRIME);
    shares.push({
      index: i,
      value: bigIntToHex(y),
    });
  }

  return {
    threshold,
    totalShares,
    shares,
  };
}

export function validateShare(share: SecretShare): boolean {
  if (typeof share.index !== "number" || share.index < 1 || share.index > 255) {
    return false;
  }
  if (typeof share.value !== "string") {
    return false;
  }
  try {
    const val = hexToBigInt(share.value);
    return val >= BigInt(0) && val < PRIME;
  } catch {
    return false;
  }
}

export function createKeyShares(
  privateKey: string,
  fromPlayer: string,
  otherPlayers: string[],
  threshold?: number,
): import("./types").KeyShare[] {
  const totalShares = otherPlayers.length + 1;
  const k = threshold ?? Math.max(2, otherPlayers.length);

  const result = splitSecret(privateKey, {
    threshold: k,
    totalShares,
  });

  return otherPlayers.map((playerId, idx) => ({
    fromPlayer,
    forPlayer: playerId,
    share: result.shares[idx + 1],
  }));
}

export async function encryptShare(
  shareValue: string,
  recipientPublicKey: string,
): Promise<string> {
  const ec = new EC("secp256k1");

  const ephemeralKey = ec.genKeyPair();
  const ephemeralPub = ephemeralKey.getPublic();
  const pubX = ephemeralPub.getX().toBuffer(32);
  const pubY = ephemeralPub.getY();
  const prefix = pubY.isOdd() ? 0x03 : 0x02;
  const ephemeralPublicKeyBytes = concat(new Uint8Array([prefix]), pubX);

  let recipientPubKeyHex = recipientPublicKey;
  if (
    recipientPublicKey.startsWith("02") ||
    recipientPublicKey.startsWith("03")
  ) {
    const pubKey = ec.curve.decodePoint(recipientPublicKey, "hex");
    recipientPubKeyHex = pubKey.encode("hex", false);
  }

  const recipientPoint = ec.curve.decodePoint(recipientPubKeyHex, "hex");
  const sharedPoint = recipientPoint.mul(ephemeralKey.getPrivate());
  const sharedSecret = sharedPoint.encode("hex", false);
  const sharedSecretBytes = hexToBytes(sharedSecret);

  const info = new TextEncoder().encode("shamir-share-v1");
  const keyMaterial = new Uint8Array(sharedSecretBytes.length + info.length);
  keyMaterial.set(sharedSecretBytes, 0);
  keyMaterial.set(info, sharedSecretBytes.length);
  const hashOut = sha256Sync(keyMaterial);
  const aesKey = hashOut.slice(0, 32);
  const macKey = hashOut.slice(32, 64);

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const plaintext = hexToBytes(shareValue);

  const aesKeyObj = await crypto.subtle.importKey(
    "raw",
    aesKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const encryptedBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKeyObj,
    plaintext,
  );

  const encryptedWithTag = new Uint8Array(encryptedBuf);
  const encryptedData = concat(iv, encryptedWithTag);
  const mac = hmacSha256(encryptedData, macKey);

  const resultBytes = new Uint8Array(
    ephemeralPublicKeyBytes.length + encryptedData.length + mac.length,
  );
  resultBytes.set(ephemeralPublicKeyBytes, 0);
  resultBytes.set(encryptedData, ephemeralPublicKeyBytes.length);
  resultBytes.set(mac, ephemeralPublicKeyBytes.length + encryptedData.length);

  return bytesToHex(resultBytes);
}

export async function decryptShare(
  encryptedShare: string,
  recipientPrivateKey: string,
): Promise<string> {
  const ec = new EC("secp256k1");

  const encryptedBytes = hexToBytes(encryptedShare);
  const EPHEM_PUBKEY_LEN = 33;
  const MAC_LEN = 32;

  const ephemeralPubKeyBytes = encryptedBytes.slice(0, EPHEM_PUBKEY_LEN);
  const encryptedData = encryptedBytes.slice(
    EPHEM_PUBKEY_LEN,
    encryptedBytes.length - MAC_LEN,
  );
  const macProvided = encryptedBytes.slice(
    encryptedBytes.length - MAC_LEN,
    encryptedBytes.length,
  );

  const ephemeralPubKeyHex = bytesToHex(ephemeralPubKeyBytes);
  const ephemeralPoint = ec.curve.decodePoint(ephemeralPubKeyHex, "hex");

  const recipientPrivate = ec.keyFromPrivate(recipientPrivateKey, "hex");
  const sharedPoint = ephemeralPoint.mul(recipientPrivate.getPrivate());
  const sharedSecret = sharedPoint.encode("hex", false);

  const sharedSecretBytes = hexToBytes(sharedSecret);
  const info = new TextEncoder().encode("shamir-share-v1");
  const keyMaterial = new Uint8Array(sharedSecretBytes.length + info.length);
  keyMaterial.set(sharedSecretBytes, 0);
  keyMaterial.set(info, sharedSecretBytes.length);
  const hashOut = sha256Sync(keyMaterial);
  const aesKey = hashOut.slice(0, 32);
  const macKey = hashOut.slice(32, 64);

  const computedMac = hmacSha256(encryptedData, macKey);
  let macOk = true;
  for (let i = 0; i < MAC_LEN && macOk; i++) {
    if (computedMac[i] !== macProvided[i]) macOk = false;
  }
  if (!macOk) {
    throw new Error("ECIES decryption failed: MAC mismatch");
  }

  const iv = encryptedData.slice(0, 12);
  const ciphertextWithTag = encryptedData.slice(12);

  const aesKeyObj = await crypto.subtle.importKey(
    "raw",
    aesKey,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const decryptedBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKeyObj,
    ciphertextWithTag,
  );

  const decrypted = new Uint8Array(decryptedBuf);
  return bytesToHex(decrypted);
}

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) {
    out[i] = (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return out;
}

function sha256Sync(data: Uint8Array): Uint8Array {
  return hexToBytes(sha256Hex(data));
}

function hmacSha256(message: Uint8Array, key: Uint8Array): Uint8Array {
  let keyBlock: Uint8Array;
  if (key.length > 64) {
    const hashedKey = hexToBytes(sha256Hex(key));
    keyBlock = new Uint8Array(64);
    keyBlock.set(hashedKey);
  } else {
    keyBlock = new Uint8Array(64);
    keyBlock.set(key);
  }

  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = keyBlock[i] ^ 0x36;
    opad[i] = keyBlock[i] ^ 0x5c;
  }

  const innerData = concat(ipad, message);
  const innerHash = hexToBytes(sha256Hex(innerData));
  const outerData = concat(opad, innerHash);
  return hexToBytes(sha256Hex(outerData));
}
