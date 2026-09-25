# One-seat worker evaluation

This fixture runs the pinned candidate with one secret key per WASM instance in
one dedicated Chromium worker per seat. Unlike the earlier all-participants
worker, peers receive only serialized public announcements, decks, shuffle
proofs and non-owner reveal contributions. Each independently decodes and
verifies those bytes using `wire-codec.rs`. No API exports secret keys.

The coordinator relays public bytes between workers. It does not manufacture
proofs or provide a worker's random seed: each worker obtains its own seed from
`crypto.getRandomValues`. The worker exports a small, bounded fixture command
set. Failed operations return no output, and invalid shuffles do not advance the
local deck. Admission pins the worker's own generated key in its assigned seat.

For each table size 2–5 the runner checks:

- Every worker independently admits the public roster and verifies every shuffle.
- Foreign-session ownership proofs and an all-zero session are rejected; an
  initialized worker cannot replace its session.
- All player workers derive the same nonempty transcript digest after admission
  and a new matching digest after each shuffle.
- Reveals before all shuffles are rejected.
- Replacing a card with a duplicate rejects the shuffle without preventing a
  subsequent valid transfer; replay after acceptance is rejected.
- Successive shuffled ciphertexts cannot be linked by byte equality.
- Every hole-card owner refuses to export its final reveal token.
- Wrong-dealer announcements, non-hole positions and wrong-card tokens are rejected.
- Wrong-contributor and duplicate reveal tokens are rejected.
- The owner cannot open the card until every other contributor supplies a
  verified token. Only the owner's worker can open that private card.

The caller supplies a nonzero 32-byte session commitment and locally agreed
dealer once at initialization. The first two rounds deal one card per seat,
starting left of the dealer; both private positions are assigned to that owner.
Version-five proof contexts bind session, dealer, stage, table size, seat and
local transcript head with separate domain tags. Admission hashes the ordered
public announcements into that head; each verified shuffle hashes its predecessor,
step and exact public deck/proof bytes into the next head. Reveal contexts bind
the final head, position, owner and contributor. Only the owner can collect all
other verified contributions and complete its final decryption locally. Burns remain unavailable. The public API permits only the active street
positions after a sequential checkpoint authorization; advancing also requires
the previous street's public cards to have opened locally.
This is **not** the application protocol: the caller must authenticate the session
commitment independently and bind encryption keys to the wallet-admitted signing
roster. Public Poker dealing and reveal authorization, durable recovery, timeouts
and independent security review remain required.
All workers run under a trusted local test page, not separate hostile browser
origins. The coordinator is allowed to receive the owner's final plaintext as
test output. This does not establish a defense against compromised client code.

## Reproduction

Use the root build script for the adapter's current artifact pin. It verifies
source before extraction, checks the exact Rust compiler, uses locked Cargo
resolution, and records the source/lock/module hashes. Compiler metadata is
normalized by package name/version; path remapping and symbol stripping remove
build-location differences. The wrapper uses process replacement to preserve
Cargo's inherited jobserver descriptors. The locked graph must have unique
package name/version pairs for this metadata policy.

```sh
rustup toolchain install 1.96.0 --profile minimal --target wasm32-unknown-unknown
shuffle_build_root=$(mktemp -d /tmp/manamesh-shuffle.XXXXXX)
python3 scripts/build-poker-shuffle.py --output "$shuffle_build_root/artifacts" --expected-module-sha256 d1031ede4c2e4fe0f92b7aa1ca3a6e28b3c15778a215dab97b548f506ad2cf44
yarn node experiments/poker-shuffle/wasm/peer-browser-check.mjs "$shuffle_build_root/artifacts/manamesh_shuffle_peer_check.wasm"
POKER_SHUFFLE_WASM="$shuffle_build_root/artifacts/manamesh_shuffle_peer_check.wasm" E2E_PORT=3107 yarn workspace @cyotee/manamesh test:e2e shuffle-admission.spec.ts
```

The output directory must be new. It contains the WASM module, build provenance
and candidate license notices. `--source-archive` accepts an existing archive but
still checks its pinned digest; `--offline` additionally requires cached Cargo
dependencies. `CARGO_HOME` can select a reusable cache. `--toolchain stable` is
accepted only when that installed alias reports the exact required compiler.
The older manual builds below are historical evidence and have different hashes;
the adapter does not accept them under its current pin.

