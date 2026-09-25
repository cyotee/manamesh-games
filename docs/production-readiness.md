# Production readiness — 2026-09-06

Status: **not production ready for untrusted Poker**. This assessment applies to
the working tree, including existing uncommitted settlement and wallet work.
Passing unit tests or the SPA build is not a security sign-off.

### Current implementation boundary

| Layer | Current evidence | Required next step |
| --- | --- | --- |
| Session admission and public betting history | Wallet-bound enrollment, signed actions, independent replay, unanimous acknowledgments, durable signing journal and archive have unit/browser coverage. | Connect the verified peer exchange to the live Poker UI and validate full-hand recovery and refusal through that path. |
| Private deal through showdown | The experimental protected runtime autonomously coordinates private dealing, community cards and eligible showdown openings; verified history derives hands and gross payouts. Complete two-/five-seat and folded-hand browser cases pass. | Connect the tested protected table/controller to live Poker onboarding, define interruption/recovery, and independently review the cryptography. |
| Checkpoint delivery | Signed history has bounded reliable WebRTC delivery, peer receipt coordination, stage-bound readiness and owned connection/worker lifetimes exercised through complete hands. | Connect the protected flow to live UI decisions; gameplay signing remains driven by explicit test controls. |
| Hidden cards | The legacy transcript attack remains reproducible. The experimental protected runtime uses pinned native shuffle/decryption verification and keeps keys worker-local; it is not mounted in live Poker. | Independently review and integrate the protected protocol before allowing untrusted play. |
| Live Poker page | Still creates `PokerGame` with host-authoritative `P2PMultiplayer`. | Replace snapshot trust with verified progression for every supported phase; a public-betting-only verifier cannot authorize dealing or settlement. |
| Hand results | Signed terminal transitions derive gross awards/refunds, credit stacks and clear the pot. Uncontested hands disclose no cards; contested hands require local proof-verified openings. | Connect results to fee-aware on-chain settlement and validate all-in tabling rules. |
| Settlement | Contract and signing-adapter tests exist. | Verify the actual UI transaction path and bind outcome signing to a complete independently verified hand. |

The transport and history foundation does not prevent withholding or guarantee
progress. Its unanimous checkpoints deliberately require every admitted seat;
production needs an explicit timeout/abort path, not a fallback to host state.

## Poker against a malicious host

The current protocol needs replacement at the shuffle/transcript boundary;
switching the standalone page from PokerGame to CryptoPokerGame is insufficient.

Confirmed findings (including the immediate fixes made during this investigation):

1. `packages/poker/src/components/PokerBoard.tsx` submitted private keys as move
   arguments to `encryptDeck`, `shuffleDeck`, and `peekHoleCards`. This wire leak
   is now closed: encryption runs locally, the move accepts only ciphertexts,
   and shuffle/peek calls omit the key. The old encryption helper remains only
   for in-process simulations. Ciphertext validation checks shape and layers;
   it does **not** establish correct encryption or a valid shuffle.
2. `packages/poker/src/crypto.ts::approveDecrypt` completes private peeks by
   removing **all** layers and storing plaintext `peekedCards` in shared G.
   Filtering a host's outbound state cannot hide this data from that host.
3. Encryption layers are published in known order, followed by `quickShuffle`,
   which only permutes unchanged ciphertexts. A host can label the ordered
   ciphertexts and follow them across each shuffle by equality, without keys.
   Tests that try to decrypt one isolated ciphertext miss this transcript attack.
   `packages/poker/src/crypto.transcript.characterization.test.ts` now reproduces
   keyless identification of the opponent's two hole cards through the actual
   encryption/shuffle/deal helpers. It is a passing reproduction of a known
   vulnerability, **not** a security acceptance test.
4. A valid curve point plus a smaller `layers` number is not proof of a correct
   decryption. The receive path accepts caller-supplied peels without a proof
   binding input, output, admitted key, request, and round.
5. Channel guests accept host snapshots without independently verifying a signed
   sequence of actions and deterministic state transitions. A malicious host can
   forge requests, substitute decks, rewind, or send different states to peers.
6. CryptoPokerGame had async setup, while the channel initializer invokes setup
   synchronously. Setup now returns synchronously for modern and legacy engine
   contexts, and move wrappers bind boardgame.io's top-level playerID before
   invoking legacy pure handlers. This fixes compatibility and honest-host seat
   enforcement, not host authentication or independent peer verification.

### Required production protocol

Threat model: authenticated 2–5 seat roster; host may be malicious and collude
with other seats; privacy relies on at least one honest participant protecting
their secrets. No protocol can force a disconnected peer to cooperate. Failure
must lead to a defined abort/settlement path, never arbitrary key disclosure.

Implement and validate in this order:

1. **Session and identity.** Agree on protocol version, match/hand identity,
   chain/settler/table domain where applicable, roster public keys, rules and
   buy-ins. Authenticate roster membership independently of host assertions.
   Use separate signing and deck-encryption keys. Sign actions over session,
   sender, monotonic sequence and previous transcript hash. Reject replay,
   conflicting sequences and changed rosters before processing a move.
2. **Verified state progression.** Peers replay the same deterministic rules,
   verify signed actions and state hashes, and acknowledge required checkpoints.
   A snapshot alone cannot authorize a decrypt or settlement signature. Verify
   reconnect snapshots against a locally retained checkpoint and transcript.
   Resolve the custom transport reducer's divergence from boardgame.io semantics
   before relying on replay; synchronous setup alone does not resolve it.
3. **Verifiable shuffle.** Use a reviewed rerandomizable encryption/mix protocol
   with proof that output is a permutation and re-encryption of exactly the
   committed input deck. All peers verify each shuffle before dealing. A
   commit/reveal permutation, shuffled unchanged ciphertexts, or a generic proof
   envelope is not a substitute. Select and benchmark an implementation before
   committing to a browser/WASM integration; do not invent a new proof scheme.
4. **Private peeks and public reveals.** Keep the owner's final layer local for
   hole cards. Verify other players' decryption proofs against the committed
   card position, key and transcript before local decryption. Do not trust a
   host-provided card-point lookup. Reveal plaintext and proof only when the
   independently verified rules require a public reveal; folded cards stay
   private. Do not distribute enough escrow material to reconstruct an honest
   opponent's key during play (especially at two seats).
5. **Settlement and liveness.** Validate the locally computed outcome and
   transcript before wallet signing. Exercise the existing timeout/refund/table
   logic against malicious aborts, withholding, mismatched state and reconnects.
   Contract signatures enforce agreement only if honest clients know what they
   are signing. No live deployment is part of the current fixes.
6. **Release evidence.** Run browser tests with a deliberately modified host,
   covering deck substitution, duplicate cards, forged peels/requests, stolen
   seats, complete-transcript card tracking, forks, rewind/replay, premature
   showdown, wrong settlement and withheld messages, at 2–5 seats. Measure proof
   generation/verification, memory, payload limits and reconnect behavior.
   Obtain independent review of the selected protocol and its integration.

Primary references for protocol evaluation (not claims that a library is audited
or a drop-in fit):

