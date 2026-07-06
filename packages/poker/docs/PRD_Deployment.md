**Poker Deployment Readiness – Product Requirements Document (PRD)**

**Version:** 1.0  
**Date:** 2026-06-24  
**Authors:** Grok (xAI) based on codebase analysis  
**Status:** Draft – Ready for review and prioritization  

> This PRD is derived directly from the [PREPAREDNESS_REPORT.md](./PREPAREDNESS_REPORT.md) in the same directory. It defines the work required to take the existing, well-tested poker module from "playable in development" to "production deployable."

---

## 1. Purpose

Deliver the final integration, deployment, and operational work needed so that the ManaMesh Texas Hold’em poker experience (standard + cryptographically fair mental-poker P2P) can be confidently deployed to testnet and subsequently mainnet/L2 environments.

The poker module already contains:
- Complete off-chain game logic, betting, hand evaluation, and mental-poker cooperative decryption.
- Production-quality on-chain settlement contracts (`PokerHandSettler` diamond + `BettingConfigOracle`).
- EIP-712 signing helpers and `buildSettlement()` utilities.
- A functional React board and P2P wiring.

**What is missing is the bridge to live contracts and the operational steps required for a real deployment.**

---

## 2. Background & Current State

See the companion **[PREPAREDNESS_REPORT.md](./PREPAREDNESS_REPORT.md)** for the full current-state assessment.

**High-level summary:**
- **Overall readiness:** ~70–75%
- **Test health:** All 107 Vitest tests + 68 Foundry tests pass. Builds are clean.
- **Primary blocker:** Settlement is still entirely mocked (`MockBlockchainService`). No calls are made to deployed `PokerHandSettler` contracts.
- Contracts have never been deployed on any network.
- Several supporting items (auth stub, abandonment UX, E2E with live chain, docs) remain.

The contracts PRD (`packages/manamesh/PRD_CONTRACTS.md`) and (historical) betting architecture doc previously defined the settlement model. Current details are in the poker package docs. Those contracts are now implemented. This PRD focuses on **finishing the system**.

---

## 3. Goals & Success Metrics

### Primary Goal
Make it possible for a user to:
1. Join a P2P poker table (2–6 players)
2. Play a full hand using mental-poker cryptography
3. Have the outcome correctly settled on-chain against real escrowed chip balances
4. Start the next hand with updated on-chain balances

### Success Metrics

| Metric                              | Target                                      | How Measured                              |
|-------------------------------------|---------------------------------------------|-------------------------------------------|
| Real settlement round-trip          | One complete hand settled on testnet        | Manual + automated test using live contracts |
| Contract deployment & config        | Oracle + ≥1 settler deployed + configured   | Deployment scripts + `setDefault` calls   |
| New-hand flow with live balances    | Post-settlement balances reflect on-chain   | Frontend receives updated balances from service |
| E2E P2P + crypto + settlement       | 2-player and 3+ player flows succeed        | Playbook + CI or manual sign-off          |
| Abandonment path                    | Timer + claim flow works end-to-end         | UI + contract test                        |
| Documentation & ops                 | Runbook allows a new engineer to deploy     | DEPLOYMENT.md or equivalent exists        |

---

## 4. Scope

### In Scope

**4.1 Settlement Integration Layer**
- Implement a real (viem-based) `BlockchainService` (or concrete implementation of the existing interface) that:
  - Uses `buildSettlement()` from `@manamesh/poker`
  - Performs EIP-712 signing via existing wallet hooks (`useSignHandResult`, `useSignFoldAuth`, etc.)
  - Calls `PokerHandSettler` functions (`assertHandMembership`, `settleHand`, `forceTimeoutSettlement`, etc.)
  - Handles address mapping (boardgame.io playerID ↔ wallet address)
- Support both full unanimous settlement and partial (FoldAuth + timeout) paths.
- Replace or augment the current mock service so that `settlePot(handResult)` performs on-chain work when a real provider is configured.