The quality workflow's `poker-shuffle` job now builds and checks the pin, runs the
standalone worker checks and the wallet-admission browser suite, and retains the
artifact/provenance. CI collection of the admission suite without its artifact
variable fails instead of skipping. The Linux workflow has not yet been run
remotely; local reproduction is not confirmation of cross-host byte identity.

The runner uses an ephemeral local server, terminates workers after each table
and closes the browser/server on completion or failure. Its timings measure the
whole checking workload, not a production latency SLA.

## Initial fixed-context results — 2026-09-06

The release WASM build completed with Rust stable, and Chromium 149.0.7827.55
passed all four table sizes with exit status 0. The 351,457-byte module's SHA-256
is `414dbcf8b1bed8a46d4fec540377e91f4eacdec2e0ac4ed7d80e1f297914479e`.
Raw measurements are in `results-2026-09-06.jsonl`.

| Seats / isolated workers | Complete workload (ms) | Private cards opened by owner |
| --- | ---: | ---: |
| 2 | 2341 | 1 |
| 3 | 4594 | 1 |
| 4 | 7737 | 1 |
| 5 | 11711 | 1 |

These cases exercise one private card per table, unlike the earlier all-keys
fixture that reveals all 52 cards. The measurements are not directly comparable.


## Session-bound results — 2026-09-06

The version-two context build passes at all four table sizes in Chromium
149.0.7827.55, with exit status 0. Each case also creates one foreign-session
worker to test replay rejection. The module is 351271 bytes; SHA-256
`168839ad95346d554112f15f6e349890746e1f40572277dad7d5cc70f3291f1a`. Raw results are in
`context-results-2026-09-06.jsonl`.

| Seats | Complete workload (ms) | Cross-session rejection / transcript agreement |
| --- | ---: | --- |
| 2 | 2281 | Passed |
| 3 | 4442 | Passed |
| 4 | 7265 | Passed |
| 5 | 10843 | Passed |

These measurements include all positive and negative checks and open one
private card per table. Session commitments are still supplied by the test
coordinator; the result proves binding to that input, not its authentication.


## Reproducible artifact — 2026-09-06

Three fresh builds in different temporary directories produced identical bytes:
329,706 bytes, SHA-256
`949d235b6f41898f2218a923dcd272afe274a1e78f5478796a7beff09f9e0e4d`.
The third build also enforced the expected digest. A malformed source archive
was rejected before creating an output artifact. Four wallet-admission Chromium
cases passed against this pin, including malformed ownership-proof rejection.
Full build provenance is in `reproducible-build-2026-09-06.json`.

