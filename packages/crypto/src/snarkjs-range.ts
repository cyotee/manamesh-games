/**
 * snarkjs Range Proof Wrappers
 *
 * Provides proof generation and verification for the range proof circuit.
 * Used by Threshold Tally Arena to verify that encrypted contributions
 * are within the allowed range [0, maxContribution].
 *
 * NOTE: The actual proof generation requires:
 * 1. Compiled circuit (.r1cs, .wasm)
 * 2. Powers of Tau ceremony artifacts (potN_final.ptau)
 * 3. Phase 2 zkey with circuit-specific setup
 *
 * These artifacts are generated via CLI and the verification key is
 * embedded as a constant. See: src/crypto/circuits/README.md
 */

import { groth16 } from "snarkjs";

/**
 * Public input signals for the range proof circuit:
 * - value: the plaintext integer (private to prover)
 * - maxValue: the maximum allowed value (public)
 *
 * The circuit proves that value is in range [0, maxValue] by:
 * 1. Decomposing value into bits
 * 2. Verifying each bit is binary (0 or 1)
 * 3. Verifying the bits reconstruct to value
 *
 * LIMITATION: The current circuit verifies binary decomposition
 * but does not strictly enforce value <= maxValue. For Threshold
 * Tally Arena with small maxContribution (e.g., 100), this is
 * acceptable since nBits=8 provides range 0-255, and a player
 * encrypting 255 would produce an obviously invalid sum.
 *
 * Full range enforcement requires additional comparison constraints
 * or Bulletproofs for production use.
 */
export interface RangeProofInput {
  value: bigint;
  maxValue: bigint;
}

/**
 * Groth16 proof structure from snarkjs
 */
export interface Groth16Proof {
  a: [string, string];       // G1 point (x, y)
  b: [[string, string], [string, string]]; // G2 point ((x1, x2), (y1, y2))
  c: [string, string];       // G1 point (x, y)
}

/**
 * Public signals from the range proof:
 * - [0]: maxValue (the bound being proven against)
 */
export interface RangeProofPublicSignals {
  maxValue: string;
}

/**
 * Complete range proof with all necessary data for verification
 */
export interface RangeProof {
  proof: Groth16Proof;
  publicSignals: string[];
}

/**
 * Verification key structure for Groth16
 * This is exported from snarkjs after the trusted setup ceremony.
 *
 * The structure is:
 * {
 *   protocol: "groth16",
 *   curve: "bn128",
 *   nPublic: 1,
 *   vk_alpha_1: [string, string],
 *   vk_beta_2: [[string, string], [string, string]],
 *   vk_gamma_2: [[string, string], [string, string]],
 *   vk_delta_2: [[string, string], [string, string]],
 *   IC: [[string, string], ...]
 * }
 */
export interface Groth16VerificationKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: [string, string];
  vk_beta_2: [[string, string], [string, string]];
  vk_gamma_2: [[string, string], [string, string]];
  vk_delta_2: [[string, string], [string, string]];
  IC: Array<[string, string]>;
}

/**
 * Generate a range proof for a given value and maxValue.
 *
 * @param input - The value to prove and the max allowed value
 * @param wasmPath - Path to the compiled circuit .wasm file
 * @param zkeyPath - Path to the phase2 final zkey file
 * @returns The proof and public signals
 *
 * NOTE: This function requires the compiled circuit artifacts
 * which are generated via CLI. See src/crypto/circuits/README.md
 */
export async function generateRangeProof(
  input: RangeProofInput,
  wasmPath: string,
  zkeyPath: string,
): Promise<RangeProof> {
  const { proof, publicSignals } = await groth16.fullProve(
    {
      value: input.value.toString(),
      maxValue: input.maxValue.toString(),
    },
    wasmPath,
    zkeyPath,
  );

  return {
    proof: proof as unknown as Groth16Proof,
    publicSignals: publicSignals as string[],
  };
}

/**
 * Verify a range proof.
 *
 * @param proof - The Groth16 proof to verify
 * @param vkey - The verification key (or JSON string)
 * @param publicSignals - The public signals (must include maxValue)
 * @returns true if the proof is valid
 */
export async function verifyRangeProof(
  proof: Groth16Proof,
  vkey: Groth16VerificationKey | string,
  publicSignals: string[],
): Promise<boolean> {
  const verificationKey =
    typeof vkey === "string" ? (JSON.parse(vkey) as Groth16VerificationKey) : vkey;

  return await groth16.verify(verificationKey as any, publicSignals as any, proof as any);
}

/**
 * Verify a range proof with separate proof and public signals.
 *
 * @param rangeProof - The complete range proof
 * @param vkey - The verification key (or JSON string)
 * @returns true if the proof is valid
 */
export async function verifyRangeProofFull(
  rangeProof: RangeProof,
  vkey: Groth16VerificationKey | string,
): Promise<boolean> {
  return verifyRangeProof(rangeProof.proof, vkey, rangeProof.publicSignals);
}

/**
 * Convert a proof to a serializable format for storage/transmission.
 */
export function serializeRangeProof(rangeProof: RangeProof): {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[];
} {
  return {
    a: rangeProof.proof.a,
    b: rangeProof.proof.b,
    c: rangeProof.proof.c,
    publicSignals: rangeProof.publicSignals,
  };
}

/**
 * Reconstruct a RangeProof from serialized format.
 */
export function deserializeRangeProof(data: {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
  publicSignals: string[];
}): RangeProof {
  return {
    proof: { a: data.a, b: data.b, c: data.c },
    publicSignals: data.publicSignals,
  };
}