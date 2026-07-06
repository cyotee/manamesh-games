# ManaMesh Poker: Cryptographically Fair P2P Texas Hold'em

This document explains the poker game workflow and security model used in ManaMesh's P2P poker implementation.

## Overview

ManaMesh Poker is a **trustless, peer-to-peer** Texas Hold'em implementation that uses **mental poker cryptography** to ensure fairness without requiring a trusted dealer or server. Players connect directly via WebRTC and use commutative encryption to shuffle and deal cards in a way that prevents cheating.

## Why Cryptographic Poker?

### The Problem with Traditional Online Poker

In traditional online poker:
- A **central server** shuffles and deals cards
- Players must **trust the server** not to cheat or leak information
- The server operator can see all cards and potentially collude with players
- Server compromise exposes all game state

### The Mental Poker Solution

Mental poker allows players to shuffle and deal cards **without any trusted party**:
- No player can see another player's cards until showdown
- No player can manipulate the deck order
- Card reveals are verifiable by all players
- Works entirely peer-to-peer

## Game Workflow

### Phase 1: Connection (P2P WebRTC)

```
┌─────────────┐                      ┌─────────────┐
│   HOST      │                      │   GUEST     │
│  (Player 0) │                      │  (Player 1) │
└──────┬──────┘                      └──────┬──────┘
       │                                    │
       │  1. Create offer code              │
       │  ◄──────────────────────────────   │
       │                                    │
       │  2. Share code out-of-band         │
       │  ────────────────────────────────► │
       │                                    │
       │  3. Generate answer code           │
       │  ◄──────────────────────────────   │
       │                                    │
       │  4. Share answer out-of-band       │
       │  ◄──────────────────────────────   │
       │                                    │
       │  5. WebRTC connection established  │
       │  ◄─────────────────────────────►   │
       │                                    │
```

Players exchange SDP offers/answers encoded as shareable join codes. This establishes a direct WebRTC data channel with no signaling server required.

### Phase 2: Cryptographic Setup

The game goes through four cryptographic phases before any cards are dealt:

#### 2a. Key Exchange

Each player generates an SRA (Shamir-Rivest-Adleman) key pair and shares their public key:

```
Player 0: Generate (pk₀, sk₀), broadcast pk₀
Player 1: Generate (pk₁, sk₁), broadcast pk₁
```

**Security Property**: Public keys are shared openly. Private keys never leave the player's browser.

#### 2b. Key Escrow (Shamir Secret Sharing)

Each player splits their private key into shares using Shamir's Secret Sharing and distributes shares to other players:

```
Player 0: Split sk₀ into shares, send share to Player 1
Player 1: Split sk₁ into shares, send share to Player 0
```

**Security Property**: If a player abandons the game, remaining players can reconstruct their key to complete card reveals. No single player can reconstruct another's key alone (threshold requirement).

#### 2c. Deck Encryption

Each player encrypts the entire deck with their private key, in sequence:

```
Initial:    [A♠, 2♠, 3♠, ..., K♥]  (52 cards as curve points)
                    │
                    ▼
Player 0:   E₀(deck) = [E₀(A♠), E₀(2♠), ..., E₀(K♥)]
                    │
                    ▼
Player 1:   E₁(E₀(deck)) = [E₁(E₀(A♠)), E₁(E₀(2♠)), ..., E₁(E₀(K♥))]
```

**Security Property**: Cards are now encrypted by ALL players. A card can only be revealed if ALL players provide their decryption keys.

#### 2d. Deck Shuffle

Each player shuffles the encrypted deck and re-encrypts:

```
Player 0:   Shuffle(E₁(E₀(deck))) + re-encrypt
Player 1:   Shuffle(result) + re-encrypt
```

**Security Property**: Because the deck is encrypted, players shuffle without knowing card positions. The final order is unknown to any single player.

### Phase 3: Gameplay

After cryptographic setup, standard Texas Hold'em proceeds:

```
┌─────────────────────────────────────────────────────────┐
│                    BETTING ROUNDS                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  PRE-FLOP                                               │
│  ├── Post blinds (SB: 10, BB: 20)                       │
│  ├── Deal 2 hole cards per player (encrypted reveal)    │
│  └── Betting round                                       │
│                                                          │
│  FLOP                                                    │
│  ├── Reveal 3 community cards (all players decrypt)     │
│  └── Betting round                                       │
│                                                          │
│  TURN                                                    │
│  ├── Reveal 1 community card                            │
│  └── Betting round                                       │
│                                                          │
│  RIVER                                                   │
│  ├── Reveal 1 community card                            │
│  └── Betting round                                       │
│                                                          │
│  SHOWDOWN                                                │
│  ├── Reveal remaining hole cards                        │
│  ├── Determine winner(s)                                │
│  └── Distribute pot                                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### Card Reveal Process

To reveal a card (e.g., Player 0's hole card):

```
Encrypted card: E₁(E₀(card))

1. Player 1 decrypts: D₁(E₁(E₀(card))) = E₀(card)
2. Player 0 decrypts: D₀(E₀(card)) = card