The initial remap/strip builds differed in function layout. Normalizing all
compiler metadata, rather than adding a fixed value alongside Cargo's generated
values, resolved that difference in the local comparison. Rust documents
[metadata's role in symbol mangling](https://doc.rust-lang.org/rustc/codegen-options/index.html#metadata).
This establishes local reproducibility and regression evidence, not a security
audit or confirmed Linux CI execution.


## Canonical private-hole policy — 2026-09-06

Two fresh builds produce the same 335,319-byte module, SHA-256
`178ba8e7535ac0acb0557fb57d98d8899ad282c2914420a72171cd7ca9e73931`.
This supersedes the earlier fixed-card pins. The adapter and CI expected digest
both require this artifact. Provenance is in `hole-policy-build-2026-09-06.json`.
The standalone runner passes all four table sizes, opening every owner's two
private cards (4/6/8/10 distinct cards), while rejecting requests for other
players' cards, wrong-card/contributor proofs, duplicate contributions, missing
contributors, cross-session/dealer announcements and non-hole reveals. Raw results
are in `hole-policy-worker-results-2026-09-06.jsonl`. Plaintexts reach only the
local test oracle and the owning worker's caller, never another player worker.
These are experimental regression checks, not an external cryptographic audit.


## Checkpoint-bound flop proof policy — 2026-09-06

The version-four worker adds checkpoint-bound public reveal proofs for the three
canonical flop positions. The private policy is unchanged. Native authorization
accepts one nonzero checkpoint after all shuffles; it does not itself validate
Poker betting rules. The private frontend adapter derives that checkpoint from
the bound locally verified complete, contested preflop history.

The runner rejects public reveals before authorization, repeat authorization,
zero checkpoints, burn/hole/turn/river requests, missing contributions,
wrong-card proofs and duplicate contributors. Its two-seat fixture deliberately
uses divergent checkpoints and cannot open a flop; the 3–5-seat fixtures verify
all players open the same three distinct public cards. The wallet-admitted
browser scenarios separately test valid two-seat progression.

Current module SHA-256:
`5d0b07d6b3489b578b64cf233e1d9087403f65c99bbaa24542e004613a6fbddc`.
Earlier sections retain historical artifacts and results. Flop state commitment,
postflop betting, later streets, recovery and independent audit remain open.

Two fresh builds produced identical 342,120-byte modules; the second enforced
the expected hash. Provenance: `flop-build-2026-09-06.json`; raw native-worker
results: `flop-worker-results-2026-09-06.jsonl`. All four wallet-admitted Chromium
scenarios also pass, including positive two-seat flop opening after signed
preflop completion. These results do not replace independent security review or
prove the remote Linux build.


## Sequential public streets — 2026-09-06

Version five authorizes stage zero/one/two sequentially for flop/turn/river,
with a fresh checkpoint and successful local opening of the preceding street.
Only active-street positions can generate or accept public tokens. The runner
also rejects prior-street proofs at the new position, premature advancement,
repeated stages and attempts to skip directly to the river. The divergent
two-seat checkpoint case remains unable to progress; matching 3–5-seat fixtures
open all five distinct public cards. The admitted browser cases test positive
two-seat progression and signed betting between reveals.

Current module SHA-256:
`c55eb991320be9c5abec87e503499f64bfea6ab8c97cffe600dfc0f036d2d21b`.
The module is 342,174 bytes. Earlier pins and measurements above are historical.
Showdown, outcome verification, recovery and independent security review remain
required before production.

Two fresh builds produced identical 342,174-byte artifacts, with the second
checking the expected digest. Provenance: `streets-build-2026-09-06.json`; raw
results: `streets-worker-results-2026-09-06.jsonl`. All four wallet-admitted browser
scenarios also pass through river betting. Linux CI still needs remote execution.


## Checkpoint-bound showdown (version six)

The version-six pin was
`464f2e912436fea13371b825c8b85020d6dfd93e6c05134e9868984ffde7581c`
(344,658 bytes). Two fresh local builds produced identical bytes; the second
build enforced that expected digest. See `showdown-build-2026-09-06.json` for
source/toolchain provenance and `showdown-worker-results-2026-09-06.jsonl` for
the isolated Chromium worker results. Historical version-five artifacts above
are no longer accepted by the current adapter. Cross-host reproducibility and
remote Linux CI execution remain unverified.

After all five board cards open, native `authorize_showdown` binds a new
checkpoint and eligible-seat mask into public decryption contexts. Eligible
hole positions may now release their owner-final contributions; folded positions
remain refused. The trusted adapter derives permission from completed river
betting, rather than accepting a remote mask or checkpoint. Native code does
not parse Poker rules. Invalid masks, repeated authorization, missing
contributions and old river proofs are refused. Every opened showdown card in
the 3–5-seat raw harness matches the earlier private opening; the 2-seat raw
fixture deliberately remains stopped at its divergent flop.

This remains an unaudited cryptographic candidate, isolated from the live page.
Key/proof recovery, abort handling and settlement integration are incomplete.


## Private contribution review (version seven)

The current artifact is 345,633 bytes, SHA-256
`d1031ede4c2e4fe0f92b7aa1ca3a6e28b3c15778a215dab97b548f506ad2cf44`.
Two fresh local builds produced identical bytes; the second enforced the expected
hash. Provenance is in `private-review-build-2026-09-06.json`; native Chromium
results are in `private-review-worker-results-2026-09-06.jsonl`. Runtime and CI
pins require this version. Cross-host reproducibility and remote CI remain
unverified.

`review_token` validates a non-owner contribution using only the admitted public
key, final encrypted deck and owner/position context. It returns no output and
retains no token. `receive_token` shares that validation but retains the token
only at the owner. Owner-final token export and non-owner opening remain refused.
The raw 2–5-seat checks confirm review alone cannot open cards, rejects changed
positions/authors/proofs and produces no output; existing private opening,
public street and showdown checks also pass. The candidate remains unaudited.
