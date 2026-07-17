# Poker Adversarial Tests

**Status:** Current  
**Last Major Update:** 2026-07-15 (S1/S2/S3/S10 automated)  
**Purpose:** Map threat IDs to automated tests that prove known attack classes
cannot extract value or corrupt settlement / mental-poker state.

## How to run

```bash
# On-chain (from packages/poker)
forge test --match-path tests/foundry/adversarial

# Full Foundry suite
forge test

# Off-chain crypto adversarial + package tests (monorepo root)
yarn workspace @manamesh/poker test
# or only adversarial:
yarn workspace @manamesh/poker test src/crypto.adversarial.test.ts
```

## On-chain threats (A1–A14)

| ID | Attack | Test |
|----|--------|------|
| A1 | Inflate `finalStacks` | `tests/foundry/adversarial/PokerHandSettler_Adversarial.t.sol::test_A1_inflateFinalStacks_revertsAndNoProfit` |
| A2 | False winner (verifier) | `…::test_A2_falseWinner_revertsAndNoProfit` |
| A3 | Forged winner signature | `…::test_A3_forgedWinnerSignature_revertsAndNoProfit` |
| A4a | HandInit sig on mutated init | `PokerHandSettler_Replay.t.sol::test_A4a_*` |
| A4b | HandOutcome replay across hands | `…::test_A4b_*` |
| A4c | Cross-settler domain sig | `…::test_A4c_*` |
| A4d | Re-assert after settle | `…::test_A4d_*` |
| A4e | chainId domain replay | `…::test_A4e_*` (`vm.chainId` + forged wrong-chain domain) |
| A5 | Double settle | `…::test_A5_*` |
| A6 | Withdraw locked funds | `…::test_A6_*` |
| A7a–e | Structural assert abuse | `…::test_A7a`–`test_A7e` |
| A8 | Force-timeout early / boundary | `PokerHandSettler_ForceTimeoutGrief.t.sol::test_A8_*` |
| A9 | Forged / missing lastRound sigs | `…::test_A9_*` |
| A10 | Unsigned winner forfeit → operator | `…::test_A10_*` |
| A11 | Third-party submit no profit | `…::test_A11_*` |
| A12 | Non-owner oracle config | `…::test_A12_*` |
| A13 | Weird ERC20 reentrancy | `PokerHandSettler_Reentrancy.t.sol::test_A13_*` (deposit/withdraw/assert/settle hooks; CEI + ledger) |
| A14 | Ledger drift under fuzz | `PokerHandSettler_Handler.t.sol` invariants |
| — | Multi-player settle N=3,5,9 | `PokerHandSettler_MultiPlayer.t.sol` |
| S4 | Multi-winner + side-pot | `PokerHandSettler_MultiWinner.t.sol` |
| S5 | Force-timeout N≥3 | `PokerHandSettler_ForceTimeoutMulti.t.sol` |
| S6 | Oracle mid-hand (live configOf) | `PokerHandSettler_OracleMidHand.t.sol` |
| S8 | Fee-on-transfer residual | `PokerHandSettler_FeeOnTransfer.t.sol` |

Each failed on-chain attack asserts **attacker vault balance non-increasing** and,
where applicable, **token balance == sum of vault ledgers**.

SUT path: real Crane diamond deploy via `TestBase_PokerSystem` / `PokerDeployLib`
(no mocked settler under test).

## Off-chain threats (C1–C4)

| ID | Attack | Test |
|----|--------|------|
| C1 | Impersonate peer (`playerId` ≠ `ctx.playerID`) | `validateCryptoMove` spoof matrix + real `submitDecryptedShare` / `voteAbortDecrypt` handlers |
| C2 | Invalid decrypt-share points | Real `submitDecryptedShare` / `approveDecrypt` with garbage ciphertext → `INVALID_MOVE`, no approval/share |
| C3 | Stall decrypt forever | Real `canAbortDecryptNow` + `voteAbortDecrypt` → `phase=voided`, `buildHandResult.abortedDecrypt` |
| C4 | Illegal phase / double-release | C4 releaseKey / peek / submitPublicKey guards |

Production handlers exported for adversarial use: `submitDecryptedShare`, `approveDecrypt`,
`voteAbortDecrypt`, `canAbortDecryptNow` (same functions wired into `CryptoPokerGame` moves).
Also: `validatePlayerIdentity` on `shuffleEncryptedDeck`; `approveDecrypt` validates share
**before** mutating request state.

## Mental poker workflow & privacy (M1–M12)

