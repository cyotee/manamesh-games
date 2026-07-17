# Poker Adversarial Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Phase 1 **complete** (A1–A14, C1–C4, A13 reentrancy, A4e chainId, multiplayer N=3/5/9).  
**Next wave:** Work remaining scenarios from  
[`2026-07-15-poker-adversarial-next-wave.md`](./2026-07-15-poker-adversarial-next-wave.md) (**S1–S10**).

**Goal:** Prove that known attack classes against ManaMesh poker settlement and mental-poker crypto cannot extract value or corrupt hand state, via explicit multi-step adversarial tests (not only isolated `expectRevert` unit cases).

**Architecture:** Split coverage into three layers: (1) on-chain `PokerHandSettler` / oracle / verifier exploit scenarios under Foundry using production diamond deploy (`TestBase_PokerSystem` / `PokerDeployLib`); (2) Foundry invariant + handler fuzz over escrow conservation; (3) off-chain TypeScript adversarial tests for move-level identity binding and decrypt liveness. Prefer real contracts and real game functions over mocks for the subject under test (Crane production-first testing).

**Tech Stack:** Foundry (solc 0.8.30, prague), Crane `CraneTest` / `Behavior_IFacet`, Vitest, `@manamesh/poker` TS module, `@manamesh/boardgameio-crypto`.

**Related docs:**
- `packages/poker/docs/PREPAREDNESS_REPORT.md` — current readiness gaps
- `packages/poker/docs/TASK.md` US-PD.3.2 — identity binding adversarial tests
- `packages/poker/docs/GAME_FLOW_AND_SECURITY.md` — threat model narrative
- `packages/manamesh/PRD_CONTRACTS.md` §11 — settlement invariants
- Existing positive/negative tests: `packages/poker/tests/foundry/**`, `packages/poker/src/crypto.test.ts`

## Global Constraints

- Package root for Solidity: `packages/poker` (`forge test` from there).
- Yarn workspaces from monorepo root; TS tests: `yarn workspace @manamesh/poker test`.
- Crane rules: real diamond deploy for integration/adversarial SUT; no mocking the settler/oracle under test.
- Players in `HandInit` must be **strictly ascending by address**; fixture keys `0xB0B` (bob) < `0xA11CE` (alice).
- Force-timeout requires **all** player signatures on `lastRoundState` (fifth arg `lastRoundSignatures`).
- Precompute any external staticcall helpers **before** `vm.expectRevert` (Foundry arg-eval pitfall).
- Adversarial tests must assert **economic** outcomes where relevant: attacker balance never increases; victim loss only via documented rules (rake, forfeit-to-operator).
- Do not commit secrets or deploy keys; hermetic local/anvil only.
- Update `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md` and `packages/poker/README.md` when the suite lands.

---

## File Map