**4.2 Contract Deployment & Configuration**
- Production-ready deployment runbooks / scripts for `BettingConfigOracle` + per-token `PokerHandSettler` instances.
- Post-deployment configuration: `setDefault(...)` (rakeBps, timeouts, operator, etc.).
- Frontend configuration surface (env vars, config module, or on-chain discovery) for:
  - Chain ID / RPC
  - Oracle address
  - Settler address(es)
  - Token → scale factor mapping
  - Rake configuration

**4.3 Identity & Authentication Hardening**
- Implement or properly document `authenticateCredentials` on `CryptoPokerGame`.
- Ensure all decryption-related moves (`approveDecrypt`, `submitDecryptedShare`, `requestDecrypt`, `peekHoleCards`, etc.) strictly validate `ctx.playerID === playerId`.
- Consider binding player identity to wallet signatures for production P2P tables.

**4.4 Verification & Testing**
- End-to-end test or playbook exercising a full crypto hand → settlement → new hand using live contracts (testnet).
- Validation of >2 player flows.
- Testing of voided/aborted hands and abandonment paths against the real settler.

**4.5 User Experience Polish**
- Abandonment timer UI and "Claim Abandonment" flows in `PokerBoard.tsx` (and/or parent components).
- Clear surface for settlement errors, pending signatures, and transaction status.
- Consistent use of the crypto game variant for P2P poker experiences (dedicated poker page and main app).

**4.6 Documentation & Operations**
- Update root status documents (`PROJECT_STATUS.md`, etc.).
- Add a `DEPLOYMENT.md` (or equivalent) in the poker package or `docs/`.
- Gas usage notes for target L2s.
- Asset pack pinning / availability requirements for deployed frontends.

### Out of Scope (for this PRD)

- New game rules, variants, or UI themes.
- ZK hand verification (the Level-1 verifier facet is already present; full ZK is future work).
- Tournament, rebuy, or ring-game session features (see optional Phase 2 ideas in historical betting architecture doc).
- Changes to the core mental-poker primitives or betting engine (these are considered complete).
- Mobile apps or native clients.
- Mainnet deployment itself (this PRD targets "ready to deploy").

---

## 5. Functional Requirements

### FR-1: Real Settlement Service
- The service must be able to take the internal game-layer result (still called `PokerHandResult` / produced by `buildHandResult(G)` in `crypto.ts` for the boardgame.io callback) and convert it via `buildSettlement(state, opts)` into the on-chain `HandOutcome` + parallel data for `HandInit`.
- Must support both "normal" unanimous settlement and timeout-based settlement.
- Must correctly compute and submit rake.
- Must update local balances from on-chain state after successful settlement.

### FR-2: Address & Nonce Management
- Reliable mapping from in-game player identifiers to on-chain addresses (sourced from connected wallets).
- Correct handling of `playerHandNonces` (monotonic per player per hand).

### FR-3: Contract Interaction
- Use the types and ABIs from the poker package / generated artifacts.
- Proper error handling and transaction receipt waiting.
- Support for the Crane diamond selector routing.

### FR-4: Configuration
- Environment-driven or admin-configurable contract addresses and parameters.
- Graceful fallback or clear error when running in "mock" vs "live" mode.

### FR-5: Auth & Move Validation
- `authenticateCredentials` must provide at least basic non-empty credential enforcement in non-P2P contexts.
- All player-supplied identity fields in crypto moves must be validated against `ctx.playerID`.

### FR-6: Liveness & Abandonment
- UI must surface when a player has been inactive long enough to trigger timeout/abandonment claims.
- The frontend must be able to construct the appropriate partial signature set + last `RoundStateTransition` for force-timeout calls.

---

## 6. Non-Functional Requirements

- **Security:** All on-chain calls must use properly EIP-712 signed payloads. No trust in off-chain game state for value movement.
- **Reliability:** Settlement must be idempotent or safely retryable. Pending-hand locks must prevent double-spends.
- **UX:** Settlement latency should be communicated clearly (transactions can take time on L2).
- **Observability:** Key events (hand started, settlement submitted, balances updated) should be logged.
- **Compatibility:** Must continue to work with existing P2P transport, boardgame.io client, and mental-poker crypto stack.

---

## 7. Dependencies & Assumptions

