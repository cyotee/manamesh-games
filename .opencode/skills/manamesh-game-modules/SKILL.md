---
name: manamesh-game-modules
description: This skill should be used when the user asks about "game modules", "boardgame.io integration", "War game", "Poker game", "Go Fish", "Merkle Battleship", "Threshold Tally", "game phases", "game moves", "GameModule interface", "getCryptoGame", "add a new game module", or needs to understand how ManaMesh implements card games.
---

# ManaMesh Game Modules

## Conceptual Overview

ManaMesh uses a pluggable GameModule system backed by boardgame.io for turn-based multiplayer card games. Each game module exports a standardized interface (types, zones, moves, validation) and wraps it in a boardgame.io Game object. Crypto-enabled games provide both a standard `getGame()` and a `getCryptoGame()` variant that uses SRA commutative encryption for provably fair play.

## Key Concepts

### GameModule Interface (`src/game/modules/types.ts`)

Every module must export:

- `id: string` — unique game identifier (e.g., "war", "poker", "gofish")
- `cardSchema: string` — JSON Schema for card validation
- `zones: ZoneDefinition[]` — defines play areas (deck, hand, field, discard, etc.)
- `initialState: (opts) => GameState` — creates fresh game state
- `validateMove: (state, moveName, playerID) => boolean` — move authorization
- `getBoardgameIOGame: () => Game` — boardgame.io Game definition (standard)
- `getCryptoGame?: () => Game` — boardgame.io Game with crypto (optional)

### Host-Authoritative Moves

All crypto game moves use `client: false` in boardgame.io, meaning moves execute on the host's state machine. This prevents clients from lying about game state. Standard games may use `client: true` for local-only moves.

### Standard Game Phases

Each module defines phases via boardgame.io's `flow` object. Crypto games follow this progression:

```
keyExchange → keyEscrow → encrypt → shuffle → gameplay phases → gameOver (or voided)
```

### ZoneDefinition

```typescript
interface ZoneDefinition {
  id: string; // unique zone id
  name: string; // display name
  type: "deck" | "hand" | "field" | "discard" | "token" | "remote";
  owner: "player" | "shared" | "global";
  capacity?: number; // optional max cards
  visibleTo?: string[]; // player IDs who can see this zone
}
```

## Game Modules

### 1. War (`war`)

**Files:**

- `src/game/modules/war/types.ts` — WarCard, WarState, zone definitions
- `src/game/modules/war/game.ts` — boardgame.io Game, moves (flipCard, surrender)
- `src/game/modules/war/crypto.ts` — SRA/Shamir helpers for crypto variant

**Standard phases:** `flip` → `resolve` → `gameOver`
**Crypto phases:** `keyExchange` → `keyEscrow` → `encrypt` → `shuffle` → `flip` → `reveal` → `resolve` → `gameOver` (or `voided`)

**Key moves:** `submitPublicKey`, `distributeKeyShares`, `encryptDeck`, `shuffleDeck`, `flipCard`, `approveDecrypt`, `releaseKey`, `surrender`

### 2. Poker (`poker`)

**Files:**

- `src/game/modules/poker/types.ts` — PokerCard, PokerState, BettingState
- `src/game/modules/poker/game.ts` — boardgame.io Game, phases (preflop/flop/turn/river/showdown)
- `src/game/modules/poker/crypto.ts` — SRA/Shamir helpers
- `src/game/modules/poker/hands.ts` — HandRank enum, evaluateHand, compareHands, findBestHand, determineWinners
- `src/game/modules/poker/betting.ts` — initBettingRound, processFold/Check/Call/Bet/Raise/AllIn, calculateSidePots

**Crypto phases:** `keyExchange` → `keyEscrow` → `encrypt` → `shuffle` → `preflop` → `flop` → `turn` → `river` → `showdown` → `gameOver`

**Betting moves:** `fold`, `check`, `call`, `bet`, `raise`, `allIn`
**Crypto moves:** Same as War + `peekHoleCards`, `requestDecrypt`, `approveDecrypt`, `releaseKey`

### 3. Go Fish (`gofish`) — 3 Security Variants

**Files:**

- `src/game/modules/gofish/types.ts` — GoFishState, securityMode types
- `src/game/modules/gofish/crypto.ts` — shared crypto engine (handles all 3 modes)

All 3 variants share the same `crypto.ts` engine, differentiated by `securityMode`:

- `"demo-private"` — private keys stored in shared state (insecure, teaching tool)
- `"coop-reveal"` — cooperative decryption, keys never in shared state
- `"zk-attest"` — ZK proof scaffolding with ECDSA verifier-signed verdicts

**Crypto phases:** `keyExchange` → `keyEscrow` → `encrypt` → `shuffle` → `play` → `gameOver`

**Deterministic shuffle:** Uses commit-reveal seed sub-protocol:

1. Each player commits `SHA256(seedHex)` via `commitShuffleSeed`
2. Each player reveals `seedHex` via `revealShuffleSeed`
3. `finalSeedHex` = XOR of all revealed seeds → deterministic Fisher-Yates

**Moves:** `askRank`, `respondToAsk`, `goFish`, `claimBooks`, `submitDecryptionShare` (coop/zk), `submitZkProofRespondToAsk` / `submitZkProofClaimBooks` (zk)