| Path | Responsibility |
|------|----------------|
| `packages/poker/tests/foundry/base/TestBase_PokerSystem.sol` | Existing Crane production deploy helpers — extend with multi-player + balance snapshot helpers if needed |
| `packages/poker/tests/foundry/adversarial/AdversarialHelpers.sol` | Shared attack scaffolding: fund players, assert hand, sign init/outcome/round, snapshot balances, assert no attacker profit |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_Adversarial.t.sol` | Multi-step settlement exploit scenarios |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_Replay.t.sol` | Signature / handId / domain replay attacks |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_ForceTimeoutGrief.t.sol` | Force-timeout economic griefing matrix |
| `packages/poker/tests/foundry/adversarial/PokerHandSettler_Handler.t.sol` | Foundry invariant handler + invariants |
| `packages/poker/tests/foundry/adversarial/README.md` | Threat → test index for reviewers |
| `packages/poker/src/crypto.adversarial.test.ts` | Move-level identity + decrypt share adversarial TS tests |
| `packages/poker/docs/ADVERSARIAL_TESTS.md` | Living map of attacks covered / residual risk |
| `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md` | Index link |
| `packages/poker/README.md` | Mention adversarial suite |

---

## Threat Model (in scope for this plan)

### On-chain (settler)

| ID | Attacker goal | Intended defense |
|----|---------------|------------------|
| A1 | Inflate `finalStacks` / mint chips on settle | Conservation: stacks + rake == pot |
| A2 | Settle as wrong winner without correct cards (verifier on) | `PokerVerifierFacet` / `WinnerMismatch` |
| A3 | Forge EIP-712 signatures (wrong key) | `SignatureLib` recovery match |
| A4 | Replay HandInit / HandOutcome on another hand or settler | handId binding + domain `verifyingContract` + HandAlreadyAsserted |
| A5 | Double-settle or settle inactive hand | HandStatus Active → Settled |
| A6 | Withdraw locked buy-ins mid-hand | `lockedOf` / InsufficientUnlockedBalance |
| A7 | Assert with unsorted / forged vault / overdraft | shape checks + unlock balance |
| A8 | Force-timeout early | TimeoutNotElapsed |
| A9 | Force-timeout with forged lastRound | all-player lastRound signatures |
| A10 | Force-timeout: winner refuses sig, attacker claims pot | unsigned winner forfeit → operator only |
| A11 | Force-timeout: third party steals forfeit | forfeit to oracle operator, not caller |
| A12 | Non-owner changes rake to 100% | MultiStepOwnable on oracle |
| A13 | Reentrancy / malicious ERC20 drains vault | SafeERC20 + checks-effects; optional weird-token harness |
| A14 | Ledger drift (sum balances ≠ token balance) | invariant after sequences |

### Off-chain (crypto game)

| ID | Attacker goal | Intended defense |
|----|---------------|------------------|
| C1 | Impersonate peer on crypto moves (`playerId` ≠ `ctx.playerID`) | `validatePlayerIdentity` → INVALID_MOVE |
| C2 | Submit invalid curve points as decrypt shares | `validateEncryptedCard` / `secpIsValidPointHex` |
| C3 | Stall decrypt forever | voteAbortDecrypt + void + `abortedDecrypt` in hand result |
| C4 | Double-release keys / illegal phase moves | phase + release guards |

### Explicitly out of scope (document residual risk only)

- Live P2P transport MITM / WebRTC identity binding (needs transport-level suite).
- Full ZK shuffle proofs (not implemented; commit-reveal only).
- Mainnet gas / MEV ordering of settle txs.
- Live wallet phishing / social engineering.

---

### Task 1: Adversarial helpers + README index

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/AdversarialHelpers.sol`
- Create: `packages/poker/tests/foundry/adversarial/README.md`
- Modify: `packages/poker/tests/foundry/base/TestBase_PokerSystem.sol` (optional small helpers only if needed)

**Interfaces:**
- Produces: abstract or library helpers usable by all adversarial suites:
  - `snapshotBalances(address[] players, address operator) → uint256[]`
  - `assertNoProfit(address attacker, uint256 balBefore, uint256 balAfter)`
  - `assertLedgerEqualsToken(IPokerHandSettler settler, IERC20 token, address[] tracked)`
  - Reuse signing patterns from `TestBase_PokerSystem` (`_sign`, `_signInit`, `_twoPlayerInit`, `_signLastRound`)

- [x] **Step 1: Create helpers contract**

Implement `AdversarialHelpers` as an abstract contract extending `TestBase_PokerSystem` with:

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {TestBase_PokerSystem} from "../base/TestBase_PokerSystem.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";

abstract contract AdversarialHelpers is TestBase_PokerSystem {
    struct BalanceSnap {
        uint256 alice;
        uint256 bob;
        uint256 operator;
        uint256 tokenTotal;
    }

    function _snap() internal view returns (BalanceSnap memory s) {
        s.alice = IPokerHandSettler(settlerProxy).balanceOf(alice);
        s.bob = IPokerHandSettler(settlerProxy).balanceOf(bob);
        s.operator = IPokerHandSettler(settlerProxy).balanceOf(operator);
        s.tokenTotal = chip.balanceOf(settlerProxy);
    }

    function _assertLedgerIntact(BalanceSnap memory after_) internal view {
        assertEq(after_.alice + after_.bob + after_.operator, after_.tokenTotal, "ledger != token");
    }

    function _assertAttackerNoProfit(uint256 beforeBal, uint256 afterBal, string memory tag) internal pure {
        assertLe(afterBal, beforeBal, tag);
    }
}
```

- [ ] **Step 2: Write `adversarial/README.md`** mapping threat IDs A1–A14 / C1–C4 → planned test names (update as tasks land).

- [ ] **Step 3: Commit**

```bash
git add packages/poker/tests/foundry/adversarial packages/poker/tests/foundry/base
git commit -m "test(poker): scaffold adversarial helpers and threat index"
```

---

### Task 2: Settlement value-extraction attacks (A1, A2, A3, A5, A6)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_Adversarial.t.sol`
- Test: same file

