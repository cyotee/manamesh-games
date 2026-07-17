# Poker Adversarial Next Wave (S1–S10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** **Complete** (S1–S10 implemented and verified 2026-07-15)  
**Date:** 2026-07-15  
**Verification:** TS 230 passed (`mentalPoker` + `crypto.adversarial` + `hands` + `settlementClient`); Foundry adversarial 54 passed.  
**Goal:** Close remaining high-ROI adversarial and integration gaps after the settlement suite (A1–A14), mental-poker privacy suite (M1–M12), coverage gaps (G1–G7), and residual offline models (R1–R6).

**Architecture:** Extend existing harnesses and Foundry adversarial layout — no parallel test frameworks. Prefer production handlers (`crypto.ts`, settler diamond via `TestBase_PokerSystem` / `PokerDeployLib`) over theater. New threat IDs **S1–S10** map into `packages/poker/docs/ADVERSARIAL_TESTS.md`.

**Tech Stack:** Vitest, Foundry (solc 0.8.30), `@manamesh/poker`, `@manamesh/boardgameio-crypto`, Crane diamond deploy.

**Related docs / prior plans (Phase 1 — done):**
- `docs/superpowers/plans/2026-07-15-poker-adversarial-tests.md` — A1–A14, C1–C4
- `docs/superpowers/plans/2026-07-15-mental-poker-adversarial-suite.md` — M1–M12, 2–5p
- `packages/poker/docs/ADVERSARIAL_TESTS.md` — living threat index (G1–G7, R1–R6, A13, A4e, multiplayer)
- Harness: `packages/poker/src/mentalPoker.harness.ts` (`runMentalPokerSetup`, `progressiveCoopPeekHand`, `TABLE_SIZES`)

**Why this wave:** Attack-class coverage for vault theft and single-key privacy is strong. Remaining risk sits at **integration seams** (multi-street → settlement), **malicious-but-well-formed peels**, **multi-winner / side-pot economics**, **oracle/token edge cases**, and the **live settlement client** path.

---

## Global constraints

- **No theater:** Real keys, real peels, real diamond for on-chain SUT.
- **No reimplementation:** Call exported production handlers; do not copy decrypt loops into tests.
- **Economic asserts on-chain:** Attacker vault balance non-increasing; token balance == sum of vault ledgers where applicable.
- **Players sorted ascending** in `HandInit`; force-timeout needs full `lastRoundSignatures`.
- Precompute staticcall helpers **before** `vm.expectRevert`.
- Update `packages/poker/docs/ADVERSARIAL_TESTS.md` as each S-ID lands.
- Do not mark deployment TASK.md complete unless S9 (BlockchainService) is fully productized — this plan is primarily **security/integration tests**.
- Do not commit secrets; hermetic local/anvil only.

---

## Phase 1 status (already green — do not re-implement)

| Layer | Coverage | Verification |
|-------|----------|--------------|
| On-chain A1–A14 + S4/S5/S6/S8 | Settlement attacks, multiplayer, multi-winner, force-timeout N≥3, oracle mid-hand, FoT residual | `forge test --match-path tests/foundry/adversarial/*` → 54 passed |
| Off-chain C1–C4 | Identity, invalid share, stall abort, phase guards | `crypto.adversarial.test.ts` |
| Mental poker M1–M12 | SRA privacy, workflow, 2–5p subset privacy | `mentalPoker.*` + `sra.privacy.test.ts` |
| Gaps G1–G7 | Full peek, community, shuffle multiset, malicious encrypt, Shamir, bridge, credentials | `mentalPoker.gaps.adversarial.test.ts` |
| Residuals R1–R6 | P2P binding, ZK limits, timing, UI residual, handId conflict model, full-hand smoke | `mentalPoker.p2p` + `mentalPoker.residual` |
| TS adversarial total | — | 140 tests green (`src/mentalPoker` + `crypto.adversarial`) |

---

## Threat model (this wave)

