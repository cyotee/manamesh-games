---
name: circom
description: circom, circom_old, circom JS, circom compiler, circom language, arithmetic circuits, R1CS, r1cs file format, witness calculator, WASM circom, circom_runtime, snarkjs, zkSNARK, zero knowledge circuits, Num2Bits, template, signal, constraint. Triggers: "circom", "circom compiler", "circom language", "R1CS format", "r1cs file", "witness calculator", "circom WASM", "circom_runtime", "arithmetic circuit", "zkSNARK circuit", "circom template"
triggers:
  - circom
  - circom compiler
  - circom language
  - circom JS
  - circom_old
  - R1CS format
  - r1cs file
  - witness calculator
  - circom WASM
  - circom_runtime
  - arithmetic circuit
  - zero knowledge circuit
  - circom template
  - signal constraint
  - Num2Bits
  - circom CLI
  - compile circom
---

# ⚠️ circom_old — Deprecated JS Circom Compiler

**This is the legacy JavaScript circom compiler (v0.5.46). It is frozen/deprecated.**

For new projects, use the **Rust circom** instead: https://github.com/iden3/circom

This skill documents `circom_old` (iden3/circom_old) for legacy support and historical reference. ManaMesh's ZK circuits are placeholder scaffolding — when real ZK circuits are developed, prefer the Rust circom.

---

## Overview

`circom` is a language for writing **arithmetic circuits** used in zero-knowledge proofs. The JS version compiles `.circom` files to:

- `.r1cs` — R1CS constraint system (binary format)
- `.wasm` — WebAssembly witness calculator
- `.sym` — symbol mapping (names → indices)
- `.cpp` / `.wat` — C source / WebAssembly text

## Quick Start

### Install

```sh
npm install -g circom
```

### Compile a circuit

```sh
circom mycircuit.circom -o mycircuit.json
# or with named outputs:
circom mycircuit.circom -r mycircuit.r1cs -w mycircuit.wasm -s mycircuit.sym
```

### CLI Flags

```
-r, --r1cs       output R1CS file
-c, --csource    output C source file
-w, --wasm       output WASM file
-t, --wat        output WebAssembly text format
-s, --sym        output symbol file
-o, --output     output directory
-f, --fast       skip constraint optimization
-v, --verbose    verbose output
-p, --prime      specify field prime (BN-128 default)
```

---

## Circom Language

### Template & Component

```circom
template NAND() {
    signal private input a;
    signal input b;
    signal output out;

    out <== 1 - a*b;
    a*(a-1) === 0;
    b*(b-1) === 0;
}

component main = NAND();
```

### Signal Assignment Operators

| Operator | Meaning                                           |
| -------- | ------------------------------------------------- |
| `<==`    | Assign signal **and** generate constraint         |
| `==>`    | Reverse assign signal **and** generate constraint |
| `<--`    | Assign signal value **without** constraint        |
| `-->`    | Reverse assign without constraint                 |
| `===`    | Define constraint only (no assignment)            |

### Example: Num2Bits

```circom
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1 = 0;

    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 += out[i] * 2**i;
    }

    lc1 === in;
}

component main = Num2Bits(8);
```

### Example: Binary Adder (multi-file)

`bitify.circom`:

```circom
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1 = 0;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 += out[i] * 2**i;
    }
    lc1 === in;
}

template Bits2Num(n) {
    signal input in[n];
    signal output out;
    var lc1 = 0;
    for (var i = 0; i < n; i++) {
        lc1 += in[i] * 2**i;
    }
    lc1 ==> out;
}
```

`binsum.circom`:

```circom
template BinSum(n, ops) {
    var nout = nbits((2**n - 1) * ops);
    signal input in[ops][n];
    signal output out[nout];
    // ... full implementation in repo
}
```

`sumtest.circom`:

```circom
include "bitify.circom"
include "binsum.circom"

template Adder() {
    signal private input a;
    signal input b;
    signal output out;
    // ... components wiring
}
component main = Adder();
```

---

## JavaScript API

### Module Exports (`index.js`)

