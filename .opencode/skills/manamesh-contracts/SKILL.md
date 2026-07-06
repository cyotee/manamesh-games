---
name: manamesh-contracts
description: This skill should be used when the user asks about "smart contracts", "GameVault", "ChipToken", "settlement", "EIP-712", "on-chain settlement", "abandonment claims", "disputes", "side pots", "ERC20 permit", or needs to understand how ManaMesh implements blockchain-based game settlement.
---

# ManaMesh Smart Contracts

## Conceptual Overview

The contracts implement on-chain escrow and settlement for poker-style games. Players deposit chips into a `GameVault` contract, play off-chain (producing signed `HandResult` messages), then call `settleHands` to distribute winnings atomically. Disputes and abandonment are handled on-chain with EIP-712 signature verification.

All contracts live in `contracts/src/` and use Foundry for development.

## Core Architecture

### GameVault (`contracts/src/GameVault.sol`)

Central escrow and settlement coordinator. Handles:

- **Join/Leave:** `joinGame`, `joinGameWithPermit`, `withdraw`, `leaveGame`
- **Settlement:** `settleHands(gameId, hands, signatures, folds, foldSigs)` — consumes signed `HandResult` messages
- **Disputes:** `disputeHand(gameId, betChain, betChainSigs)` — replays bet chain, can reverse settlement if fraud detected
- **Abandonment:** `claimAbandonment(gameId, ...)` — redistributes escrow after timeout

**Key dependencies:**

- `IGameVault` interface (structs: `HandResult`, `Bet`, `FoldAuth`, `Abandonment`)
- `IChipTokenFactory` — validates chip tokens
- `SignatureVerifier` library — EIP-712 hashing and signature verification
- OpenZeppelin `SafeERC20`, `EIP712`

**State:**

```solidity
mapping(bytes32 => uint256) public escrowedChips;
mapping(bytes32 => bool) public settledHands;
mapping(bytes32 => int256[]) public settledDeltas;  // per-player deltas after settlement
```

### ChipToken (`contracts/src/ChipToken.sol`)

ERC-20 chip token backed 1:1 by ETH:

- `deposit()` — deposit ETH, receive chips 1:1
- `withdraw(uint256 amount)` — burn chips, receive ETH back
- Implements `ERC20` + `ERC20Permit` (EIP-2612)
- `ethReserve()` view — current ETH backing

### ChipTokenFactory (`contracts/src/ChipTokenFactory.sol`)

Deploys per-underlying chip tokens using Crane's deterministic deploy package:

- `getChipToken(underlying)` → address — get or create chip token for underlying
- `isChipToken(token)` → bool — check if a token is a factory-deployed chip
- Uses Crane `TOKEN_PKG` for deterministic deployment with salt

### SignatureVerifier (`contracts/src/libraries/SignatureVerifier.sol`)

Centralized EIP-712 type hashes and verification helpers:

- `hashBet`, `hashHandResult`, `hashFoldAuth`, `hashAbandonment` — struct hashing
- `verifyBetChain` — replay and verify full bet chain
- `recoverSigner` — EIP-712 signature recovery
- `verifyMultiple` — batch signature verification

## EIP-712 Domain

```solidity
contract GameVault is IGameVault, EIP712("ManaMesh", "1") {
  // Domain separator: ManaMesh v1
}
```

**Important:** Frontend EIP-712 domain must match on-chain domain (chainId + verifyingContract). See `skill:manamesh-eip712`.

## Key Structs

```solidity
struct HandResult {
  bytes32 gameId;
  uint8 round;
  address[] players;        // player addresses
  int256[] deltas;          // chip deltas (positive = win, negative = loss)
  bytes32 finalBetHash;     // hash of final bet state
}

struct Bet {
  bytes32 gameId;
  uint8 round;
  uint8 playerIndex;
  BetType betType;          // FOLD, CHECK, CALL, BET, RAISE, ALL_IN
  uint256 amount;
  uint256 potAfter;
}

struct FoldAuth {
  bytes32 gameId;
  uint8 playerIndex;
  uint256 foldAmount;
  bytes signature;
}

struct Abandonment {
  bytes32 gameId;
  address[] remainingPlayers;
  uint256[] amounts;         // amounts each remaining player claims
  bytes[] signatures;        // signatures from remaining players
  uint256 abandonedAt;
}
```

