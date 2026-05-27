/**
 * Range Proof Verification Key
 *
 * This is a PLACEHOLDER verification key for development/testing.
 * The actual key must be generated via the trusted setup ceremony.
 *
 * Run the following from src/crypto/circuits/:
 *
 *   circom range_proof.circom --r1cs --wasm --sym -o .
 *   snarkjs powersoftau new bn128 12 pot12_0000.ptau -v
 *   snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="First" -v
 *   snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v
 *   snarkjs groth16 setup range_proof.r1cs pot12_final.ptau range_proof_0000.zkey
 *   snarkjs zkey contribute range_proof_0000.zkey range_proof_0001.zkey --name="Contributor" -v
 *   snarkjs zkey export verificationkey range_proof_0001.zkey verification_key.json
 *
 * Then replace this placeholder with the actual key from verification_key.json.
 *
 * IMPORTANT: The verification key is circuit-specific. If you modify the circuit,
 * you must regenerate the key.
 */
export const RANGE_PROOF_VKEY: {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: [string, string];
  vk_beta_2: [[string, string], [string, string]];
  vk_gamma_2: [[string, string], [string, string]];
  vk_delta_2: [[string, string], [string, string]];
  IC: [string, string][];
} = {
  protocol: "groth16",
  curve: "bn128",
  nPublic: 1,
  vk_alpha_1: ["0", "0"],
  vk_beta_2: [
    ["0", "0"],
    ["0", "0"],
  ],
  vk_gamma_2: [
    ["0", "0"],
    ["0", "0"],
  ],
  vk_delta_2: [
    ["0", "0"],
    ["0", "0"],
  ],
  IC: [["0", "0"]],
};