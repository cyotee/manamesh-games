import {
  secpBaseMulHex,
  secpIsValidPointHex,
  secpModN,
  secpRandomScalar,
  secpPointAddHex,
  secpPointMulHex,
  secpPointNormalizeHex,
  secpScalarFromHex,
  secpScalarToHex32,
  type SecpPointHex,
  type SecpScalarHex,
} from "./secp256k1";
import { sha256Hex, utf8Bytes } from "./sha256";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export type DleqProof = {
  // Commitments
  a1Hex: SecpPointHex;
  a2Hex: SecpPointHex;
  // Response scalar (32-byte hex)
  zHex: SecpScalarHex;
};

function normalizePoint(hex: string): SecpPointHex {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return secpPointNormalizeHex(clean);
}

function hashToScalar(domain: string, parts: string[]): bigint {
  // Use unambiguous ASCII serialization; parts are hex strings.
  const input = `${domain}|${parts.join("|")}`;
  const h = sha256Hex(utf8Bytes(input));
  return secpModN(BigInt("0x" + h));
}

export function dleqProve(params: {
  base2Hex: SecpPointHex;
  publicShareHex: SecpPointHex;
  partialHex: SecpPointHex;
  secretShare: bigint;
  context?: string;
}): DleqProof {
  const base1Hex = secpBaseMulHex(1n);
  const base2Hex = normalizePoint(params.base2Hex);
  const y1Hex = normalizePoint(params.publicShareHex);
  const y2Hex = normalizePoint(params.partialHex);
  assert(secpIsValidPointHex(base2Hex), "invalid base2");
  assert(secpIsValidPointHex(y1Hex), "invalid public share");
  assert(secpIsValidPointHex(y2Hex), "invalid partial");

  // w <-R [1..n-1]
  // a1 = w*G; a2 = w*base2
  // e = H(G, base2, y1, y2, a1, a2, ctx)
  // z = w + e*x mod n
  // Fresh randomness for the proof.
  const ww = secpRandomScalar();

  const a1Hex = secpPointMulHex(base1Hex, ww);
  const a2Hex = secpPointMulHex(base2Hex, ww);

  const domain = `dleq-v1:${params.context ?? ""}`;
  const e = hashToScalar(domain, [
    base1Hex,
    base2Hex,
    y1Hex,
    y2Hex,
    a1Hex,
    a2Hex,
  ]);
  const z = secpModN(ww + secpModN(e * secpModN(params.secretShare)));

  return { a1Hex, a2Hex, zHex: secpScalarToHex32(z) };
}

export function dleqVerify(params: {
  base2Hex: SecpPointHex;
  publicShareHex: SecpPointHex;
  partialHex: SecpPointHex;
  proof: DleqProof;
  context?: string;
}): boolean {
  try {
    const base1Hex = secpBaseMulHex(1n);
    const base2Hex = normalizePoint(params.base2Hex);
    const y1Hex = normalizePoint(params.publicShareHex);
    const y2Hex = normalizePoint(params.partialHex);
    const a1Hex = normalizePoint(params.proof.a1Hex);
    const a2Hex = normalizePoint(params.proof.a2Hex);
    const z = secpScalarFromHex(params.proof.zHex);

    assert(secpIsValidPointHex(base2Hex), "invalid base2");
    assert(secpIsValidPointHex(y1Hex), "invalid public share");
    assert(secpIsValidPointHex(y2Hex), "invalid partial");
    assert(secpIsValidPointHex(a1Hex), "invalid a1");
    assert(secpIsValidPointHex(a2Hex), "invalid a2");

    const domain = `dleq-v1:${params.context ?? ""}`;
    const e = hashToScalar(domain, [
      base1Hex,
      base2Hex,
      y1Hex,
      y2Hex,
      a1Hex,
      a2Hex,
    ]);

    // Check: z*G == a1 + e*y1
    //        z*base2 == a2 + e*y2
    const left1 = secpPointMulHex(base1Hex, z);
    const right1 = secpPointAddHex(a1Hex, secpPointMulHex(y1Hex, e));
    const left2 = secpPointMulHex(base2Hex, z);
    const right2 = secpPointAddHex(a2Hex, secpPointMulHex(y2Hex, e));
    return (
      secpPointNormalizeHex(left1) === secpPointNormalizeHex(right1) &&
      secpPointNormalizeHex(left2) === secpPointNormalizeHex(right2)
    );
  } catch {
    return false;
  }
}