```javascript
const circom = require("circom");

circom.compiler; // compile(srcFile, options) — async
circom.c_tester; // C-based witness calculator factory
circom.wasm_tester; // WASM-based witness calculator factory
circom.tester; // alias for wasm_tester
```

### Compile Function

```javascript
const { compiler } = require("circom");

await compiler("/path/to/mycircuit.circom", {
  // Output files
  r1csFileName: "./mycircuit.r1cs",
  wasmFileName: "./mycircuit.wasm",
  watFileName: "./mycircuit.wat",
  symWriteStream: fs.createWriteStream("./mycircuit.sym"),

  // Behavior
  prime:
    "21888242871839275222246405745257275088548364400416034343698204186575808495617", // BN-128
  reduceConstraints: true, // false = --fast, skip optimization
  verbose: false,
  sanityCheck: false,
  mainComponent: "main",
  newThreadTemplates: /regex/,
});
```

### Witness Calculator (WASM)

```javascript
const { wasm_tester } = require("circom");

// Compile + get tester instance
const circuit = await wasm_tester("/path/to/mycircuit.circom");

// Calculate witness
const witness = await circuit.calculateWitness({
  in: 42,
});
// witness is an array of field elements

// Assert output matches expected
await circuit.assertOut(witness, { out: [1, 0, 1, 0, 1, 0, 1, 0] });

// Release resources
await circuit.release();
```

### Witness Calculator (C)

```javascript
const { c_tester } = require("circom");

const circuit = await c_tester("/path/to/mycircuit.circom");
const witness = await circuit.calculateWitness({ in: 42 });
```

### Full Test Example

```javascript
const { wasm_tester } = require("circom");

async function runTest(circuitPath, inputs, expectedOutputs) {
  const cir = await wasm_tester(circuitPath);
  const w = await cir.calculateWitness(inputs);
  await cir.assertOut(w, expectedOutputs);
  await cir.release();
}

runTest("./test/circuits/mycircuit.circom", { in: 42 }, { out: [1, 0, 1, 0] });
```

---

## R1CS Binary Format

The `.r1cs` file encodes the constraint system in a canonical binary format.

### File Structure

```
┏━━━━┳━━━━━━━━━━━━━━━━━┓
┃ 4  ┃  72 31 63 73   ┃  Magic "r1cs" (0x72, 0x31, 0x63, 0x73)
┗━━━━┻━━━━━━━━━━━━━━━━━┛
┏━━━━┳━━━━━━━━━━━━━━━━━┓
┃ 4  ┃   01 00 00 00  ┃  Version 1
┗━━━━┻━━━━━━━━━━━━━━━━━┛
┏━━━━┳━━━━━━━━━━━━━━━━━┓
┃ 4  ┃   03 00 00 00  ┃  Number of Sections (3)
┗━━━━┻━━━━━━━━━━━━━━━━━┛
```

### Sections

| Type ID      | Section        | Contents                                                                  |
| ------------ | -------------- | ------------------------------------------------------------------------- |
| `0x00000001` | Header         | field size, prime, nWires, nPubOut, nPubIn, nPrvIn, nLabels, mConstraints |
| `0x00000002` | Constraints    | A, B, C linear combinations for each constraint                           |
| `0x00000003` | Wire2Label Map | 64-bit label IDs per wire                                                 |

### Header Fields (little-endian)

- **field size** (4 bytes) — bytes per field element
- **prime** — field prime number
- **nWires** — total wires including ONE signal
- **nPubOut** — public output wires
- **nPubIn** — public input wires
- **nPrvIn** — private input wires
- **nLabels** — total labels
- **mConstraints** — number of constraints

### Constraint Encoding

Each constraint is three linear combinations A, B, C where `A * B - C = 0`.

Linear combination encoding:

```
[4 bytes: numNonZero]
  [4 bytes: wireId][n8 bytes: coefficient]  × numNonZero
```

### Wire → Label Map

Array of 64-bit label IDs, one per wire:

```
[64-bit labelId for wire_0][64-bit labelId for wire_1]...
```

Full spec: https://github.com/iden3/circom_old/blob/master/doc/r1cs_bin_format.md