| ID | Claim | Test |
|----|--------|------|
| M1 | Ciphertext ≠ plaintext id/point | `boardgameio-crypto/.../sra.privacy.test.ts` |
| M2 | Single key cannot recover 2-layer card | `sra.privacy.test.ts` + poker privacy suite |
| M3 | All keys recover original card id | `sra.privacy.test.ts` |
| M4 | Poker setup encrypt→shuffle→deal yields N-layer hands | `mentalPoker.workflow.test.ts` |
| M5 | Cannot recover opponent hole cards with one key | `mentalPoker.privacy.adversarial.test.ts` |
| M5b | Partial coop share does not mark hand peeked | same |
| M6 | Undealt deck unreadable with one key | same |
| M7 | Cooperative peel recovers deck card ids | `mentalPoker.workflow.test.ts` |
| M8 | `peekHoleCards` targets only `hand:${self}` | privacy adversarial |
| M9 | Garbage share → `INVALID_MOVE`, no approval | privacy adversarial |
| M10 | Private keys absent from shared `G` | workflow |
| M11 | Shuffle keeps encryption layers | workflow |
| M12 | Proper-subset privacy for N=2–5 | privacy suite + `sra.privacy.test.ts` N-layer cases |

Harness: `src/mentalPoker.harness.ts` with `TABLE_SIZES = [2,3,4,5]` (real `generateKeyPair` +
production `submitPublicKey` / `encryptDeck` / `shuffleEncryptedDeck`).

Workflow and privacy specs use `describe.each(TABLE_SIZES)` so every claim is checked for
**each table size** from 2 through 5 players (`layers === N`, deck remainder `52 - 2N`,
leave-one-out subset recovery fails).

Production fixes landed with this suite:
- Coop decrypt requires **all players’ decryption shares**, not mere approvals
- `hasPeeked` only after cards fully peel to `layers === 0`
- Requester may submit a share after auto-approve on peek

```bash
yarn workspace @manamesh/boardgameio-crypto test src/mental-poker/sra.privacy.test.ts
yarn workspace @manamesh/poker test src/mentalPoker
```

## Coverage gaps closed (G1–G7)

| ID | Concern | Test |
|----|---------|------|
| G1 | Full multi-card progressive coop peek | `mentalPoker.gaps.adversarial.test.ts` + harness `progressiveCoopPeekHand` (N=2–5) |
| G2 | Community deal / early-read privacy / full peel | same (N=2,3,5) |
| G3 | Shuffle multiset + non-identity order | same |
| G4 | Malicious encrypt + deal fairness + host lookup/zone tamper | same |
| G5 | Shamir key escrow + fold / releaseKey / challengeVoid | same + `@manamesh/boardgameio-crypto/shamirs` |
| G6 | Settlement bridge from crypto `G` | same (`buildSettlement`) |
| G7 | Phase skip + credentials | same + R4 residual |

Production hardening with these suites:
- `decryptionShares` are `EncryptedCard[]` parallel to `cardIndices`
- Progressive zone peels on `approveDecrypt` / `submitDecryptedShare`
- `hasPeeked` only when all players shared and cards fully peeled (`layers === 0`)

## Residual risks — automated offline (R1–R6)

Previously listed as out of suite; now covered by offline adversarial tests that
**model** transport/mainnet concerns against real handlers. Live network and
mainnet mempool behavior remain out of process.

| ID | Concern | Test | Notes |
|----|---------|------|-------|
| R1 | P2P / WebRTC identity MITM | `src/mentalPoker.p2p.adversarial.test.ts` | **Modeled offline**: `validatePlayerIdentity`, `authenticateCredentials`, production handlers reject `playerId ≠ ctx.playerID`; empty / empty-object credentials rejected. Live WebRTC MITM not simulated. |
| R2 | ZK shuffle proofs | `src/mentalPoker.residual.adversarial.test.ts` (R2) + multiset in `mentalPoker.gaps.adversarial.test.ts` | **Enforced today**: post-shuffle multiset of peels == `cardIds`, layers preserved for N=2–5. **Not required today**: `G.crypto.shuffleProofs` / `commitments` remain empty on poker path (no ZK object). |
| R3 | Timing / griefing (decrypt stall) | `src/mentalPoker.residual.adversarial.test.ts` (R3) + C3 in `crypto.adversarial.test.ts` | Real `canAbortDecryptNow` / `voteAbortDecrypt`; stall without abort stays pending; abort after `POKER_DECRYPT_STALL_WINDOW_MOVES` voids + tags refusers (N=2–5). |
| R4 | UI-class residual | `src/mentalPoker.residual.adversarial.test.ts` (R4) + C4 / gaps | Phase skip, double `releaseKey` (real handler), peek only opens `hand:self`, multiplayer credential gate. |
| R5 | Mainnet gas / MEV settle ordering | `src/mentalPoker.residual.adversarial.test.ts` (R5) | **Modeled offline** at TS builder: `deriveHandId` uniqueness, same-`handId` double-settle conflict set, `finalStateHash` binds `handId`. **On-chain double settle**: Foundry A5. Live mempool MEV not simulated. |
| R6 | Full-hand mental-poker smoke | `src/mentalPoker.residual.adversarial.test.ts` (R6) | Setup → progressive peeks all seats → deal flop → progressive community peels (N=2–3) + `advancePhase` stub. |

