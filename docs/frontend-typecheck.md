# Frontend typecheck findings

The full frontend typecheck is a required quality/release check and now passes locally.

Command: `yarn workspace @cyotee/manamesh typecheck`.

Current result: **0 diagnostics**, exit 0. This includes imported workspace source as well as frontend source and tests. The legacy Node resolution / ES2020 configuration produced 1,221 diagnostics; Bundler resolution / ES2022 / skipLibCheck removed resolution cascades and conflicting dependency declaration checks. Strict checking remains enabled for application source.

The first corrected-config run produced 203 diagnostics. Two source errors identified a real settlement adapter mismatch: it still exposed winner signatures and omitted the required hand-end signatures. The adapter now forwards claimant and hand-end signatures; its new tests also exposed an invalid 300-second timeout default. Configuration now uses the shared 3,600-second default and validates explicit values against the supported 900–86,400-second range.

Both full suites passed before that final settlement correction: frontend 625 tests / 42 files, Poker 397 tests / 29 files. The subsequent 23-test targeted settlement run, Poker typecheck and root build passed. These results do not establish full type safety or malicious-host readiness.

The next pass reduced 201 diagnostics to 104 by declaring Timestreams React type dependencies, using the Paillier subpath export in the HE Battleship demo, making numeric board-count reductions explicit, and sharing the actual PlayerPrompt type between Timestreams state and effects. Simplified scoring now iterates the known era list instead of indexing through `any`. All 33 targeted play/trigger/scoring tests passed, and the Paillier runtime exports resolved. Yarn refreshed the PnP map from cached dependencies without network access.

Timestreams module integration corrections then reduced 104 diagnostics to 95: setup now supplies the declared player count, concurrent-player configuration uses the engine's published ALL type, and module validation uses the public `(state, moveName, playerID, ...args)` order and `error` field. Era lookup follows the canonical era list, not timeline insertion order. The shared GameModule type now supports custom object state layouts while keeping BaseGameState as its default; zone-specific consumers must still require BaseGameState. Seven Timestreams integration/regression tests, 25 shared module tests, and the root build passed. This fixes the module adapter, not the malicious-host card protocol.

The frontend Timestreams wrapper now preserves the game setup return type and uses the package configuration type, including debugSeed. It preserves setup-data merge precedence and rejects a missing setup implementation instead of returning an invalid empty state. This reduces 95 diagnostics to 92; the root build passed. The shared P2P callback type mismatch remains.

The shared channel transport now extends the engine Transport base class and derives its callback/factory types from that API, preserving multiple connection listeners. This removes three client integration diagnostics (92 to 89). Eight transport tests passed, including a real engine Client sync/connection lifecycle test; transport and frontend builds passed. The library build resolves the new internal engine import through its Node-compatible CJS entry.

Transport fixtures now use InitializeGame and ProcessGameConfig, and explicitly narrow the expected update. All 15 frontend transport tests passed. The local Battleship page used the Client factory as a React component; it now constructs a stable client and mounts both seats on the same local transport. These corrections reduce 89 diagnostics to 84, and the root build passed. The new Chromium regression exposed a separate greedy fleet-partition bug: legal touching ships could fail placement and post-game audit. A deterministic regression failed before the fix; complete partition search now passes all 10 Battleship tests and three consecutive browser placement-to-battle runs. Both regressions are included in root quality.

Asset corrections reduce 84 diagnostics to 77. A typed adapter bridges Helia 4 byte-array blocks to UnixFS 7 streams, replacing the production cast. Bare CIDs now reconstruct UnixFS files instead of returning encoded DAG-PB blocks; timeout also aborts the underlying read. A real local 700 KB file round-trip exercises both bare CID and directory path. The path test exposed DAG-PB 4.1.7 returning Multiformats 14 CIDs to the Multiformats 13 exporter, which rejects their identity. Root resolutions pin DAG-PB 4.1.5 (Multiformats 13); remove this pin only after coherent dependency upgrades pass these path tests. Yarn installed the pin from cache. All 25 asset tests passed, then all 20 loader tests passed with an added abort assertion; the root build passed. These checks use local blocks and do not validate WAN retrieval.

Threshold Tally UI corrections reduce 77 diagnostics to 74: DKG publication sends the current public coefficients object, using the configured threshold, and ciphertext rendering handles its two point fields instead of calling string methods on the object. The new real React/engine rendering regression and all six tally game tests passed; the root build also passed. These checks do not establish malicious-host security, range-proof enforcement, or end-to-end UI DKG completion.

