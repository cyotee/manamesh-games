---
name: snarkjs
description: snarkjs, Groth16, PLONK, FFLONK ZK proofs, powersoftau trusted setup, zkey ceremony, circom, proof generation, proof verification, solidity verifier, verifyProof, snarkjs CLI, snarkjs JavaScript API. Triggers: "snarkjs", "Groth16", "PLONK", "FFLONK", "powers of tau", "zkey", "circom", "fullprove", "verifyProof", "solidity verifier", "trusted setup", "ZK proof", "zero knowledge"
triggers:
  - snarkjs
  - Groth16
  - PLONK
  - FFLONK
  - powers of tau
  - zkey ceremony
  - circom
  - fullprove
  - verifyProof
  - solidity verifier
  - trusted setup
  - ZK proof
  - zero knowledge
  - zkey export solidityverifier
  - snarkjs groth16
  - snarkjs plonk
---

# snarkjs — zkSNARKs in JavaScript

snarkjs v0.7.6 implements Groth16, PLONK, and FFLONK proving systems in pure JavaScript + WebAssembly. It can generate proofs in Node.js and browsers, and produce EVM-compatible Solidity verifier contracts.

## Three Proving Systems

| System      | Trusted Setup                  | Proof Size         | Verification   | Use Case                                |
| ----------- | ------------------------------ | ------------------ | -------------- | --------------------------------------- |
| **Groth16** | Per-circuit (phase 2 ceremony) | 3 points (A, B, C) | 3 pairings     | Single circuit, production              |
| **PLONK**   | Universal (powers of tau only) | 1 proof            | 1 pairing      | Updatable circuit, multiple deployments |
| **FFLONK**  | Universal (powers of tau only) | 1 proof            | Fewer pairings | Batch verification (beta)               |

**Key insight**: Groth16 requires a per-circuit phase 2 ceremony after powers of tau. PLONK/FFLONK only need the universal powers of tau — the same `potN_final.ptau` can be reused across circuits.

## Trusted Setup Flow

### Phase 1 — Powers of Tau (Universal)

Powers of tau creates a universal transcript reusable across circuits.

```sh
# 1. Start ceremony (bn128 curve, power 14 = 2^14 constraints)
snarkjs powersoftau new bn128 14 pot14_0000.ptau -v

# 2. Contribute (run many times by different people)
snarkjs powersoftau contribute pot14_0000.ptau pot14_0001.ptau --name="Contributor" -v

# 3. Verify transcript integrity
snarkjs powersoftau verify pot14_0003.ptau

# 4. Apply randomness beacon (finalize with public randomness)
snarkjs powersoftau beacon pot14_0003.ptau pot14_beacon.ptau <beacon_hex> <iterations> -n="Final Beacon"

# 5. Prepare for phase 2 (computes Lagrange polynomials)
snarkjs powersoftau prepare phase2 pot14_beacon.ptau pot14_final.ptau -v
```

Phase 1 produces `potN_final.ptau` — reuse this file for any number of PLONK/FFLONK circuits, or as input to Groth16 phase 2.

### Phase 2 — Circuit-Specific (Groth16 only)

```sh
# 1. Initial setup (binds circuit to ptau)
snarkjs groth16 setup circuit.r1cs pot14_final.ptau circuit_0000.zkey

# 2. MPC contributions (each contributor runs this)
snarkjs zkey contribute circuit_0000.zkey circuit_0001.zkey --name="Name" -v

# 3. Verify zkey matches circuit + ptau
snarkjs zkey verify circuit.r1cs pot14_final.ptau circuit_0003.zkey

# 4. Beacon (finalize with randomness)
snarkjs zkey beacon circuit_0003.zkey circuit_final.zkey <beacon_hex> <iterations> -n="Final"

# 5. Export verification key
snarkjs zkey export verificationkey circuit_final.zkey verification_key.json
```

For PLONK, skip phase 2 entirely:

```sh
snarkjs plonk setup circuit.r1cs pot14_final.ptau circuit_final.zkey
snarkjs zkey export verificationkey circuit_final.zkey verification_key.json
```

## Proof Generation

### CLI