**Interfaces:**
- Consumes: `AdversarialHelpers`, production diamond from `setUp`
- Produces: named tests for A1–A3, A5–A6

- [ ] **Step 1: Write failing/adversarial tests**

```solidity
contract PokerHandSettler_AdversarialTest is AdversarialHelpers {
    function setUp() public override {
        AdversarialHelpers.setUp();
        _fundDefault();
    }

    /// A1: Attacker tries to credit themselves more than pot - rake.
    function test_A1_inflateFinalStacks_revertsAndNoProfit() public {
        HandInit memory init = _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 200e18); // should be 195e18
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        vm.expectRevert(/* ConservationViolation */);
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);
        BalanceSnap memory after_ = _snap();
        assertEq(after_.alice, before_.alice);
        assertEq(after_.bob, before_.bob);
        _assertLedgerIntact(after_);
    }

    /// A2: Bob claims win while Alice holds royal (verifier enabled on diamond).
    function test_A2_falseWinner_reverts() public { /* WinnerMismatch */ }

    /// A3: Bob signs outcome declaring Alice winner — still fails recovery for Alice.
    function test_A3_forgedWinnerSignature_reverts() public { /* InvalidSignature */ }

    /// A5: Second settle after successful settle.
    function test_A5_doubleSettle_reverts() public { /* HandNotActive */ }

    /// A6: Withdraw full balance while buy-in locked.
    function test_A6_withdrawLockedFunds_reverts() public {
        _assertTwoPlayerHand();
        uint256 free = IPokerHandSettler(settlerProxy).balanceOf(alice)
            - IPokerHandSettler(settlerProxy).lockedOf(alice);
        vm.prank(alice);
        vm.expectRevert(/* InsufficientUnlockedBalance */);
        IPokerHandSettler(settlerProxy).withdraw(free + 1);
    }
}
```

Fill each body using patterns from `PokerHandSettler_EdgeCases.t.sol` and `PokerHandSettler.t.sol`. Always snapshot balances before/after failed attacks.

- [ ] **Step 2: Run**

```bash
cd packages/poker && forge test --match-path tests/foundry/adversarial/PokerHandSettler_Adversarial.t.sol -vv
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/poker/tests/foundry/adversarial/PokerHandSettler_Adversarial.t.sol
git commit -m "test(poker): adversarial settlement value-extraction cases A1-A6"
```

---

### Task 3: Signature replay and domain binding (A4)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_Replay.t.sol`

**Scenarios:**

1. **A4a — HandInit replay:** Assert hand H1; craft H2 with different nonces/buyIns but reuse H1 signatures → must fail `InvalidSignature` (hash changes) or wrong structure.
2. **A4b — HandOutcome replay across hands:** Complete settle on H1; start H2; submit H1 outcome + H1 winner sigs against H2 init → `HandIdMismatch` or `HandNotActive` for H1’s handId / mismatch.
3. **A4c — Cross-settler domain:** Deploy second settler (second token via `PokerDeployLib` or second `deploySettler` call). Sign HandInit for settler A; submit to settler B → signature recovery fails (domain uses `address(this)`).
4. **A4d — Re-assert same HandInit after settle:** Same handId should be `HandAlreadyAsserted` or not `None` depending on status storage (document actual status enum behavior; assert cannot re-lock).

- [ ] **Step 1: Implement tests with multi-settler setup**

