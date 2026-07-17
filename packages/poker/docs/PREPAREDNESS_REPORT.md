# Poker Game Deployment Preparedness Report

**Module:** `@manamesh/poker` (`packages/poker/`)  
**Report Date:** 2026-06-24  
**Branch:** `feat/manamesh-crypto-and-poker-contracts`  
**Scope:** Texas Hold'em (standard + cryptographically fair mental-poker P2P variant), including betting, hand evaluation, cooperative decryption, EIP-712 signing helpers, and on-chain settlement contracts (`PokerHandSettler` + `BettingConfigOracle`).

---

## Executive Summary

The poker game is **substantially complete** for a playable, cryptographically fair P2P experience and has production-quality contracts + helpers. Core logic, mental-poker cryptography, betting, UI, tests, and on-chain artifacts are in good shape.

**It is not yet ready for production deployment.** The primary blocker is **real on-chain settlement**: the frontend still uses a mock blockchain service. Contracts are implemented and tested but have never been deployed. Minor gaps remain in production identity wiring, operational deployment processes, and end-to-end verification with live contracts.

**Overall Readiness:** ~70-75% toward production deployment.  
**Estimated remaining effort:** 1-2 focused engineering weeks (primarily settlement wiring + deployment + verification).

---

## Test & Build Health

| Check                  | Status     | Details |
|------------------------|------------|---------|
| Vitest (TS)            | ✅ Pass   | 107 tests, 7 files (betting, hands, crypto, handId, signing, handOutcome, parity vectors). No skips. |
| Foundry (Solidity)     | ✅ Pass   | 68 tests across 13 suites (settler E2E, oracle, verifier, integration deploy, hand evaluation). |
| `forge build`          | ✅ Clean  | Succeeds (minor non-blocking `asm-keccak256` lint notes in SignatureLib). |
| TypeScript             | ✅ Clean  | Package typechecks cleanly. |
| Package Exports        | ✅        | `index.ts` cleanly exports game, board, signing, handId, handOutcome, betting, etc. |

---

## Completed / Production-Ready Components

### Game Logic & Betting (Standard + Crypto)
- Full Texas Hold'em rules: blinds, preflop/flop/turn/river/showdown, side pots, all-in, folding.
- Betting round state machine, active player rotation, valid action computation.
- Hand evaluation (`hands.ts`), winner determination (including splits).
- `buildHandResult()` in crypto variant produces settlement-ready data (contributions, payouts, winners, abortedDecrypt flag).

### Cryptographic (Mental Poker) Flow
- SRA commutative encryption (key exchange → encrypt deck → shuffle).
- Cooperative decryption for hole cards (`peekHoleCards`, `requestDecrypt`/`approveDecrypt`) and community cards.
- Progressive layer peeling, owner-decrypts-last semantics.
- Liveness protection: `voteAbortDecrypt`, stall window (`POKER_DECRYPT_STALL_WINDOW_MOVES`), voided state.
- All crypto + betting moves use `client: false`.
- Validation: `validatePlayerIdentity`, `validateEncryptedCard`, `secpIsValidPointHex` usage.
- Auto-setup orchestration in `PokerBoard.tsx` (keyExchange → encrypt → shuffle).

### UI / Board (`PokerBoard.tsx`)
- Supports both `PokerPhase` and `CryptoPokerPhase`.
- Betting controls, player status (folded/all-in/dealer/blinds), community cards, pot display.
- Encrypted vs. peeked card rendering.
- Cooperative decrypt request/approval UI + notifications.
- Crypto setup progress UI.
- "Deal Next Hand" / game-over flow with `onNewHand` callback (passes `handResult`).

### Smart Contracts
- `PokerHandSettler` (Crane diamond + facets: facet, repo, target, errors, DFPkg).
- `BettingConfigOracle` (shared across tokens, owner-configurable rake/defaults).
- Verifier facet + `PokerHandEvaluator`.
- Supporting libs: `SignatureLib`, `PokerSettlementHashLib`, `HandIdLib`.
- Full type structs: `HandInit`, `HandOutcome`, `RoundStateTransition`.
- Deployment scripts: `DeployPokerSystem.s.sol`, `DeployPokerHandSettler.s.sol`, `DeployBettingConfigOracle.s.sol`, `PokerDeployLib.sol`.
- E2E integration tests covering deposit → settle → withdraw, timeout/abandonment, verifier rejection, multi-token oracle sharing.