---

## WASM Runtime API

When compiled with `-w`, the WASM module exports these runtime functions:

```javascript
init(); // Initialize the circuit
getNVars(); // Number of variables
getNPublic(); // Number of public inputs/outputs
getFrLen(); // Field element byte length
setSignal(name, idx, value); // Set input signal
multiGetSignal(names, indices, counts); // Get multiple signals
getPWitness(idx); // Get witness value for signal
getWitnessBuffer(); // Get full witness buffer
Fr_toInt(witnessIdx); // Convert field element to integer
getPRawPrime(); // Get the prime
```

Usage:

```javascript
const wc = await WitnessCalculatorBuilder(wasmBuffer);
await wc.init();
await wc.setSignal("main.a", 0, 42);
const witness = await wc.calculateWitness();
```

---

## Key Source Files

| File                          | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `index.js`                    | Module exports: compiler, c_tester, wasm_tester           |
| `cli.js`                      | CLI entry point, yargs parser                             |
| `src/compiler.js`             | `compile()` — async compiler function                     |
| `src/ctx.js`                  | Compiler context (signals, constraints, field arithmetic) |
| `src/r1csfile.js`             | `buildR1cs()` — R1CS binary writer                        |
| `src/construction_phase.js`   | Parse + build AST, components, constraints                |
| `ports/wasm/builder.js`       | WASM module builder                                       |
| `ports/wasm/build_runtime.js` | WASM runtime exports (init, setSignal, etc.)              |
| `ports/wasm/tester.js`        | `wasm_tester` implementation                              |
| `ports/c/tester.js`           | `c_tester` implementation                                 |
| `doc/r1cs_bin_format.md`      | R1CS binary format specification                          |

---

## Constraints / Gotchas

1. **Deprecated** — `circom_old` is frozen. Use Rust circom for new projects.
2. **BN-128 is the default curve** — prime: `21888242871839275222246405745257275088548364400416034343698204186575808495617`
3. **Memory usage** — compiler can be memory-intensive. Use `NODE_OPTIONS="--max-old-space-size=8192"` for large circuits.
4. **`--fast` skips optimization** — `options.reduceConstraints = false` skips constraint reduction; faster compilation but more constraints.
5. **circom_runtime dependency** — the `WitnessCalculatorBuilder` comes from the separate `circom_runtime` npm package (a peer dependency).
6. **Signal classification** — signals are classified as ONE/PUBINPUT/PRVINPUT/OUTPUT/INTERNAL/CONSTANT. Only INPUT signals need to be provided for witness calculation.
7. **Linear combinations must be simplifiable** — `===` constraints must reduce to `a*b + c = 0` form.
8. **WASM is single-threaded** — the JS version's WASM output does not use multi-threading. Use the C output path for parallelized witness generation.

---

## ManaMesh Usage

ManaMesh's Go Fish ZK mode (`gofish-zk`) uses **placeholder ZK circuits** — the snarkjs signing/verification infrastructure is wired, but actual circom circuits are not yet written. When ManaMesh needs real ZK circuits:

1. Write Circom circuit (.circom files)
2. Compile with `circom circuit.circom -r circuit.r1cs -w circuit.wasm`
3. Generate proof with snarkjs using the compiled `.r1cs` and `.wasm`
4. Submit `ZkProofEnvelope` (vkeyId, publicSignals, proof) as a game move

See `skill:snarkjs` for the proof generation side, and `skill:manamesh-crypto` for the ZK verdict signing infrastructure.

---

## See Also

- `skill:snarkjs` — Groth16/PLONK proof generation using compiled circom output
- `skill:manamesh-crypto` — ZK verdict signing (ECDSA) in ManaMesh
- `skill:manamesh-game-modules` — Go Fish `gofish-zk` mode placeholder
- https://github.com/iden3/circom_old — Legacy JS compiler (deprecated, frozen at v0.5.46)
- https://github.com/iden3/circom — **Rust circom** (active development, for new projects)
- https://github.com/iden3/circom_old/blob/master/doc/r1cs_bin_format.md — R1CS binary format spec
