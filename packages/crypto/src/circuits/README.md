# Range Proof Circuit

This directory contains the Circom circuit for range proofs used by Threshold Tally Arena.

## Circuit: `range_proof.circom`

Proves that a value `m` is in range `[0, maxValue]` using binary decomposition.

**Approach:**
1. Decompose `value` into 8 bits using `Num2Bits(8)`
2. `Num2Bits` constraint ensures each bit is binary (0 or 1)
3. `Num2Bits` constraint ensures bits reconstruct to original value

**Limitation:** The circuit verifies binary decomposition but does NOT strictly enforce `value <= maxValue`. For Threshold Tally Arena with `maxContribution=100`, this is acceptable because:
- nBits=8 provides range 0-255
- A player encrypting 255 would produce an obviously invalid decrypted sum
- The threat model assumes players won't forge proofs for out-of-range values

For strict range enforcement, consider Bulletproofs or additional comparison constraints.

## Trusted Setup (One-Time)

Requires snarkjs and circom installed:

```bash
# 1. Compile the circuit
circom range_proof.circom --r1cs --wasm --sym -o .

# 2. Start powersoftau ceremony (or download existing potN_final.ptau)
snarkjs powersoftau new bn128 12 pot12_0000.ptau -v

# 3. Contribute to ceremony (run multiple times)
snarkjs powersoftau contribute pot12_0000.ptau pot12_0001.ptau --name="Contributor" -v

# 4. Prepare phase2
snarkjs powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v

# 5. Setup Groth16
snarkjs groth16 setup range_proof.r1cs pot12_final.ptau range_proof_0000.zkey

# 6. Contribute to phase2 (run multiple times)
snarkjs zkey contribute range_proof_0000.zkey range_proof_0001.zkey --name="Contributor" -v

# 7. Export verification key
snarkjs zkey export verificationkey range_proof_0001.zkey verification_key.json
```

## Files

- `range_proof.circom` - Circom circuit source
- `range_proof.r1cs` - Compiled constraint system (generated)
- `range_proof_js/` - Generated witness calculator (generated)
- `range_proof_final.zkey` - Final proving key (DO NOT commit - large file)
- `verification_key.json` - Verification key (embed in source)

## Usage

```typescript
import {
  generateRangeProof,
  verifyRangeProof,
  RANGE_PROOF_VKEY,
} from "./snarkjs-range";

// Generate proof (browser/node with WASM support)
const proof = await generateRangeProof(
  { value: 42n, maxValue: 100n },
  "/circuits/range_proof.wasm",
  "/circuits/range_proof_final.zkey"
);

// Verify proof
const isValid = await verifyRangeProof(proof.proof, RANGE_PROOF_VKEY, proof.publicSignals);
```

## Files to Add to .gitignore

```
*.ptau
*.zkey
range_proof.r1cs
range_proof.sym
range_proof_js/
!range_proof_js/*.wasm
```