### Off-Chain Signing & Settlement Prep
- `src/handId.ts` (`deriveHandId`).
- `src/signing.ts` (EIP-712 domains + signers/recoverers for HandInit, HandOutcome, RoundStateTransition, etc.).
- `src/handOutcome.ts` (`buildSettlement`, `encodeCard`, `BuiltSettlement` interface).
- Correct handling of rake, scaling, parallel arrays sorted by address, final stacks + hole/community cards.

### Frontend Integration
- Registry (`game/registry.ts`) exposes `getCryptoGame: () => CryptoPokerGame`.
- Main app (`App.tsx`) selects crypto variant for poker, injects `initialBalances`/`handId`, wraps board with settlement callback.
- Dedicated P2P poker page + `PokerLobby.tsx` (join-code matchmaking).
- Blockchain service abstraction (`BlockchainService` interface) with mock implementation.

### Other
- Stable P2P client patterns and security mitigations documented in `docs/GAME_FLOW_AND_SECURITY.md`.
- Package is self-contained with its own `foundry.toml`, `lib/`, `tsconfig`, and scripts.

---

## Remaining Gaps & Blockers

### Critical (Must Fix for Deployment)
1. **Real On-Chain Settlement Wiring**
   - **S9 progress (2026-07-15):** Testable dual path landed.
     - `@manamesh/poker` `settlementClient.ts` — `prepareSettlementPayload`, `buildAssertHandCall` / `buildSettleHandCall`, `LiveSettlementClient` with injected viem-like ports (18 unit tests, no real RPC).
     - Frontend `live-service.ts` + extended `BlockchainService` (`assertHandMembership`, `settleHand`, `settleFromState`, `mode`) + mock fallback + `createBlockchainService` factory + env config helper.
   - **Still residual for deploy:**
     - Default `App.tsx` still calls mock `settlePot(HandResult)` — not yet wired to `settleFromState` + wallet-signed HandOutcome.
     - No deployed settler/oracle addresses or live viem clients in production config.
     - Winner EIP-712 signing from connected wallets and FoldAuth / force-timeout client paths incomplete.
   - References: S9 in `ADVERSARIAL_TESTS.md`, `TASK.md` US-PD.1.1, `App.tsx` (handleNewHand), `mock-service.ts` / `live-service.ts`.

2. **Contract Deployment & Configuration**
   - No contracts have been deployed on any network.
   - Post-deploy oracle configuration (`setDefault` / token overrides for `rakeBps`, timeouts, etc.) is manual and undocumented in ops runbooks.
   - No environment/config surface in frontend for deployed addresses, chain ID, scale factor, or oracle address.

### Important
3. **Production Identity / Auth**
   - `authenticateCredentials` in `CryptoPokerGame` is a stub (`return true`).
   - Explicit TODO: "integrate real credentials (e.g. signed player tokens) when relay is added."
   - P2P security currently relies on boardgameIO-p2p layer + per-move `validatePlayerIdentity`.

4. **End-to-End Verification with Real Settlement**
   - Full round-trip (crypto setup → multi-street betting → cooperative reveals → gameover → on-chain settle → new hand with live balances) has not been exercised.
   - Limited validation of >2 player crypto flows.

5. **Abandonment / Liveness UX**
   - Timer UI and "Claim Abandonment" flows are not surfaced (per betting architecture doc).
   - `challengeVoid` and abort paths exist in logic but have limited UI.

### Lower / Polish / Ops
- Dedicated `/poker` standalone page currently wires the **standard** `PokerGame`; crypto path is primarily exercised via main app.
- Asset pack availability / pinning for deployed frontends not documented.
- Some outdated status in root docs (`PROJECT_STATUS.md` still describes crypto poker as ~40% with stubs).
- Operational deployment guide for contracts + frontend pages (IPFS chunks or hosting) missing.
- Minor: debug console logs, fallback key generation, placeholder community card handling during decrypt.

