# Poker Betting Architecture: Off-Chain Gameplay, On-Chain Settlement

**Status:** Historical (superseded)  
**Last Updated:** Pre-2026-06 (with migration note)  
**Superseded by:** Current design in `../PRD_Deployment.md`, `PRD_CONTRACTS.md`, and `packages/poker/docs/`  
**Note:** This describes the earlier GameVault/ChipToken model. Current uses PokerHandSettler + BettingConfigOracle.

> **Note (2026-06):** This document describes an earlier design iteration based on `GameVault` / `ChipToken` (MM-035 era).
> The current production design uses:
> - `PokerHandSettler` (per-ERC20 diamond) + `BettingConfigOracle`
> - `HandInit` / `HandOutcome` EIP-712 payloads (see `PRD_CONTRACTS.md`)
> - `buildSettlement()` + `settleHand()` / `forceTimeoutSettlement()`
>
> See:
> - `packages/manamesh/PRD_CONTRACTS.md` (locked contract spec)
> - `packages/poker/` (current implementation, `docs/PREPAREDNESS_REPORT.md`, `docs/PRD_Deployment.md`, `docs/TASK.md`)
> - `packages/poker/contracts/settler/` and `src/handOutcome.ts`

## Overview

Poker betting in ManaMesh uses a hybrid architecture:
- **Gameplay** (betting, pot tracking, hand evaluation) runs off-chain in boardgame.io
- **Chip escrow and settlement** runs on-chain in `PokerHandSettler.sol` (per-token) + `BettingConfigOracle`