| ID | Priority | Concern | Stack | Attack if false |
|----|----------|---------|-------|-----------------|
| **S1** | P0 | Multi-street crypto hand → settlement artifact | TS | Settlement built from incomplete/wrong cards/stacks |
| **S2** | P0 | Wrong / out-of-order progressive peels | TS | Malicious-but-valid shares complete or corrupt reveal |
| **S3** | P0 | Concurrent / overlapping decrypt requests | TS | Abort or complete one request poisons another |
| **S4** | P1 | Multi-winner + side-pot settle | Foundry + TS | Split/side-pot conservation broken or unpaid winners |
| **S5** | P1 | Force-timeout N≥3 | Foundry | Forfeit/refund wrong under multi-seat |
| **S6** | P1 | Oracle rake/operator change mid-hand | Foundry | Mid-hand config change breaks conservation or siphon |
| **S7** | P1 | Hand eval TS ↔ Solidity parity | TS + Foundry vectors | Verifier accepts TS-built false winners |
| **S8** | P2 | Fee-on-transfer / rebasing ERC20 | Foundry | Ledger drifts from token balance |
| **S9** | P2 | Live `BlockchainService` (mocked viem) | TS / frontend | Production wiring double-credits or skips assert |
| **S10** | P2 | Key-exchange adversarial | TS | Duplicate/invalid pubkeys accepted into encrypt |

### Explicitly lower priority (document only unless requested)

- Live WebRTC/TURN MITM (R1 models game-layer only)
- Live mainnet MEV ordering (A5 double-settle covers contract side)
- Constant-time SRA / gas benchmarks
- UI abandonment timer (after product surface exists)
- Full product ZK shuffle proofs

---

## File map (planned)

| Path | Responsibility |
|------|----------------|
| `packages/poker/src/mentalPoker.streets.adversarial.test.ts` | **S1** multi-street → `buildHandResult` / `buildSettlement` |
| `packages/poker/src/mentalPoker.peel.adversarial.test.ts` | **S2** wrong/out-of-order/no-progress peels |
| `packages/poker/src/mentalPoker.concurrent.adversarial.test.ts` | **S3** concurrent decrypt requests |
| `packages/poker/src/mentalPoker.keyExchange.adversarial.test.ts` | **S10** key-exchange adversarial |
| `packages/poker/src/hands.parity.test.ts` (or extend `hands.test.ts` + vectors) | **S7** TS eval vectors |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_MultiWinner.t.sol` | **S4** multi-winner / side-pot |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_ForceTimeoutMulti.t.sol` | **S5** force-timeout N=3+ |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_OracleMidHand.t.sol` | **S6** oracle mid-hand |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_FeeOnTransfer.t.sol` | **S8** fee-on-transfer token |
| `packages/poker/tests/foundry/verifier/` or `parity/` vectors | **S7** Solidity side of parity |
| Frontend / service tests under manamesh frontend (S9) | Mocked viem BlockchainService |
| `packages/poker/docs/ADVERSARIAL_TESTS.md` | Index S1–S10 |
| `packages/poker/tests/foundry/adversarial/README.md` | Foundry rows for S4–S6, S8 |

Reuse (do not fork):
- `mentalPoker.harness.ts`
- `AdversarialHelpers.sol` / `TestBase_PokerSystem.sol`
- `buildSettlement` / `buildHandResult` / signing helpers

---

## Suggested implementation order

```
S2 → S3 → S1 → S7 → S4 → S5 → S6 → S10 → S8 → S9
```

Rationale: peel correctness (S2/S3) underpins multi-street (S1); eval parity (S7) underpins multi-winner settle (S4); oracle/token (S6/S8) are independent Foundry tracks; S9 is product-facing and largest.

Parallelization: Foundry tasks (S4–S6, S8) can run as one subagent stream while TS tasks (S1–S3, S7, S10) run as another after S2 lands.

---

## Task S2: Wrong / out-of-order progressive peels (P0)

**Files:**
- Create: `packages/poker/src/mentalPoker.peel.adversarial.test.ts`
- May harden: `packages/poker/src/crypto.ts` (`approveDecrypt` / `submitDecryptedShare`) if bugs found

**Cases:**