```bash
yarn workspace @manamesh/poker test src/mentalPoker src/crypto.adversarial.test.ts
```

## Still residual (not fully automated)

- Live transport-level WebRTC MITM / TURN-path identity (R1 models binding only)
- Live mainnet gas / MEV tx ordering (R5 models handId conflict; A5 on-chain double settle)
- Social engineering / wallet phishing
- Fee-on-transfer / rebasing as a **supported** token class — **S8** proves current diamond is unsafe for FoT (ledger credits requested amount; token may be short); FoT remains **unsupported** residual
- Full ZK shuffle proofs as a product feature (R2 documents absence + multiset integrity only)
- **S9 residual:** live RPC / deployed contracts / App wiring (mocked client path is covered; see S9 section)

## Next wave (S1–S10)

**Implementation plan:** [`docs/superpowers/plans/2026-07-15-poker-adversarial-next-wave.md`](../../../docs/superpowers/plans/2026-07-15-poker-adversarial-next-wave.md)

Work order: **S2 → S3 → S1 → S7 → S4 → S5 → S6 → S10 → S8 → S9**.

| ID | P | Concern | Stack | Tests | Status |
|----|---|----------|-------|-------|--------|
| S1 | P0 | Multi-street crypto → settlement artifact | TS | `src/mentalPoker.streets.adversarial.test.ts` | **done** — peeks + flop/turn/river → `buildHandResult` / `buildSettlement` real card ids; abort → `abortedDecrypt` |
| S2 | P0 | Wrong / out-of-order progressive peels | TS | `src/mentalPoker.peel.adversarial.test.ts` | **done** — wrong-key, identity, garbage/layer-increase, swap multiset, double-submit (N=2,3) |
| S3 | P0 | Concurrent overlapping decrypt requests | TS | `src/mentalPoker.concurrent.adversarial.test.ts` | **done** — dual hole peeks isolated; community vs hole; **global** abort voids hand, keeps completed `hasPeeked`; order independence |
| S4 | P1 | Multi-winner + side-pot settle | Foundry | `tests/foundry/adversarial/PokerHandSettler_MultiWinner.t.sol` | **done** — split pot (verifier ON, board-plays-tie), side-pot-style stacks, winners≠payouts, partial tie, winner∉players |
| S5 | P1 | Force-timeout N≥3 | Foundry | `tests/foundry/adversarial/PokerHandSettler_ForceTimeoutMulti.t.sol` | **done** — N=3 all-sign / forfeit / incomplete lastRound / early+boundary / non-player no profit |
| S6 | P1 | Oracle rake/operator mid-hand | Foundry | `tests/foundry/adversarial/PokerHandSettler_OracleMidHand.t.sol` | **done** — live `configOf` at settle; conservation under new rake; new operator; A12 cross-link |
| S7 | P1 | Hand eval TS ↔ Solidity parity | both | `test-vectors/hand-eval-parity.json` + `src/hands.parity.test.ts` + `tests/foundry/verifier/PokerHandEvaluator_parity.t.sol` | **done** |
| S8 | P2 | Fee-on-transfer / rebasing ERC20 | Foundry | `tests/foundry/adversarial/PokerHandSettler_FeeOnTransfer.t.sol` | **done residual** — 1% FoT deposit/withdraw/settle prove ledger ≠ token; FoT unsupported; no production fix |
| S9 | P2 | Live BlockchainService (mocked viem) | TS / frontend | `src/settlementClient.test.ts` + frontend `live-service.ts` / mock dual path | **done** (mocked; live RPC residual) |
| S10 | P2 | Key-exchange adversarial | TS | `src/mentalPoker.keyExchange.adversarial.test.ts` | **done** — keychain rejects invalid/duplicate keys; **S10.7** `encryptDeck` rejects sk not matching published pubkey (`requirePrivateKeyMatchesPublished`) |