---

## Security Posture (Summary)

- All cryptographic primitives remediated in prior passes (real SHA-256, point normalization, encrypted Shamir shares where used, rejection sampling, etc.).
- Poker crypto uses the shared `@manamesh/boardgameio-crypto` primitives.
- `client: false` + identity validation on sensitive moves.
- `buildHandResult` correctly flags aborted decrypts for settlement impact.
- Remaining items noted in older `SECURITY_REPORT.md` (R1/R2 around share validation and caller-supplied playerId) appear addressed in the refactored `packages/poker/src/crypto.ts`, but a fresh targeted review against the current package is recommended before mainnet.

---

## Path to Deployment Readiness (Recommended Order)

1. **Implement real `BlockchainService`** (viem-based)
   - Replace or extend mock with contract calls using `buildSettlement` + poker signing helpers.
   - Wire player address mapping (from wallet hooks).
   - Support both full settlement and fold-auth paths.

2. **Deploy & Configure Contracts**
   - Deploy `BettingConfigOracle` + at least one `PokerHandSettler` (testnet first).
   - Seed oracle config.
   - Export addresses + config into frontend (env or config module).

3. **Close Identity/Auth Gap**
   - Implement or document `authenticateCredentials` (wallet signature binding or relay token).
   - Ensure all decrypt-related moves strictly enforce `ctx.playerID`.

4. **E2E Validation**
   - Exercise full crypto poker + live settlement roundtrip (2p + 3p+).
   - Test void/abort + abandonment paths end-to-end.

5. **UI / Ops Polish**
   - Abandonment timer + claim UI.
   - Ensure crypto path is the default for P2P poker experiences.
   - Update root status docs + add `DEPLOYMENT.md` or runbook in poker package.
   - Pin / document required asset packs for card images.

6. **Documentation & Release**
   - Finalize `PREPAREDNESS_REPORT.md` updates.
   - Gas benchmarks (L2 vs mainnet) if targeting specific chains.
   - Security sign-off.

---

## Files of Interest

**Core Poker Logic**
- `src/game.ts`, `src/betting.ts`, `src/hands.ts`, `src/crypto.ts`, `src/types.ts`
- `src/components/PokerBoard.tsx`
- `src/index.ts` (exports)

**Settlement / On-Chain**
- `src/handId.ts`, `src/signing.ts`, `src/handOutcome.ts`
- `contracts/settler/`, `contracts/oracle/`, `contracts/verifier/`, `contracts/lib/`
- `script/Deploy*.s.sol`, `script/PokerDeployLib.sol`
- `tests/foundry/`

**Frontend Integration Points**
- `packages/manamesh/packages/frontend/src/game/registry.ts`
- `packages/manamesh/packages/frontend/src/App.tsx` (P2PGame, LocalGame, handleNewHand)
- `packages/manamesh/packages/frontend/src/blockchain/` (mock-service, types, wallet)
- `packages/manamesh/packages/frontend/src/pages/poker/`

**Docs**
- `docs/GAME_FLOW_AND_SECURITY.md`
- `docs/historical/POKER_BETTING_ARCHITECTURE.md` (historical)
- `packages/manamesh/PRD_CONTRACTS.md`
- Root `PROJECT_STATUS.md`, `SECURITY_REPORT.md`

---

## Conclusion

The poker module has a **solid, well-tested foundation**. The cryptographic fairness model, betting engine, board, and settlement contract suite are ready for integration. The missing pieces are primarily **bridging to live contracts** and **operational deployment**.

Once real settlement is wired and contracts are deployed/configured on a target network, the game will be in a strong position for a controlled deployment (testnet → limited mainnet / private tables).

**Next recommended action:** Implement the real blockchain settlement service and perform a testnet deployment of the oracle + settler.

---

*Report generated from codebase inspection, test runs (`yarn test`, `forge test`), build verification, and cross-reference with project documentation on 2026-06-24.*