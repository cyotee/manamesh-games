# Browser candidate evaluation

This is an isolated, disposable worker test of the pinned ziffle candidate.
It is not a production cryptographic adapter. The upstream implementation is
experimental and unaudited; successful browser execution does not change that.

The Rust entry mirrors the native candidate checks: 52-card verified shuffles,
wrong-context and wrong-predecessor rejection, duplicate-card substitution,
ciphertext equality tracking, invalid reveal proofs and missing contributors.
A pass requires recovering all 52 distinct card indices. All participants live
inside one worker in this fixture. It does not test independent peers, wallet
admission, Poker replay, withholding, or private-card UI behavior.

The worker seeds ChaCha20 with 256 bits from `crypto.getRandomValues`. It does
not accept an external seed over its message channel. The seed and generated
participant keys remain local to that disposable worker; no key persistence or
production key API is implemented. Each seat count gets a new worker, fresh
randomness and a fresh WASM instance. Any Rust assertion failure traps and fails
the run. Unexpected WASM imports are rejected.

## Reproduction

First download and verify the pinned source archive using the parent README.
Keep the resulting `ziffle-f24f38e6049d43336517079d4abb36e465ea2512` directory in
`$evaluation_dir`. From the monorepo root:

```sh
mkdir -p "$evaluation_dir/browser/src"
cp experiments/poker-shuffle/wasm/Cargo.toml experiments/poker-shuffle/wasm/Cargo.lock "$evaluation_dir/browser/"
cp experiments/poker-shuffle/wasm/wasm-check.rs "$evaluation_dir/browser/src/lib.rs"
candidate_rustc=$(rustup which --toolchain stable rustc)
RUSTC="$candidate_rustc" CARGO_HOME="$evaluation_dir/cargo" CARGO_TARGET_DIR="$evaluation_dir/browser-target" rustup run stable cargo build --locked --release --target wasm32-unknown-unknown --manifest-path "$evaluation_dir/browser/Cargo.toml"
yarn node experiments/poker-shuffle/wasm/browser-check.mjs "$evaluation_dir/browser-target/wasm32-unknown-unknown/release/manamesh_shuffle_browser_check.wasm"
```

Requires the WASM Rust target, installed monorepo dependencies and Playwright
Chromium. The runner starts an ephemeral loopback HTTP server and closes the
browser and server after completion or failure. It has a five-minute deadline
per seat count. No external RPC or network service participates in the checks.

Results report the entire checking workload's wall time and WASM linear memory
size after each run. They do not isolate proof generation from verification,
measure peak browser memory, or establish a production performance budget.

## Results — 2026-09-05

Rust 1.96.0 linked the release WASM module successfully. Chromium
149.0.7827.55 completed all checks at 2–5 seats with exit status 0. The server and
browser closed normally. The module was 336,618 bytes with SHA-256
`b17858a4427ceaf9c618ab443b9eafb28b77713a2d3431eea934ea4e541f451b`.

| Seats | Complete checking workload (ms) | Linear memory after run (bytes) |
| --- | ---: | ---: |
| 2 | 5723 | 1179648 |
| 3 | 14466 | 1179648 |
| 4 | 29866 | 1179648 |
| 5 | 36617 | 1179648 |

Each case recovered all 52 canonical card indices after the positive and
negative proof checks. Raw measurements are in `results-2026-09-05.jsonl`.
These are single runs on a loaded development machine, not browser performance
SLAs. The native harness timers measure different portions of the workload.
