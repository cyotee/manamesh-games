# Task: Poker Deployment Readiness

**Module:** `@manamesh/poker` (`packages/poker/`)  
**Related PRD:** [PRD_Deployment.md](./PRD_Deployment.md)  
**Related Report:** [PREPAREDNESS_REPORT.md](./PREPAREDNESS_REPORT.md)  
**Status:** Ready for execution  
**Created:** 2026-06-24  
**Dependencies:** None (builds on existing complete game logic, contracts, and signing helpers)  
**Scope:** Bridge the gap from "fully functional in dev with mocks" to "production-deployable on testnet/mainnet L2 with real on-chain settlement".

---

## Description

Implement the remaining work required to make the ManaMesh Texas Hold'em poker experience (both standard and cryptographically fair mental-poker P2P variants) ready for deployment.

The core components are already complete and well-tested:
- Full betting, hand evaluation, and game flow.
- Mental-poker cryptographic setup, cooperative decryption, and liveness protection in `CryptoPokerGame`.
- Production-quality on-chain contracts (`PokerHandSettler` diamond + `BettingConfigOracle`) with E2E Foundry tests.
- EIP-712 helpers (`handId.ts`, `signing.ts`) and `buildSettlement()` in `handOutcome.ts`.
- React board (`PokerBoard.tsx`) and frontend wiring (registry, App.tsx P2P flows).

The critical missing pieces are:
- Replacing the mock blockchain service with real viem + contract integration for settlement.
- Deploying and configuring the contracts.
- Hardening identity/auth for production P2P.
- Adding abandonment UX and performing full E2E verification with live contracts.
- Operational documentation.

**Goal:** After this task, a developer can deploy the contracts to a testnet, wire the frontend, play a full P2P crypto poker hand, and have the outcome correctly settled on-chain with updated balances for the next hand.

---

## Dependencies

- Existing `@manamesh/poker` package (logic, contracts, signing).
- Frontend wallet infrastructure (`packages/manamesh/packages/frontend/src/wallet/` including signing hooks and `useGameKeys`).
- `BlockchainService` interface and mock implementation.
- Deployment scripts in `packages/poker/script/`.
- P2P transport and boardgame.io client already integrated for poker.

No external MM- task dependencies (this is the integration/deployment capstone for poker).

---

## Phased Breakdown & User Stories

### Phase 1: Real On-Chain Settlement Wiring (Critical Path)

#### US-PD.1.1: Implement Live BlockchainService

As a poker integrator, I want a real (non-mock) implementation of `BlockchainService` that performs on-chain settlement using the existing poker signing and contract helpers so that hand outcomes move real escrowed value.

**Acceptance Criteria:**
- [x] Create `packages/manamesh/packages/frontend/src/blockchain/live-service.ts` (or extend the abstraction) that implements live settlement (S9: `LiveBlockchainService` + `@manamesh/poker` `LiveSettlementClient`; `settlePot(HandResult)` remains mock-only — live requires `settleFromState` / `settleHand`).
- [x] Live path calls `buildSettlement` / `prepareSettlementPayload` from `@manamesh/poker` to produce on-chain `HandOutcome` (unit-tested with mocked viem ports).
- [ ] Uses existing wallet signing hooks (`useSignHandResult`, `useSignFoldAuth`, `createHandResultData`, etc. from `src/wallet/signing`) — residual: wire winner EIP-712 HandOutcome sigs from connected wallets into `settleHand`.
- [x] playerID → address map required on live client (`requirePlayerAddresses` / `setPlayerAddresses`); missing map errors clearly.
- [x] Submits `assertHandMembership` / `settleHand` via injected viem-like write port (mocked tests green; real RPC residual).
- [ ] Handles both full unanimous settlement and FoldAuth + partial signature paths (force-timeout path not yet in client).
- [x] Returns transaction hash, updated balances (fetched after confirmed write only — no optimistic credit), and success status.
- [x] Supports configurable mode: "mock" vs "live" (`createBlockchainService` / `VITE_POKER_SETTLEMENT_MODE`).
- [x] Graceful error handling for failed txs / user reject without double-credit (S9 tests).

#### US-PD.1.2: Integrate Settlement into Poker Flows

As a player, after a hand ends I want the pot automatically (or explicitly) settled on-chain and the next hand to start with correct updated balances.