Entry-page corrections reduce 74 diagnostics to 70. Simple, Threshold Tally and One Piece now construct engine clients rather than rendering the Client factory as JSX. Simple mounts two local seats, Tally three, and One Piece preserves separate mounted seat clients behind its local selector. The development console links to existing game pages instead of importing the removed App. Three Chromium regressions pass: console-to-simple navigation, three tally seats with accepted DKG commitment, and One Piece deck-selection seat switching. The final root build passed, and these browser regressions are included in root quality. This does not test One Piece deck loading/gameplay or a complete tally round.

Mistborn package corrections reduce 70 diagnostics to 64. React/ReactDOM peers and development dependencies now support the exported components under Yarn PnP. Data exports reuse the asset helpers, removing ambiguous star exports. Restored React types exposed seven additional board errors; demo player display data now explicitly supplies its empty metal list and absent character. All 10 package tests passed, including new public export identity and React rendering checks; the final frontend typecheck and root build verified the board-default correction. The package still has obsolete game-engine move signatures and remains a prototype.

Mistborn engine corrections reduce 64 diagnostics to 51. Setup, turn initialization, end-condition and move adapters now use the context-object API. Main moves reject an actor other than the current player; key submission binds the supplied seat to the engine actor. The private-key encryption helper is no longer a registered network move and remains offline-only; the encryption phase cannot complete pending a validated public-payload protocol. The module declares its actual state/card types and asset metadata. This exposes a remaining card-schema creation error: required cost/cardType are not guaranteed. All 12 package tests passed, including real Client setup/draw and absence of the unsafe move, and the root build passed. Deterministic move history, phase progression and full secure gameplay remain incomplete.

Mistborn card-schema correction reduces 51 diagnostics to 50, with no remaining Mistborn source diagnostics in this full frontend run. The public factory now requires nonempty id/name, a nonnegative safe-integer cost, a supported card type and valid optional metadata; incomplete input throws rather than producing an invalid typed card. All 33 Mistborn tests passed, including malformed-input and public-module wiring regressions. This is source/contract validation, not evidence that the unfinished game protocol is production ready.

The One Piece investigation found private-key submission and a key-derived public shuffle seed. Both game definitions no longer register private-key encryption, and the frontend no longer calls it. Independent 32-byte random seeds use the commitment hash expected by the actual verifier; lost committed seeds are not replaced on resume. The encryption phase is intentionally unfinished pending a validated replacement. All 240 package tests, one frontend commit/reveal integration test and root build passed. Removing the unsafe wrapper reduces 50 diagnostics to 48. See [One Piece security status](../packages/onepiece/SECURITY.md).

One Piece setup corrections reduce 48 diagnostics to 45. Both games now read the engine context object; encrypted setup returns state synchronously instead of a Promise. Its removed lookup branch was unreachable because initial deck-ID arrays are empty. Main-game concurrent setup actors are configured per phase, and deck loading rejects a claimed seat different from the engine actor. All 242 package tests passed, followed by three focused setup tests including own-seat acceptance and foreign-seat rejection. The root build passed. These changes do not initialize the full main-game crypto state or finish encryption.

One Piece turn-lifecycle corrections reduce 45 diagnostics to 42. The previously inert endTurn move now requests the engine end-turn event and rejects a non-current actor. The refresh/draw hook uses the actual onBegin API. A real-client regression failed before the fix and now checks next-player advancement, turn increment, attached DON restoration and drawing. All 244 One Piece tests passed. This covers the play-phase lifecycle, not secure deck setup or a full multiplayer match.

Deck/board boundary corrections reduce 42 diagnostics to 38. The deck resolver now uses a nullish cache/reload fallback instead of assigning nullable reload results into an undefined-only variable. All 26 existing deck-resolution tests passed, including reload and missing-pack cases. Two One Piece board slot callbacks use the declared slot type. The invalid Phaser physics.default=false option was removed; the installed Phaser Config implementation defaults an omitted physics system to false, preserving behavior.

One Piece identity/state corrections reduce 38 diagnostics to 31. Public-key wrappers now pass and enforce the engine actor; main-game shuffle commit/reveal wrappers no longer accept a caller identity from move arguments. Abort-vote context also receives the actor. Empty shuffle maps are sparse string maps, and crypto plugin commitments/proofs use the declared plugin state rather than string maps. Unsupported authenticateCredentials=true properties were removed; transport authentication remains a separate requirement. All 245 package tests passed, including real-client foreign-seat rejection and own-seat key acceptance. Full main-game crypto-state compatibility remains unresolved.