## Settlement Flow

### Off-chain (Frontend)

1. Players play a hand, betting using signed `Bet` messages
2. At hand end, each player creates `HandResult` (players, deltas, finalBetHash)
3. Each player signs their `HandResult` with EIP-712 `eth_signTypedData`

### On-chain (GameVault)

```solidity
function settleHands(
  bytes32 gameId,
  HandResult[] calldata hands,
  bytes[] calldata signatures,
  FoldAuth[] calldata folds,
  bytes[] calldata foldSigs
) external {
  // 1. Validate fold authorizations (_processFolds)
  // 2. Verify hand signatures (SignatureVerifier.recoverSigner)
  // 3. Update escrow state (_settleHand)
  // 4. Track settled deltas in _settledDeltas
}
```

### Dispute Flow

```solidity
function disputeHand(
  bytes32 gameId,
  Bet[] calldata betChain,
  bytes[] calldata betChainSigs
) external {
  // 1. Replay bet chain with SignatureVerifier.verifyBetChain
  // 2. If fraud detected: _reverseSettlement
  // 3. Otherwise: confirm settlement stands
}
```

### Abandonment Flow

```solidity
function claimAbandonment(
  bytes32 gameId,
  Abandonment calldata auth
) external {
  // 1. Check abandonedAt + abandonmentTimeout passed
  // 2. Verify signatures from remaining players
  // 3. Redistribute escrowed chips per amounts[]
}
```

## Build & Test

```bash
cd contracts
forge build        # Compile
forge test         # Run tests
forge coverage     # Coverage report
```

**Test files:**

- `test/GameVault.t.sol` — settlement, disputes, abandonment
- `test/ChipToken.t.sol` — chip deposit/withdraw
- `test/Counter.t.sol` — basic Foundry test

## Vendor Dependencies

```
contracts/lib/openzeppelin-contracts/   # OpenZeppelin (SafeERC20, EIP712, ERC20, etc.)
contracts/lib/forge-std/               # Foundry test helpers
contracts/lib/crane/                    # Crane token/DF packages (TOKEN_PKG for ChipTokenFactory)
```

## Important Constraints / Gotchas

- **Settlement is conservative:** `GameVault` stores deltas and `settledDeltas`, allowing reversals on dispute.
- **Bet chain verification:** `disputeHand` replays the full bet chain — if any signature fails, fraud is flagged.
- **Factory requirement:** GameVault only accepts chips from its factory — `chipFactory.isChipToken(token)` check.
- **Crane deployment:** `ChipTokenFactory` uses Crane's deterministic deploy package, not simple `new Token()`. It requires the `TOKEN_PKG` for deployment.
- **Abandonment timeout:** Must pass `abandonedAt + abandonmentTimeout` before claiming.
- **Array length validation:** Critical — many vulnerabilities come from mismatched array lengths in `settleHands` and `disputeHand`.
- **EIP-712 array hashing:** Frontend must align with Solidity's `abi.encode`-based array hashing. Mismatch is a common bug — see MM-044 task.

## Key Files

```
contracts/src/GameVault.sol                          # Main escrow/settlement contract
contracts/src/ChipToken.sol                         # ERC20 chip token (ETH-backed)
contracts/src/ChipTokenFactory.sol                   # Chip token deployer
contracts/src/libraries/SignatureVerifier.sol         # EIP-712 helpers
contracts/src/interfaces/IGameVault.sol               # GameVault interface & structs
contracts/src/interfaces/IChipToken.sol               # ChipToken interface
contracts/src/interfaces/IChipTokenFactory.sol        # Factory interface
contracts/test/GameVault.t.sol                        # GameVault tests
contracts/test/ChipToken.t.sol                        # ChipToken tests
contracts/foundry.toml                               # Foundry configuration
```

## See Also

- `skill:manamesh-p2p` — Off-chain gameplay that produces HandResult signatures
- `skill:manamesh-game-modules` — Poker module that generates bets and HandResults