**Acceptance Criteria:**
- [ ] Update `packages/manamesh/packages/frontend/src/App.tsx` (`handleNewHand` for both LocalGame and P2PGame) to use the live service when available.
- [ ] Pass required data (addresses, handId, scale, rakeBps) from game state / wallet context into `buildHandResult` (game layer) then `buildSettlement` (on-chain layer).
- [ ] Update new-hand creation logic to fetch fresh balances from the blockchain service instead of (or in addition to) mock state.
- [ ] Ensure `onNewHand` callback in `PokerBoard.tsx` receives a usable `PokerHandResult` and triggers the real flow.
- [ ] Support both the dedicated `/poker` page (via PokerLobby) and the main app game selector.
- [ ] Existing mock behavior remains for development/offline use (feature flag or provider choice).

#### US-PD.1.3: Wire Address Mapping and Nonce Handling

As the system, I want reliable playerID → on-chain address mapping and correct `playerHandNonces` so settlement transactions match the `HandInit` used at hand start.

**Acceptance Criteria:**
- [ ] Implement a robust mapping service or hook that associates in-game player IDs with connected wallet addresses at game start / join.
- [ ] Persist or derive monotonic nonces per (player, table/hand) and include them when building `HandInit` / `HandOutcome`.
- [ ] Update any initial state creation for poker (`createCryptoInitialState` usage) to capture starting buy-ins from on-chain or signed escrow data where possible.
- [ ] Tests or integration checks that the data passed to `buildSettlement` produces a `BuiltSettlement` usable for on-chain verification.

**Files to Create/Modify (Phase 1):**
- New: `packages/manamesh/packages/frontend/src/blockchain/live-service.ts`
- New: `packages/manamesh/packages/frontend/src/blockchain/config.ts` (addresses, rpc, mode)
- Modify: `packages/manamesh/packages/frontend/src/App.tsx` (handleNewHand, game setup)
- Modify: `packages/manamesh/packages/frontend/src/pages/poker/PokerLobby.tsx` and `main.tsx` (if needed for address passing)
- Modify: `packages/poker/src/components/PokerBoard.tsx` (ensure onNewHand data is rich enough)
- Modify: `packages/manamesh/packages/frontend/src/blockchain/mock-service.ts` (keep as fallback, perhaps extract interface)
- Modify: `packages/manamesh/packages/frontend/src/blockchain/types.ts` (if interface needs updates)
- Modify: `packages/poker/src/crypto.ts` (if `buildHandResult` needs small adjustments for on-chain data)
- Tests: Add unit/integration tests for live-service (mocked viem calls at minimum)

---

### Phase 2: Contract Deployment & Frontend Configuration

#### US-PD.2.1: Execute and Document Contract Deployment

As a deployer, I want repeatable, documented steps to deploy the `BettingConfigOracle` and per-token `PokerHandSettler` instances.

**Acceptance Criteria:**
- [ ] Successfully run `script/DeployPokerSystem.s.sol` (or composed scripts) on a target testnet (e.g. Base Sepolia, Arbitrum Sepolia).
- [ ] Call `setDefault` (and any token overrides) on the oracle with sensible production values (rakeBps, timeouts, operator).
- [ ] Create `packages/poker/DEPLOYMENT.md` with:
  - Prerequisites (foundry, env vars like TOKEN, RPC, PRIVATE_KEY).
  - Exact commands.
  - Post-deploy verification steps (e.g. `cast` calls).
  - How to obtain addresses for frontend config.
- [ ] Update `packages/poker/README.md` with deployment section.
- [ ] (Optional) Add a simple hardhat/foundry script or make target for one-command deploy + configure.

**Files:**
- New: `packages/poker/DEPLOYMENT.md`
- Modify: `packages/poker/README.md`, `script/Deploy*.s.sol` (if minor improvements needed for logging)
- Modify (if helpful): `packages/poker/script/PokerDeployLib.sol`

#### US-PD.2.2: Surface Contract Config in Frontend

As the frontend, I want to consume deployed contract addresses and parameters without hard-coding.

**Acceptance Criteria:**
- [ ] Add configuration (env vars, `vite.config`, or runtime config) for:
  - `VITE_POKER_SETTLER_ADDRESS`
  - `VITE_BETTING_CONFIG_ORACLE_ADDRESS`
  - `VITE_POKER_CHAIN_ID`
  - `VITE_POKER_TOKEN_SCALE` (per token)
  - `VITE_POKER_RAKE_BPS`