### 4. Merkle Battleship (`merkle-battleship`)

**Files:**

- `src/game/modules/merkle-battleship/types.ts`
- `src/game/modules/merkle-battleship/game.ts`
- `src/game/modules/merkle-battleship/commitment.ts` — Merkle commitment helpers

**Phases:** `placement` → `battle` → `gameOver`

**Commitment:** SHA-256 Merkle tree commitments. Each cell's leaf hash: `SHA256(utf8("${gameId}|${playerId}|${cellIndex}|${bit}|") || saltBytes)`
**Win condition:** `hasAllShipsSunkFromMarks` — all 17 ship cells (Carrier5 + Battleship4 + Cruiser3 + Submarine3 + Destroyer2) marked as hits

### 5. Threshold Tally Arena (`threshold-tally`)

**Files:**

- `src/game/modules/threshold-tally/types.ts`
- `src/game/modules/threshold-tally/game.ts`
- `src/game/modules/threshold-tally/logic.ts` — DKG, ElGamal, combine/verify helpers

**Phases:** `setup` → `commit` → `decrypt` → `resolve` (cycles back to `commit`)

**DKG Setup:** `publishDkgCommitment` → `confirmDkgShare` → `publishPublicShare` → `finalizeDkg`
**Commit:** `submitCiphertext` — EC ElGamal encryption, auto-aggregates on submit
**Decrypt:** `submitDecryptShare` — partial decryptions with DLEQ proofs, Lagrange interpolation

### 6. HE Battleship — Demo Only

**Files:**

- `src/game/modules/he-battleship/types.ts`
- `src/game/modules/he-battleship/game.ts`
- `src/game/modules/he-battleship/logic.ts`

**Status:** Demo/scaffolding — not registered in game registry. Battle phase reads opponent's `boardBits` directly (trusted mode).

## Game Registry (`src/game/registry.ts`)

Maps game IDs to `GameInfo` entries. Use `getGame(id)` for standard or `getCryptoGame(id)` for crypto variant:

```typescript
const game = getCryptoGame('poker');
const client = new Client({ game: game, ... });
```

## Board Components (`src/components/`)

Each game has a React board component:

- `WarBoard.tsx`
- `PokerBoard.tsx`
- `GoFishBoard.tsx`
- `MerkleBattleshipBoard.tsx`
- `ThresholdTallyBoard.tsx`

Components use `useEffect` hooks for auto-setup (crypto key exchange, encryption, shuffling).

## Important Constraints / Gotchas

- **Setup player index:** Sequential setup steps (encrypt, shuffle) are gated by `setupPlayerIndex` which cycles through `playerOrder`. Only the current setup player can execute these moves.
- **Voided state:** All crypto games can enter a `voided` phase for unrecoverable failures (invalid proofs, failed signature verification).
- **Go Fish shuffle deadlock:** The commit-reveal steps for Go Fish shuffle must NOT be gated behind `isMySetupTurn`. Only the sequential `shuffleDeck` call should be gated. This was a previous bug.
- **HE Battleship not registered:** The HE Battleship module exists but is not in the registry — it's a component-only demo accessed via direct import.
- **Go Fish ZK circuits are placeholder:** The ZK infrastructure (signing/verification) is wired but actual ZK proofs are not yet generated.

## Key Files

```
packages/frontend/src/game/modules/types.ts        # GameModule interface, CoreCard, ZoneDefinition
packages/frontend/src/game/registry.ts            # GameInfo map, getGame, getCryptoGame
packages/frontend/src/game/modules/war/types.ts
packages/frontend/src/game/modules/war/game.ts
packages/frontend/src/game/modules/war/crypto.ts
packages/frontend/src/game/modules/poker/types.ts
packages/frontend/src/game/modules/poker/game.ts
packages/frontend/src/game/modules/poker/crypto.ts
packages/frontend/src/game/modules/poker/hands.ts
packages/frontend/src/game/modules/poker/betting.ts
packages/frontend/src/game/modules/gofish/types.ts
packages/frontend/src/game/modules/gofish/crypto.ts
packages/frontend/src/game/modules/merkle-battleship/types.ts
packages/frontend/src/game/modules/merkle-battleship/game.ts
packages/frontend/src/game/modules/merkle-battleship/commitment.ts
packages/frontend/src/game/modules/threshold-tally/types.ts
packages/frontend/src/game/modules/threshold-tally/game.ts
packages/frontend/src/game/modules/threshold-tally/logic.ts
packages/frontend/src/game/modules/he-battleship/types.ts
packages/frontend/src/game/modules/he-battleship/game.ts
packages/frontend/src/game/modules/he-battleship/logic.ts
packages/frontend/src/components/WarBoard.tsx
packages/frontend/src/components/PokerBoard.tsx
packages/frontend/src/components/GoFishBoard.tsx
packages/frontend/src/components/MerkleBattleshipBoard.tsx
packages/frontend/src/components/ThresholdTallyBoard.tsx
```

## See Also

- `skill:manamesh-crypto` — SRA, Shamir, Merkle, threshold crypto primitives
- `skill:manamesh-p2p` — P2P networking and boardgame.io transport
- `skill:manamesh-assets` — IPFS asset loading and asset packs