```solidity
function test_A4c_crossSettlerSignatureRejected() public {
    // deploy second token + settler sharing oracle
    // sign init with domain of settler A
    // assertHandMembership on settler B with those sigs → InvalidSignature
}
```

Use `PokerSettlementHashLib.domainSeparator()` via a thin harness **only if** needed to sign for a specific verifyingContract; prefer signing digests built as:

```solidity
bytes32 domain = keccak256(abi.encode(
    DOMAIN_TYPEHASH,
    keccak256(bytes("PokerHandSettler")),
    keccak256(bytes("1")),
    block.chainid,
    settlerA
));
```

- [ ] **Step 2: Run**

```bash
cd packages/poker && forge test --match-path tests/foundry/adversarial/PokerHandSettler_Replay.t.sol -vv
```

- [ ] **Step 3: Commit**

```bash
git add packages/poker/tests/foundry/adversarial/PokerHandSettler_Replay.t.sol
git commit -m "test(poker): adversarial signature replay and domain binding A4"
```

---

### Task 4: Force-timeout griefing matrix (A8–A11)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_ForceTimeoutGrief.t.sol`

**Scenarios:**

| Test | Attack | Assertion |
|------|--------|-----------|
| `test_A8_forceTimeoutBeforeWindow_reverts` | Call at `lastActivity + timeout - 1` | `TimeoutNotElapsed`; balances unchanged |
| `test_A9_forgedLastRoundSigs_reverts` | Bad player0 lastRound sig | `InvalidSignature`; balances unchanged |
| `test_A9b_missingLastRoundSigArray_reverts` | Empty lastRoundSignatures | `ArrayLengthMismatch` |
| `test_A10_unsignedWinnerForfeitsToOperatorNotCaller` | Empty winner sig; prank attacker EOA | Alice loses stack share; **attacker vault balance unchanged**; operator += rake + forfeit |
| `test_A11_thirdPartySubmitDoesNotSteal` | Random `vm.prank(attacker)` after timeout with valid lastRound + signed winner | Settlement succeeds; attacker ledger profit == 0 |
| `test_A8_activityClock` | Document current lastActivity semantics; if only set at assert, assert force becomes ready exactly at `assertTime + timeout` | Exact timestamp boundary (`== readyTime` allowed or not — match contract: ready when `timestamp >= lastActivity + timeout`) |

- [ ] **Step 1: Implement grief matrix with balance snapshots for attacker EOA** (`makeAddr("attacker")` funded or not).

- [ ] **Step 2: Run**

```bash
cd packages/poker && forge test --match-path tests/foundry/adversarial/PokerHandSettler_ForceTimeoutGrief.t.sol -vv
```

- [ ] **Step 3: Commit**

```bash
git add packages/poker/tests/foundry/adversarial/PokerHandSettler_ForceTimeoutGrief.t.sol
git commit -m "test(poker): adversarial force-timeout grief matrix A8-A11"
```

---

### Task 5: Structural / access-control attacks (A7, A12) + optional weird ERC20 (A13)

**Files:**
- Modify: `packages/poker/tests/foundry/adversarial/PokerHandSettler_Adversarial.t.sol` (or new `PokerHandSettler_Access.t.sol` if file grows large)
- Create (optional A13): `packages/poker/contracts/settler/_test/ERC20ReentrantMock.sol` — only if reentrancy path is plausible through ERC20 hooks

**Scenarios:**

- **A7a** Unsorted players
- **A7b** Invalid vault (`vault != settler`)
- **A7c** Player count 0/1/10
- **A7d** Zero buy-in
- **A7e** Duplicate addresses (caught by not-strictly-increasing sort)
- **A12** Non-owner `setDefault` / `setTokenConfig` on production oracle diamond
- **A13** (stretch) Token with `transfer` callback that reenters `withdraw` / `settleHand` — expect revert or no double credit

Note: Many A7 cases already exist in EdgeCases — **do not duplicate blindly**. Either move them under `adversarial/` with threat IDs or write thin wrappers that call shared helpers and document “covered by EdgeCases + adversarial index”. Prefer **one canonical location** for each threat ID in `adversarial/README.md`.