**Dependencies**
- Deployed `PokerHandSettler` and `BettingConfigOracle` contracts (via the existing deployment scripts).
- Wallet connection (RainbowKit / wagmi / viem) already present in the frontend.
- Existing signing infrastructure (`src/wallet/signing/` and poker package EIP-712 helpers).
- The `BlockchainService` interface and mock implementation.

**Assumptions**
- Target environment is an EVM L2 (or mainnet) with reasonable gas costs.
- Players will connect with Ethereum-compatible wallets that can produce EIP-712 signatures.
- The current chip token / vault model (or a compatible ERC-20 escrow) is used.
- For P2P tables, identity is primarily enforced at the transport + move-validation layer (wallet binding is an additional hardening step).

---

## 8. Recommended Phased Plan

Follow the order from the Preparedness Report:

**Phase 1 – Settlement Wiring (Critical Path)**
1. Create / extend a live `BlockchainService` implementation.
2. Integrate `buildSettlement`, signing hooks, and contract calls in the `handleNewHand` flows (`App.tsx` and any poker-specific pages).
3. Update `PokerBoard` / parents to pass required wallet data.

**Phase 2 – Deploy & Configure**
1. Execute testnet deployment of oracle + settler(s) using existing scripts.
2. Call `setDefault` (and any token-specific overrides).
3. Wire addresses into frontend configuration.
4. Document the deployment process.

**Phase 3 – Identity, Auth & Hardening**
1. Implement `authenticateCredentials`.
2. Audit and strengthen `validatePlayerIdentity` usage on all decrypt moves.
3. Optional: bind table participation to wallet signatures.

**Phase 4 – Verification & Polish**
1. Full E2E playbook / automated test on testnet (2p + multi-player).
2. Abandonment timer + claim UI.
3. Error states, loading indicators for on-chain operations.
4. Ensure crypto variant is used for P2P poker sessions.

**Phase 5 – Documentation & Release Readiness**
1. Update status docs.
2. Create operational runbook (`DEPLOYMENT.md`).
3. Gas benchmarks.
4. Final security / code review focused on the new integration layer.

---

## 9. Acceptance Criteria (Overall)

- A full hand can be played P2P with mental-poker crypto and the result successfully settled on a testnet `PokerHandSettler` contract.
- After settlement, a new hand can be started and the players’ on-chain escrowed balances reflect the outcome (minus rake where applicable).
- Both normal settlement and at least one timeout/abandonment path work.
- All existing tests continue to pass.
- A new engineer can follow documented steps to deploy the contracts and run a poker table against them.
- No critical security issues (player impersonation in crypto moves, signature replay, incorrect accounting) are introduced.

---

## 10. Risks & Open Questions

**Risks**
- L2 gas costs or UX latency for settlement transactions could degrade experience (mitigate with optimistic UI + clear status).
- Multi-player (>2) mental-poker setup + settlement edge cases.
- Keeping the mock service working for development while adding live mode.

**Open Questions**
- Should settlement be triggered automatically by the host after gameover, or require explicit player action?
- Batch settlement of multiple hands (cheaper) vs per-hand (simpler UX)?
- Exact source of truth for "initial buy-in" amounts when using real escrows (should they come from on-chain `assertHandMembership` rather than client state?).
- Whether to surface the dedicated `/poker` page as a full crypto experience or keep it as a simpler demo.

---

## 11. References

- [PREPAREDNESS_REPORT.md](./PREPAREDNESS_REPORT.md) – Source of truth for current state and gaps.
- `docs/historical/POKER_BETTING_ARCHITECTURE.md` (historical)
- `packages/manamesh/PRD_CONTRACTS.md`
- `packages/poker/src/handOutcome.ts`, `signing.ts`, `crypto.ts`
- `packages/poker/contracts/`, `script/`
- `packages/manamesh/packages/frontend/src/blockchain/`
- `packages/manamesh/packages/frontend/src/wallet/signing/`

---

**Next Step Recommendation:** Prioritize Phase 1 (real settlement service implementation) and a testnet deployment. Once those two are complete, the poker game will be in a deployable state for controlled roll-out.

*This PRD is intentionally narrow and actionable. It treats the core game and contract implementations as complete and focuses on the integration and operational work required for deployment.*