```sh
# Groth16 — full pipeline (witness + proof in one step)
snarkjs groth16 fullprove input.json circuit.wasm circuit_final.zkey proof.json public.json

# Groth16 — separate witness then prove
snarkjs wtns calculate circuit_js/circuit.wasm input.json witness.wtns
snarkjs groth16 prove circuit_final.zkey witness.wtns proof.json public.json

# PLONK — full pipeline
snarkjs plonk fullprove input.json circuit.wasm circuit_final.zkey proof.json public.json

# PLONK — separate witness then prove
snarkjs plonk prove circuit_final.zkey witness.wtns proof.json public.json
```

### JavaScript API (Node.js)

```js
const snarkjs = require("snarkjs"); // CJS in Node

async function prove() {
  // fullProve = compute witness + generate proof
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { a: 10, b: 21 },
    "circuit.wasm",
    "circuit_final.zkey",
  );

  // Verify locally
  const vKey = JSON.parse(fs.readFileSync("verification_key.json"));
  const res = await snarkjs.groth16.verify(vKey, publicSignals, proof);

  console.log(res ? "Verification OK" : "Invalid proof");
}
```

PLONK equivalent:

```js
const { proof, publicSignals } = await snarkjs.plonk.fullProve(
  { a: 10, b: 21 },
  "circuit.wasm",
  "circuit_final.zkey",
);
const vKey = JSON.parse(fs.readFileSync("verification_key.json"));
const res = await snarkjs.plonk.verify(vKey, publicSignals, proof);
```

ESM import (Node.js with `"type": "module"` or bundler):

```js
import snarkjs from "snarkjs";

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  inputs,
  wasm,
  zkey,
);
```

## Proof Verification

### CLI

```sh
snarkjs groth16 verify verification_key.json public.json proof.json
snarkjs plonk verify verification_key.json public.json proof.json
```

### JavaScript

```js
const vKey = JSON.parse(fs.readFileSync("verification_key.json"));
const isValid = await snarkjs.groth16.verify(vKey, publicSignals, proof);
```

## Verification Key JSON Structure

**Groth16** — 3 pairings + IC array:

```json
{
  "protocol": "groth16",
  "curve": "bn128",
  "nPublic": 3,
  "vk_alpha_1": ["123456", "7891011"],
  "vk_beta_2": [
    ["123456", "7891011"],
    ["111213", "141516"]
  ],
  "vk_gamma_2": [
    ["1", "2"],
    ["3", "4"]
  ],
  "vk_delta_2": [
    ["1", "2"],
    ["3", "4"]
  ],
  "IC": [
    ["123", "456"],
    ["789", "012"]
  ]
}
```

**PLONK** — polynomial commitment key:

```json
{
  "protocol": "plonk",
  "curve": "bn128",
  "nPublic": 3,
  "power": 14,
  "k1": ["123"],
  "k2": ["456"],
  "Qm": ["0", "1"],
  "Ql": ["0"],
  "Qr": ["0"],
  "Qo": ["1"],
  "Qc": ["0"],
  "S1": ["..."],
  "S2": ["..."],
  "S3": ["..."],
  "X_2": [["..."], ["..."]]
}
```

## Solidity Verifier Generation

```sh
# Generate verifier contract
snarkjs zkey export solidityverifier circuit_final.zkey verifier.sol

# Generate calldata (for calling verifyProof on deployed contract)
snarkjs zkey export soliditycalldata public.json proof.json
```

The generated `verifier.sol` exposes:

```solidity
function verifyProof(
    uint256[2] memory a,
    uint256[2][2] memory b,
    uint256[2] memory c,
    uint256[] memory input
) public view returns (bool)
```

Paste the calldata output into Remix or call `verifyProof` directly with the proof points.

## Circuit Inspection Tools

```sh
# Info about circuit constraints and signals
snarkjs r1cs info circuit.r1cs

# Print constraint system
snarkjs r1cs print circuit.r1cs circuit.sym

# Export R1CS as JSON
snarkjs r1cs export json circuit.r1cs circuit.r1cs.json

# Check witness validity
snarkjs wtns check circuit.r1cs witness.wtns
```

