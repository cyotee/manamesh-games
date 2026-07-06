import {
  secpBaseMulHex,
  secpIsValidPointHex,
  secpLagrangeCoeffAt0,
  secpModN,
  secpPointAddHex,
  secpPointMulHex,
  secpPointNegHex,
  type SecpPointHex,
} from "./secp256k1";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export type ElGamalCiphertext = {
  c1Hex: SecpPointHex;
  c2Hex: SecpPointHex;
};

// We encode small integers m as (m + offset)*G to avoid needing to serialize the
// point at infinity when m=0.
export const ELGAMAL_EXP_OFFSET = 1;

export function elgamalEncryptExp(
  publicKeyHex: SecpPointHex,
  m: bigint,
  r: bigint,
): ElGamalCiphertext {
  assert(secpIsValidPointHex(publicKeyHex), "invalid public key");
  const rr = secpModN(r);
  const mm = secpModN(m);

  const mPlus = secpModN(mm + BigInt(ELGAMAL_EXP_OFFSET));
  assert(mPlus !== 0n, "encoded message cannot be zero");

  const c1Hex = secpBaseMulHex(rr);
  const rPkHex = secpPointMulHex(publicKeyHex, rr);
  const gHex = secpBaseMulHex(1n);
  const mGHex = secpPointMulHex(gHex, mPlus);
  const c2Hex = secpPointAddHex(rPkHex, mGHex);
  return { c1Hex, c2Hex };
}

export function elgamalAdd(
  a: ElGamalCiphertext,
  b: ElGamalCiphertext,
): ElGamalCiphertext {
  return {
    c1Hex: secpPointAddHex(a.c1Hex, b.c1Hex),
    c2Hex: secpPointAddHex(a.c2Hex, b.c2Hex),
  };
}

export function elgamalPartialDecrypt(
  c1Hex: SecpPointHex,
  secretShare: bigint,
): SecpPointHex {
  assert(secpIsValidPointHex(c1Hex), "invalid c1");
  return secpPointMulHex(c1Hex, secretShare);
}

export function elgamalCombinePartials(
  partials: Array<{ x: bigint; partialHex: SecpPointHex }>,
): SecpPointHex {
  assert(partials.length >= 1, "need at least one partial");
  const xs = partials.map((p) => p.x);
  let acc: SecpPointHex | null = null;
  for (let i = 0; i < partials.length; i++) {
    const lambda = secpLagrangeCoeffAt0(xs, i);
    const term = secpPointMulHex(partials[i]!.partialHex, lambda);
    acc = acc ? secpPointAddHex(acc, term) : term;
  }
  assert(acc, "internal error");
  return acc;
}

export function elgamalRecoverMessagePoint(
  c2Hex: SecpPointHex,
  combinedSecretTimesC1Hex: SecpPointHex,
): SecpPointHex {
  assert(secpIsValidPointHex(c2Hex), "invalid c2");
  assert(
    secpIsValidPointHex(combinedSecretTimesC1Hex),
    "invalid combined partial",
  );
  return secpPointAddHex(c2Hex, secpPointNegHex(combinedSecretTimesC1Hex));
}

export function elgamalDecodeSmallMessage(
  messagePointHex: SecpPointHex,
  max: number,
): number | null {
  // Brute force discrete log for tiny ranges (0..max).
  assert(Number.isInteger(max) && max >= 0, "invalid max");
  assert(secpIsValidPointHex(messagePointHex), "invalid message point");
  if (messagePointHex === "00") return null;

  // Decode (m + offset) * G.
  const gHex = secpBaseMulHex(1n);
  for (let m = 0; m <= max; m++) {
    const kHex = secpPointMulHex(gHex, BigInt(m + ELGAMAL_EXP_OFFSET));
    if (kHex === messagePointHex) return m;
  }
  return null;
}

export function elgamalDecodeSmallSumMessage(
  messagePointHex: SecpPointHex,
  maxSum: number,
  count: number,
): number | null {
  // When summing `count` ciphertexts, the encoded offset accumulates:
  //   M = (sum(m_i) + count*offset) * G
  // Decode by brute forcing the sum.
  assert(Number.isInteger(count) && count >= 1, "invalid count");
  const gHex = secpBaseMulHex(1n);
  const off = BigInt(count * ELGAMAL_EXP_OFFSET);
  for (let m = 0; m <= maxSum; m++) {
    const kHex = secpPointMulHex(gHex, BigInt(m) + off);
    if (kHex === messagePointHex) return m;
  }
  return null;
}