1. Peel with **another player’s private key** (valid curve point, wrong layer) → no `hasPeeked`; request stays pending or `INVALID_MOVE`.
2. Peel that **does not reduce layers** (identity / same ciphertext) → rejected or ignored; cannot complete.
3. Peel that **increases layers** or garbage still-shaped as `EncryptedCard` → `INVALID_MOVE`, no approval recorded.
4. **Swapped multi-card array** (share for card[0] in slot[1]) → no completion with wrong ids; preferably `INVALID_MOVE`.
5. **Double-submit** after partial progress → second submit `INVALID_MOVE`.
6. N=2 and N=3 at minimum (`TABLE_SIZES` preferred).

**Asserts:**
- `hasPeeked === false` until all honest progressive peels done
- Zone layers never go to 0 under attacker-only peels
- Approvals/shares not granted on invalid peels

- [x] **Step 1:** Write failing adversarial cases against current progressive peel API.
- [x] **Step 2:** Fix production only if a real bug is found (smallest correct fix).
- [x] **Step 3:** Run

```bash
yarn workspace @manamesh/poker test src/mentalPoker.peel.adversarial.test.ts
```

- [x] **Step 4:** Index **S2** in `ADVERSARIAL_TESTS.md`.

---

## Task S3: Concurrent / overlapping decrypt requests (P0)

**Files:**
- Create: `packages/poker/src/mentalPoker.concurrent.adversarial.test.ts`

**Cases:**

1. Two seats open peeks concurrently; complete seat A fully without completing seat B.
2. Community decrypt open while hole peek pending; finish community without marking hole peeked.
3. `voteAbortDecrypt` voids stalled request **without** clearing an independent completed peek’s `hasPeeked` (define product rule if abort is global phase-void — document actual behavior and lock it with asserts).
4. Completion order independence: B then A vs A then B both recover correct ids.
5. N=2–3 minimum.

- [x] **Step 1:** Write cases with real `peekHoleCards` / community path / `approveDecrypt`.
- [x] **Step 2:** Document product semantics of abort vs multi-request in test header + ADVERSARIAL_TESTS.
- [x] **Step 3:** Green vitest; index **S3**.

---

## Task S1: Multi-street crypto → settlement artifact (P0)

**Files:**
- Create: `packages/poker/src/mentalPoker.streets.adversarial.test.ts`
- Extend harness if needed: street helpers (deal turn/river, progressive community peel all indices)

**Happy path (N=2, stretch N=3):**

1. `runMentalPokerSetup`
2. Progressive peek both (all) seats
3. Deal flop (3) → progressive peel all community indices
4. Deal turn (1) → peel
5. Deal river (1) → peel
6. Optional: mutate chips/pot/folded flags to a settleable shape (minimal betting stub OK if full betting integration is heavy)
7. `buildHandResult(G)` and/or `buildSettlement(...)` with player addresses, buy-ins, handId, rakeBps
8. Assert: hole + community card ids ⊆ `G.cardIds`, no unknowns, winners/stacks conservation at TS layer

**Negative:**
- `buildSettlement` / hand result refuses or flags incomplete peeks if API supports it
- Aborted decrypt → settlement path sees `abortedDecrypt` (tie to existing C3)

- [x] **Step 1:** Harness helpers for multi-street community peels.
- [x] **Step 2:** E2E street test + settlement artifact asserts.
- [x] **Step 3:** Green vitest; index **S1**.

---

## Task S7: Hand evaluation TS ↔ Solidity parity (P1)

**Files:**
- Create or extend: `packages/poker/src/hands.parity.test.ts` + Foundry vector consumer or shared JSON under `packages/poker/test-vectors/`
- Existing: `PokerHandEvaluator.t.sol`, `packages/poker/src/hands.ts`

**Cases (shared vectors):**

1. Royal flush vs junk  
2. Wheel straight vs Broadway  
3. Three-pair collapse to best two pair  
4. Identical hands → tie  
5. Kicker battles (pair Ace vs pair King)  
6. Full house vs flush vs quads ranking order  

**Method:** Encode cards as the same uint8 packing both sides already use (or map explicitly). Assert same winner index / tie set.

- [x] **Step 1:** Extract or define canonical vector table (JSON or TS const mirrored in Solidity).
- [x] **Step 2:** TS tests + Foundry tests consume same cases.
- [x] **Step 3:** Green both; index **S7**.

---