Battleship signal-channel methods are now required when a channel is supplied, matching the board’s unconditional calls and the join-code implementation. All 10 package tests pass; frontend diagnostics drop from 31 to 28. Inspection exposed an unresolved quick-connect path: RoomCodeLobby supplies a plain P2PChannel without the signal methods; the page omits p2pConnection and the board falls back to BroadcastChannel. That cannot deliver shot proofs across devices and requires a signal adapter or equivalent dedicated channel, with peer-to-peer proof exchange validation. Those type-only changes did not fix that runtime blocker. The subsequent adapter and two-browser WebRTC regression now demonstrate actual bidirectional shot proofs and engine updates. The test also exposed missing transport phase-exit hooks; those are fixed with two regression cases. The 28-diagnostic baseline is unchanged. See production-readiness.md for remaining session/disclosure blockers.

## Current status

No frontend source diagnostics remain. Strictness is still enabled. Root quality
runs this command, but a passing typecheck does not establish secure gameplay or
production readiness. No remote CI run or release was performed.


The codec/discovery pass reduced 28 diagnostics to 25. Join-code events now use
`P2PChannel['events']` from the actual public interface, and DHT offer payloads
must be strings before decoding. Compression streams receive an owned byte
buffer. A new test with native compression enabled reproduced an unhandled
rejected write when falling back to an uncompressed legacy code; the codec now
consumes and observes both sides of the stream concurrently. The prior codec
tests disabled native compression and could not cover this failure. All 56
codec/discovery tests pass without an unhandled stream error; root build passes.


The bootstrap/service pass reduced 25 diagnostics to 21. ENS resolution now uses
`getEnsText` directly instead of a nonexistent `getResolver` method. Resolver
regressions failed in six cases before the fix; all 12 now pass, covering cache
validation, malformed ENS lists and denied browser storage during refresh.
The libp2p service map now describes actual identify/ping instances, not service
factories. Combined resolver/DHT checks pass 51 tests. The six gossip-adapter
errors expose an absent pubsub service and an incorrect message-listener API;
these remain runtime work, not a type assertion opportunity.


The gossip integration pass reduced 21 diagnostics to 15. Both libp2p node
constructors now install a strictly signed pubsub service. The adapter consumes
message event details, filters room/topic, checks the signed author against the
claimed lobby sender, validates payload shapes, bounds input, and cleans up
listeners/timers. Version 17.1.1 required deduplicating compatible major versions
of the libp2p interface, utilities, internal interface and peer collections; the
initial mixed dependency graph failed typechecking and was not cast away.
All 71 adapter, real loopback gossip, DHT and IPFS tests pass; root build passes.
Remaining diagnostics are the registry board type and One Piece source types.


The registry pass reduced 15 diagnostics to 13. Each registration is checked
against its actual state/board props before entering the heterogeneous list;
crypto games may have a distinct state type. The registry no longer erases game
state with `as Game` or coerces Battleship's board to unknown state. Runtime
lookup tests and a negative compile-time board compatibility check pass. One
Piece's module type now imports the existing public module API rather than the
removed `../types` path. All remaining diagnostics are in One Piece game.ts.

The new runtime import test also reproduced a Yarn PnP error: wagmi 2.19.5 does
not forward @tanstack/query-core to @wagmi/core's query helpers. The version-scoped
.yarnrc.yml package extension forwards that peer from the frontend's existing
dependency. Cached installation skipped build scripts; the registry import and
root build now pass.


The One Piece protocol-state pass reduced the last 13 diagnostics to zero.
The deck-loading game now initializes the public protocol fields its existing
key-exchange handlers require, using the same initializer as the encrypted
variant while retaining its own board zones/configuration. An explicit mode
keeps plaintext peek behavior separate from encrypted-zone operations. Shared
crypto handlers preserve their caller's state type, and proof/visibility helpers
require only the fields they use. Decryption-share move arguments use the actual
EncryptedCard payload type. Initial heartbeat state is deterministic.

All 247 One Piece tests pass, including ordinary deck loading through two-seat
public-key admission, preservation of board zones, and clock-independent setup.
The three local-page Chromium checks and root build pass. Private-key encryption
is still not registered as a multiplayer move; a secure encryption/shuffle path
and encrypted gameplay integration remain unfinished.
