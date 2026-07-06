---
name: manamesh-architecture
description: This skill should be used when the user asks about "ManaMesh architecture", "project overview", "tech stack", "how it works", "boardgame.io integration", "decentralized networking", "provably fair", or needs to understand the high-level design of the ManaMesh platform.
---

# ManaMesh Architecture Overview

## Project Intent

ManaMesh is a decentralized, browser-based multiplayer platform for competitive card and board games (Magic: The Gathering, One Piece Card Game, Lorcana, etc.). It prioritizes P2P networking so gameplay works without any server. Each game module demonstrates a different cryptographic paradigm for provably fair play between untrusted peers.

**Core principles:**

- **P2P-first** — Gameplay works without any server; backend is optional
- **Modularity** — Game-specific rules as pluggable handlers
- **Decentralization** — IPFS for assets, libp2p for networking
- **Security & Fairness** — Cryptographic commitments prevent cheating
- **Open Source** — Permissive license for community hosting

## Tech Stack

| Layer          | Technology                               |
| -------------- | ---------------------------------------- |
| Frontend       | React + Vite + TypeScript                |
| Game Engine    | boardgame.io (turn-based logic)          |
| Rendering      | Phaser 3 (2D card visuals)               |
| P2P Networking | libp2p + WebRTC                          |
| Asset Storage  | Helia (IPFS) + IndexedDB                 |
| Backend        | Node.js + Express (optional signaling)   |
| Blockchain     | Solidity + Foundry (on-chain settlement) |
| Crypto         | elliptic, snarkyjs, paillier-bigint      |

## Monorepo Structure

```
manamesh/
├── packages/
│   ├── frontend/                    # React app
│   │   └── src/
│   │       ├── App.tsx             # Main app + routing
│   │       ├── game/               # Game modules & registry
│   │       │   ├── modules/        # war, poker, gofish, etc.
│   │       │   └── registry.ts     # GameInfo map
│   │       ├── components/          # React UI components
│   │       ├── crypto/              # Cryptographic primitives
│   │       ├── p2p/                 # P2P networking layer
│   │       ├── phaser/              # Phaser 3 rendering
│   │       ├── assets/              # IPFS loader, caches, manifests
│   │       ├── hooks/               # React hooks
│   │       └── deck/                # Deck utilities
│   └── backend/                     # Optional Node.js server
│       └── src/
│           ├── index.ts             # Express + HTTP
│           └── signaling.ts         # WebSocket signaling
├── contracts/                       # Solidity smart contracts
│   └── src/
│       ├── GameVault.sol           # Escrow + settlement
│       ├── ChipToken.sol           # ERC20 chip token
│       └── libraries/              # SignatureVerifier
├── vendor/                          # Git submodules (forked deps)
│   ├── boardgame.io/               # boardgame.io fork
│   └── boardgameIO-p2p/            # P2P transport fork
└── tasks/                          # Project management (PM)
```

## Three Cryptographic Paradigms

### 1. Mental Poker (SRA Commutative Encryption)

For card games with hidden shuffled decks (War, Poker, Go Fish).

**Flow:**

1. Each player generates EC key pair
2. Key shares distributed via Shamir SSS to other players (key escrow)
3. Deck encrypted sequentially — each player adds one encryption layer
4. Deck shuffled (with commit-and-reveal proof)
5. Cards revealed via cooperative decryption (all players must contribute)
6. If player abandons: remaining players reconstruct their key from Shamir shares

**Key files:** `src/crypto/mental-poker/`, `src/crypto/shamirs/`

### 2. Commitment Schemes (Merkle Trees)

For board games requiring binding placement (Merkle Battleship).

**Flow:**

1. Player commits to board (100 cells) by publishing Merkle root
2. Each cell's leaf: `SHA256(gameId|playerId|cellIndex|bit|salt)`
3. On guess: opponent reveals cell value + Merkle proof
4. `applyReveal` verifies proof against committed root
5. Cannot change placement after game starts

**Key files:** `src/crypto/merkle.ts`, `src/game/modules/merkle-battleship/`

### 3. Threshold Homomorphic Encryption

For aggregation where individual inputs stay private but aggregate is decryptable (Threshold Tally Arena).

**Flow:**

1. Players run Feldman DKG to create shared public key
2. Each player encrypts input with shared public key (EC ElGamal)
3. Ciphertexts auto-aggregate via homomorphic addition
4. Any 2 of 3 players can combine partial decryptions to reveal total
5. DLEQ proofs verify partial decryptions are valid

**Key files:** `src/crypto/ec-elgamal-exp.ts`, `src/crypto/feldman-dkg.ts`, `src/crypto/dleq.ts`

## P2P Networking Architecture