- [ ] Live service reads this config.
- [ ] Clear error / dev-only fallback when config is missing.
- [ ] Document required env vars in root README or poker-specific docs.

**Files:**
- Modify: `packages/manamesh/packages/frontend/.env.example` (or create)
- Modify: `packages/manamesh/packages/frontend/vite.config.ts` or a config loader
- Modify: live-service and any poker page entrypoints

---

### Phase 3: Production Identity & Auth Hardening

#### US-PD.3.1: Implement authenticateCredentials

As a game host/relay, I want basic credential validation on `CryptoPokerGame` so that unauthenticated or mismatched players cannot join.

**Acceptance Criteria:**
- [ ] Replace the stub in `packages/poker/src/crypto.ts` (`CryptoPokerGame.authenticateCredentials`) with meaningful logic (at minimum require non-empty credentials; preferably validate wallet signature or token shape).
- [ ] Update call sites and any P2P lobby code that supplies credentials.
- [ ] Document the current trust model (P2P layer + move validation provide primary binding).

#### US-PD.3.2: Strengthen Move-Level Identity Binding

As a participant, I want decryption and setup moves to be strictly bound to the actual `ctx.playerID` so a malicious peer cannot impersonate another player’s cryptographic contributions.

**Acceptance Criteria:**
- [ ] Audit and ensure `validatePlayerIdentity(ctx.playerID, playerId)` is present at the very start of every relevant move handler in `crypto.ts` (submitPublicKey, encrypt, shuffle, peekHoleCards, requestDecrypt, approveDecrypt, submitDecryptedShare, releaseKey, etc.).
- [ ] Add early returns with `INVALID_MOVE` on mismatch (already partially present — make comprehensive).
- [ ] Add or extend tests for impersonation attempts (negative test cases).
- [ ] Consider centralizing the guard in a shared helper if not already.

**Files:**
- Modify: `packages/poker/src/crypto.ts`
- Modify: `packages/poker/src/crypto.test.ts` (add adversarial identity tests)
- Possibly: `packages/boardgameio-crypto/` if a stronger shared guard is warranted

---

### Phase 4: E2E Verification, Liveness UX & Polish

#### US-PD.4.1: Full End-to-End Test with Live Contracts

As a tester, I want a documented (and ideally automated) way to play a complete crypto poker hand and settle it against a live testnet settler.

**Acceptance Criteria:**
- [ ] Playbook or script in `packages/poker/` or `docs/` that:
  - Starts two (or more) browser instances or uses test harness.
  - Completes key exchange → encrypt → shuffle → full betting streets.
  - Performs cooperative reveals.
  - Triggers gameover + settlement.
  - Verifies on-chain balances changed correctly.
- [ ] Covers at least one normal settlement and one fold/abort path.
- [ ] Test >2 player setup if practical.
- [ ] Existing unit tests continue to pass (no regression).

#### US-PD.4.2: Abandonment Timer & Claim UI

As a player, when someone disconnects I want to see a timer and be able to claim abandonment after timeout so stalled hands can be resolved on-chain.

**Acceptance Criteria:**
- [ ] Add inactivity/abandonment timer display in `PokerBoard.tsx` (or shared component) during active play phases.
- [ ] Enable "Claim Abandonment" button after the configured timeout (align with oracle/settler config).
- [ ] Wire the action to construct the necessary partial signatures + last round state and call the appropriate settler function.
- [ ] Handle resulting voided hand state and settlement impact.
- [ ] Visual feedback for abandoned vs normal resolution.

**Files:**
- Modify: `packages/poker/src/components/PokerBoard.tsx`
- Modify: `packages/poker/src/types.ts` (if new state needed)
- Possibly update `crypto.ts` move for abandonment claim if new game move required
- Add tests for timer logic (client-side or mocked)

#### US-PD.4.3: Settlement UX Polish

As a player, I want clear feedback during and after on-chain settlement.

**Acceptance Criteria:**
- [ ] Loading / pending transaction states in the hand-complete screen.
- [ ] Success / failure banners with tx hash links (to block explorer).
- [ ] Automatic or manual refresh of balances before starting next hand.
- [ ] Edge cases: settlement while another player is offline, gas estimation errors, etc.

---

### Phase 5: Documentation, Status & Release Prep

#### US-PD.5.1: Update Status & Add Operational Docs

