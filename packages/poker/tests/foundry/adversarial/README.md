# Poker adversarial Foundry suite

Threat-ID → test map for settlement attack coverage. See also
`packages/poker/docs/ADVERSARIAL_TESTS.md`.

| ID | Attack | Test |
|----|--------|------|
| A1 | Inflate finalStacks | `PokerHandSettler_Adversarial.t.sol::test_A1_*` |
| A2 | False winner (verifier) | `…::test_A2_*` |
| A3 | Forged winner signature | `…::test_A3_*` |
| A4 | Signature / domain replay (incl. A4e chainId) | `PokerHandSettler_Replay.t.sol` |
| A5 | Double settle | `…::test_A5_*` |
| A6 | Withdraw locked funds | `…::test_A6_*` |
| A7 | Structural assert abuse | `…::test_A7a`–`test_A7e` |
| A8–A11 | Force-timeout grief | `PokerHandSettler_ForceTimeoutGrief.t.sol` |
| A12 | Non-owner oracle config | `…::test_A12_*` |
| A13 | Weird ERC20 reentrancy | `PokerHandSettler_Reentrancy.t.sol` |
| A14 | Ledger drift (fuzz) | `PokerHandSettler_Handler.t.sol` |
| — | Multi-player N=3,5,9 | `PokerHandSettler_MultiPlayer.t.sol` |
| **S4** | Multi-winner + side-pot | `PokerHandSettler_MultiWinner.t.sol` |
| **S5** | Force-timeout N≥3 | `PokerHandSettler_ForceTimeoutMulti.t.sol` |
| **S6** | Oracle rake/operator mid-hand | `PokerHandSettler_OracleMidHand.t.sol` |
| **S8** | Fee-on-transfer residual | `PokerHandSettler_FeeOnTransfer.t.sol` |

Off-chain C1–C4: `packages/poker/src/crypto.adversarial.test.ts`.

```bash
cd packages/poker && forge test --match-path tests/foundry/adversarial
```

## S6 policy note

`settleHand` / `forceTimeoutSettlement` read `oracle.configOf(token)` **at settle time**.
Mid-hand owner changes to rake or operator affect in-flight hands (no assert-time snapshot).

## S8 product note

Fee-on-transfer tokens are **unsupported**. Deposit credits the requested amount while the
settler may receive less ERC20 → known ledger ≠ token residual (documented tests, no
production change without product decision).