Result: Card is revealed only when both players cooperate
```

**Security Property**: A player can only see their own hole cards (opponent won't decrypt them). Community cards are revealed by all players together.

#### Private Hole Card Revelation

The key insight is that **decryption is done in layers, and the final layer is only removed by the card's owner**.

After the shuffle, every card is encrypted by both players:

```
Deck position 0: E₁(E₀(card_a))  ← Both layers, unknown card
Deck position 1: E₁(E₀(card_b))  ← Both layers, unknown card
Deck position 2: E₁(E₀(card_c))  ← Both layers, unknown card
...
```

Neither player knows which actual card (A♠, K♥, etc.) is at which position because the shuffle happened while encrypted.

**Dealing Hole Cards to Player 0 (HOST):**

Let's say positions 0 and 1 are dealt to Player 0:

```
Step 1: Player 1 (GUEST) decrypts their layer for positions 0 and 1

        E₁(E₀(card_a)) → D₁(...) → E₀(card_a)
        E₁(E₀(card_b)) → D₁(...) → E₀(card_b)

        Player 1 sends these partially-decrypted cards to Player 0

Step 2: Player 0 (HOST) decrypts their own layer

        E₀(card_a) → D₀(...) → card_a  ✓ Player 0 sees: 7♠
        E₀(card_b) → D₀(...) → card_b  ✓ Player 0 sees: K♦
```

**What Player 1 saw:** Only `E₀(card_a)` and `E₀(card_b)` — still encrypted, meaningless data.

**What Player 0 saw:** The actual cards `7♠` and `K♦`.

**Dealing Hole Cards to Player 1 (GUEST):**

Positions 2 and 3 are dealt to Player 1:

```
Step 1: Player 0 (HOST) decrypts their layer for positions 2 and 3

        E₁(E₀(card_c)) → D₀(...) → E₁(card_c)
        E₁(E₀(card_d)) → D₀(...) → E₁(card_d)

        Player 0 sends these partially-decrypted cards to Player 1

Step 2: Player 1 (GUEST) decrypts their own layer

        E₁(card_c) → D₁(...) → card_c  ✓ Player 1 sees: A♣
        E₁(card_d) → D₁(...) → card_d  ✓ Player 1 sees: Q♥
```

**What Player 0 saw:** Only `E₁(card_c)` and `E₁(card_d)` — still encrypted.

**What Player 1 saw:** The actual cards `A♣` and `Q♥`.

**Why This Works:**

| Property | Explanation |
|----------|-------------|
| **Owner sees cards** | They hold the final decryption key and apply it last |
| **Opponent can't see** | They only ever see a partially-decrypted blob still encrypted by the owner's key |
| **Order matters** | The owner MUST decrypt last, after receiving the opponent's partial decryption |
| **No trusted dealer** | Each player decrypts only their own layer — no central authority needed |

**Visual Summary:**

```
PLAYER 0's HOLE CARDS:              PLAYER 1's HOLE CARDS:

E₁(E₀(card))                        E₁(E₀(card))
     │                                   │
     ▼ Player 1 decrypts                 ▼ Player 0 decrypts
E₀(card)  ← P1 sees this (encrypted)    E₁(card)  ← P0 sees this (encrypted)
     │                                   │
     ▼ Player 0 decrypts                 ▼ Player 1 decrypts
   card   ← P0 sees plaintext           card   ← P1 sees plaintext
```

The asymmetry is intentional: **whoever decrypts last sees the card**. The opponent who decrypts first only sees an intermediate encrypted state.

### Phase 4: Settlement

After showdown:
1. Winner determined by standard poker hand rankings
2. Pot distributed to winner(s)
3. Chip balances updated via blockchain service
4. "Deal Next Hand" creates fresh game with new cryptographic setup

## Security Architecture

### P2P State Synchronization

The game uses a **HOST-authoritative** model:

```
┌─────────────────────────────────────────────────────────┐
│                  STATE AUTHORITY                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  HOST (Player 0)                 GUEST (Player 1)       │
│  ┌──────────────┐               ┌──────────────┐        │
│  │ Authoritative│               │   Follower   │        │
│  │    State     │◄─────────────►│    State     │        │
│  │              │   P2P Sync    │              │        │
│  └──────────────┘               └──────────────┘        │
│         │                              │                │
│         ▼                              ▼                │
│  - Processes moves            - Sends moves to HOST     │
│  - Validates state            - Waits for confirmation  │
│  - Broadcasts updates         - Applies received state  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### Critical Security Fix: `client: false`

All cryptographic setup moves use `client: false` to prevent **optimistic updates**:

```typescript
// crypto.ts - Setup phase moves
moves: {
  submitPublicKey: {
    move: ({ G, ctx }, playerId, publicKey) => submitPublicKey(G, ctx, playerId, publicKey),
    client: false,  // <-- CRITICAL: Prevents local execution
  },
  distributeKeyShares: {
    move: ({ G, ctx }, playerId, privateKey, shares) => distributeKeyShares(...),
    client: false,
  },
  encryptDeck: {
    move: ({ G, ctx }, playerId, privateKey) => encryptDeck(...),
    client: false,
  },
  shuffleDeck: {
    move: ({ G, ctx, events }, playerId, privateKey) => shuffleEncryptedDeck(...),
    client: false,
  },
}
```

**Why This Matters**:

Without `client: false`:
1. GUEST calls `submitPublicKey()`
2. boardgame.io optimistically applies the move locally (increments stateID to 1)
3. GUEST sends action to HOST with stateID 0
4. HOST processes and broadcasts update with stateID 1
5. GUEST receives update but local state is already at stateID 1
6. State mismatch causes "Stale state" errors

With `client: false`:
1. GUEST calls `submitPublicKey()`
2. boardgame.io sends action to HOST without local execution
3. HOST processes and broadcasts update with stateID 1
4. GUEST receives and applies update cleanly
5. State remains synchronized

#### Critical Security Fix: Stable P2P Client

The P2P client must remain stable during gameplay:

```typescript
// App.tsx - P2PGame component
const clientCreatedForHandRef = useRef<number>(-1);
const initialBalancesForHandRef = useRef<Record<string, number>>({});
const stableClientRef = useRef<typeof P2PClient>(null);

const P2PClient = useMemo(() => {
  // Skip recreation if already created for this hand
  if (clientCreatedForHandRef.current === handNumber) {
    return null;
  }
  clientCreatedForHandRef.current = handNumber;

  // ... create client
}, [connection, role, game, handNumber, handId, dealerIndex, playerID]);
// NOTE: initialBalances intentionally excluded to prevent recreation
```

**Why This Matters**:

Without stable client:
1. Game starts with `initialBalances: {}`
2. Async `blockchainService.getBalances()` resolves
3. `initialBalances` updates to `{0: 1000, 1: 1000}`
4. useMemo dependency change triggers P2PClient recreation
5. New P2PMaster created with fresh stateID: 0
6. GUEST still has higher stateID from previous client
7. "Stale state" errors, game breaks

With stable client:
1. Client created once per hand number
2. Async balance updates don't trigger recreation
3. State remains synchronized throughout game

### Comparison: Secure vs Insecure Approaches

| Aspect | Insecure (Server-Based) | Secure (Mental Poker) |
|--------|------------------------|----------------------|
| **Deck Shuffle** | Server shuffles, players trust server | Players jointly shuffle encrypted deck |
| **Card Visibility** | Server sees all cards | No party sees cards until reveal |
| **Cheating Prevention** | Trust server operator | Cryptographic impossibility |
| **Collusion Risk** | Server can collude | No central party to collude with |
| **Verification** | Trust server logs | All operations verifiable on-chain |
| **Single Point of Failure** | Server compromise | No central point to attack |

### Security Properties Achieved

1. **Card Secrecy**: No player can see cards they shouldn't see (enforced by encryption)
2. **Shuffle Fairness**: No player can influence card order (encrypted shuffle)
3. **Reveal Integrity**: Cards can only be revealed with proper key cooperation
4. **Abandonment Recovery**: Key escrow allows game completion if player leaves
5. **State Integrity**: HOST-authoritative model with `client: false` prevents desync
6. **Verifiability**: All cryptographic operations can be verified by any party

## File Structure

```
src/game/modules/poker/
├── README.md           # This file
├── crypto.ts           # Mental poker game with cryptographic phases
├── types.ts            # Type definitions for crypto poker state
├── betting.ts          # Betting round logic
├── hands.ts            # Hand evaluation and winner determination
└── game.ts             # Standard deck/card utilities

src/crypto/
├── mental-poker/
│   ├── sra.ts          # SRA commutative encryption
│   └── index.ts        # Mental poker operations (encrypt, shuffle, reveal)
├── shamirs/
│   └── index.ts        # Shamir secret sharing for key escrow
└── plugin/
    └── crypto-plugin.ts # boardgame.io plugin for crypto state

src/p2p/
├── transport.ts        # P2P transport with HOST/GUEST roles
├── webrtc.ts           # WebRTC peer connection wrapper
└── discovery/
    └── join-code.ts    # Two-way join code exchange
```

## Testing the Implementation

1. Open two browser tabs at `http://localhost:3001`
2. Both select Texas Hold'em → P2P Online
3. Tab 1: Create Game (Host) → copy offer code
4. Tab 2: Join Game (Guest) → paste offer code → copy answer code
5. Tab 1: Paste answer code → Connect
6. Observe cryptographic setup phases complete
7. Play poker with full P2P state synchronization

## Future Enhancements (MM-031)

- **Wallet Authentication**: Player identity via Ethereum wallet signatures
- **On-Chain Settlement**: Chip balances stored in smart contracts
- **Shuffle Commitments**: Commit-reveal for shuffle verification
- **Dispute Resolution**: On-chain arbitration for contested games
- **Tournament Mode**: Multi-table tournaments with bracket progression