## Browser Usage

```sh
# Build browser bundle
npm run build
cp node_modules/snarkjs/build/snarkjs.min.js .
```

```html
<script src="snarkjs.min.js"></script>
<script>
  // Browser global: window.snarkjs
  const { proof, publicSignals } = await window.snarkjs.groth16.fullProve(
      { a: 10, b: 21 },
      "circuit.wasm",
      "circuit_final.zkey"
  )
</script>
```

Browser bundle entry: `build/browser.esm.js` (ESM) or `build/snarkjs.min.js` (IIFE).

## Constraints / Gotchas

1. **snarkjs v0.7.6 is ESM-only** — `package.json` has `"type": "module"`. Use `import` or the CJS build (`./build/main.cjs`) in Node.js.
2. **Groth16 requires phase 2 ceremony** — the same `pot_final.ptau` cannot produce valid Groth16 proofs without circuit-specific zkey contributions. PLONK does not have this requirement.
3. **Beacon hex format** — use a public, verifiably random string (e.g., hash of a future block) as the beacon hex. Never use untrusted randomness.
4. **witness.wtns is binary** — use `wtns calculate` to produce it; don't hand-edit.
5. **PLONK proof is not Groth16-compatible** — verify with the same protocol's verification key, not interchange.
6. **circom_runtime** — witness generation uses the circom runtime (`circom_runtime.wasm`). The WASM file must match the circuit compilation output.
7. **Memory constraints** — in constrained environments (Bun, browser extensions), pass `{ singleThread: true }` to prove:
   ```js
   await snarkjs.groth16.prove(zkey_final, wtns, undefined, {
     singleThread: true,
   });
   ```
8. **FFLONK is beta** — expect API changes. Test thoroughly before production use.
9. **Large circuits need higher power** — a circuit with 2^n constraints needs ptau power >= n. Common: power 20 (1M constraints).
10. **No native TypeScript types in package** — import from `snarkjs` directly; types may need `@types/snarkjs` or manual declaration.

## Key Files

| File                                  | Purpose                                           |
| ------------------------------------- | ------------------------------------------------- |
| `src/groth16.js`                      | Groth16 module exports (fullProve, prove, verify) |
| `src/plonk.js`                        | PLONK module exports                              |
| `src/groth16_fullprove.js`            | Orchestrates witness calc → groth16 prove         |
| `src/groth16_prove.js`                | Heavy lifting: reads zkey, multi-exp on G1/G2     |
| `src/wtns_calculate.js`               | WitnessCalculator from circom_runtime WASM        |
| `src/zkey_export_verificationkey.js`  | Exports VK JSON (protocol-specific shape)         |
| `src/zkey_export_solidityverifier.js` | EJS template dispatcher for Solidity verifiers    |
| `templates/verifier_groth16.sol.ejs`  | Groth16 Solidity verifier template                |
| `templates/verifier_plonk.sol.ejs`    | PLONK Solidity verifier template                  |
| `templates/verifier_fflonk.sol.ejs`   | FFLONK Solidity verifier template                 |

## ManaMesh ZK Usage

ManaMesh's Go Fish ZK mode (`gofish-zk`) uses snarkjs for zero-knowledge proof scaffolding:

- `skill:manamesh-crypto` — ZK verdict signing with ECDSA (verifier signs valid/invalid)
- `skill:manamesh-game-modules` — Go Fish `securityMode=zk-attest` uses `PendingZkCheck` with `ZkProofEnvelope` (vkeyId, publicSignals, proof) and `submitZkVerdict` with ECDSA signature
- **Current status**: snarkjs ZK circuits are placeholder scaffolding — the signing/verification infrastructure is wired but actual circuit proofs are not yet generated

## See Also

- `skill:manamesh-crypto` — ManaMesh's ZK integration (ECDSA verdict signing, verifier-signed verdicts)
- `skill:manamesh-game-modules` — Go Fish `gofish-zk` security mode using snarkjs
- https://github.com/iden3/snarkjs — Official repo (commit 9a8f1c0, v0.7.6)
- circom (compiler for writing ZK circuits): https://github.com/iden3/circom
