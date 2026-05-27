import { groth16 } from "snarkjs";

export type Groth16Proof = unknown;
export type Groth16VerificationKey = unknown;

export type Groth16VerifyInput = {
  vkey: Groth16VerificationKey;
  publicSignals: unknown[];
  proof: Groth16Proof;
};

export async function verifyGroth16Proof({
  vkey,
  publicSignals,
  proof,
}: Groth16VerifyInput): Promise<boolean> {
  // snarkjs returns a Promise<boolean>
  return await groth16.verify(vkey as any, publicSignals as any, proof as any);
}