- [ ] **Step 1: Wire A7/A12 into adversarial suite with threat IDs and no-profit asserts.**

- [ ] **Step 2: If implementing A13, write minimal reentrant token; otherwise document residual risk in `ADVERSARIAL_TESTS.md`.**

- [ ] **Step 3: Run full forge suite**

```bash
cd packages/poker && forge test
```

- [ ] **Step 4: Commit**

```bash
git add packages/poker/tests/foundry/adversarial packages/poker/contracts/settler/_test
git commit -m "test(poker): adversarial access and structural attacks A7 A12"
```

---

### Task 6: Invariant handler fuzz (A14)

**Files:**
- Create: `packages/poker/tests/foundry/adversarial/PokerHandSettler_Handler.t.sol`

**Architecture (Crane handler pattern):**

```solidity
contract PokerSettlerHandler is Test {
    IPokerHandSettler settler;
    ERC20Mock token;
    address[] actors; // small fixed set from seeds
    // ghost: sumDeposits - sumWithdrawals should match token.balanceOf(settler)

    function deposit(uint256 actorSeed, uint256 amount) external { /* bound, prank, mint+approve+deposit */ }
    function withdraw(uint256 actorSeed, uint256 amount) external { /* only unlocked */ }
    // Optional later: assertHand / settle with canned 2p flow if complexity allows
}

contract PokerHandSettler_InvariantTest is AdversarialHelpers {
    PokerSettlerHandler handler;

    function setUp() public override {
        AdversarialHelpers.setUp();
        handler = new PokerSettlerHandler(settlerProxy, chip, /* actors */);
        targetContract(address(handler));
    }

    function invariant_tokenBalanceEqualsSumVaultBalances() public view {
        // sum over actors + operator == chip.balanceOf(settler)
    }

    function invariant_lockedNeverExceedsBalance() public view {
        // for each actor: lockedOf <= balanceOf
    }
}
```

**Constraints for v1 handler:**
- Focus on **deposit/withdraw** conservation first (always valid).
- If assert/settle are too signature-heavy for fuzz, keep them in scripted adversarial tests only; document that A14 deposit/withdraw is covered by invariants and settle paths by scripted A1–A11.

- [ ] **Step 1: Implement handler + two invariants.**

- [ ] **Step 2: Run**

```bash
cd packages/poker && forge test --match-contract PokerHandSettler_InvariantTest -vv
```

Expected: PASS under default fuzz runs (`foundry.toml` fuzz.runs = 256).

- [ ] **Step 3: Commit**

```bash
git add packages/poker/tests/foundry/adversarial/PokerHandSettler_Handler.t.sol
git commit -m "test(poker): invariant handler for vault conservation A14"
```

---

### Task 7: Off-chain crypto adversarial suite (C1–C4)

**Files:**
- Create: `packages/poker/src/crypto.adversarial.test.ts`
- Modify: `packages/poker/src/crypto.ts` only if a move is missing `validatePlayerIdentity` (fix under same PR; tests first)
- Reference: `packages/poker/src/crypto.test.ts` existing security describes

**C1 — Impersonation matrix**

For each sensitive move, call the real move function (or `Client`/`Simulate`) with `{ playerID: victim }` while args claim `attacker`:

Moves to cover (minimum):
- `submitPublicKey`
- `encryptDeck` / setup encrypt step
- `shuffleDeck` (if exposed)
- `peekHoleCards`
- `requestDecrypt`
- `approveDecrypt` / `submitDecryptedShare`
- `releaseKey`
- `voteAbortDecrypt`

Pattern:

```typescript
it('C1 peekHoleCards rejects playerId spoofing', async () => {
  const G = await createCryptoTestState(2);
  // arrange valid phase for peek
  const result = /* invoke move as player "1" with playerId arg "0" */;
  expect(result).toBe(INVALID_MOVE); // or valid:false via validateCryptoMove + move
});
```

Prefer **executing the move** through boardgame.io test helpers if available; otherwise call the internal move functions exported for testing. If moves are not exported, export test-only wrappers or use `Client({ game: CryptoPokerGame })` with multiplayer local.

