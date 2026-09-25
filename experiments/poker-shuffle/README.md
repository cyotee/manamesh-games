# Poker shuffle implementation evaluation

This directory is an isolated compatibility experiment. It is not imported by
the game, does not replace the existing protocol, and is not a security audit.

## Pinned candidates

| Candidate | Evidence and fit | Outstanding work |
| --- | --- | --- |
| [ziffle](https://github.com/v26-solutions/ziffle/tree/f24f38e6049d43336517079d4abb36e465ea2512), commit `f24f38e6049d43336517079d4abb36e465ea2512` | Rust, secp256k1 ElGamal, Bayer–Groth shuffle proofs, key-ownership and card-specific reveal proofs; MIT OR Apache-2.0. Public API accepts a proof context. Native harness below exercises it unchanged. | Upstream explicitly declares it experimental and unaudited. Requires independent review, browser/WASM adapter and measurements, strict input decoding and an application protocol. Not approved for production. |
| [Manta zkShuffle](https://github.com/Manta-Network/zkShuffle/tree/7278810e27b3077b05f0717bbe05e05d68807348), commit `7278810e27b3077b05f0717bbe05e05d68807348` | Circom/Groth16 shuffle and decrypt circuits, TypeScript proof helpers. SDK manifest declares MIT. [Salus audit](https://cert-api.salusec.io/api/v1/salus/contract/certificate/full/2024/zkShuffle_audit_report_2024-02-01.pdf) identifies this commit and eight circuit files. | Audit found one acknowledged low-severity boolean-selector constraint issue; caller constraints matter. Audit scope is not the SDK, setup artifacts or our integration. Source archive has no ready `.wasm`/`.zkey` artifacts. Need reviewed setup provenance, build reproduction, license notices and browser proof benchmarks. |
| [Geometry/Parity mental-poker](https://github.com/paritytech/mental-poker) | Another Bayer–Groth/ElGamal implementation family, descended from Geometry's implementation. | Source/API and maintenance comparison remains open; no audit or browser readiness established here. |

The choice remains open. A Rust proof library avoids introducing Groth16 setup
artifacts, but does not avoid implementation review. The existing SRA single-point
ciphertexts cannot be passed to these ElGamal APIs. Do not add a nominal proof
field to the old shuffle and call that an integration.

Source provenance checked locally on 2026-09-05: SHA-1 file digests for all eight
Circom files at the pinned zkShuffle commit match the audit appendix. This
establishes source correspondence, not correctness of generated proving keys.
The downloaded source archive's SHA-256 was
`28abfad60de30d4b51d23c31a9afc03ecfd6ed419f5a25ef0552060a5967e221`.

## Native candidate checks

`candidate-check.rs` uses public ziffle APIs and OS-seeded `rand::thread_rng()`.
For each seat count 2–5 it checks:

- Key-ownership and shuffle proofs reject another context.
- Duplicate-card substitution fails proof verification even with valid points.
- A later shuffle proof rejects an earlier, incorrect predecessor deck.
- Successive shuffles have no unchanged ciphertexts matching by equality.
- Reveal proofs reject another card and another request context.
- Missing decryption contributors do not recover card identities.
- Complete verified reveals recover each of the 52 canonical card indices once.

The missing-contributor and equality checks are concrete attack checks, not
formal privacy proofs. Native timings are single-run diagnostics, not browser
performance promises. No wallet, network, host state machine or settlement is
involved in this experiment.

### Results — 2026-09-05

Native release build: upstream **16 unit tests and 15 documentation tests passed**.
The additional harness completed successfully for **all four seat counts**.
Each transmitted 52-card deck measured **3,432 bytes** and each shuffle proof
**5,547 bytes** using canonical compressed serialization.

| Seats | Setup/proving measurement (ms) | Subsequent positive verification measurement (ms) |
| --- | ---: | ---: |
| 2 | 2934 | 693 |
| 3 | 3090 | 811 |
| 4 | 4273 | 1150 |
| 5 | 5430 | 1484 |

These columns follow the harness timers: the first includes initial proof
generation plus initial positive/negative verification and later proof
generation; the second sums only subsequent positive shuffle verifications.
They exclude the remaining adversarial and reveal checks. The development
machine had other workloads; do not extrapolate these values to browser SLAs.
The library also passes `cargo check --lib --target wasm32-unknown-unknown`
with Rust 1.96.0 after installing that target and pinning `RUSTC` to the rustup
compiler. The first attempt selected a different Homebrew compiler without the
target installed; this was a local toolchain mismatch. This is a WASM-target
typecheck, not a linked browser application or browser execution test.
The subsequent [isolated Chromium worker evaluation](wasm/README.md) links the
candidate into a 336,618-byte WASM module and passes the complete checks at
2–5 seats using browser-seeded randomness. It records whole-workload timings
and linear-memory size; independent-peer integration and production review
remain outstanding.
No runtime dependency was added to Poker.

Reproduce from the monorepo root (downloads dependencies, writes only temporary
evaluation artifacts):

```sh
evaluation_dir=$(mktemp -d /tmp/manamesh-shuffle.XXXXXX)
curl -fsSL https://codeload.github.com/v26-solutions/ziffle/tar.gz/f24f38e6049d43336517079d4abb36e465ea2512 -o "$evaluation_dir/source.tar.gz"
# Verify SHA-256 before extracting:
echo "6725a9c26853c1c0de29b84cff73235e9a6ddc47cf776f4da1c152b5385ee7de  $evaluation_dir/source.tar.gz" | shasum -a 256 -c -
tar -xzf "$evaluation_dir/source.tar.gz" -C "$evaluation_dir"
candidate_dir="$evaluation_dir/ziffle-f24f38e6049d43336517079d4abb36e465ea2512"
cp experiments/poker-shuffle/candidate-check.rs "$candidate_dir/examples/candidate-check.rs"
CARGO_HOME="$evaluation_dir/cargo" CARGO_TARGET_DIR="$evaluation_dir/target" cargo test --locked --release --manifest-path "$candidate_dir/Cargo.toml"
CARGO_HOME="$evaluation_dir/cargo" CARGO_TARGET_DIR="$evaluation_dir/target" cargo run --locked --release --manifest-path "$candidate_dir/Cargo.toml" --example candidate-check
```

Optional WASM-target check with an existing rustup stable toolchain:

```sh
rustup target add wasm32-unknown-unknown --toolchain stable
candidate_rustc=$(rustup which --toolchain stable rustc)
CARGO_HOME="$evaluation_dir/cargo" CARGO_TARGET_DIR="$evaluation_dir/wasm-target" RUSTC="$candidate_rustc" rustup run stable cargo check --offline --locked --lib --target wasm32-unknown-unknown --manifest-path "$candidate_dir/Cargo.toml"
```

## Required adapter and game boundary

Before any integration can enable untrusted Poker:

1. Bind the exact protocol, canonical card mapping, roster and key proofs into
   a session commitment. Reject identity, duplicate and invalid public keys;
   require a nonidentity aggregate key and proof of possession for each seat.
2. Verify all proofs locally against the previously committed deck. Contexts
   must bind session, hand, step, sender and previous transcript hash.
3. Deserialize with validation, exact lengths and complete byte consumption.
   Bound payload sizes before decoding. Never deserialize a `Verified` label
   supplied by a host or persist verification solely as a boolean in shared G.
   Version the wire encoding explicitly: arkworks canonical compressed points
   are not the existing SRA/SEC1 hex format, despite both using secp256k1.
4. Track reveal contributors by authenticated seat and card position. Aggregate
   exactly once per required seat; never infer completeness from array length.
5. Keep the hole-card owner's final contribution local. Independent rule replay
   and agreed checkpoints must authorize the other contributions before the
   client uses its key. A valid proof does not authorize a premature reveal.
6. Require verified outcomes and transcript agreement before settlement signing.
   Withholding results in the agreed abort path, not key disclosure.

These requirements are not implemented by this experiment. See
[production-readiness.md](../../docs/production-readiness.md) for the complete
release gates.

## Strict public-byte adapter — 2026-09-06

`wire-codec.rs` is an evaluation adapter for the pinned candidate's compressed
encoding and a 52-card deck. It bounds length before decoding, uses validated
canonical deserialization, requires complete consumption and exact re-encoding,
and exposes decoders only for unverified public keys, ownership proofs, decks,
shuffle proofs, reveal tokens and reveal proofs. It cannot deserialize secret
keys or a host-supplied `Verified` label. Expected compressed lengths are 33,
65, 3432, 5547, 33 and 98 bytes respectively; these are pinned-format values,
not a general secp256k1 wire standard.

The native `wire-codec-check.rs` harness confirmed that the candidate's ownership
verifier accepts the identity public key with an identity commitment and zero
response. This is a concrete reason to enforce nonidentity admission outside
that verifier; ownership proof acceptance alone does not provide that policy.
The adapter rejects identity keys, duplicate keys, rosters outside 2–5 seats,
invalid ownership proofs under independently supplied per-seat contexts, and an
identity aggregate key. A dedicated cancellation regression generates two
nonidentity keys with opposite known test scalars through the candidate's own
keygen API. Both ownership proofs verify under their distinct seat contexts,
but their aggregate is identity; the adapter rejects that roster. Only this
adversarial fixture uses a controlled RNG prefix; ordinary cases use OS-seeded
randomness.

Native release validation completed with exit 0 at all four seat counts. Each
case checks every truncated prefix, trailing bytes and all-0xff malformed input
for each public encoding; rejects duplicate keys and swapped seat contexts;
serializes and decodes the initial shuffle and every card-zero reveal proof;
and obtains verified objects only by checking proofs locally. Missing one
contributor cannot reveal the card, while the complete set can. The existing
candidate harness covers subsequent shuffles and all 52 card identities.

Reproduce after preparing the pinned checkout as above:

```sh
mkdir -p "$candidate_dir/examples/wire-codec"
cp experiments/poker-shuffle/wire-codec.rs "$candidate_dir/examples/wire-codec/"
cp experiments/poker-shuffle/wire-codec-check.rs "$candidate_dir/examples/"
CARGO_HOME="$evaluation_dir/cargo" CARGO_TARGET_DIR="$evaluation_dir/target" cargo run --offline --locked --release --manifest-path "$candidate_dir/Cargo.toml" --example wire-codec-check
```

This is still native integration groundwork. Callers must derive contexts from
an independently authenticated session/seat/transcript, bind encryption keys to
that session's signing roster, and authorize each reveal from verified rules.
The adapter does not establish those bindings, provide worker key isolation or
persistence, define a versioned network envelope, or wire verified dealing into
Poker. Its checks do not replace independent cryptographic review.
