import {
  secpBaseMulHex,
  secpIsValidPointHex,
  secpModN,
  secpPointAddHex,
  secpPointMulHex,
  secpRandomScalar,
  secpInvN,
  type SecpPointHex,
} from "./secp256k1";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Feldman VSS / DKG primitives for arbitrary threshold t (degree t-1 polynomial).
// Public transcript: commitments to polynomial coefficients.
// Private to each player: shares s_ij sent to player j.

export type DkgCommitment = {
  coefficients: SecpPointHex[]; // [g^{a0}, g^{a1}, ..., g^{a(t-1)}]
};

export type DkgDealerSecrets = {
  coefficients: bigint[]; // [a0, a1, ..., a(t-1)]
  commitment: DkgCommitment;
};

export function dkgMakeDealerSecrets(
  threshold: number = 2, // t: minimum shares needed to reconstruct
  _totalShares: number = 2, // n: total shares distributed (kept for signature, not needed for coeffs)
): DkgDealerSecrets {
  assert(threshold >= 2, "threshold must be >= 2");
  const coefficients: bigint[] = [];
  for (let i = 0; i < threshold; i++) {
    coefficients.push(secpRandomScalar());
  }
  const commitmentCoeffs: SecpPointHex[] = coefficients.map((a) =>
    secpBaseMulHex(a),
  );
  return { coefficients, commitment: { coefficients: commitmentCoeffs } };
}

export function dkgEvaluateShare(dealer: DkgDealerSecrets, x: bigint): bigint {
  const xx = secpModN(x);
  // f(x) = sum_{j=0}^{t-1} a_j * x^j mod N
  let result = 0n;
  let xPow = 1n; // x^0
  for (let j = 0; j < dealer.coefficients.length; j++) {
    result = secpModN(result + secpModN(dealer.coefficients[j]! * xPow));
    xPow = secpModN(xPow * xx); // x^(j+1)
  }
  return result;
}

export function dkgVerifyShare(
  commitment: DkgCommitment,
  x: bigint,
  share: bigint,
): boolean {
  try {
    // Verify all coefficient points are valid
    for (const coeff of commitment.coefficients) {
      if (!secpIsValidPointHex(coeff)) return false;
    }
    const xx = secpModN(x);
    // Left side: g^share
    const left = secpPointMulHex(secpBaseMulHex(1n), secpModN(share));
    // Right side: prod_{j=0}^{t-1} (c_j)^(x^j) mod P
    let rhs: SecpPointHex = "00"; // identity
    let xPow = 1n; // x^0
    for (let j = 0; j < commitment.coefficients.length; j++) {
      const term = secpPointMulHex(commitment.coefficients[j]!, xPow);
      rhs = secpPointAddHex(rhs, term);
      xPow = secpModN(xPow * xx); // x^(j+1)
    }
    return left === rhs;
  } catch {
    return false;
  }
}

export function dkgCombineCommitments(commits: DkgCommitment[]): DkgCommitment {
  assert(commits.length >= 1, "need commitments");
  const t = commits[0]!.coefficients.length;
  const combinedCoeffs: SecpPointHex[] = new Array(t).fill("00" as SecpPointHex);
  for (const commit of commits) {
    assert(
      commit.coefficients.length === t,
      "all commitments must have same threshold",
    );
    for (let j = 0; j < t; j++) {
      combinedCoeffs[j] = secpPointAddHex(combinedCoeffs[j]!, commit.coefficients[j]!);
    }
  }
  return { coefficients: combinedCoeffs };
}

export function dkgPublicKeyFromCombinedCommitment(
  combined: DkgCommitment,
): SecpPointHex {
  // g^{sum a0}
  return combined.coefficients[0]!;
}

export function dkgPrivateShareFromReceivedShares(shares: bigint[]): bigint {
  let acc = 0n;
  for (const s of shares) acc = secpModN(acc + secpModN(s));
  return acc;
}

export function dkgPublicShareFromPrivateShare(
  privateShare: bigint,
): SecpPointHex {
  return secpPointMulHex(secpBaseMulHex(1n), secpModN(privateShare));
}

/**
 * Reconstruct a private share using Lagrange interpolation at x=0.
 * Uses ALL provided shares (assumes caller verified count >= threshold).
 * shares: array of { x: bigint, y: bigint } where y = f(x)
 */
export function dkgReconstructPrivateShare(
  shares: { x: bigint; y: bigint }[],
): bigint {
  assert(shares.length >= 2, "need at least 2 shares");
  // Lagrange interpolation at x=0:
  // L_0 = sum_{i in S} (y_i * l_i(0)) where l_i(0) = prod_{j in S, j!=i} (-j / (i-j)) mod N
  let secret = 0n;
  for (let i = 0; i < shares.length; i++) {
    // Compute Lagrange coefficient at 0 for share i
    let lagrangeCoeff = 1n;
    const xi = secpModN(shares[i]!.x);
    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      const xj = secpModN(shares[j]!.x);
      // numerator: -x_j, denominator: x_i - x_j
      const num = secpModN(SECP256K1_N - xj); // -x_j mod N
      const den = secpModN(xi - xj);
      lagrangeCoeff = secpModN(lagrangeCoeff * secpModN(num * secpInvN(den)));
    }
    secret = secpModN(secret + secpModN(shares[i]!.y * lagrangeCoeff));
  }
  return secret;
}

const SECP256K1_N = BigInt(
  "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
);

/**
 * Reconstruct a public share (g^{secret_share}) using Lagrange interpolation at x=0.
 * Returns a DkgCommitment with a single coefficient (the public share point).
 * shares: array of { x: bigint, commitment: DkgCommitment } where commitment.c0 = g^{y_i}
 */
export function dkgReconstructPublicShare(
  shares: { x: bigint; commitment: DkgCommitment }[],
): DkgCommitment {
  assert(shares.length >= 2, "need at least 2 shares");
  // Interpolate g^{secret} at x=0 using Lagrange coefficients
  // g^{secret} = prod_{i in S} (g^{y_i})^{l_i(0)} = prod_{i in S} (c0_i)^{l_i(0)}
  let publicShare: SecpPointHex = "00"; // identity
  for (let i = 0; i < shares.length; i++) {
    // Compute Lagrange coefficient at 0 for share i
    let lagrangeCoeff = 1n;
    const xi = secpModN(shares[i]!.x);
    for (let j = 0; j < shares.length; j++) {
      if (i === j) continue;
      const xj = secpModN(shares[j]!.x);
      // numerator: -x_j, denominator: x_i - x_j
      const num = secpModN(SECP256K1_N - xj); // -x_j mod N
      const den = secpModN(xi - xj);
      lagrangeCoeff = secpModN(lagrangeCoeff * secpModN(num * secpInvN(den)));
    }
    // Multiply public share by (g^{y_i})^{l_i(0)} = (c0_i)^{l_i(0)}
    const term = secpPointMulHex(shares[i]!.commitment.coefficients[0]!, lagrangeCoeff);
    publicShare = secpPointAddHex(publicShare, term);
  }
  return { coefficients: [publicShare] };
}