This split is necessary because:
1. **Speed**: Poker requires ~30+ betting actions per hand. On-chain = ~100k gas per action + block time = unusable
2. **Cost**: A 6-player hand with 30 bets would cost ~$50+ in gas if every action were on-chain
3. **UX**: Players expect instant feedback. Waiting for block confirmations breaks the game feel
4. **Complexity**: Side pots, pot odds, and hand evaluation are deterministic but complex. No need for expensive on-chain computation.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRE-GAME                                      │
│  Players deposit chips → GameVault.joinGame()                     │
│  Chips locked in escrow per-player                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     EACH HAND (off-chain)                        │
│                                                                  │
│  1. Post blinds (boardgame.io flow)                            │
│  2. Betting rounds: check, call, raise, fold, all-in          │
│     - Each action updates G.pot, G.sidePots, G.playerBets        │
│  3. At showdown: evaluate hands, compute deltas                 │
│  4. buildHandResult() → { gameId, handId, players, deltas }     │
│  5. All players sign the HandResult (EIP-712)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SETTLEMENT (on-chain)                         │
│                                                                  │
│  Host/guest calls GameVault.settleHands()                       │
│  → Chips distributed per deltas                                  │
│  → Escrowed balances updated                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     WITHDRAWAL (anytime)                         │
│  Players call GameVault.withdraw() to reclaim chips              │
└─────────────────────────────────────────────────────────────────┘
```

## Existing Smart Contract Infrastructure (Current Design)

**Note:** The sections below describe the **current** design (`@manamesh/poker`).

### BettingConfigOracle (separate diamond)
- Per-token (and global default) configuration for `operator` (rake recipient) and `rakeBps`.
- Live lookup at settlement time.
- Owner-controlled via Crane MultiStepOwnable.

### PokerHandSettler (one diamond per ERC20)
Core settlement contract handling:
- **Escrow**: `deposit()`, `withdraw()` (with `lockedOf` protection)
- **Hand activation**: `assertHandMembership(HandInit, signatures[])` — unanimous EIP-712
- **Settlement**: `settleHand(HandInit, HandOutcome, winnerSignatures[])` — normal path
- **Force-timeout**: `forceTimeoutSettlement(...)` — partial signatures, forfeits to operator
- Uses `finalStacks` model (not deltas). Rake taken from pot.
- Immutable reference to the config oracle.
- Optional Level-1 on-chain verifier facet.

See `PRD_CONTRACTS.md` and `packages/poker/contracts/` for details. Legacy `GameVault`/`SignatureVerifier` artifacts have been superseded.

## Data Structures (Current)

Current on-chain payloads (see `PRD_CONTRACTS.md` and `packages/poker/contracts/types/`):

### HandInit (unanimously signed to start a hand)
- players[] (sorted), buyIns[], vault, blinds, timeoutSeconds, otherConfig, playerHandNonces[]

### HandOutcome (signed at showdown)
- handId, pot, winners[], payouts[], finalStacks[], finalStateHash, holeCards[2][], communityCards[5]

`buildSettlement()` in `@manamesh/poker` produces the on-chain `HandOutcome` + parallel `players`/`buyIns` for the matching `HandInit`.

Legacy `HandResult { ..., int256[] deltas }` and `finalBetHash` are superseded.

### Deltas Example (conservation: sum = 0)

Given players A, B, C with contributions:
- A contributed 100 (winner)
- B contributed 50 (folded pre-flop)
- C contributed 100 (lost at showdown)
- Total pot = 250

Deltas:
- A: +150 (wins pot)
- B: -50 (loses contribution)
- C: -100 (loses contribution)

Sum: +150 - 50 - 100 = 0 ✓

### Bet Chain (for disputes)
```solidity
struct Bet {
    bytes32 handId;
    address bettor;
    uint256 betIndex;
    uint8 action;      // 0=fold, 1=check, 2=call, 3=raise, 4=all-in
    uint256 amount;
    bytes32 previousBetHash;  // Chain linkage
}
```

## Edge Cases (High-Level, Still Relevant)

### Fold Mid-Hand
- Player can sign FoldAuth (in current EIP-712 signing helpers) to authorize settlement without their participation.
- Folded player's chips remain locked until settlement.

### Abandonment
- If a player goes offline, after the timeout (configured in HandInit), remaining players can trigger force-timeout settlement.
- See current `forceTimeoutSettlement` in the settler and UI needs in TASK.md.

### Disputes / Verification
- The current design relies on unanimous signatures on HandInit + winner signatures on HandOutcome.
- `finalStateHash` provides an opaque commitment to the off-chain transcript.
- On-chain Level-1 verifier checks declared winners against revealed cards (when enabled).
- Full dispute via bet chain or mental-poker transcript binding is future work.

## Implementation Tasks (Historical — See Current Docs)

Most Phase 1 items from the original doc have been completed or superseded:

- `buildHandResult()` / `buildSettlement()` exists in `packages/poker/src/` (crypto.ts and handOutcome.ts).
- EIP-712 signing helpers are in `packages/poker/src/signing.ts` and the frontend wallet signing module.
- Abandonment timer UI and full settlement wiring are tracked in `packages/poker/docs/TASK.md` (Phase 4).
- Current contracts are in `packages/poker/contracts/settler/` (PokerHandSettler) and `oracle/`.

**See instead:**
- `packages/poker/docs/TASK.md` (Phases 1-5 for deployment readiness)
- `packages/poker/docs/PRD_Deployment.md`
- `packages/manamesh/PRD_CONTRACTS.md` (locked spec)

## Betting Actions (boardgame.io moves)

| Move | Description | On-Chain Impact |
|------|-------------|----------------|
| `postBlind` | Post small/big blind | No (off-chain tracking) |
| `check` | Match current bet, no raise | No |
| `call` | Match current bet | No (tracked in G.pot) |
| `raise` | Increase bet above call | No (updates G.bet) |
| `fold` | Surrender hand | Signs FoldAuth if called |
| `allIn` | Bet all remaining chips | Creates side pot if others have more |
| `showdown` | Reveal hands, evaluate | Triggers `buildHandResult()` → `buildSettlement()` |

## Files to Modify (Current Locations)

### Frontend / Game Layer
- `packages/poker/src/crypto.ts` — `buildHandResult()`, betting integration
- `packages/poker/src/handOutcome.ts` — `buildSettlement()`
- `packages/poker/src/components/PokerBoard.tsx` — settlement UI, new-hand flow
- `packages/manamesh/packages/frontend/src/App.tsx` — `handleNewHand` + blockchain service wiring

### Smart Contracts
- `packages/poker/contracts/settler/PokerHandSettler*` (already implemented per PRD)
- See `packages/poker/script/` for deployment

## Security Considerations (Current)

1. **Betting actions are off-chain**: Players sign HandInit at start and HandOutcome (winners) at end. Verified on-chain.
2. **Host is authoritative** for boardgame.io state, but all value movement requires cryptographic signatures.
3. `client: false` on crypto moves prevents optimistic desyncs.
4. Mental-poker transcript + `finalStateHash` + on-chain verifier (optional) provide fairness guarantees.
5. See `packages/poker/docs/GAME_FLOW_AND_SECURITY.md` and `SECURITY_REPORT.md` for full details.

## Open Questions (Current Status)

See `packages/poker/docs/PRD_Deployment.md` and `docs/TASK.md` for the active list. Key remaining items include:
- Who triggers settlement in production P2P (host vs. any player vs. automated)?
- Full integration of abandonment timer + claim UI.
- Live contract deployment and frontend config surface.