**C2 — Invalid points**

- Submit decrypt share with `ciphertext: '00'` / wrong length / non-hex → INVALID_MOVE or no state change.

**C3 — Stall**

- Extend existing stall simulation to call real `voteAbortDecrypt` move and assert `phase === 'voided'` and `buildHandResult(G).abortedDecrypt === true`.

**C4 — Phase guards**

- `releaseKey` twice; `peekHoleCards` mid-betting when incomplete → reject.

- [ ] **Step 1: Write `crypto.adversarial.test.ts` with describe blocks per C1–C4.**

- [ ] **Step 2: Run**

```bash
yarn workspace @manamesh/poker test src/crypto.adversarial.test.ts
```

- [ ] **Step 3: If any move lacks identity guard, add `validatePlayerIdentity` at top of handler and re-run.**

- [ ] **Step 4: Commit**

```bash
git add packages/poker/src/crypto.adversarial.test.ts packages/poker/src/crypto.ts
git commit -m "test(poker): adversarial crypto identity and liveness C1-C4"
```

---

### Task 8: Documentation and design-map update

**Files:**
- Create: `packages/poker/docs/ADVERSARIAL_TESTS.md`
- Modify: `packages/poker/docs/DESIGN_DOCUMENTS_MAP.md`
- Modify: `packages/poker/README.md`
- Modify: `packages/poker/tests/foundry/adversarial/README.md` (final threat → test table)
- Optional: check off US-PD.3.2 adversarial bullets in `packages/poker/docs/TASK.md`

**ADVERSARIAL_TESTS.md content outline:**

1. Purpose and threat model summary  
2. Table: Threat ID | Layer | Test file::name | Status  
3. Residual risks (P2P, ZK shuffle, weird ERC20 if skipped)  
4. How to run  

```bash
cd packages/poker && forge test --match-path tests/foundry/adversarial
yarn workspace @manamesh/poker test src/crypto.adversarial.test.ts
```

5. How to add a new attack (template)

- [ ] **Step 1: Write docs and wire map/README links.**

- [ ] **Step 2: Full verification**

```bash
cd packages/poker && forge test && yarn test
```

Expected: all existing + new tests pass (no regression on 96+ baseline).

- [ ] **Step 3: Commit**

```bash
git add packages/poker/docs packages/poker/README.md packages/poker/tests/foundry/adversarial/README.md
git commit -m "docs(poker): adversarial test map and run instructions"
```

---

## Acceptance Criteria (plan complete when)

- [ ] Dedicated `tests/foundry/adversarial/` suite exists with multi-step attacks A1–A12 (A13 optional stretch).
- [ ] Each failed attack asserts **no attacker vault profit** and **ledger integrity** where applicable.
- [ ] Replay / cross-settler domain tests pass (A4).
- [ ] Force-timeout grief matrix proves forfeit goes to operator, not caller (A10–A11).
- [ ] At least deposit/withdraw invariants hold under fuzz (A14).
- [ ] TS suite covers impersonation for all listed crypto moves (C1) plus C2–C4.
- [ ] `ADVERSARIAL_TESTS.md` indexes threats → tests and residual risks.
- [ ] `forge test` and `yarn workspace @manamesh/poker test` green.

## Suggested implementation order

1. Task 1 (helpers)  
2. Task 2 (core extraction)  
3. Task 4 (force-timeout grief) — high value, reuses helpers  
4. Task 3 (replay)  
5. Task 5 (structural/access)  
6. Task 6 (invariants)  
7. Task 7 (crypto TS)  
8. Task 8 (docs)

## Notes for implementers

- Reuse sorted player fixtures (`bob`, `alice`) and `TestBase_PokerSystem` signing helpers.
- Production diamond already enables verifier — A2 should use diamond path, not harness with verifier disabled.
- Prefer exact `vm.expectRevert(abi.encodeWithSelector(...))` over generic reverts.
- If a test discovers a real vulnerability, **stop and file a fix task** before expanding coverage; do not weaken asserts to pass.
- Do not mark TASK.md deployment phases complete; this plan is **security test only**.