## Task S4: Multi-winner + side-pot settle (P1)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_MultiWinner.t.sol`
- Optional TS: settlement builder side-pot / split in `handOutcome` tests

**Cases:**

1. **Split pot:** two winners, two valid winner sigs, equal `payouts`, conservation `sum(finalStacks)+rake == pot`.
2. **Side-pot style stacks:** short stack all-in; `finalStacks` reflect main+side without overpaying.
3. **Mismatch:** `winners.length != payouts.length` reverts.
4. **Winner not in init.players** reverts (or documented forfeit path).
5. Verifier on for true ties (reuse evaluator tie acceptance).

**Asserts:** ledger intact; no third-party profit.

- [x] **Step 1:** Multi-winner happy path with verifier if feasible.
- [x] **Step 2:** Side-pot conservation case.
- [x] **Step 3:** Structural mismatch reverts + no-profit.
- [x] **Step 4:**

```bash
cd packages/poker && forge test --match-path tests/foundry/adversarial/PokerHandSettler_MultiWinner.t.sol -vv
```

- [x] **Step 5:** Index **S4** in docs + adversarial README.

---

## Task S5: Force-timeout multi-player (P1)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_ForceTimeoutMulti.t.sol`

**Cases (N=3 minimum; N=5 stretch):**

1. All winners sign → paid; conservation holds.
2. One declared winner **unsigned** → forfeit to operator; other signed winners paid.
3. Incomplete `lastRoundSignatures` reverts.
4. Early force-timeout reverts; boundary success.
5. Attacker (non-player) calling force-timeout cannot extract vault profit beyond rules (A11 multi-seat).

- [x] **Step 1:** Helper to fund/sign N sorted seats (extend `TestBase` or local helpers).
- [x] **Step 2:** Cases above with balance snapshots.
- [x] **Step 3:** Forge green; index **S5**.

---

## Task S6: Oracle config change mid-hand (P1)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_OracleMidHand.t.sol`

**Cases:**

1. Assert hand under rake A; owner sets rake B; settle uses **whichever policy code implements** — lock with assert (live `configOf` vs snapshot).
2. Change **operator** mid-hand; rake credits correct address per policy.
3. Non-owner cannot change config (already A12 — thin cross-link).
4. Extreme: set rake to max-1 after assert; conservation still holds under new formula if live-read.

Document the intended invariant in the test header (recommended product rule: **settle uses oracle at settle time** vs **snapshot at assert** — implement tests for **actual** behavior; if product wants snapshot and code is live-read, file a fix task).

- [x] **Step 1:** Observe current settler code path for oracle read.
- [x] **Step 2:** Write tests locking actual behavior + economic integrity.
- [x] **Step 3:** Forge green; index **S6**.

---

## Task S10: Key-exchange adversarial (P2)

**Files:**
- Create: `packages/poker/src/mentalPoker.keyExchange.adversarial.test.ts`

**Cases:**

1. Duplicate public key for two seats rejected or documented unsafe.
2. Invalid / non-curve public key rejected.
3. Second `submitPublicKey` after already set → `INVALID_MOVE`.
4. Encrypt out of turn / wrong phase → `INVALID_MOVE`.
5. Encrypt after key exchange incomplete → `INVALID_MOVE`.

- [x] **Step 1:** Cases against real `submitPublicKey` / `encryptDeck`.
- [x] **Step 2:** Harden production if duplicates currently allowed and design forbids them.
- [x] **Step 3:** Green vitest; index **S10**.

---

## Task S8: Fee-on-transfer / rebasing token (P2)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_FeeOnTransfer.t.sol`
- Create: test token that takes fee on transfer/transferFrom

**Cases:**

1. Deposit with 1% fee: either **reverts / ledger matches actual received**, or document failure mode (current code likely credits requested amount → ledger ≠ token). Prefer **assert actual safe behavior** or **explicit known-limitation test** that fails until product decides (do not weaken production silently).
2. Withdraw path with fee-on-transfer to recipient.
3. Compare to normal ERC20Mock baseline.

**Product decision note:** If protocol will only support standard ERC20s, test should document “unsupported token class” and may assert broken invariant as known residual OR reject non-1:1 tokens if detection is feasible.