```
App.tsx
  └── startP2P()                    # Initialize libp2p node
  └── GameSelector → ModeSelect
        └── P2PLobby               # User picks transport, creates/joins room
              └── TransportManager  # Tries: LAN → Direct IP → Relay → JoinCode
                    ├── DHTConnection      # libp2p DHT discovery
                    ├── LANConnection      # mDNS local discovery
                    ├── RelayConnection    # Circuit relay
                    └── JoinCodeConnection # Manual SDP copy/paste
              └── onConnected(connection, role)
                    └── P2PGame
                          └── Client(game, transport: P2PMultiplayer)
                                └── WebRTC data channel
```

**Key:** boardgame.io `transport: P2PMultiplayer({ connection, role, ... })` bridges the P2P connection to boardgame.io's sync protocol.

## Asset Loading Architecture

```
Card image request
      ↓
useCardImage(packId, cardId)
      ↓
loader.getCardImageUrl
      ↓
Check pack-level IndexedDB ('manamesh-card-images')
      ↓ miss
fetcher.fetchBlob(source, path)
      ↓
ipfs-loader.loadAsset(cid)
      ↓
Check global IndexedDB ('manamesh-asset-cache') — 100MB LRU
      ↓ miss
Helia (browser IPFS node)
      ↓ or
HTTP gateways (ipfs.io, dweb.link, cloudflare-ipfs.com)
      ↓
putInCache(cid, blob)
      ↓
storeCardImage(packId, cardId, side) → pack-level image cache
      ↓
Return object URL to UI
```

## Game Module System

Each module in `src/game/modules/<name>/` exports:

- `id` — unique game identifier
- `cardSchema` — JSON Schema for cards
- `zones` — play area definitions
- `initialState` — fresh game state factory
- `validateMove` — move authorization
- `getBoardgameIOGame()` — standard game
- `getCryptoGame?()` — crypto-enabled variant

**Registry:** `src/game/registry.ts` maps IDs to `GameInfo` entries.

## Smart Contract Architecture (Blockchain Settlement)

```
Off-chain:
  Player A + B play poker
  → Sign Bet messages with EIP-712 (wallet)
  → Produce signed HandResult at showdown

On-chain:
  GameVault.joinGame()     — deposit chips into escrow
  GameVault.settleHands() — distribute winnings based on signed HandResult
  GameVault.disputeHand()  — replay bet chain, reverse if fraud
  GameVault.claimAbandonment() — redistribute if player goes offline
```

## Vendor Submodules

| Submodule                | Version | Commit  | Purpose                         |
| ------------------------ | ------- | ------- | ------------------------------- |
| `vendor/boardgame.io`    | 0.50.2  | 4f3c90d | Game engine (forked, in-sync)   |
| `vendor/boardgameIO-p2p` | 0.4.4   | 665a1e7 | P2P transport (forked, in-sync) |

Both point to `cyotee/` GitHub forks but are currently in-sync with upstream.

## Development Commands

```bash
# Frontend dev
yarn dev:frontend        # Vite dev server

# Backend dev
yarn dev:backend         # nodemon + ts-node

# Build & test
yarn build               # Build all workspaces
yarn test                # Run Vitest tests (frontend)

# Contracts
cd contracts && forge build && forge test
```

## Important Constraints / Gotchas

- **No MongoDB yet:** Backend has no database code despite being mentioned in docs. Signaling is in-memory only.
- **HE Battleship is demo:** Not registered in game registry — component-only demo.
- **Go Fish ZK is scaffold:** Actual ZK circuits not generated — only signing/verification infrastructure.
- **Paillier/Feldman DKG are demo-quality:** Reduced key sizes for browser feasibility.
- **Shuffle proof is commit-and-reveal, not true ZK:** Code comments note this.
- **SRA hash-to-curve is try-and-increment:** Production should use proper `hash_to_curve`.
- **libp2p mock in backend:** Backend creates a libp2p node but doesn't use it functionally.

## Key Files

```
packages/frontend/src/App.tsx                        # Main app entry + routing
packages/frontend/src/game/registry.ts              # Game registration
packages/frontend/src/crypto/index.ts               # Crypto re-exports
packages/frontend/src/p2p/index.ts                  # P2P re-exports
packages/frontend/src/assets/ipfs-loader.ts          # IPFS loader
packages/frontend/src/phaser/PhaserBoard.tsx         # Phaser wrapper
packages/backend/src/index.ts                        # Express server
packages/backend/src/signaling.ts                    # WS signaling
contracts/src/GameVault.sol                         # Settlement contract
```

## See Also

- `skill:manamesh-game-modules` — Game module details
- `skill:manamesh-crypto` — Cryptographic primitives
- `skill:manamesh-p2p` — P2P networking
- `skill:manamesh-assets` — Asset loading
- `skill:manamesh-contracts` — Smart contracts