### S1/S2/S3/S10 product notes (locked by tests)

- **S3 abort:** `voteAbortDecrypt` rejects **all** pending decrypt requests and sets `phase = "voided"` (hand-global). Completed peeks keep `hasPeeked === true`.
- **S2 swap peels:** Progressive peels with swapped multi-card arrays still recover the **same multiset** of hole cards (SRA commutative); cannot invent foreign ids. Garbage / identity peels cannot complete reveal. Wrong-key peels may reduce layers by 1 (by design) while `hasPeeked` stays false.
- **S10 residuals:** Duplicate public keys and non-curve public keys are **accepted today** (no uniqueness / curve check on `submitPublicKey`). Encrypt turn/phase guards work.
- **S1 community residual:** Settlement uses zone-recovered plaintext + peeked hole cards; `G.community` still accumulates placeholders + re-appended reveals on multi-street peels (not settlement-blocking when builder uses zone/peeks).

### S4/S5/S6/S8 product notes (locked by tests)

- **S4:** Accounting uses `finalStacks` only; `winners[]` must match evaluator ties (verifier ON) and each winner must sign. Side pots are modeled via unequal buy-ins + stack vectors with conservation `sum(finalStacks)+rake == pot`.
- **S5:** Force-timeout skips verifier; requires full `lastRoundSignatures`; unsigned declared winners forfeit `finalStack` to operator; third-party caller cannot receive funds.
- **S6:** `PokerHandSettlerTarget` reads `oracle.configOf(token)` **at settle time** (no assert-time snapshot). Mid-hand rake/operator changes apply to in-flight hands.
- **S8:** FoT unsupported. `deposit` credits requested `amount` after `transferFrom` without measuring balance delta → ledger can exceed token holdings; withdraw may become insolvent.

Harness: `progressiveCoopPeekZone` in `src/mentalPoker.harness.ts` for community multi-index peels.

```bash
yarn workspace @manamesh/poker test src/mentalPoker.peel src/mentalPoker.concurrent src/mentalPoker.streets src/mentalPoker.keyExchange src/mentalPoker
```

### S7 packing (hand eval)

`uint8 card = (rank << 4) | suit` — rank 2..14 (14=Ace), suit 0=clubs .. 3=spades. Matches `encodeCard` / `PokerHandEvaluator`.

### S9 Live BlockchainService (mocked viem)

**Status:** Automated with **mocked** write/read ports — no real RPC/network.

| Case | Coverage |
|------|----------|
| `assertHandMembership` call shape | `buildAssertHandCall` + `LiveSettlementClient.assertHandMembership` |
| `settleHand` uses `buildSettlement` + EIP-712 domain (`chainId`, `verifyingContract`) | `prepareSettlementPayload` / `buildSettleHandCall` |
| RPC / user reject does not optimistic-credit | `LiveSettlementClient` keeps prior `confirmedBalances`; chain mock unchanged |
| Missing playerID → address map | `requirePlayerAddresses` clear error |
| Mock vs live mode switch | dual-path harness — live reject does not re-apply mock credits |

**Files:**
- Pure client + tests: `packages/poker/src/settlementClient.ts`, `settlementClient.test.ts`
- Frontend thin wrap: `packages/manamesh/packages/frontend/src/blockchain/live-service.ts`, extended `types.ts` / `mock-service.ts`, `config.ts`, factory in `index.ts`

**Residual (real deploy — not closed by S9):**
- Deployed settler + oracle addresses on a live chain
- Real viem `WalletClient` / `PublicClient` + wallet winner EIP-712 sigs
- `App.tsx` / `PokerLobby` wiring to `settleFromState` (still uses mock `settlePot(HandResult)` by default)
- Env config (`VITE_POKER_*`) filled for production

Cross-link: `docs/TASK.md` US-PD.1.1 (chunk implemented; full product wiring still open), `PREPAREDNESS_REPORT.md`.

```bash
yarn workspace @manamesh/poker test src/settlementClient.test.ts
```

## Adding a new attack

1. Assign a threat ID in this file.  
2. Add a multi-step test under `tests/foundry/adversarial/` (or TS) that snapshots balances, attempts the exploit, and asserts economic + status outcomes.  
3. Link the test in the tables above and in `tests/foundry/adversarial/README.md`.