- [x] **Step 1:** FeeOnTransfer mock + diamond deploy with that token.
- [x] **Step 2:** Deposit/withdraw economic tests.
- [x] **Step 3:** Forge green or documented `vm.expectRevert` / skip-with-reason per product choice; index **S8**.

---

## Task S9: BlockchainService live path (mocked viem) (P2)

**Files (expected; adjust to repo layout):**
- Frontend/service under `packages/manamesh/packages/frontend/src/blockchain/` (or poker package service if extracted)
- Tests: unit with mocked public/wallet client

**Cases:**

1. `assertHandMembership` builds correct args from game state + signatures.
2. `settleHand` uses `buildSettlement` + EIP-712 domain (chainId, verifyingContract).
3. RPC failure / user reject does not mutate local balances optimistically without confirm.
4. Mock mode vs live mode switch — no double-credit.
5. playerID → address map required; missing map errors clearly.

Depends on TASK.md US for real settlement wiring. If service not yet implemented, this task **implements minimal service + tests** or **defers with checklist** — prefer implement minimal testable adapter.

- [x] **Step 1:** Locate/create BlockchainService interface + mock/live adapters.
- [x] **Step 2:** Unit tests with mocked viem.
- [x] **Step 3:** Index **S9**; cross-link `TASK.md` / `PREPAREDNESS_REPORT.md`.

---

## Documentation task (after each S-ID or as final)

**Files:**
- Modify: `packages/poker/docs/ADVERSARIAL_TESTS.md` — section **S1–S10**
- Modify: `packages/poker/tests/foundry/adversarial/README.md`
- Modify: `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md` (link this plan)
- Optional: readiness note in `PREPAREDNESS_REPORT.md` when S1+S9 land

```markdown
## Next-wave scenarios (S1–S10)

| ID | Concern | Test | Status |
|----|---------|------|--------|
| S1 | Multi-street → settlement | mentalPoker.streets… | … |
...
```

- [x] **Step 1:** Keep docs in sync as tasks complete.
- [x] **Step 2:** Final verification:

```bash
cd packages/poker && forge test --match-path tests/foundry/adversarial
yarn workspace @manamesh/poker test src/mentalPoker src/crypto.adversarial.test.ts src/hands
# + S9 package path when present
```

---

## Acceptance criteria (wave complete when)

- [x] **S1** green: multi-street peels produce settleable artifact with real card ids.
- [x] **S2** green: wrong/out-of-order/no-progress peels cannot complete opponent hand.
- [x] **S3** green: concurrent requests isolated per documented semantics.
- [x] **S4** green: multi-winner + side-pot conservation on diamond.
- [x] **S5** green: force-timeout N≥3 economic rules hold.
- [x] **S6** green: mid-hand oracle changes locked to actual policy + conservation.
- [x] **S7** green: shared eval vectors match TS and Solidity.
- [x] **S8** green or explicitly residual with fee-token test documenting limitation.
- [x] **S9** green (mocked viem settlement client + frontend dual path; live RPC residual documented).
- [x] **S10** green: key-exchange adversarial matrix.
- [x] Full Foundry adversarial + mentalPoker suites remain green (no regression of Phase 1).
- [x] `ADVERSARIAL_TESTS.md` indexes S1–S10.

---

## Notes for implementers

- Prefer extending `progressiveCoopPeekHand` / adding `progressiveCoopPeekZone(G, players, zoneId, indices)` over duplicating peel loops.
- If S2 finds that progressive zone mutation allows a single wrong-key peel to reduce layers: that may be **by design** (honest layer peel) — privacy still holds if layers remain >0; assert accordingly (same lesson as M5b).
- Multi-winner Foundry tests: build hole/community cards that the verifier accepts for ties; or disable verifier only if product diamond allows (prefer verifier on).
- Do not weaken A13/A14 invariants while adding S8.
- Stop and fix production bugs discovered by adversarial cases before expanding coverage.

## Out of scope for this wave

- Browser multi-tab WebRTC e2e
- Mainnet deployment / real RPC against public networks
- Replacing quickShuffle with ZK shuffle product feature
- Social engineering / phishing
- Gas benchmarking and MEV simulation frameworks