**Acceptance Criteria:**
- [ ] Update `packages/manamesh/PROJECT_STATUS.md`, `PROGRESS.md` (or equivalent) to reflect new readiness.
- [ ] Add / update `packages/poker/README.md` with "Deployment" and "Live Settlement" sections.
- [ ] Ensure `DEPLOYMENT.md` (from Phase 2) is complete and referenced.
- [ ] Add notes on asset pack requirements for card images in deployed frontends.
- [ ] (Stretch) Gas cost table for L2s in the docs.

#### US-PD.5.2: Verify Crypto Path is Default for P2P

**Acceptance Criteria:**
- [ ] Confirm that P2P / lobby flows for "Texas Hold'em" use `CryptoPokerGame` (not the standard variant) in both the dedicated page and main selector.
- [ ] Update any remaining references that defaulted to standard `PokerGame`.

---

## Technical Details

- Settlement must preserve the existing off-chain mental poker guarantees (no on-chain card logic; only outcome + signatures).
- Use viem for all contract interactions (already a dependency).
- Prefer reusing the types and helpers already exported from `@manamesh/poker` (`buildSettlement`, `sign*`, `deriveHandId`).
- Mode switching (mock vs live) should be clean so CI/dev can stay fast while prod uses real contracts.
- All new on-chain calls must be covered by at least basic happy-path + error tests (even if using viem mocks).
- Keep backward compatibility for any external consumers of the poker package exports.

Key integration points:
- `buildHandResult(G)` → richer data for `buildSettlement`.
- Wallet `useSignHandResult` / `HandResultTypes`.
- `PokerHandSettler.settleHand` / `forceTimeoutSettlement` (see contracts for exact signatures).
- Oracle for `rakeBps` and other config.

---

## Files to Create/Modify (Summary)

**High Priority / Phase 1**
- `packages/manamesh/packages/frontend/src/blockchain/live-service.ts` (new)
- `packages/manamesh/packages/frontend/src/blockchain/config.ts` (new or extend)
- `packages/manamesh/packages/frontend/src/App.tsx`
- `packages/poker/src/components/PokerBoard.tsx` (minor)
- `packages/manamesh/packages/frontend/src/blockchain/types.ts`

**Phase 2**
- `packages/poker/DEPLOYMENT.md` (new)
- `packages/poker/README.md`
- Env / config files in frontend

**Phase 3**
- `packages/poker/src/crypto.ts`
- `packages/poker/src/crypto.test.ts`

**Phase 4**
- `packages/poker/src/components/PokerBoard.tsx`
- New or updated E2E test / playbook (e.g. `packages/poker/docs/E2E_SETTLEMENT.md` or in frontend tests)
- Possibly small additions to `packages/poker/src/crypto.ts` or types for abandonment

**Phase 5**
- Root status docs
- `packages/poker/README.md`
- Possibly `packages/poker/DEPLOYMENT.md` refinements

**Tests**
- Unit tests for live service (mocked)
- Adversarial identity tests in poker crypto tests
- Integration / manual E2E verification

---

## Inventory Check (Before Starting Work)

- [ ] Verify current tests still pass: `cd packages/poker && yarn test && forge test`
- [ ] Confirm wallet signing hooks exist and are exported (`useSignHandResult`, `HandResultTypes`, etc.).
- [ ] Confirm `buildSettlement` and contract ABIs/types are usable from the poker package.
- [ ] Have a testnet RPC and deployer key ready for Phase 2.
- [ ] Confirm the current `BlockchainService` interface in `frontend/src/blockchain/types.ts`.

---

## Completion Criteria

- [ ] All user stories across phases have their acceptance criteria checked off.
- [ ] Full happy-path crypto poker hand can be played P2P and settled against live testnet contracts, with correct balance updates for the next hand.
- [ ] At least one abandonment/timeout path works end-to-end.
- [ ] All existing tests (107 vitest + 68 foundry) continue to pass with no regressions.
- [ ] `DEPLOYMENT.md` exists and a fresh engineer can follow it to deploy + configure.
- [ ] Frontend can be configured for live mode via environment variables.
- [ ] Documentation (READMEs + status files) is updated.
- [ ] Security-sensitive changes (identity binding, auth) have been reviewed.
- [ ] Build succeeds cleanly for both `packages/poker` and the main frontend.

---

**When this task is complete, the poker module should be considered ready for controlled deployment to testnet and subsequent limited production use.**

**If blocked, clearly document the blocker and affected phase.**

---

*This TASK.md is the actionable companion to PRD_Deployment.md and the Preparedness Report.*