- [Verificatum standalone verifier specification](https://www.verificatum.org/files/vmnv-3.1.0.pdf):
  concrete shuffle and decryption proof verification requirements.
- [ZKShuffle paper](https://zkholdem.xyz/wp-content/themes/zkholdem-theme/zkshuffle.pdf):
  mental-poker shuffle/encrypt and private/public dealing proof design.
- [Neff, verifiable shuffles of ElGamal pairs](https://courses.csail.mit.edu/6.897/spring04/Neff-2004-04-21-ElGamalShuffles.pdf):
  alternative protocol family to evaluate for browser performance and available implementations.

These references inform evaluation; the existing SRA API is not automatically
compatible with their ciphertexts or proofs. Dependency choice remains open
pending implementation, license, audit and performance review.

The [pinned shuffle candidate evaluation](../experiments/poker-shuffle/README.md)
now records concrete implementation candidates and a native 2–5 seat adversarial
harness using a candidate's public API unchanged. It also verifies that the
eight zkShuffle circuit source hashes match the published audit appendix.
The candidate's 16 unit tests, 15 documentation tests and additional harness
passed. At all four seat counts, substituted decks and replayed proofs were
rejected, incomplete reveal shares did not reveal cards, and ciphertext equality
tracking failed. A library typecheck for `wasm32-unknown-unknown` also passed.
Browser execution, the JS/worker adapter and independent security review remain
outstanding.
This evaluation does not change the runtime Poker protocol or certify a library.

The [local history verifier](../packages/poker/docs/VERIFIED_HISTORY.md) is now
implemented and exported as an integration building block. It binds session
terms, verifies actor and unanimous checkpoint signatures, and independently
replays public state with atomic catch-up and replay/fork checks. Twelve tests
pass using actual Poker bet/raise wrappers at 2–5 seats. It is not wired into
the legacy transport; authenticated admission and the shuffle/reveal adapter
remain required before live use.

The [durable signing journal](../packages/poker/docs/SIGNING_JOURNAL.md) now
connects verified proposals to local session signatures. It uses an atomic,
strict-durability IndexedDB claim shared by proposals and acknowledgments, and
requires the original journal reference after restart. Conflicting claims,
missing storage and failed commits prevent key use. Fifteen signer/history unit
tests and six real Chromium tests pass, including cross-tab races, reload,
failed signing, missing/closed storage and a modified host requesting conflicting
acknowledgments. Poker typecheck passes. The journal contains no keys; session-key
recovery/enrollment and live transport integration remain outstanding. Browser
reload evidence is not a physical power-loss or storage-rollback guarantee.

This work also fixed a shared signing-preimage collision: `stableStringify`
silently omitted an own `__proto__` field. It now preserves that field; two new
regressions and the complete shared-crypto suite (151 tests) pass.

## Concrete remediation and validation

- Injected wallet browser checks: five cases pass for connection, address/chain
  display, personal-sign recovery, EIP-712 message/domain binding and rejection
  of another requested account. The previous fixture signed without validating
  the requested account; a new browser regression reproduced that behavior.
  Both personal-sign and typed-data fixture paths now check the signer address.
  These checks use the Poker page and injected test wallet, not MetaMask, and
  send no transaction. The root Chromium CI step includes this suite.

- Poker contracts: a full local Forge run completed with 245 tests across
  35 suites passing, including real-diamond deployment, settlement/withdrawal,
  wrong-winner rejection, timeout, table lifecycle, replay and reentrancy cases.
  The initial macOS sandbox run crashed in system proxy configuration before
  tests; the approved unsandboxed run completed. Foundry 1.5.1 reported existing
  compilation artifacts current. No production contract source was changed.
  A separate contract job is now part of root CI and required by the reusable
  release validation. The completed invariant fixture had no active-hand locks;
  it has subsequently been strengthened to retain exact nonzero buy-in locks
  under deposits/withdrawals. Both strengthened invariants pass separately at
  256 runs and 128,000 calls each, with zero reverts. This follow-up validates
  the changed fixture; the 245-test run predates that fixture change.

- Shuffle browser feasibility: the pinned candidate now compiles into a linked
  WASM module and passes the native harness's proof/tampering/reveal checks in
  Chromium workers for 2–5 seats. Fresh randomness is generated inside each
  worker. Complete workload times were 5.7–36.6 seconds, with 1,179,648 bytes of
  WASM linear memory after each run. These are not isolated proof benchmarks or
  peak browser-memory measurements. The candidate remains experimental and
  unaudited; no Poker runtime dependency or independent-peer adapter was added.
  See [browser evaluation evidence](../experiments/poker-shuffle/wasm/README.md).

- Wallet enrollment for verified history: `PokerHistoryEnrollment` checks one
  EOA wallet authorization per independently expected seat, binding the complete
  session, wallet order and session signing keys before releasing its verifier.
  Eight local-key tests pass for 2–5 seats and substitution/replay/mutation cases.
  [Enrollment contract](../packages/poker/docs/HISTORY_ENROLLMENT.md) documents the
  remaining membership, wallet UI and persistence work; live Poker still bypasses
  this new path.
  The sixth Chromium case now verifies enrollment before journal creation,
  agreement between two admitted seats and replay after reload with the original
  journal reference. It uses runner-local wallet signatures, not wallet UI.

- Connection-bound guest action and sync identities: implemented; seven focused
  transport tests pass, including forged envelope/root/payload identities and
  filtered sync/update snapshots. Transport TypeScript build passes.
- Standard Poker: per-player views hide opponent cards and deck aliases; betting
  wrappers bind the actual sender, including omitted claimed-seat arguments.
  Eight focused regressions pass. This remains a **trusted-dealer** game.
- Shared betting now rejects malformed or unsafe integer amounts and pot overflow
  before transferring chips. A short all-in call cannot lower the table bet via
  the raise move. Incomplete raises preserve the minimum full raise and cannot
  reopen a prior actor until the cumulative increase reaches a full raise,
  following [Poker TDA rule 47](https://www.pokertda.com/view-poker-tda-rules/).
  An all-in opponent still counts as being in the hand: both game entry points
  now retain the remaining player's call/fold decision instead of advancing the
  street prematurely. The amount regression initially failed eight of nine
  cases; the additional phase regressions failed in both game entry points.
- Crypto Poker: five wire/setup regressions pass for local encryption, rejection
  of private-key move arguments, sender binding, synchronous setup and malformed
  ciphertext arrays. Hole-card plaintext in shared state, linkable shuffles,
  missing cryptographic proofs and unverified host snapshots remain blockers.
- Test worker crash: reproduced with a single Vitest thread; `web-worker` loaded
  by `snarkjs` mistakes the runner thread for its own worker. A Timestreams smoke
  test passes in a forked process. Poker, Timestreams and frontend configurations
  now use bounded fork pools; frontend collection excludes Playwright specs.
  The same exception was later reproduced in Mistborn and One Piece even though
  their runners reported passing tests. Both now use bounded fork pools too;
  reruns passed 8 and 238 tests respectively without that worker exception.
  Mistborn no longer allows an empty suite to pass. Both suites are in root CI;
  this runner correction does not certify their gameplay or cryptographic privacy.
- Frontend offline fixtures: defer WebRTC dependencies until node creation;
  test DHT-unavailable handling without starting a node. IPFS integration uses
  real local Helia/UnixFS blocks with networking disabled and explicit cleanup;
  unavailable-node unit tests inject that condition instead of making requests.
- Timestreams turn-release regression: replace an impossible synthetic decrypt
  state with a real two-key encrypted draw. The test verifies the turn stays
  held until the final peel and then advances exactly once (five tests pass).
- Poker typecheck: reduced 94 initial diagnostics to zero by correcting engine
  context types, missing state exports, card schema fields, settlement mock
  types and transitive wallet/Vite types. Wallet verification retains all five
  original tests and adds valid/tampered batch and custom-domain regressions;
  all seven pass.
- Crypto timing failures in the initial broad review: both pass on targeted
  rerun after reducing contention. Do not treat elapsed-time assertions on an
  uncontrolled shared machine as a calibrated performance benchmark.
- WebRTC intentional close: preserve suppression of disconnect events (which can
  trigger reconnect flows), but update the public state getter to disconnected.
  Regression expectation updated to match that lifecycle contract.
- Registry staging now copies the real monorepo SPA and bundles the checked-out
  channel transport with its declarations and license. An isolated install of
  the earlier thin re-export package reproduced host-state disclosure through
  registry transport 0.5.0. Bundling the corrected implementation closes that
  packaging regression. Node ESM also needed an explicit engine entry instead
  of its legacy `/core` directory. The final installed consumer passes runtime
  exports, CLI help, sender binding, filtered sync and TypeScript API checks.
  See [registry release procedure](registry-release.md) for reproducible commands.
- CLI HTTP serving: reproduced traversal into a sibling `dist-private` directory
  and symlink disclosure outside `dist`. File containment now checks path
  components and resolved symlinks. Missing assets return 404; only extensionless
  HTML navigation gets the SPA fallback. Malformed URLs return 400, unsupported
  methods return 405, and responses use `nosniff`. Nine HTTP cases pass against
  the production CLI in an isolated package fixture; this does not certify SPA
  rendering or concurrent modification of the installed files by a local writer.
- Publishing no longer suppresses install/test/build failures or generates a
  placeholder SPA. The new staged-package validator rejects an existing
  placeholder too: checking only file existence was insufficient. A local npm
  pack dry run confirmed the explicit file list excludes TypeScript build-cache
  data and contains the advertised export targets. The later bundled tarball
  has eleven files, including local declarations and the transport license.
  Repository build hooks are removed from its staged manifest.
  The standalone submodule publisher has now been retired to a manual migration
  notice. Root `release-manamesh.yml` runs the reusable quality workflow, checks
  the requested artifact identity, and publishes that same tarball via OIDC.
  Staged repository metadata now matches the monorepo for provenance. YAML and
  local artifact identity checks pass, including wrong-version rejection. Remote
  CI, trusted-publisher configuration and actual publication remain unverified.
- Added a root quality workflow for shared builds, crypto/Poker typechecks,
  scoped unit suites and the production build. Private submodules require a
  configured read-only `SUBMODULES_READ_TOKEN`. No remote CI run was performed.

### Validation evidence

Local commands and results at this checkpoint:

| Check | Result |
| --- | --- |
| Frontend `test:run` | 601 tests / 40 files passed; followed by 7 wallet verification tests after the final type changes |
| Current full frontend after settlement/archive/channel work | 625 tests / 42 files passed; exit 0 |
| Current full Poker through verified showdown | 470 tests / 35 files passed; exit 0, 210.85 seconds. Six Chromium admission/full-hand scenarios pass. Poker/frontend typechecks and root build also pass. |
| Historical frontend typecheck investigation | Legacy settings produced 1,221 diagnostics; Bundler resolution / ES2022 / skipLibCheck produced 203 source diagnostics, exit 2. Superseded by the clean current typecheck below. |
| Settlement adapter after full typecheck findings | 23 targeted tests, Poker typecheck and root production build passed after forwarding claimant/hand-end signatures and using the shared timeout default |
| Full frontend typecheck after settlement fixes | 201 source diagnostics remained, exit 2; no remaining blockchain-directory diagnostics. |
| Frontend typecheck after React/prompt corrections | 104 source diagnostics remained; 33 targeted Timestreams tests passed. |
| Current full frontend Vitest suite | 676 tests / 54 files pass after admission/transport changes, including real loopback gossip and local Helia regressions. |
| Current full frontend typecheck | Passes locally with zero diagnostics after One Piece protocol-state integration. This is not a production-security certification. Battleship now multiplexes shot-proof signals over its peer channel; a two-context Chromium WebRTC regression passes placement and one verified shot per seat. Discovery and manual join-code session negotiation remain release gates. See [typecheck findings](frontend-typecheck.md). |
| Poker `test` after worker correction | 328 tests / 20 files passed |
| Historical full Poker `test` after betting and enrollment changes | 378 tests / 27 files passed; exit 0 |
| Later full Poker run during betting remediation | 368 passed, 2 failed / 26 files; both failures were the new premature all-in phase regressions, subsequently fixed and covered by the 80-test targeted run |
| Poker final targeted wire, view, settlement and street regressions | 36 tests / 4 files passed after the subsequent code fixes |
| Poker betting amount, reopening and all-in phase regressions | 80 tests / 3 files passed, including 13 new cases; typecheck passed |
| Poker transcript attack characterization | Reproduced keyless hole-card identification; 1 test passed (known vulnerability, not protection) |
| Poker `typecheck` | Passed after the final corrections |
| Timestreams full `test` after fixture correction | 617 tests / 96 files passed |
| Mistborn / One Piece after worker correction | 8 tests / 2 files and 238 tests / 8 files passed; worker initialization exception absent |
| Channel transport regression suite / build | 7 tests passed / build passed |
| Root `yarn build` | Passed; Timestreams SPA and public library produced |
| Staged package validator / `npm pack --dry-run --ignore-scripts` | Placeholder rejected; SPA layout accepted; seven intended files, with no source-only exports or build-cache file |
| Bundled registry artifact / isolated npm consumer | Actual eleven-file tarball installed; runtime exports, CLI help, sender binding, filtered sync and TypeScript API checks passed; transport and library builds passed |
| CLI HTTP regression | Nine HTTP cases plus parent test passed (10 reported tests); CI step added |
| History wallet enrollment + durable signer | 11 tests / 2 files passed; Poker typecheck passed |
| Browser enrollment and signing journal | All 6 Chromium tests passed, including admission → checkpoint → reload/replay |
| Shuffle candidate in Chromium workers | Linked WASM release build and all 2–5 seat proof/tampering/reveal runs passed; candidate remains unaudited |
| Full Poker Foundry before invariant fixture strengthening | 245 tests / 35 suites passed; each of the two invariants completed 256 runs and 128,000 calls with zero reverts |
| Strengthened active-hand invariants | Both passed; each completed 256 runs and 128,000 calls with zero reverts against the production diamond |
| Injected wallet on Poker page | 5 Chromium cases passed after fixture account validation; actual signature recovery and EIP-712 binding checked |
| Injected settlement adapter | 15 unit regressions passed for wallet/RPC chain binding, account changes and malformed provider responses |
| Build after injected adapter changes | Root `yarn build` passed (Timestreams SPA and public library; not a Poker production entry build) |
| Follow-up after injected adapter changes | Poker typecheck and all 5 connected-wallet Chromium cases passed; browser suite covers connect/sign, not settlement transactions |
| Settlement service import boundary | All 16 adapter/service cases passed without service mocks after adding `@manamesh/poker/settlement`; Poker typecheck passed |
| Public betting replay | 17 tests and Poker typecheck passed, including unanimous signed preflop replay across 2–5 peers and all six betting actions; no live protocol integration |
| Enrolled betting in Chromium | All 10 history cases passed together; four new 2–5 seat cases combine wallet enrollment, public betting, durable signing, hostile-host rejection and reload/replay |
| Durable transcript archive | 25 history/signer/enrollment unit tests and Poker typecheck passed; expanded 13-case Chromium suite passed, including automatic recovery and closed/missing/corrupted storage |
| Concurrent archive commits | Additional focused Chromium case passed; identical writes from two tabs recover as one batch |
| Automatic archive persistence | Complete 14-case Chromium history suite passed; 25 existing unit cases plus 2 attachment regressions and Poker typecheck passed |
| WebRTC checkpoint delivery | Six adapter unit cases, focused strict TypeScript check and one focused Chromium case passed: chunked signed Poker history traveled over real local WebRTC, was independently verified/persisted, and recovered after reload |

The earlier 368-pass/two-failure Poker run began before the all-in completion fix
and loaded its new regression tests during execution. Those failures were fixed;
the subsequent 378-test full run covered those betting and enrollment fixes.
The latest full run, including acknowledgment collection, passes all 406 tests.
The passing transcript characterization intentionally reproduces the known
keyless card-tracking attack and remains evidence against production readiness.
Browser settlement transactions, hostile-host tests of the live game, installed SPA
rendering and remote CI are not yet covered by completed evidence.

The browser history harness now uses actual public Poker betting in four cases
(2–5 seats), with verified wallet enrollment before creating each signing journal.
Receivers reject a host-signed false state hash before key use, a conflicting
raise after acknowledgment and again after reload, and extra snapshot fields
without advancing history. All peers finish the preflop round at an identical
checkpoint. The runner relays signed messages and supplies the replay transcript;
this does not cover WebRTC, durable transcript storage, card operations or payouts.

The subsequent `IndexedDBPokerHistoryArchive` adds durable transcript storage
as a separate integration component. The verifier now supports a committer that
must finish before its checkpoint advances. The archive atomically writes the
batch and head, rejects stale heads and replays all saved signatures/actions from
local genesis during recovery. Browser tests resume accepted Poker betting
without a runner-supplied transcript, continue to a completed betting round, and
reject closed, missing or corrupted storage. The live Poker page still does not
use the archive. Key recovery, WebRTC, card operations and payouts remain open.
The archive now attaches persistence itself instead of relying on its caller's
factory to install a callback. It rejects an already configured writer or a
verifier whose import has begun, preventing an accidental in-memory fallback.

The injected settlement adapter now rejects a configured chain that differs
from the wallet or HTTP RPC, instead of labeling the client with the configured
chain unconditionally. It rechecks both networks and the active wallet account
before writes, rejects caller account overrides, and checks the RPC network
before balance reads. These checks cannot authenticate a malicious RPC or make
separate provider requests atomic. An initial unisolated import failed before
test collection because the transitive
`@wagmi/core` dependency lacks its `@tanstack/query-core` peer in the current PnP
graph. The service imported Poker's package root, which also loads React boards
and wallet UI. Both blockchain services now use the dedicated
`@manamesh/poker/settlement` entry point (and the existing `handId` entry point).
All 16 tests pass with the real services imported, including installation after
network validation and preserving the previous service after rejection. RPC
clients remain test doubles; no transaction was sent. This fixes the service's
unnecessary UI dependency, not the underlying optional-peer graph for consumers
that load the complete wallet UI in Node.

## Outstanding release gates

- Preserve the now-passing strict frontend and Poker typechecks in CI. Both
  commands were rerun successfully after acknowledgment collection was added.
  Local success still needs confirmation in the remote quality/release workflow.
- Complete package test runs, classify and fix failures; then typecheck/build
  affected workspaces and validate transport runtime artifacts.
- Verify the replacement root release workflow remotely, including private
  submodule access and npm trusted-publisher configuration.
- Complete the malicious-host protocol above before enabling untrusted Poker.
- Validate wallet/settlement money paths with existing injected-wallet browser
  fixtures and production Foundry deployments in local tests.
- Reconcile historical status/security/design documents with current evidence.
  The historical Poker preparedness and ManaMesh status/security reports now
  carry superseding notices; their detailed historical claims remain preserved.
- Audit remaining games and explicitly separate unsupported demonstrations from
  production entry points. A Poker fix does not certify the rest of the monorepo.


### Battleship channel and phase follow-up

The frontend now supplies the same multiplexing adapter to the Battleship board
and game transport. Signal frames have a versioned prefix, JSON encoding and a
128 KiB UTF-8 limit; malformed signal frames are discarded instead of reaching
the engine. Both peers must use this protocol version. The page selects the
opponent's channel by seat and disposes its adapter on leaving the game.

The first browser run reproduced a transport bug: automatic phase transitions
skipped `onEnd`, leaving `G.phase` at placement even after `ctx.phase` advanced.
The shared channel reducer now runs the outgoing hook (including its returned
state) before resolving the next phase, for both explicit and automatic exits,
and clears obsolete active-player stages. This is a bounded compatibility fix;
it does not establish full boardgame.io reducer equivalence.

Validation: 19 frontend adapter/transport tests and 10 shared transport tests
pass. One Chromium test connects two isolated browser contexts over real WebRTC,
commits both boards, exchanges guesses/reveals and observes a verified hit/miss
for each seat. It uses test-local signaling and a shared fixture match ID; it
does not exercise Trystero discovery, WAN connectivity or reconnection. Root
build passes; full strict frontend typecheck remains at 28 diagnostics.

Remaining Battleship blockers include manual join codes generating independent
`mb_sdp_${Date.now()}` match IDs on each device, and the lack of independently verified shot authorization before
revealing a cell. Proof validity binds the response to a board; it does not by
itself authorize disclosure. These paths need session negotiation and adversarial
protocol tests before production use. No malicious-host safety claim follows
from the successful honest-peer browser test.


### Battleship disclosure budget follow-up

The live board now rejects guess signals outside battle or the opponent's turn,
from a different claimed seat, or for a second distinct cell in the same turn.
A local guard permits exact retries and rejects turn rollback. The exported
signal helper defaults to refusing disclosure unless given an explicit local
policy. This limits cell-harvesting by a guest against an honest host; host-supplied
turn state is still unverified. The guard is in memory and resets on remount;
durable disclosure history, authenticated pending-shot agreement and adversarial
host protection remain unfinished.

All 21 Battleship package tests pass, including 11 disclosure cases. The
honest-peer Chromium WebRTC test still passes both shots. The older signal
integration test was excluded by the frontend's `src/**` pattern and imported
a removed module. It now uses the workspace public API and lives under
`src/p2p/battleship-signals.test.ts`, where the ordinary test command runs it.
Package tests still emit a pre-existing `web-worker` import error on stderr;
the passing tests do not establish worker functionality.


### Join-code codec and discovery type fixes

Native gzip tests reproduced a rejected stream write escaping the decoder's
legacy uncompressed-code fallback. Both stream directions are now consumed
concurrently with their promises observed, preserving fallback without an
unhandled rejection. New tests exercise actual native compression rather than
removing the APIs. The codec uses an owned ArrayBuffer, DHT discovery rejects
non-string offer payloads before decoding, and join-code events derive their
type from the exported channel interface. All 56 targeted tests and root build
pass. Full strict frontend typecheck now reports 25 diagnostics. These checks do
not cover live DHT bootstrap or WAN connections; decompressed input size limits
and stricter SDP/ICE schema validation remain separate hardening work.


### Bootstrap resolution and service typing

ENS discovery previously called a nonexistent public-client method and always
fell back. It now requests the text record directly; cache/ENS lists must contain
bounded nonempty address-like strings, timestamps must be valid and unexpired,
and refresh tolerates denied localStorage. These are basic input checks, not
full multiaddress or reachable-peer validation. Twelve resolver tests pass
(six failed before the fix), and 39 existing DHT tests pass. RPC responses are
mocked; this does not verify the live ENS record or fallback peer availability.

The libp2p service map now models identify and ping instances correctly. The
remaining gossip adapter assumes a pubsub service that `createNode` never
installs, and its message callback expects raw bytes rather than the service's
event object. A compatible service implementation and integration tests remain
necessary; Timestreams manual join codes remain the product default. Strict
frontend typecheck is down to 21 diagnostics.


### Signed gossip service integration

Both the shared browser node and MatchmakingService's independently constructed
node now install `@libp2p/gossipsub` 17.1.1 with StrictSign. The adapter requires
that policy, consumes `event.detail`, filters the room topic, binds JSON sender
to the verified pubsub author, rejects malformed/oversized payloads and makes
start idempotent. Stop removes listeners and heartbeat timers. The current
[upstream service API](https://libp2p.github.io/js-libp2p/modules/_libp2p_gossipsub.html)
documents the service registration and event format.

Dependency alignment deduplicates compatible versions of `@libp2p/interface`,
`@libp2p/utils`, `@libp2p/interface-internal` and `@libp2p/peer-collections`.
Initial mixed versions produced actual stream/key/collection incompatibilities;
no assertions were added to conceal those errors. All 71 targeted tests pass,
including two real libp2p nodes exchanging signed messages over loopback, adapter
identity/schema/lifecycle tests, DHT unavailable-path tests and real local Helia
multi-block file reads. Root build passes; strict frontend typecheck reports 15
diagnostics. Package installation skipped build scripts.

This establishes service availability and author binding, not complete secure
matchmaking. The admission follow-up below adds host-role checks and seat reservations.
Authenticated discovery and full browser integration remain unfinished. Loopback transport does not verify WAN mesh formation, bootstrap
availability or TURN connectivity. Poker's independently verified game history
and shuffle/decryption protocol remain separate live-integration release gates.


### Lobby host authorization and seat admission

Guests now pin the host identity from their selected table registration and
accept GameStart, GameAbort and JoinResponse only from that peer. GameStart is
accepted once while in the lobby and advances guest state to game. Admission
responses carry a recipient peer ID, so a broadcast offer cannot be consumed by
another guest. Local guest callers cannot invoke host control methods.

The host retains requests and seat offers, refuses host-seat/out-of-range or
already reserved seats, and accepts confirmation only for that peer's pending
offer. Confirmed names come from the actual join request; repeated or unsolicited
confirmations cannot overwrite the roster. Guests confirm only their offered
seat. Rejection/leave releases reservations, and stop clears admission state.
PokerLobby now selects seats from service reservations rather than a potentially
stale React player count. These wire changes require matching clients.

All 14 service/adapter tests and root build pass. Strict frontend typecheck remains
at 15 diagnostics. Service tests inject authenticated-message callbacks; real
signed pubsub delivery was validated in the preceding integration pass. This
pass does not prove the complete UI admission flow across devices.

Remaining limits: the DHT table record itself is not yet authenticated against
an independently trusted invitation; pinning a maliciously substituted record
is insufficient. Guest confirmation is not a complete host-acknowledged roster
protocol, pending offers need expiry/recovery, and host start still needs the
agreed roster/readiness barrier. These remain production work alongside Poker's
verified history and verifiable shuffle/decryption integration.


### Registry state typing and PnP import correction

GameInfo now supports distinct normal/crypto state types. A typed registration
helper checks each board/game pairing and retains literal game IDs for narrowing.
The registry no longer uses whole-game/board casts to fit unknown state. Runtime
lookup tests preserve the actual Poker/CryptoPoker games and Battleship board;
a compile-time regression rejects an incompatible board. One Piece's stale
module-type import now points to the existing frontend public module API.

The runtime registry import initially failed because wagmi 2.19.5 omitted the
query-core peer required by @wagmi/core query helpers. A version-scoped Yarn
package extension forwards the frontend's existing @tanstack/query-core peer.
No dependency version or wallet signing behavior was changed for this fix.
Registry tests and root build pass. Strict frontend typecheck now reports 13
diagnostics, all from ordinary One Piece state being passed to crypto handlers.
These failures require actual state/flow corrections rather than suppression.

The five injected-wallet Chromium checks also pass after the PnP correction:
provider injection, wallet connection, personal-sign recovery, typed-data domain
binding and rejection of another account. No funds were transferred and these
checks do not validate settlement transactions or malicious-host gameplay.


### One Piece protocol-state integration and clean typecheck

The deck-loading game entered key exchange without the public crypto fields
its handler required. It now composes the shared initializer with its existing
plaintext board zones, DON cards and configuration. The state has an explicit
`deck-loading` versus `encrypted` mode so peek operations select their intended
zone representation. Crypto handlers preserve the caller's state type; shared
proof and visibility helpers accept only the state fields they use. The main
decryption-share wrapper now declares its actual encrypted-card payload.
Initial heartbeat state no longer reads wall-clock time.

Validation: all 247 One Piece tests pass, including deck loading through both
players' public-key admission, retained board zones, deterministic initialization
and continued exclusion of private-key encryption from both network move
registries. Three local-page Chromium tests pass and root build passes. Strict
frontend typechecking passes with zero diagnostics. Early integration tests
exposed mistaken encrypted/plaintext detection by field presence; the explicit
mode fixes that regression. A first new fixture used zero leader life and ended
the game prematurely; the final test uses a playable deck fixture.

This does not complete secure One Piece: its encryption phase remains blocked
until validated public layers and client preparation exist. Mode-less saved
states need an explicit migration/compatibility policy, and transcript replay,
actor binding, proof checks and private-zone handling still require production
work. Clean types do not authorize using the game with untrusted peers.

The complete frontend Vitest run after these changes passes all 671 tests in 54
files (56.87 seconds). Together with the clean strict typecheck this resolves
the current frontend diagnostics/test baseline; it does not establish complete
malicious-host resistance, network recovery or production settlement behavior.

### Poker acknowledgment collection boundary

Added PokerHistoryProposal to the public verified-history entry point. The
collector independently reviews an actor-signed action, bounds acknowledgment
input, checks exact envelope fields, binds each signature to its admitted seat
and this action, and refuses incomplete or stale checkpoint assembly. Duplicate
valid votes do not count twice; invalid votes do not consume a seat. Commit uses
the existing verifier and awaits its configured archive before advancing state.
Persistence failure retains the complete collection for retry without changing
history. No host state snapshot or private key enters this API.

Nine new collector cases plus existing verifier/signer tests pass (26 total).
The browser archive fixture now uses the actual collector instead of manually
assembling signature arrays; it first rejects a forged seat signature, then
collects valid votes. All 15 browser history/signing tests pass, including real
WebRTC checkpoint delivery and recovery. Poker/frontend typechecks and root
build pass. Durable journal behavior remains covered by the browser tests;
collector unit tests use a test journal, not disk persistence.

The live Poker page still constructs PokerGame with the host-authoritative P2P
transport. The collector is a necessary proposal/ack assembly boundary, but
proposal/ack transport, verified deck progression and UI integration are still
missing. No production malicious-host safety claim is made.


### Poker proposal and acknowledgment transport — 2026-09-06

The dedicated history channel now carries reviewed proposals and acknowledgments
as bounded `{type, wireJSON}` envelopes inside its existing ordered frames.
Checkpoint arrays retain their existing wire format. Proposal delivery invokes
independent signature verification and local replay before emitting an event.
Acknowledgments require a pending proposal and the admitted seat's signature;
unknown message types, unsolicited votes, forged seat claims and stale proposals
are rejected. One pending proposal per local head prevents replacement during
collection. Advancing history invalidates that pending proposal.

There is no automatic signing in this transport. Callers explicitly use the
journal-backed signer and send its acknowledgment; the recipient verifies it
before counting it. The existing bounded assembly, timeout, one-verification
limit, close cleanup and send backpressure apply to all message types. Send
completion means queued, not accepted: callers must observe application-level
progress before sending further messages. Withholding still requires a defined
abort/recovery policy.

Validation: root build, eight channel unit tests, strict frontend typecheck, and all 16
Chromium history/signing tests pass. The new real-WebRTC case exchanges a
proposal and both votes, rejects a signature claiming another seat, commits only
after unanimity and recovers the persisted checkpoint after reload. Its expanded
focused rerun also rejects host-signed fabricated state before any signing and
rejects proposal replay after commit. Test setup still enrolls the roster through
fixture controls; the live Poker page and verified dealing remain unintegrated.

### Poker multi-peer vote convergence — 2026-09-06

The first proposal-channel implementation kept a separate collector per socket.
At a three-to-five-seat star table, votes arriving on different host sockets
would therefore remain split. Channels now share an inbox by local
VerifiedPokerHistory object identity. Independently replayed player histories
remain separate even when their session IDs match. Concurrent announcements of
the same proposal share verification; a competing proposal cannot replace it
while verification or collection is pending. Closing one socket leaves the
history's accepted votes available to surviving connections. A committed head
invalidates the old pending collector.

Eleven channel tests pass, including three-to-five-seat signature collection,
concurrent conflicting proposals, independent history isolation, and preserving
votes after a socket is disposed. All 19 Chromium history tests pass (24.1s).
The three new browser cases use separate WebRTC links, independently enrolled
histories, durable signers and archives. They withhold the final seat, verify
that commit fails without advancing history, then deliver its vote and verify
identical persisted checkpoints at every peer plus reload recovery. Strict
frontend typecheck and root build pass.

The initial browser fixtures incorrectly reused wallet keys as session keys;
enrollment rejected all three before networking. The corrected fixtures use
separate keys, preserving that production admission requirement. Browser
controls still establish signaling and explicit signing; this is transport
integration evidence, not a completed live Poker UI or verified full hand.

### Shuffle candidate public-byte boundary — 2026-09-06

Added an isolated strict decoding and roster-admission adapter to the pinned
shuffle experiment. Native checks at 2–5 seats pass after serialized public
values are decoded and proofs verified locally. The harness reproduces a
material admission-policy gap: the candidate ownership verifier accepts an
identity public key with a trivial proof. The adapter rejects identity keys
before accepting that proof, rejects duplicate roster keys and invalid contexts,
and checks for an identity aggregate key. Fixed payload sizes, validated
canonical decoding, complete consumption and exact re-encoding bound the public
byte interface. No secret-key or `Verified` decoder is exposed.

See [adapter evidence and remaining limits](../experiments/poker-shuffle/README.md#strict-public-byte-adapter--2026-09-06).
A dedicated cancellation regression also passes: two nonidentity public keys
with valid seat-bound ownership proofs sum to identity and are rejected. Its
controlled key-generation randomness is confined to the adversarial fixture.
Independent worker integration, session/encryption-key binding, full verified dealing,
reveal authorization and external review remain required. This change adds no
runtime Poker dependency and makes no production security claim.

### One-secret-key-per-worker shuffle evaluation — 2026-09-06

The candidate now has a separate worker harness with one player key per WASM
instance. Public announcements, decks, proofs and non-owner reveal tokens pass
through the strict byte decoder and local proof verification at each peer.
Invalid or replayed shuffles cannot advance the deck. The fixed fixture policy
refuses premature reveals and prevents exporting card zero's owner's final
contribution; only that worker can combine all contributors and open the card.
Wrong-contributor and duplicate tokens are rejected.

The linked 351,457-byte WASM module passed Chromium checks at every seat count
2–5, with one private card opened per table. Complete checking workloads took
2.341, 4.594, 7.737 and 11.711 seconds respectively. These are single-run
whole-workload measurements, not production latency targets. See the
[worker boundary, reproducible commands and raw results](../experiments/poker-shuffle/wasm/peers/README.md).
The native codec reproduction was also adjusted to keep its helper module under
an example subdirectory, so Cargo does not discover it as a standalone binary.

This is still an isolated experiment. Workers share a trusted test page and use
fixture session contexts and a fixed card-owner rule. Authenticated session and
encryption-key binding, transcript-derived contexts, real dealing/reveal rules,
recovery, live Poker integration and independent review remain outstanding.

### Worker session and transcript contexts — 2026-09-06

Replaced the shuffle worker's fixed proof contexts with version-two contexts
bound to a nonzero 32-byte session commitment, stage, seat and local transcript
head. The worker accepts the session only at initialization. It hashes the
ordered admitted announcements into the initial head, and each verified shuffle
commits its predecessor, step and exact public deck/proof bytes into the next
head. Reveal proofs bind the final head and the fixture's card/owner policy.

The WASM release build and Chromium checks pass at 2–5 seats. A foreign-session
worker's ownership proof is rejected without consuming its claimed seat;
all-zero sessions and replacing an initialized session are rejected. All player
workers independently derive matching digests after admission and every shuffle.
Existing duplicate-card, replay, contributor binding and owner-only opening
checks still pass. Raw results and module hash are recorded in the
[worker evaluation](../experiments/poker-shuffle/wasm/peers/README.md#session-bound-results--2026-09-06).

Binding to a supplied commitment does not authenticate that commitment. The
worker still needs wallet-admitted session/encryption-key roster integration,
full Poker dealing and reveal authorization, recovery, and independent review.
No live Poker path uses this experiment yet.

### Signing-identity binding for encryption rosters — 2026-09-06

Added PokerEncryptionRoster to the verified-history package entry point. Every
admitted signing identity authorizes the same protocol digest and exact ordered
public announcements under the Poker session domain. The bounded, immutable
roster is independently expected; signature verification rejects changed terms,
missing seats and signatures claiming another seat. Local signing requires the
seat's announcement to match the worker's locally supplied announcement, and
refuses a history that has already started.

A separate durable journal namespace binds the Poker session and encryption
admission purpose, intentionally excluding the proposed roster and protocol.
Changing either therefore conflicts with the existing claim, while leaving the
gameplay journal and sequence one available. Storage failure prevents signing;
a rejected signing request retains its claim. The existing missing/replaced
journal checks apply to recovery.

Nine authorization unit cases pass, with actual signatures at 2–5 seats. All 20
Chromium history tests pass, including a new enrolled-roster case that reloads,
rejects a substituted roster before key use, retries the original authorization,
and successfully advances gameplay sequence one. Poker/frontend typechecks and
root build pass. Authorization fixtures deliberately use opaque test bytes and
do not claim to validate encryption proofs.

The shuffle worker must still validate ownership/curve/aggregate proofs, and
its integration must enforce both that validation and unanimous authorization
before dealing. This class is not yet connected to the experimental worker or
the live Poker page; full dealing, recovery and independent review remain gates.

### Worker proof checks joined to signing admission — 2026-09-06

Added an experimental frontend adapter that owns the pinned candidate worker,
initializes it with the wallet-admitted history's session ID, and validates the
ordered encryption announcements before exposing roster signing. The worker's
own generated announcement must match its local seat. Every admitted signing
identity must authorize that same roster before the adapter permits shuffle or
reveal operations. Raw worker access and caller-supplied authorization flags are
not exposed. Module bytes are copied and checked against the evaluated SHA-256;
requests are bounded and serialized, with termination on errors/timeouts.

Four Chromium cases passed at 2–5 seats in separate browser contexts, combining
actual wallet enrollment, worker proof checks, durable roster signatures, all
shuffle proofs and owner-only opening of the fixture's private card. Modified
module bytes, own-key substitution and forged roster signatures are rejected.
A focused strengthened two-seat rerun also passes malformed-ownership-proof
rejection: the adapter closes and cannot request another signature. Strict
frontend typecheck and root build pass.

The [adapter contract and reproduction instructions](../packages/manamesh/packages/frontend/src/p2p/experimental/README.md)
identify the remaining scope. Its tests need POKER_SHUFFLE_WASM and otherwise
skip; the ordinary CI workflow does not build this experimental artifact yet.
The live Poker page still does not use this adapter. Full dealing, signed-history
checkpoint integration, reveal authorization from Poker rules, recovery, aborts
and independent review remain required.

### Pinned shuffle build and CI coverage — 2026-09-06

Added scripts/build-poker-shuffle.py and a dedicated poker-shuffle quality job.
The builder checks the source archive SHA-256 before extraction, exact Rust
1.96.0 compiler, locked dependency graph and expected WASM digest. It bounds and
validates archive entries, writes a new artifact directory with provenance and
candidate notices, and supports verified local archives/offline dependencies.
The adapter now pins the reproducible 329,706-byte module rather than the earlier
manual build. No automatic pin updates or hash bypass are provided.

Initial fresh-directory builds differed despite path remapping and stripping.
Compiler metadata still varied: replacing Cargo's generated metadata with stable
package-name/version metadata resolved the local difference. The first compiler
wrapper also closed Cargo's jobserver descriptors; process replacement fixes
that diagnostic. Three final fresh builds match byte-for-byte; the last enforced
the reviewed digest. A bad source archive was rejected without an output artifact.

All four wallet-admission browser cases and standalone worker checks at all
2–5 seat counts pass against the new pin. Build-script
syntax and workflow YAML parse checks pass. The new CI job installs the pinned
compiler, builds/verifies the artifact, runs standalone worker and admission
browser tests, and retains provenance. CI collection without an artifact now
fails, while local optional runs can still skip. Earlier notes that CI has no
shuffle build are superseded by this configuration change.

Remote Linux CI and cross-host reproducibility have not yet been demonstrated.
The protocol remains experimental: full dealing, checkpoint/reveal integration,
recovery, live Poker wiring and independent security review remain release gates.


### Full regression baseline and canonical hole dealing — 2026-09-06

A fresh full frontend run passes 676 tests / 54 files (67.79s); a full Poker run
before the deal-order correction passes 415 tests / 31 files (172.18s). These
include the recent roster authorization and peer-channel changes. No test
failures or unhandled runner errors were reported by either completed run.

Inspection found mismatched hole dealing: ordinary Poker gave each player two
consecutive draws; legacy crypto Poker dealt in rounds but always started at
seat zero. Added a frozen canonical deal plan and made both paths deal one card
per seat per pass starting left of the button. It includes hole, burn and board
positions without card values or decryption authority. The heads-up button gets
the last card, consistent with the [TDA rules](https://www.pokertda.com/view-poker-tda-rules/).
Tests cover layout partitioning and every button position at representative
sizes through nine seats, with actual ordinary/crypto helper routing and
non-numeric player IDs. An initial test cleanup callback returned Vitest's utility
object; a block body fixes the resulting type diagnostic.

Twenty targeted dealing/security/characterization tests, Poker/frontend
typechecks and root build pass. The passing characterization still reproduces
the known transcript attack. This correction does not make legacy crypto safe,
fix its missing community burns, change the verified protocol's 2–5 seat limit,
or replace the worker's fixed private-card rule. Existing dealt hands and old
transcripts must retain their original interpretation.


The complete Poker rerun after the deal-order correction passes all 426 tests in
32 files (134.70s), including the encrypted-game adversarial workflows. Combined
with the 676-test frontend run, clean typechecks and successful build, this
refreshes the local regression evidence. It still does not certify live Poker
against a malicious host or replace the outstanding protocol/release gates.


### Canonical private-hole worker policy — 2026-09-06

Replaced the isolated worker's fixed position-zero/seat-zero fixture with both
hole cards for every seat at 2–5 players. Each client supplies its independently
agreed dealer; version-three contexts bind that dealer into every ownership,
shuffle and reveal proof. The adapter also binds the immutable canonical deal
plan into the unanimously signed encryption-roster protocol digest. A host
cannot reuse those keys/proofs with a different deal order.

Only a card's owner accepts contributions and opens it, after verifying every
other seat's contribution. The owner's final contribution stays inside its
worker. Wrong-card/contributor proofs, duplicates, premature opening and every
non-hole position are refused. The standalone Chromium runner opens all 4/6/8/10
hole cards at 2/3/4/5 seats, verifies uniqueness through a test-only oracle, and
passes its hostile-input checks including foreign-session/dealer rejection.
Two fresh builds yield identical 335,319-byte WASM artifacts; the adapter and CI
pin are updated to `178ba8e7535ac0acb0557fb57d98d8899ad282c2914420a72171cd7ca9e73931`.

This does not authorize community-card reveals or showdown, connect betting
checkpoints to deck transitions, provide recovery/abort handling, or replace the
live host-authoritative Poker page. External review of the cryptographic
candidate and remote CI remain outstanding. No claim of production readiness
follows from these experimental checks.

Validation after this change: four wallet-admitted Chromium cases pass (2–5
seats, every owner's two cards), frontend typecheck passes, and root build
passes. The tracked root Timestreams HTML was preserved across the build. These
focused checks supplement the preceding complete Poker 426-test and frontend
676-test runs; those full suites were not repeated for this isolated worker change.


### Short opening all-in consistency — 2026-09-06

Investigation of later-street betting found a shared-rule inconsistency: an
opening `bet` of an entire stack smaller than the big blind lowered `minRaise`
and reset other players' action flags, while the equivalent `allIn` retained the
full-bet threshold. The verified betting parser then rejected the `bet` result
with `round_amount`. Two regression cases failed before the fix, while the
corresponding short `allIn` and full opening wagers already passed.

`processBet` now updates the full-raise threshold and reopens prior actors only
for a full opening bet. This matches the existing all-in path and
[TDA rule 47](https://www.pokertda.com/view-poker-tda-rules/).
Tests cover identical resulting states through both actions at short, exact and
above-minimum amounts, plus later-street replay with legal calls, minimum raises
for players yet to act, and closed raising rights for prior checkers. All 81
focused betting/replay/game-security tests pass. This fixes a shared rule needed
for public-street integration; it does not add a reveal or street-advance API.

The complete Poker rerun after this correction passes **431 tests / 32 files**
(exit 0, 152.15 seconds). Poker typecheck also passes. No failure or unhandled
runner error was reported. Full-hand verified progression remains outstanding.


### Unanimous final-deck agreement before private decryption — 2026-09-06

Added a separate final-deck signing statement to the admitted encryption roster.
It binds session, protocol/deal plan, ordered encryption roster, locally verified
transcript digest and seat identity. The durable encryption-admission journal
uses slot one for roster approval and slot two for final-deck approval. Neither
the proposed deck nor changed roster/protocol creates a different namespace, so
competing approvals conflict before another key invocation. Gameplay sequence
one remains available in its separate journal.

The experimental adapter counts only successful native shuffles and reads the
final digest from its own worker after every seat has contributed. No API accepts
a host's proposed head for signing. Private token generation, acceptance and
opening remain disabled until every signing identity approves that exact local
digest. Incomplete/forged approvals, old roster signatures and changed-deck terms
are refused. This closes the gap between individually valid shuffle proofs and
unanimous agreement on one deck; it does not add public reveals or permit the
public betting replayer to bypass future outer-protocol phase checks.

The native worker and artifact pin are unchanged. Durable deck-certificate
archiving/recovery, private-deal completion, full-hand betting transitions,
public reveals, live networking/UI and independent audit remain required.

Validation: 21 targeted roster/deck and history-signing unit tests pass, including
rejection when gameplay advances during journal or signing awaits. Four Chromium
cases pass at 2–5 seats (3.2 minutes) with actual wallet admission, IndexedDB
claims, every shuffle, final-deck authorization and both private cards for every
seat. Forged/incomplete deck certificates and roster signatures cannot unlock
decryption. Poker/frontend typechecks and root build pass; tracked root
Timestreams HTML remains unchanged. An initial Vitest mock lost viem's generic
signer signature; a typed forwarding wrapper fixes that test-only diagnostic.
The prior full 431-test Poker run predates these nine additional deck cases; it
was not repeated for this isolated authorization change.


### Certified private deal to signed preflop — 2026-09-06

Added `PokerDealtBettingReplay` with a locally derived `awaitingDeal` genesis,
immutable dealer/stacks/blinds terms and a one-time binding to the independently
verified final deck. The only initial transition is the dealer's `beginBetting`
action carrying every seat's private-deal receipt. Receipts have their own typed
signature domain and claim journal slot three; roster/deck claims and gameplay
positions remain separate. They bind the accepted deck and identity without
publishing private cards.

The experimental adapter tracks successfully opened canonical positions and
refuses to sign a receipt until both owner hole cards have opened. The outer
replayer rejects betting before the deal certificate, wrong certificate types,
missing receipts, wrong-deck terms and injected state. After the unanimous
history transition, preflop betting is independently replayed while preserving
the accepted deck digest. The existing history archive stores this signed
transition and its public receipt certificate.

Recovery of the encryption roster/deck proof binding is still missing, and no
worker secret recovery, public reveal, next street, showdown, payout or live-page
integration is supplied here. The standalone betting sub-state helper remains
insufficient for malicious-host protection. See Poker's
`docs/DEALT_BETTING_REPLAY.md` for the trusted binding contract and limits.

Validation: 25 targeted receipt/replay and encryption-authorization tests pass.
Four admitted Chromium cases pass at 2–5 seats (1.2 minutes), each completing
native shuffle verification, unanimous deck approval, all private hole openings,
private-deal receipts, the unanimous begin-betting checkpoint and a complete
preflop call/check round. Every peer reaches the same history head and pot.
Poker/frontend typechecks and root build pass; root Timestreams HTML is preserved.
The complete Poker suite was not repeated for this isolated outer-boundary change.

A focused two-seat rerun also passes after adding the repeated-opening attack:
opening the first local hole position twice returns the same card and still
refuses a private-deal receipt until the other hole position is opened.


### Checkpoint-authorized flop decryption — 2026-09-06

The certified-deal replayer derives a frozen flop request only from its exact
bound local history after a committed, complete and contested preflop round.
The experimental adapter verifies the bound deck and canonical positions before
authorizing its private worker. It accepts no host-supplied checkpoint argument,
refuses stale authorization and exposes public tokens only while that checkpoint
remains current. Uncontested hands do not authorize a flop.

Version-four native contexts bind each flop contribution to session/dealer,
final deck transcript, betting checkpoint, canonical position and contributor.
Each peer independently verifies all contributions and requires every seat's
token before opening a public card. Public APIs refuse private-hole, burn,
turn and river positions; owner-only private APIs retain their original policy.
The native fixture itself does not interpret Poker rules: the trusted adapter
owns that permission check. A synthetic two-seat checkpoint fork demonstrates
that otherwise valid contributions from different checkpoints cannot combine.

This opens verified flop plaintexts, but does not yet commit them to public
history or start postflop betting. Later streets, showdown, proof recovery,
live-page integration and external review remain outstanding. The experimental
artifact/CI pin is now `5d0b07d6b3489b578b64cf233e1d9087403f65c99bbaa24542e004613a6fbddc`.

Validation: eight certified-deal/reveal-permission tests pass; both typechecks
and root build pass. All four isolated worker cases pass, including divergent
checkpoint rejection at two seats and matching public openings at 3–5 seats.
All four wallet-admitted browser scenarios pass (2–5 seats, 1.5 minutes), opening
the same three distinct flop cards only after the committed preflop round.
Two fresh builds produce byte-identical 342,120-byte artifacts, with the second
build enforcing the expected digest. Raw provenance and worker results are in
`experiments/poker-shuffle/wasm/peers/flop-*-2026-09-06.*`. Root Timestreams HTML
is preserved; Linux CI and external security review are still unverified.


### Signed verified flop and postflop betting — 2026-09-06

The version-two certified-deal state now includes street, community cards and
hand-wide contributions. After all canonical flop positions open, the adapter
binds only its cached native outputs to the replayer at the exact authorized
checkpoint. It accepts no host-card argument. The dealer's `revealFlop` proposal
must match every peer's own local proof-checked values and order before that
peer signs. Missing evidence, modified cards, duplicate transitions, stale or
replacement bindings and wrong actors are refused.

The unanimous history transition preserves pot/stacks and hand-wide investment,
then resets street bets, action flags and the full-bet floor. Action starts left
of the dealer, skipping folded/all-in seats. If at most one player has chips,
postflop betting is already complete so the client cannot invent a dry side pot.
Later bets update each seat's hand-wide contribution from its agreed initial
stack and current balance. Turn/river, showdown, proof-binding recovery and live
Poker integration remain outstanding.

The new outer genesis deliberately differs from the previous experimental
format; old archives must not be reinterpreted. Native WASM/proof formats remain
unchanged. Two initial test failures came from Vitest spreading stack-array rows
into separate arguments; object-shaped fixtures fix both the runtime roster
error and the corresponding TypeScript diagnostic.

Validation so far: 30 focused betting/transition tests pass, including immutable
flop binding, stale/wrong-card refusals, correct heads-up/multiway action order,
folded/all-in skipping and dry-side-pot prevention. Four wallet-admitted Chromium
cases pass (2–5 seats, 1.7 minutes), rejecting a changed board before signing and
reaching identical persisted heads, public cards, pots and contributions through
flop betting. Poker/frontend typechecks and root build pass, with the tracked
root Timestreams HTML preserved.

The complete Poker regression run passes **453 tests / 33 files** (exit 0,
172.45 seconds), including all accumulated certificate, private-deal and flop
transition tests. No failure or unhandled runner error was reported.


### Verified turn, river and all-in runout — 2026-09-06

Extended the certified-deal boundary and experimental worker adapter through
turn and river. Each next-street request comes from the exact bound local
committed history after complete contested betting. The version-five native
worker authorizes stages sequentially, requires the previous public cards to
have opened, and accepts only the active street's canonical positions. Proofs
bind the fresh betting checkpoint, final deck, position and contributor; old
street proofs cannot be transplanted. Burns remain inaccessible.

Local verified output is bound once for each street. `revealTurn`/`revealRiver`
proposals must match that evidence before signing, retain the board and all
hand-wide contributions, and reset betting consistently. The version-three
outer state intentionally creates new experimental sessions; old archives are
not reinterpreted. Showdown, outcome verification, recovery and live Poker
integration remain incomplete. Native/CI pin:
`c55eb991320be9c5abec87e503499f64bfea6ab8c97cffe600dfc0f036d2d21b`.

Validation: 31 targeted betting/replay tests pass, including a complete unequal
all-in runout preserving contributions `[10, 2, 10]`. All four isolated worker
cases pass: the divergent two-seat fixture cannot progress, while matching
3–5-seat fixtures open all five public cards. Four admitted Chromium scenarios
pass at 2–5 seats (1.8 minutes), including positive heads-up progression, forged
turn/river card rejection, premature/old-position refusals and identical signed
heads, pots and contributions through river betting. Poker/frontend typechecks
and root build pass; tracked root Timestreams HTML is unchanged.

Two fresh builds produce identical 342,174-byte modules; the second enforced the
expected digest. Provenance and raw worker results are under
`experiments/poker-shuffle/wasm/peers/streets-*-2026-09-06.*`. The prior full
453-test Poker run predates this turn/river extension; focused and browser checks
cover the new paths. Remote Linux CI and independent audit remain unverified.


### Pot accounting and uncontested completion — 2026-09-06

Added immutable gross-chip allocation using hand-wide contributions. Folded
chips remain in the pot while folded hands lose eligibility. Uncalled excess is
returned separately. Folded contribution boundaries with unchanged eligibility
are merged before splitting, avoiding repeated odd-chip rounding; genuine side
pots remain independent even when the same hands tie in each. Odd chips follow
winning-seat order left of the button, consistent with
[TDA rules 20–21](https://www.pokertda.com/view-poker-tda-rules/).
Tests cover main/side pots, folded money, uncalled excess, ties, the maximum safe
chip total, and exhaustive small heads-up accounting. No host hand ranking is
trusted by this helper; contested integration must supply locally verified ranks.

The version-four certified-deal state supports `finishUncontested` after complete
betting leaves exactly one live hand. Every peer derives awards/refunds, credits
final in-game stacks and zeros the pot; extra payout fields and all subsequent
actions are refused. No private or public card disclosure is needed. Gross-chip
results still need rake/token-scale/wallet/contract integration, and contested
showdown remains unfinished. The live Poker page retains its legacy engine.

Validation: the full Poker suite passes **466 tests / 34 files** (exit 0,
152.53 seconds), including 11 allocation tests and 11 certified-deal/result
cases. Five admitted Chromium scenarios pass (1.4 minutes): four tables complete
all betting streets, and one derives an uncontested result with zero pot and no
board disclosure. Both typechecks and root build pass; root Timestreams HTML is
preserved. The native artifact pin is unchanged. Independent audit, contested
showdown, proof/key recovery and live settlement integration remain open.


### Verified contested showdown — 2026-09-06

The experimental version-five dealt-betting replay now completes contested
hands. Version-six native contexts authorize eligible hole-card contributions
only after the adapter derives a completed river checkpoint and folded-seat
mask. Every peer requires all local proof-verified public openings before
binding showdown evidence. Previously opened private cards cannot satisfy this
public gate. Folded hands remain unopened and ineligible for awards.

Each proposed `finishShowdown` must match the peer’s bound evidence exactly.
The canonical standard-deck mapping and existing hand evaluator derive ranks
locally; side-pot allocation derives awards/refunds without host-supplied
strengths or amounts. Duplicate cards are rejected, total chips are conserved,
and the completed state refuses further actions.

Validation: **470 tests / 35 files pass** in the full Poker suite (exit 0,
210.85 seconds). **Six Chromium cases pass** (2.9 minutes): 2–5-seat contested
showdowns, an uncontested hand and a folded-hand showdown. Revealed values
match earlier private openings; forged hands are rejected before signing.
Isolated native-worker checks also pass. Poker/frontend typechecks and the root
build pass; the tracked generated HTML was restored after building.

Two fresh local native builds produce the identical 344,658-byte artifact,
SHA-256 `464f2e912436fea13371b825c8b85020d6dfd93e6c05134e9868984ffde7581c`.
Runtime and CI pins now require it. Build provenance and raw-worker results are
recorded under `experiments/poker-shuffle/wasm/peers/showdown-*2026-09-06.*`.
Cross-host reproduction and remote CI remain unverified.

This supersedes earlier statements that contested showdown is unimplemented
**in the experimental path**. The live Poker page still uses its legacy
host-authoritative engine. Production still requires live integration, proof
and key recovery, timeout/abort policy, independent cryptographic review and
fee-aware settlement authorization. All-in tabling currently occurs after river
runout; earlier tabling rules remain to be implemented and validated.


### Join-code history channel routing — 2026-09-06

The live join-code wrapper previously routed every incoming RTC data channel
as the game channel. A second channel could replace the original routing.
`PeerConnection` now retains the original reliable `game` channel and accepts
only explicitly registered dedicated labels. It closes unknown, duplicate,
unordered and partially reliable channels. At most four dedicated registrations
exist per connection; disposed slots cannot be remotely revived. Connection
cleanup closes all admitted channels.

`JoinCodeConnection` exposes registration and opening so the existing
`PokerHistoryChannel` can attach to the actual lobby connection. Both peers must
register before the agreed initiator opens; readiness coordination is still a
live-session integration requirement. Labels are routing, not authenticated
identity or permission to sign.

Validation: **26 targeted WebRTC/history unit tests pass**; **one Chromium
join-code integration case passes** (9.1 seconds including startup). The latter
uses real compressed offer/answer codes and production connection wrappers in
two browser contexts. A signed counter-history checkpoint is verified while
game messages stay separate; malformed history frames are rejected. It does
not represent a complete live Poker hand. Frontend typecheck and root build
pass. The generated tracked HTML was restored after building. The new browser
case is included in the quality workflow; remote CI has not been run.

See `packages/manamesh/packages/frontend/src/p2p/POKER_JOIN_CHANNEL.md` for
connection ownership, ordering and disposal requirements. Live Poker remains
host-authoritative until admission, readiness, proof exchange and verified UI
progression are integrated.


### Automatic join-code history readiness — 2026-09-06

`connectPokerHistory` now coordinates dedicated-channel registration and opening
for already admitted peers. The lower-numbered seat opens only after a matching
registration announcement. Both ends then confirm session, checkpoint, seat
direction and fresh hello/ack nonces on the dedicated reliable channel before
exposing `PokerHistoryChannel`. History input during this handshake is rejected;
no automatic signing or state import occurs. Announcements retry every 500 ms;
startup times out after 20 seconds and cleans up on failure/disposal. There is
no host-state fallback. Readiness is delivery coordination, not identity proof.

Validation: **25 unit tests pass** (14 readiness and 11 history-channel cases).
**Two Chromium join-code cases pass** (23.2 seconds including startup), including
automatic startup when the responder registers late. Signed checkpoint delivery
and separate game-message routing both remain intact. These are two-seat
transport fixtures, not full live Poker sessions. The helper still needs live
admission/lobby wiring and 3–5-seat session orchestration with proof exchange.

Frontend typecheck and root build also pass for this readiness change. The
tracked generated HTML was restored after the build.


### History connection termination — 2026-09-06

The join-session helper now retains terminal monitoring after readiness.
Its non-rejecting `closed` promise resolves once with the first closure reason,
and callers can stop actions after a remote close/error or local disposal.
The history adapter exposes a matching terminal event and boolean, rejects
subsequent sends and removes listeners. Disposing either adapter or session
ends the session and releases its channel registration. Startup failure rejects
readiness and resolves closure with the same error.

Validation: **33 unit tests pass** (19 readiness/lifecycle and 14 history-channel
cases). **Two Chromium join-code cases pass** (20.2 seconds including startup),
now checking remote shutdown after a verified checkpoint: the surviving peer
clears readiness and refuses further sends. The first browser run exposed an
overly specific test expectation: Chromium emitted RTC error before close.
The corrected assertion accepts either terminal reason while retaining both
behavioral requirements. Frontend typecheck and root build pass; generated
tracked HTML was restored. No production protocol failure was suppressed.

This supplies lifecycle notification, not recovery or an authorized refund.
In-flight verified persistence may finish after transport closure. Live UI
wiring must observe this terminal signal; full-session orchestration, proof
exchange, recovery and abort/settlement policy remain incomplete.


### Join-code table coordinator — 2026-09-06

`connectPokerHistoryTable` now owns all local history links for a 2–5-seat star
table. It validates the complete local topology before registering channels,
waits for every local link, and closes sibling protocol links on any failure.
Partial construction failures and explicit disposal also release already-started
links. Its returned peer/channel entries are frozen. Guest readiness covers the
relay link only; it is not evidence that every participant is ready or has voted.

The 3–5-seat history fixtures now use production `JoinCodeConnection` offer/answer
codes and the automatic table coordinator instead of raw RTC setup. They retain
wallet admission, independent replay, durable journals and archive recovery.
Withholding the last vote still prevents commit. After unanimous approval, all
peers reach the same checkpoint. Disconnecting one guest closes the honest
relay's remaining history links and reaches every surviving guest. A malicious
relay can withhold notification; unanimous history still refuses progress
without the absent seat's signature.

Targeted validation: **27 unit tests pass** (8 table coordinator and 19 peer
readiness/lifecycle cases), **three 3–5-seat Chromium table cases pass** (28.9
seconds including startup), and frontend typecheck/root build pass. The tracked
generated HTML was restored. These fixtures exercise a signed betting action,
not a complete cryptographic hand. Live lobby admission and proof exchange,
verified UI progression, recovery and abort/settlement policy remain open.

The complete history/join-code Chromium suite also passes **22 cases**
(exit 0, 1.6 minutes), including wallet enrollment, conflicting-signature
refusal, durable journal/archive recovery and the migrated table fixtures.


### Public shuffle proofs over join-code channels — 2026-09-06

The experimental full-hand fixtures now deliver every seat's public shuffle
proof over production join-code history channels. The actor generates its proof
inside its local worker. Guests send to the relay; the relay verifies locally
before forwarding, and every other receiver verifies independently. The runner
triggers steps and observes completion but no longer relays shuffle-proof bytes.

`PokerHistoryChannel` accepts bounded artifacts only with an explicitly
registered local asynchronous verifier. It emits acceptance after verification
and a current-checkpoint check; unsupported, invalid or stale artifacts close
the channel and its owning table. The shuffle adapter checks exact schema,
session/checkpoint, seat range and the 8,979-byte proof encoding before invoking
the native verifier. No artifact message imports game state or signs anything.
Roster and final-deck certificates remain separate unanimous gates.

Validation: **26 unit tests pass** (18 history-channel and 8 shuffle packet
cases). Frontend typecheck and root build pass; tracked generated HTML was
restored. **All seven browser scenarios have passing evidence across the main
run and focused reruns**: full 2–5-seat showdown, uncontested completion,
folded-hand showdown and tampered peer-shuffle refusal. The tampered proof is
rejected by the real native worker, produces no acceptance, closes the table
and cannot obtain additional deck signatures.

The initial six-case run had five passes and a four-seat overall timeout at
120 seconds under observed machine contention. An attempted retry was
interrupted by a Vite reload caused by an agent comment edit. With the source
held steady, the four-seat case passed in 40.2 seconds with the same deadline
(exit 0; 56.2 seconds including startup). The tampered-proof case passed in
27.0 seconds. No protocol assertion or timeout was weakened. The precise cause
of the original timing overrun is not proven; remote CI timing remains a gate.

Private/public decryption contributions and approval certificates still travel
through fixture-controlled delivery, and live Poker remains host-authoritative.
Production still requires those exchanges, live admission/UI integration,
recovery, abort/settlement policy and independent cryptographic review. The
underlying shuffle candidate is still unaudited.


### Public decryption proofs over peer channels — 2026-09-06

The experimental proof-channel adapter now accepts a separate bounded
`public-contribution-v1` packet. Its 131-byte contribution/proof pair, contributing
seat, position, session and checkpoint are checked before native work. The local
admission adapter must already authorize that position for the current street
or showdown; a packet cannot grant reveal permission. The worker verifies the
contribution before the channel records acceptance or the relay forwards it.
Unknown/private-contribution packet types remain refused.

Flop, turn, river and eligible showdown contributions now travel through actual
join-code channels in the full-hand fixtures. The runner prepares/triggers sends
and observes verified receipt, without relaying public contribution bytes.
Missing contributions still prevent opening. Folded hands remain unopened,
and burns/future positions remain unavailable. Private hole-card contribution
routing and roster/deck approval delivery still need production integration.

Validation: **36 unit tests pass** (18 history-channel and 18 shuffle/public-proof
packet cases), frontend typecheck and root build pass, and **all eight Chromium
scenarios pass in one uninterrupted run** (exit 0, 9.6 minutes including startup).
This includes 2–5-seat complete hands, uncontested and folded-hand outcomes,
tampered shuffle refusal, and native rejection of a tampered flop contribution.
The latter closes the table, records no verified receipt, leaves the flop
unbound and produces no further signature. Source remained unchanged during
the browser run; protocol and test deadlines were unchanged. Tracked generated
HTML was restored after building. The native artifact itself did not change.

These results supersede the earlier partial-run evidence for this browser suite.
They do not establish remote CI timing, cryptographic audit completion, private
recipient routing, live UI/admission integration, recovery or settlement safety.
The live Poker page remains on its legacy host-authoritative path.


### Private contribution review and peer delivery — 2026-09-06

Version seven adds native `review_token`: it validates a non-owner contribution
using the admitted public key, final encrypted deck and owner/position context,
returns no output, and retains no decryption token. The existing owner-only
receive path shares the validator but retains the verified share. Owner-final
token export and non-owner card opening remain refused. Review does not invoke
the reviewer's secret key or populate its opening cache.

The frontend routes a private contribution using its immutable local deal plan:
the owner receives/stores it; every other seat reviews it without retention.
The relay forwards only after verification. The browser runner now triggers
private sends and observes receipts without carrying their bytes. These packets
contain no plaintext card or owner-final contribution. Receipt observations
cannot replace the two actual owner-only openings required to sign a private-deal
receipt.

Validation: **38 unit tests pass** (18 history-channel and 20 proof-packet cases),
frontend typecheck and root build pass, and **all nine Chromium scenarios pass**
in one uninterrupted run (exit 0, 8.9 minutes including startup). Full hands pass
at 2–5 seats. The new three-seat adversarial case sends an altered contribution
from one guest toward another guest's card: the non-owner relay rejects it
before forwarding, closes the table, and no additional private-deal signature
is produced. The raw 2–5-seat worker suite also passes, including review-only
output/cache restrictions and changed-author/position/proof refusals.

Two fresh local builds produce identical 345,633-byte modules, SHA-256
`d1031ede4c2e4fe0f92b7aa1ca3a6e28b3c15778a215dab97b548f506ad2cf44`.
The second build enforced that digest. Runtime/CI pins and the cryptographic
suite now require version seven; earlier worker artifacts cannot be mixed in.
Provenance and raw results are recorded in
`experiments/poker-shuffle/wasm/peers/private-review-*2026-09-06.*`.
Tracked generated HTML was restored after building.

This supersedes earlier statements that private contribution delivery remains
fixture-relayed. Approval/certificate exchange, live admission/UI wiring,
proof/key recovery, abort/settlement policy and independent cryptographic review
remain incomplete. The native candidate is still unaudited, and the live Poker
page remains host-authoritative. Remote CI and cross-host reproduction remain
unverified.


### Peer approval collection — 2026-09-06

The experimental path now exchanges roster, shuffled-deck and private-deal
approvals over the actual join-code table. Each peer verifies the signature
against its own admitted signer, protocol, roster and verified deck head.
The bounded collector retains at most one approval per seat and cannot emit
an incomplete certificate. Concurrent exact retries share verification;
conflicting pending bytes are refused. Already-started history invalidates
further approvals, including retries. Certificate use retains full verification.

The normal browser path no longer receives approval arrays from the runner:
each peer signs locally, sends its approval, collects verified peer approvals
and constructs its own certificate. Negative fixtures still inspect certificates
to construct forgeries. A new scenario falsely attributes a guest signature
to another seat and requires rejection before relay forwarding.

Initial validation: 33 Poker approval/roster tests and 44 frontend channel tests
pass. Poker and frontend typechecks and the root production build pass.
Typechecking caught union inference errors in the new typed-data verifier and
its fixture; each branch now supplies its concrete signed-message schema.
Tracked generated HTML was restored. The full Poker suite passes: **485 tests
in 35 files**, exit 0, 432.82 seconds. **All ten Chromium scenarios pass** in
one uninterrupted run (exit 0), including complete hands at 2–5 seats,
uncontested and folded-hand outcomes, and tampered shuffle/public/private
proof rejection. The new forged-seat approval case confirms relay rejection
before forwarding, no collected approval on the two other peers, no additional
signature from those peers, and table closure. Source and deadlines remained
unchanged throughout the browser run. Logs: `/tmp/poker-approval-full.log` and
`/tmp/poker-approval-browser.log`.

Wallet enrollment, encryption-key announcement setup and full-hand transition
delivery remain harness-controlled. Live UI integration, proof/key recovery,
abort/settlement policy and independent cryptographic review remain release
gates. The live Poker page remains host-authoritative.


### Verified gameplay peer exchange — 2026-09-06

`PokerGameplayExchange` now routes full-hand proposals, acknowledgments and
committed batches over the existing verified star-table channels. Each actor
explicitly proposes locally; the relay independently reviews and echoes that
proposal, including to its author. Receiving it never signs. Each seat must
explicitly acknowledge, and the relay must collect all verified signatures
before local replay/persistence and batch distribution. Guests verify and
persist the complete batch independently. The full-hand browser runner no
longer assembles or relays those signed-message bytes.

Unsigned, bounded checkpoint receipts separate transport readiness from game
authorization. Their session/sequence/head must match the receiver's current
checkpoint; they never count as votes. The relay holds one early next proposal
until every link reports the previous checkpoint. A slow-persistence regression
checks that the next actor cannot race another peer's pending append. Missing
receipts stall; they do not authorize an abort, refund or settlement.

Validation: **35 targeted frontend tests pass** (9 exchange, 18 channel, 8 table),
frontend typecheck and root build pass. Tracked generated HTML was restored.
The browser suite initially produced **9 passes and one five-player timeout**
(`/tmp/poker-gameplay-browser.log`); an unchanged isolated retry also timed out.
The old teardown could replace the original error with a context-close error.
It now preserves the original failure and records only public phase/timing
metadata. That diagnostic identified the 120-second total budget expiring
during a flop card-opening operation, after earlier gameplay had progressed.

The five-player case now has a 300-second whole-hand budget, with explicit
20-second browser waits for all cases; protocol/worker deadlines and security
assertions are unchanged. **The isolated five-player case passes**, reaching
all showdown outcome assertions in **186,732 ms** (3.1-minute test, exit 0;
`/tmp/poker-gameplay-browser-five-budget.log`). This is split-run correctness
evidence, not an uninterrupted green suite under the revised timing settings
and not evidence of acceptable production latency. The previous full Poker
485-test result remains applicable to unchanged Poker package sources.

This supersedes the earlier full-hand runner-delivery limitation. Wallet
enrollment and encryption-key announcements remain harness-controlled. Live
Poker UI integration, performance/CI reliability, proof/key recovery,
abort/settlement policy, and independent cryptographic review remain open.
The live Poker page still uses its legacy host-authoritative path.


### Gameplay delivery failure state — 2026-09-06

Review found that local proposal/vote/batch send errors could leave the
exchange apparently open after partial delivery. Outbound delivery failures
now close every local gameplay link and preserve the first `closeReason`.
The existing join-session owner propagates physical closure. If persistence
succeeded before batch delivery failed, the local committed checkpoint is
retained and further signing is refused; no rollback is attempted. Invalid
local input and rejected append calls before delivery remain retryable.

Validation: **all 13 exchange tests pass**, including 2–5-seat successive
transitions, delayed peer persistence, forged votes, receipt restrictions, and
four new delivery/retry regressions. Frontend typecheck and whitespace checks
pass. The persistence-retry case injects an append-call failure to test this
coordinator boundary; it is not a new disk-failure/recovery test. Browser
coverage remains the split-run evidence above; no browser rerun was performed
for this failure-state change. Live UI wiring and complete recovery remain open.


### Wallet enrollment peer bootstrap — 2026-09-06

The live lobby review confirmed that admission must precede the history channel;
that channel deliberately requires an already admitted verifier. Added bounded
individual approval collection to `PokerHistoryEnrollment`, with local-wallet
recovery, fixed terms, exact retry handling, incomplete-certificate refusal and
full re-verification at admission. It cannot expose history or authorize signing
while only some wallets have approved.

`PokerEnrollmentExchange` now delivers those approvals on connected join-code
signaling links before history startup. It retains no private keys, never signs,
and never imports host-supplied replacement rosters or terms. Registration
retries and early-approval buffering allow peers to start at different times.
The relay forwards only verified wallet approvals; packet/processing/storage
counts are bounded by the fixed roster. Failure removes local handlers and
reports a reason; connection teardown remains the caller's responsibility.

The full-hand harness now obtains each test-wallet signature locally in its
own browser context and exchanges it over the real links. Each peer constructs
its own certificate and independently creates its archived history. No wallet
signature array is passed between pages by the runner on this normal path.

Validation: **14 Poker enrollment tests** and **7 frontend bootstrap exchange
tests** pass. Poker/frontend typechecks and root build pass; tracked generated
HTML was restored. **Three Chromium checks pass in
one run**: real join-code admission at two and five seats, followed by a
complete two-seat hand with the new startup flow (exit 0, 1.8 minutes including
startup; `/tmp/poker-enrollment-browser.log`). The complete hand reached its
outcome assertions in 61,107 ms. The prior full five-seat hand was not rerun
for this bootstrap change; its current browser evidence remains admission-only.

This supersedes the normal-path enrollment signature-array limitation. The
runner still supplies locally expected terms and test keys, and encryption-key
announcements are still fixture-delivered. Application wallet-provider wiring,
independent terms review in the live lobby, worker-key announcement exchange,
recovery, performance, settlement/abort policy and independent cryptographic
review remain open. The live Poker page remains host-authoritative.


### Encryption-key announcement peer delivery — 2026-09-06

Added incremental native announcement admission to the experimental adapter
and a bounded `announcement-v1` artifact envelope. Each peer verifies the
public key/ownership proof, rejects own-key substitution and conflicting seat
replacements, and requires the native aggregate-roster checks before exposing
roster signing. Native operations are serialized with one pending item per
seat. No native source or pinned artifact changed. Ownership proof alone is
not wallet/session-signing authorization: unanimous roster approvals remain
mandatory before shuffling.

The full-hand harness now exchanges announcements over the real join-code
channels. Its old whole-roster helper also initialized the signing-journal
reference; the initial browser run exposed that missing local preparation
step. Explicit preparation after complete native roster review fixes it.
Negative whole-roster fixtures remain direct test inputs.

Validation: **32 proof/approval/announcement packet tests pass**, frontend
typecheck and root build pass, with tracked generated HTML restored. After the
setup fix, **all three selected Chromium cases pass in one run** (exit 0):
complete two- and three-seat hands plus tampered-key-announcement refusal.
The adversarial case rejects the altered proof, closes the table, retains no
verified announcement on the receiving peer and produces no roster signature.
Evidence: `/tmp/poker-announcement-browser-retry.log`; the initial failures are
retained in `/tmp/poker-announcement-browser.log`. Four-/five-seat full hands
and arbitrary concurrent announcement delivery were not rerun for this change.

This supersedes the fixture-delivered announcement limitation for the normal
full-hand path. Tests still supply expected terms/test keys and pace actions
using observed peer completion. A live application session coordinator,
independent terms review, wallet-provider/UI wiring, recovery, performance,
abort/settlement policy and independent cryptographic review remain open.
The live Poker page remains on the legacy host-authoritative path.


### Bounded concurrent channel reception — 2026-09-06

The history channel previously rejected every incoming frame while asynchronous
verification was pending. That made honest overlapping relay traffic depend on
the harness's send pacing. Complete messages now enter a bounded per-channel
queue and are verified in arrival order. Limits are eight waiting messages and
one MiB of waiting UTF-8 payload, separate from the active verification and
existing bounded fragment assembly. Overflow closes the channel and discards
queued work; disposal prevents any remaining queued verification. Already
reviewed identical proposals can be forwarded without competing with inbound
verification or repeating its signature/replay checks.

Validation: **34 channel/gameplay tests pass**, including message/byte overflow,
ordered processing and disposal. Frontend typecheck and root build pass; tracked
generated HTML was restored. **Complete three- and five-player Chromium hands
pass in one run** with all encryption announcements sent concurrently, exercising
both the transport queue and native announcement admission serialization.
Evidence: `/tmp/poker-receive-queue-tests.log` and
`/tmp/poker-receive-queue-browser.log`. No protocol or test deadlines changed.

This verifies concurrent announcement delivery, not arbitrary concurrent public
or private proof operations across all links. Those stages still use paced
harness actions. Live application stage coordination, wallet/UI integration,
recovery, performance and independent cryptographic review remain open. The
live Poker page is still host-authoritative.


### Cross-link worker command serialization — 2026-09-06

A second concurrency gap remained after channel queuing: different peer links
could reach the same worker while its previous command was pending and receive
`busy`. Added bounded worker serialization with one active/eight waiting
commands, fail-closed overflow and disposal, and no automatic retry. Commands
are bound to their locally captured checkpoint before dispatch and before their
result is exposed. A stale command closes the adapter. Native source/artifact
pins and cryptographic proof verification are unchanged.

The browser now sends private contributions from all non-owners concurrently
and public contributions from all seats concurrently for each card. It retains
missing-share refusal and non-owner/private-card opening checks.

Validation: **36 queue/packet tests pass**, frontend typecheck and final root
build pass (tracked generated HTML restored), and
**all four selected Chromium cases pass in one run** (exit 0, 5.5 minutes
including startup): complete three-/five-player hands and tampered public/private
contribution refusal. Full-hand outcome assertions finish in 79,876 and
83,099 ms respectively; these are local timings, not a controlled performance
benchmark. Evidence: `/tmp/poker-worker-queue-tests.log` and
`/tmp/poker-worker-queue-browser.log`. Queue tests cover order, caller metadata,
individual errors, overflow and disposal. A dedicated forced-checkpoint-change
browser test has not been added.

This supersedes the per-card author-pacing limitation. The harness still
coordinates card/street boundaries and supplies local terms/test keys. Live
application coordination, wallet/UI integration, recovery, settlement/abort
policy, remote CI reliability and independent cryptographic review remain open.
The live Poker page remains host-authoritative.


### Reusable proof exchange and worker lifetime — 2026-09-06

Moved normal proof routing out of the browser harness into
`PokerProofExchange`. The component owns verified relay forwarding, local
announcement/shuffle/approval/contribution sends, checkpoint-scoped receipts,
and copied prepared-public-proof caches. It does not sign or select gameplay
actions. Hostile test packets still bypass it deliberately.

Channel rejection/closure or forwarding failure now terminates the worker and
closes sibling links. Independent worker closure triggers the same cleanup.
Read-only approval progress and the first failure reason remain available for
reporting without reopening signing or native commands. Browser adversarial
assertions now require worker closure on every affected peer and refusal of
further signing/reveal work, in addition to the existing invalid-proof checks.

Validation: **42 exchange/packet/worker-queue tests pass**, frontend typecheck
and root build pass, with tracked generated HTML restored. **All eleven
Chromium scenarios pass in one uninterrupted run** (exit 0), covering complete
2–5-seat hands, uncontested/folded outcomes, concurrent announcements and
per-card contributions, and all five malicious proof/approval scenarios.
Evidence: `/tmp/poker-proof-exchange-tests.log` and
`/tmp/poker-proof-exchange-browser.log`. This supersedes the earlier split-run
correctness evidence for the current full-hand browser suite.

The live Poker page still uses its legacy host-authoritative path. The next
integration work remains an application session owner for enrollment, signing
references and card/street coordination, followed by wallet/terms-review UI.
Recovery, settlement/abort policy, performance/remote CI validation and
independent cryptographic review remain release gates.


### Protocol session ownership and startup barrier — 2026-09-06

Added `connectPokerProtocolSession` to compose history transport, proof exchange
and gameplay exchange for an already admitted local worker. It owns startup,
failure cleanup and worker termination, retaining the first terminal reason.
It does not create journals, sign, recover keys or enroll wallets.

Fixed an integration race: a guest could finish its local channel handshake
while the relay was still waiting for another link and had no proof verifier
installed. Every participant now installs proof/gameplay handlers before a
table-wide installation barrier releases normal traffic. The barrier binds
session/checkpoint/direction and echoes a fresh guest instance nonce, with
bounded retries, timeout and cleanup. Readiness is unsigned routing information,
not authorization; a malicious relay can still withhold or misrepresent it.

Validation: **14 readiness/proof-exchange unit tests pass**, frontend typecheck
and root build pass, and tracked generated HTML is unchanged. **Four selected
Chromium cases pass in one run** (exit 0, 5.3 minutes): complete three-/five-seat
hands, forged approval-seat refusal and tampered key-announcement refusal. The
five-seat test holds back the final participant and verifies that an early guest
remains waiting before completing the hand. Evidence:
`/tmp/poker-protocol-session-tests.log`,
`/tmp/poker-protocol-session-types-confirmed.log`,
`/tmp/poker-protocol-session-build.log`, and
`/tmp/poker-protocol-session-browser.log`.

The initial browser attempt failed before tests because the sandbox refused the
local server port; the permitted local-browser run above succeeded. One initial
unit assertion counted a fake transport's already queued delivery as a leaked
timer; the corrected check drains that delivery and verifies no further retry
sends or timers remain. Neither failure was bypassed in production code.

The live Poker page remains host-authoritative. This owner covers an already
admitted worker; enrollment/signing-reference ownership, autonomous card/street
coordination and wallet/terms-review UI are still open. Recovery, abort and
settlement policy, independent cryptographic review and remote CI validation
remain production release gates. The previous eleven-case browser result
predates this session-owner change; only the four selected cases were rerun.


### Local admitted history and signing lifetime — 2026-09-06

Added `openPokerLocalHistory` and moved browser archived-history setup onto it.
It owns wallet-admitted history, durable public archive and gameplay signing
journal, validates local seat/account and recovery identity, and requires paired
archive/journal references for explicit recovery. Startup failure closes opened
database connections while retaining durable records; no lock reset or silent
fresh-journal fallback is provided.

The account passed to protocol signers is guarded by the owner's lifetime.
Disposal closes storage, refuses new signing calls and refuses results from
requests that were already pending. It cannot undo a signature request already
dispatched to an account. Durable claims remain in place in either case.

Validation: frontend typecheck and root build pass, with tracked generated HTML
unchanged. **Five Chromium storage/lifetime tests pass**: accepted transcripts
survive reload, corrupted and missing archives refuse recovery, concurrent tabs
archive a checkpoint consistently, and a paused signature result is refused
after disposal. That disposal test reloads the original references and proves a
conflicting action still fails before account invocation. **One complete
two-seat encrypted-hand browser test also passes**, exercising this owner with
the native proof adapter and protocol session. Evidence:
`/tmp/poker-local-history-types.log`, `/tmp/poker-local-history-build.log`,
`/tmp/poker-local-history-browser.log`, `/tmp/poker-local-history-hand.log`.

This is a reusable application component exercised by fixtures, not completed
live-page wiring. The live Poker page still uses the legacy host-authoritative
client. Wallet/terms-review UI, ownership of encryption-approval references,
composition with protocol termination, card/street coordination, private-worker
loss policy, settlement and independent cryptographic review remain open.
Public archive recovery must not be presented as encrypted-hand recovery.


### Combined protocol and local signing lifetime — 2026-09-06

`connectPokerProtocolSession` now owns the local-history owner in addition to
its worker and protocol links. Terminal protocol failure revokes local signing
before resource cleanup; closing the local owner also closes the protocol. The
local owner exposes a non-rejecting `whenClosed` promise. Startup checks its seat
and copies the link map so later caller mutation cannot change barrier routing.
Existing durable records and first terminal errors remain intact.

Validation: frontend typecheck and root build pass; tracked generated HTML was
restored. **Three Chromium scenarios pass in one run** (exit 0, 2.9 minutes):
complete two-seat encrypted hand, forged approval-seat refusal at three seats,
and a new two-seat local-shutdown case. The latter pauses the relay's roster
signature, closes the guest's local owner, waits for both workers/histories to
close, then releases the pending signature. Its result is refused, no approval
is collected, and later signing does not reach the accounts. Forged-approval
checks now also require closure of affected local histories. Evidence:
`/tmp/poker-owned-lifetime-types.log`, `/tmp/poker-owned-lifetime-build.log`,
`/tmp/poker-owned-lifetime-browser.log`. The suite now contains twelve scenarios;
the other nine were not rerun for this change.

This closes the previously documented protocol/local-history composition gap.
It does not complete live-page integration, encryption-approval reference
ownership, wallet/terms review, card/street coordination, encrypted-hand recovery,
settlement or independent cryptographic review. The live page remains on its
legacy host-authoritative path.


### Encryption-approval journal ownership — 2026-09-06

The local-history owner now exposes explicit `prepareEncryptionSigning` for a
natively reviewed roster. It owns the encryption-approval journal independently
of gameplay records, deduplicates concurrent preparation for the same roster,
and refuses roster replacement, foreign-session/non-genesis context, disposal,
and public-history recovery. It returns a frozen reference without signing.
Creation failure closes the owner and its protocol while retaining durable
records. The full-hand harness now uses this application method instead of
creating the encryption journal itself.

Validation: frontend typecheck and root build pass; generated tracked HTML is
restored. **Three selected Chromium scenarios pass in one run** (exit 0, 2.1
minutes): refusal to replace an existing encryption journal or prepare after
public-history recovery, a complete two-seat encrypted hand whose concurrent
preparation calls return the same reference, and shutdown during a pending
approval. Evidence: `/tmp/poker-owned-approval-types.log`,
`/tmp/poker-owned-approval-build.log`, `/tmp/poker-owned-approval-browser.log`.

This completes ownership of fresh encryption-approval reference creation, not
private-key recovery. The method does not substitute for native roster review.
Live-page integration, wallet/terms review, autonomous card/street coordination,
interrupted-hand policy, settlement and independent cryptographic review remain
open. The live Poker page still uses the legacy host-authoritative path.


### Full frontend and Poker regression baseline — 2026-09-06

Re-ran the accumulated frontend and Poker unit/integration suites without source
changes during execution. Poker completed with **491 tests in 35 files passing**
(exit 0, 439.81 seconds). The frontend completed with **786 passing tests in 61
files and one failed real-network test** (787 tests in 62 files total, exit 1).
The sole failure was `listen EPERM` when the sandbox denied the signed-pubsub
fixture's loopback listener. Re-running that exact test with local-port permission
passed (exit 0). Thus all frontend tests have passing evidence across the main
run and the permitted targeted rerun; this was not one entirely green full run.

Evidence: `/tmp/poker-readiness-poker-full.log`,
`/tmp/poker-readiness-frontend-full.log`, and
`/tmp/poker-readiness-gossip-permitted.log`. Poker's initial quiet period was
verified CPU activity, not a stopped process; its residual adversarial file
alone took 158.72 seconds. No test was skipped or weakened to handle the sandbox
failure, and no production source change was needed for that failure.

Passing tests are not a security certification. The suite includes an intentional
characterization reproducing keyless hole-card tracking in the legacy public
shuffle transcript. The protected native-proof/replay path is separate and still
awaits live-page integration and independent review.

Re-inspection also confirms the legacy `game.ts` showdown still splits its entire
pot between overall hand winners, ignoring cumulative side-pot eligibility. Its
uncontested path returns without clearing the pot, and `advancePhase` sets
`showdown` without resolving when only one active player remains. These remain
open live-game correctness issues. Fixing side pots requires cumulative hand
contributions; the legacy per-street `bet` fields are reset between rounds and
cannot establish those totals. The verified replay's pot allocator already
provides cumulative eligibility, refunds and odd-chip handling and should be
reused with a sound contribution source.


### Live trusted-host Poker payout correction — 2026-09-06

Fixed the confirmed `PokerGame` accounting gap. Each hand snapshots stacks before
blinds; differences from current stacks establish cumulative contributions across
street bet resets. Showdown now uses `allocatePokerPots` for eligible main/side-pot
winners, folded contributions, uncalled refunds and dealer-relative odd chips.
It checks pot accounting and resulting stack bounds before awarding chips. The
last fold resolves immediately, clears the pot and ends the hand. All betting
moves reject terminal phases, and match `endIf` waits for completed payouts rather
than counting temporary zero stacks during an all-in as eliminations.

Validation: **35 tests in four files pass** (exit 0), including five new actual-move
regressions for cumulative pots/refunds, tied odd chips, fold completion/terminal
refusal, all-in match-end gating, and betting across multiple streets. Poker and
frontend typechecks and root build pass; generated tracked HTML is restored.
Evidence: `/tmp/poker-live-payout-verified.log`, `/tmp/poker-live-payout-types.log`,
`/tmp/poker-live-payout-frontend-types.log`, `/tmp/poker-live-payout-build.log`.
Initial test failures were corrected fixture assumptions: one card index described
an ace instead of a king, and the multi-street test needed explicit 1/2 blinds
rather than default 10/20. No payout rule was weakened to satisfy them.

The prior full Poker result of 491 passing tests predates these edits; the complete
suite was not rerun. Existing in-progress trusted-host snapshots lacking the new
stack snapshot are not supported for continuation. This fixes the previously
reported payout/completion bugs, not malicious-host authority. Verified-path live
integration, legacy transcript privacy, interrupted-hand policy, settlement and
independent cryptographic review remain production blockers. The game-flow guide
now explicitly labels its trustless workflow as intended design rather than a
security claim about the live implementation.


### Live Poker subsequent-hand and all-in flow — 2026-09-06

Fixed the next-hand path to retain engine seat IDs while excluding busted players
from dealing, blinds and action. Button rotation chooses the next funded seat;
heads-up the dealer is small blind and first preflop actor. New-hand moves refuse
spectators, busted seats and tables with fewer than two funded players. Stack
snapshots continue to cover every engine seat for payout conservation.

Automatic board runout now handles blind-posting all-ins and later streets with
no remaining betting contest. A lone player owing a call may call/fold, but cannot
raise or over-shove into a dry side pot. If a short all-in blind is already covered,
no unnecessary nominal blind top-up is demanded. These changes are in the live
trusted-host `PokerGame`; shared legacy crypto betting helpers were not changed.

Validation: **30 tests in four files pass**, including six new next-hand/runout
regressions alongside payout, sender/privacy boundary and deal-plan tests. Poker
typecheck and final root build pass; generated tracked HTML is restored. Evidence:
`/tmp/poker-next-hand-complete.log`, `/tmp/poker-next-hand-types-complete.log`,
`/tmp/poker-next-hand-build-final.log`. The earlier full 491-test Poker result
predates these edits; the complete suite was not rerun here.

The live page remains host-authoritative. Verified-protocol UI integration,
interrupted encrypted-hand policy, settlement, legacy transcript privacy and
independent cryptographic review remain production release blockers.


### Bound enrollment review component — 2026-09-06

Added immutable `PokerHistoryEnrollment.reviewTerms` containing the actual bound
public configuration, canonical genesis and ordered wallet/session-key identities.
The read-only `PokerEnrollmentReview` component renders that source directly,
including chain/domain and session/rules fingerprints. It shows starting chips,
blinds and dealer only when recreating those values produces the exact bound
Poker genesis, and labels other state unrecognized. Public state is React-escaped.
It neither signs nor performs wallet/network actions.

Validation: **15 Poker enrollment tests and three static-render UI tests pass**.
They cover snapshot immutability and agreement with signing data, rendering exact
identities, rejecting invalid local seats, escaping public JSON, displaying a
reconstructed Poker setup, and refusing a misleading lookalike summary. Poker and
frontend typechecks and root build pass; generated tracked HTML is restored.
Evidence: `/tmp/poker-review-terms-tests.log`, `/tmp/poker-review-ui-verified.log`,
`/tmp/poker-review-types.log`, `/tmp/poker-review-poker-types.log`,
`/tmp/poker-review-build.log`. One initial UI fixture incorrectly passed review-only
fields into the strict enrollment config; the fixture was corrected without
relaxing constructor validation.

The component is not yet mounted in live onboarding and has no approval control.
Connecting it to wallet authorization and the existing enrollment/session owners
remains necessary. This is review infrastructure, not a completed production UI
or evidence of malicious-host protection in the live page. Card/street coordination,
interrupted-hand policy, settlement and independent cryptographic review remain open.


### Wallet approval UI and peer enrollment — 2026-09-06

Added `PokerEnrollmentApproval` and `approvePokerEnrollment`. The component
requires explicit review confirmation and click, rejects unrecognized genesis,
and sends a verified signature only through its supplied callback. The adapter
checks the selected EIP-1193 account/chain before and after signing, recovers the
expected wallet, observes account/chain/disconnect events, and supports abort and
a 120-second deadline. Cleanup removes handlers/timers and late results are
refused. No transaction, automatic connection, chain switch or approval retry is
performed. User-facing errors describe the corrective action rather than internal
protocol error codes.

Validation: **eight unit/render tests pass** for review rendering, wallet/chain
mismatch, wrong recovered signer, pre-cancellation and successful verification.
**Two injected-wallet Chromium approval tests pass** for explicit click and an
account change while signing is paused. **Two peer-enrollment Chromium tests pass**
at two/five seats using the same UI and independent injected wallets; signatures
travel through real join-code enrollment links, incomplete admission is refused,
and all seats start history at the same checkpoint. The bootstrap fixture no
longer gives its page a raw wallet key for these cases. Frontend typecheck and root
build pass; tracked generated HTML is restored. The final copy-only error-message
change was checked by rerunning both approval browser tests.

Evidence: `/tmp/poker-wallet-approval-tests.log`,
`/tmp/poker-wallet-approval-browser-final.log`,
`/tmp/poker-wallet-enrollment-browser.log`, `/tmp/poker-wallet-enrollment-types.log`,
`/tmp/poker-wallet-approval-build.log`. This covers provider/address/signature and
peer admission, not funded transactions or a deployed settler. An already
dispatched wallet request cannot be undone; its late result is discarded.

The live Poker page does not yet mount this flow. Production integration still
requires assembling reviewed terms and local identities, composing enrollment
with the protected session and card/street coordination, and handling interruption,
settlement and independent cryptographic review. The legacy live client remains
host-authoritative.


### Enrollment-to-history session owner — 2026-09-06

Added `connectPokerEnrollmentSession` to own connected enrollment links and the
resulting fresh local history. It binds the local session account to its expected
seat, accepts only separately obtained wallet approvals, waits for the exchange's
verified completion, disposes bootstrap routing and opens durable history once.
The harness now uses this application handoff instead of reconstructing enrollment
and creating history itself. Failure/disposal closes links and local storage;
closing local history propagates back to the underlying connections. Results of
storage opening after cancellation are closed rather than exposed.

`PokerEnrollmentExchange` now exposes verified `completed` and non-rejecting
`whenClosed` promises. Completion waits for pending receive verification and
forwarding, and startup cleanup removes earlier listeners when registration fails.

Validation: **eight exchange tests pass**, frontend typecheck and root build pass,
with generated tracked HTML restored. **Four Chromium scenarios pass in one run**
(exit 0, 1.3 minutes): two-/five-seat injected-wallet UI enrollment, closing incomplete
enrollment without creating history or signing, and a complete two-seat encrypted
hand using the new handoff. Evidence: `/tmp/poker-enrollment-owner-tests-final.log`,
`/tmp/poker-enrollment-owner-types.log`, `/tmp/poker-enrollment-owner-build.log`,
`/tmp/poker-enrollment-owner-browser.log`.

The owner starts no native worker by itself and performs no signing or key recovery.
The live page still needs to mount this composition, establish independently reviewed
terms and identities, and coordinate protected card/street operations. Interrupted-hand
policy, settlement, legacy transcript privacy and independent cryptographic review
remain production release blockers.


### Owned worker startup and handoff disconnect monitoring — 2026-09-06

Added `startPokerProtectedSession` to own fresh local history, pinned worker
creation and protected protocol connection. It checks awaiting-deal genesis/dealer
binding and terminates worker, signing and connections on failure/disposal. Native
adapter creation now supports cancellation before and after worker allocation;
abort listeners are removed after initialization and the native artifact is unchanged.
The full-hand harness uses this factory for normal startup.

The initial four-case browser run passed complete two-/five-seat hands and pending
approval shutdown, but failed worker-startup cancellation because the remote local
history stayed open. The local worker had terminated correctly. Diagnosis: the
enrollment exchange stopped monitoring connections after successful admission,
before the remote participant created its protocol channel. Fixed the enrollment
owner to monitor links throughout its lifetime (500 ms interval, removed on closure).

After that fix, **worker-startup cancellation and a complete two-seat encrypted
hand pass together** (exit 0, 48.8 seconds), and final frontend typecheck/root build
pass, with tracked generated HTML restored. Cancellation holds worker initialization
delivery and proves one termination, closure of both local histories, rejection of
readiness and zero signing calls. Evidence:
`/tmp/poker-protected-factory-browser.log` (initial failure and three passes),
`/tmp/poker-protected-factory-browser-fixed.log` (final two passes),
`/tmp/poker-protected-factory-types-complete.log`,
`/tmp/poker-protected-factory-build-complete.log`. The suite now has thirteen cases;
the complete suite was not rerun after the monitor change.

This closes the worker-startup lifetime gap and provides a direct application
factory after enrollment. It does not mount the flow in the live page, choose
reviewed session terms, coordinate cards/streets, implement interrupted-hand
settlement, or replace independent cryptographic review. Those remain release gates.

### Protocol stage binding — 2026-09-06

The startup-only handshake could not distinguish authorization stages at the same
history checkpoint. Added v2 packets bound to a bounded locally chosen scope.
Previous-stage traffic is ignored rather than releasing or failing a later stage;
missing/malformed scope bindings fail. `connectPokerProtocolSession` now owns a
`synchronize(scope)` operation with one pending barrier, exact retry sharing,
64-scope/current-head bounds and cleanup through the existing session lifetime.
Readiness cannot substitute for local certificate or native proof verification.

Roster and deck authorization in the full-hand browser path now await this
application coordination. **15 readiness unit tests pass**, frontend typecheck
passes, and **complete two-/five-seat encrypted Chromium hands pass together**
(exit 0, 2.3 minutes; individual hands 36.4 and 89.7 seconds). Evidence:
`/tmp/poker-stage-ready-tests.log`, `/tmp/poker-stage-ready-types.log`, and
`/tmp/poker-stage-ready-browser.log`. This was a selected two-case browser run,
not all thirteen scenarios. Per-card/street orchestration remains in the harness,
and the live page still requires protected-flow integration.

Final root build also passes (`/tmp/poker-stage-ready-build.log`); tracked
generated HTML was restored byte-for-byte. Root and platform diff checks pass.

### Autonomous private-card dealing — 2026-09-06

The protected runtime now exposes `dealPrivateCards()` after reviewed deck
authorization. Application code drives all canonical private positions, generates
only non-owner contributions, waits for locally verified shares, opens only the
local owner's cards, and synchronizes peers before the next position. Results
are frozen and local-only. Exact retries share the same operation; failures close
the owned session. Dealing never signs an approval or exports private keys.

Added bounded event-driven contribution waits to `PokerProofExchange` with
closure/timeout cleanup. **25 focused tests pass** (15 readiness, 10 proof-exchange),
and frontend typecheck passes. **Three selected Chromium cases pass together**
(exit 0, 3.3 minutes): three-seat tampered-contribution refusal, two-seat autonomous
dealing and contested showdown (42.2 seconds), and five-seat autonomous dealing
and contested showdown (99.9 seconds). The new scenarios issue one deal request
per peer and provide no per-card test-runner pacing. They verify two local cards,
unchanged signing counts, retry sharing and owner/non-owner native restrictions.
Full hands are combined only in the test runner's oracle, never by a peer.

Evidence: `/tmp/poker-auto-private-tests.log`, `/tmp/poker-auto-private-types.log`,
and `/tmp/poker-auto-private-browser.log`. The browser suite now has fifteen
scenarios; the other twelve were not rerun for this change. This removes private
dealing orchestration from the application integration backlog. Public streets,
showdown orchestration, live-page mounting and interrupted-hand handling remain
open, alongside the existing independent cryptographic review gate.

Final root build passes (`/tmp/poker-auto-private-build.log`), tracked generated
HTML is unchanged, and root/platform diff checks pass.

### Autonomous public cards and showdown — 2026-09-06

Added protected-runtime community-card and showdown operations. Requests derive
from the exact locally bound replay and verified history. Application code
installs native authorization, coordinates peers, exchanges and verifies every
required contribution, opens permitted positions, and binds native evidence before
returning immutable results. Folded hands are excluded from showdown permissions.
Retries share the original operation at the same checkpoint/replay. No gameplay
signature or commit is automatic. Public waits use the same bounded event-driven
closure/timeout handling as private waits. The native artifact/hash pin is unchanged.

**28 focused unit tests pass** (15 readiness, 13 proof-exchange); final frontend
typecheck passes. Initial browser validation passed tampered-proof refusal but
failed three autonomous cases because the legacy harness attempted a second
`bindCommunity` after the autonomous method had already bound the evidence.
The `flop_already_bound` guard was correct. Updated autonomous assertions to
consume returned/cached results, leaving the replay guard and manual-path checks
intact.

After that test correction, **four Chromium cases pass together** (exit 0,
3.6 minutes): tampered public contribution refusal (52.4 seconds), two-seat
complete autonomous hand (42.9 seconds), five-seat complete autonomous hand
(58.4 seconds), and three-seat autonomous hand with a folded player (24.3 seconds).
The folded case checks expected live hands and rejects public tokens for folded
positions. Autonomous flop/showdown tests check unchanged signing counts and
reuse of the original operation. The suite now has sixteen scenarios; the other
twelve were not rerun in this turn.

Evidence: `/tmp/poker-auto-public-tests.log`,
`/tmp/poker-auto-public-types-final.log`, `/tmp/poker-auto-public-browser.log`
(initial harness failures), `/tmp/poker-auto-public-browser-fixed.log` (four passes).
Card-stage coordination is now application code, but setup/phase dispatch and
live-page integration remain unfinished. Interruption/settlement policy and
independent cryptographic review also remain production release gates.

Final root build passes (`/tmp/poker-auto-public-build.log`); tracked generated
HTML is unchanged. The opening implementation table now reflects autonomous
card-stage coordination while retaining the live-page and security release gates.

### Autonomous announcement exchange and ordered shuffling — 2026-09-06

The protected runtime now owns announcement exchange and ordered deck shuffling.
`exchangeAnnouncements()` waits for every native ownership/roster verification
before exposing readiness. After explicit roster signatures, `shuffleDeck()`
requires the complete locally verified certificate, authorizes it, drives only
this peer's shuffle step, verifies every other step, and coordinates peers after
each step and after local deck-head review. The test runner no longer chooses
when each shuffle author proceeds in the autonomous scenarios. Both operations
share retries and perform no signing. Operational failures terminate the owned
session; missing approvals reject before shuffle work begins.

Generalized existing bounded event-driven waits for announcement/shuffle progress.
The shared bound remains 16 waits; announcement/card deadlines are 20 seconds,
and shuffle verification waits use the native command's 120-second budget.
Verification completion and closure cleanup have focused regression coverage.

**31 focused unit tests pass** (15 readiness, 16 proof-exchange), frontend typecheck
passes, and **five selected Chromium cases pass together** (exit 0, 2.6 minutes):
tampered shuffle refusal (29.2 seconds), tampered announcement refusal (23.8),
complete autonomous two-seat hand (32.2), five-seat hand (35.7), and three-seat
folded-hand showdown (19.7). The autonomous setup checks matching local deck
heads, retry sharing and unchanged signing counts. Eleven other scenarios in the
sixteen-case suite were not rerun here.

Evidence: `/tmp/poker-auto-setup-tests.log`, `/tmp/poker-auto-setup-types.log`,
`/tmp/poker-auto-setup-browser.log`. Setup and card operations are application code;
live-page integration and dispatch between user approvals/verified phases remain
unfinished. Interruption policy, settlement binding and independent cryptographic
review remain release gates. The pinned native artifact is unchanged.

Final root build passes (`/tmp/poker-auto-setup-build.log`); tracked generated HTML
is unchanged, and root/platform diff checks pass.

### Protected hand-controller dispatch — 2026-09-06

Added `startPokerHandController` to own automatic progression from the exact
locally verified genesis, approval collections and committed history. It drives
announcement exchange, shuffle, reviewed deck binding, private dealing and allowed
public reveals. It waits for explicit signatures and produces checkpoint-bound
unsigned dealer suggestions for begin-betting/reveal/terminal transitions. It
never invokes gameplay proposal, acknowledgment, signing or commit. Stale
suggestions are hidden immediately when history advances. Only one operation
runs at a time; the 100 ms local-state timer is removed on completion or closure.
Disposal/failure closes the protected session and preserves the original reason.

**Four new Chromium controller scenarios pass together** (exit 0, 2.7 minutes):
complete two-seat showdown (15.5 seconds), five-seat showdown (1.1 minutes),
uncontested completion (44.3 seconds), and cancellation at roster approval
(29.1 seconds). These scenarios start one controller per peer and supply only
explicit approvals and gameplay choices. There are no test calls to choose
shuffle authors, authorize card stages, exchange contributions or bind reveals.
They check matching checkpoints/suggestions, two local cards, chip conservation,
unchanged signing counts during automatic work, no community disclosure for
uncontested play, and both histories closing with zero signatures on cancellation.

The **31 underlying readiness/proof-exchange tests pass**, as does frontend
typecheck. Evidence: `/tmp/poker-hand-controller-tests.log`,
`/tmp/poker-hand-controller-types.log`, `/tmp/poker-hand-controller-browser.log`.
The existing sixteen shuffle-admission scenarios were not rerun this turn.
Live Poker still mounts the host-authoritative game: the tested controller now
needs product onboarding and table UI integration. Interrupted-hand policy,
settlement binding and independent cryptographic review remain release gates.

Final root build passes (`/tmp/poker-hand-controller-build.log`); generated tracked
HTML was restored, and root/platform diff checks pass.

### Protected table controls and review binding — 2026-09-06

Added `PokerProtectedTable` for the local history/runtime/controller. It presents
local private card names, committed community cards, stacks and pot, exact
protocol approval data/fingerprints, explicit betting/table proposals, reviewed
acknowledgments and unanimous relay commits. Protocol/action approval buttons
require matching review checkboxes; effects/rendering never sign. Leaving closes
the controller/session, while component rendering itself does not own or reset
session lifetime.

Added a verified `proposalForReview` accessor and optional expected checkpoint/
proposal arguments to gameplay operations. A stale rendered review now rejects
before signing journal claims or commit. **14 gameplay tests pass**, including
that boundary. Initial typecheck caught a union-inference issue for three typed-
data variants; explicit narrowing fixes it without casts, and final typecheck
passes.

**All four Chromium controller cases now pass through the actual React UI**
(exit 0, 3.2 minutes): two-seat showdown (32.3 seconds), five-seat showdown (1.2
minutes), uncontested completion (18.4 seconds), and cancellation (11.7 seconds).
Approval/proposal/acknowledgment/commit/leave calls are button interactions rather
than direct harness signing calls. Tests verify checkbox gating, stable signing
counts during automatic work, matching checkpoints and conservation. Fixture
bootstrap still supplies locally generated identities and pinned WASM; live
onboarding is not implemented by these tests.

Evidence: `/tmp/poker-table-ui-tests.log`, `/tmp/poker-table-ui-types.log` (initial
compile failure), `/tmp/poker-table-ui-types-fixed.log`,
`/tmp/poker-table-ui-browser.log`. The component is mounted only in the browser
fixture so far. The main Poker page still uses host-authoritative gameplay;
connecting protected onboarding/table lifetime remains the next integration step.
Interruption policy, settlement binding and independent cryptographic review
remain production release gates.

Final root build passes (`/tmp/poker-table-ui-build.log`); generated tracked HTML
was restored, and root/platform diff checks pass.

### Public session invitations and local key generation — 2026-09-06

Added a strict public invitation format and ephemeral local participant factory.
Invitations carry only agreed public identities/terms; canonical 8192-byte input,
exact fields, distinct wallet/session identities, locally fixed rules and valid
chip/domain values are enforced. Nonces and hand IDs are freshly generated.
Local replay generates genesis; no host snapshot, private key or module URL is
accepted. Review requires an independently expected wallet roster/domain and the
browser's own identity, then returns enrollment for explicit wallet approval.
The participant exports a guarded signing adapter, not a private key, and disposal
revokes future and in-flight signing results.

The complete table-UI scenarios now generate session keys inside the browser and
exchange public invitations. The runner still supplies fixture wallet signatures
for enrollment, but no longer supplies session signing private keys. **Nine
invitation tests pass**; combined with handshake coverage, **29 focused tests
pass**, and final frontend typecheck passes.

Initial browser validation had one generic `poker_join:handshake` failure and
three passes. Investigation added a deterministic event-order test: an opened
channel receives a hello before its local open callback. The old helper emitted
only ack, violating its own required hello-before-ack order. This test failed
before the fix. The helper now emits its hello first and ignores the later open
callback through its existing once guard. Handshake failures now retain bounded
categories (binding/order/frame/etc.). The initial browser log was too generic
to prove that this ordering gap caused that particular failure.

After the fix, **all four React UI scenarios pass together** (exit 0, 3.1 minutes):
two-seat showdown (35.9 seconds), five-seat showdown (1.6 minutes), uncontested
completion (22.9 seconds), and cancellation (11.2 seconds). Evidence:
`/tmp/poker-invitation-tests-final.log`, `/tmp/poker-join-open-order-before.log`
(failing regression), `/tmp/poker-invitation-join-tests.log`,
`/tmp/poker-invitation-types-final.log`, `/tmp/poker-invitation-browser.log`
(initial mixed result), `/tmp/poker-invitation-browser-fixed.log` (four passes).
Live invitation forms, wallet review and join-code onboarding still need mounting;
this does not replace interruption/settlement policy or independent crypto review.

Final root build passes (`/tmp/poker-invitation-build.log`); generated tracked HTML
was restored and verified after completion. Root/platform diff checks pass.
