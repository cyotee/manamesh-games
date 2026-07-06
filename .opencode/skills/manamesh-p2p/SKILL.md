---
name: manamesh-p2p
description: This skill should be used when the user asks about "P2P networking", "WebRTC", "libp2p", "join codes", "transport", "discovery", "mDNS", "DHT", "circuit relay", "boardgame.io transport", "signaling", "peer connection", or needs to understand how ManaMesh connects players without a central server.
---

# ManaMesh P2P Networking

## Conceptual Overview

ManaMesh uses a hybrid P2P transport system that automatically selects the best connection method. The stack attempts transports in priority order: **LAN/mDNS** → **Direct IP** → **Circuit Relay** → **Join Code** (fallback). This eliminates dependency on centralized STUN servers while maintaining compatibility with various network environments.

All P2P code lives in `packages/frontend/src/p2p/`.

## Transport Priority

| Priority | Transport           | Best For                              | STUN Required     |
| -------- | ------------------- | ------------------------------------- | ----------------- |
| 1        | LAN / Local Network | Same WiFi/network, LAN parties        | No                |
| 2        | Direct IP           | VPN users, port-forwarded setups      | No                |
| 3        | Circuit Relay       | NAT traversal via Protocol Labs nodes | No                |
| 4        | Join Code           | Fallback with copy/paste SDP exchange | Yes (Google STUN) |

Users can override via in-app **TransportSettings** or URL parameters:

```
/?transport=relay       # Force Circuit Relay only
/?transport=lan,relay   # Only LAN and Relay
/?verbose=true          # Enable detailed logs
```

## Core WebRTC (`src/p2p/webrtc.ts`)

Low-level WebRTC wrapper managing `RTCPeerConnection` and data channels:

- Creates offer/answer with ICE candidates
- Manages data channel lifecycle (open/close)
- JSON message framing for game actions
- ICE candidate handling with timeouts

**Key types:**

```typescript
ConnectionOffer { offer: RTCSessionDescriptionInit, iceCandidates: RTCIceCandidateInit[] }
```

## Join Code Codec (`src/p2p/codec.ts`)

Encodes `ConnectionOffer` blobs into short shareable strings (base64-like) for copy/paste:

- `encodeOffer(offer: ConnectionOffer)` → `string` — join code
- `decodeOffer(code: string)` → `ConnectionOffer`

This is the "legacy fallback" transport when others fail.

## Discovery Adapters (`src/p2p/discovery/`)

### DHT (`src/p2p/discovery/dht.ts`)

Primary global peer discovery via libp2p Kademlia DHT:

- `generateRoomCode()` → generates unique room key
- Host publishes offer to DHT under room key
- Guest queries room key to retrieve offer and establish WebRTC handshake

### mDNS (`src/p2p/discovery/mdns.ts`)

Zero-setup LAN discovery for local networks. Works without internet.

### Join Code (`src/p2p/discovery/join-code.ts`)

Two-way copy/paste SDP exchange — the manual fallback.

### Signaling (`src/p2p/discovery/signaling.ts`)

Optional centralized signaling server fallback. Backend provides a WebSocket signaling server at `ws://host:4000/signaling`.

## Transport Adapters (`src/p2p/transports/`)

Each adapter implements a unified interface for connection establishment:

- `joincode-transport.ts` — Join code with Google STUN fallback
- `relay-transport.ts` — Circuit relay via libp2p (no STUN needed)
- `lan-transport.ts` — LAN/mDNS transport
- `direct-ip-transport.ts` — Manual IP:port exchange

## Transport Manager (`src/p2p/transport-manager.ts`)

Selects best transport based on user settings and capability:

```typescript
// Default priority: ['lan', 'directIp', 'relay', 'joinCode']
// User can override via settings or URL params
```

## libp2p Config (`src/p2p/libp2p-config.ts`)

Creates browser-friendly libp2p node with:

- **Transports:** WebRTC, WebSocket
- **Protocols:** Circuit Relay v2, Kademlia DHT, Noise encryption, Yamux
- **Bootstrap nodes:** Protocol Labs relay nodes
- **Exported helpers:** `getNode()`, `stopNode()`, `isConnectedToPeers()`

```typescript
// Creates libp2p node with DHT and circuit relay
const node = await createLibp2p({
  transports: [webRTC(), webSockets()],
  peerDiscovery: [dht()],
  circuitRelay: { enabled: true },
  // ...
});
```

## boardgame.io Transport (`src/p2p/transport.ts`)

Implements boardgame.io's `Transport` interface using WebRTC data channels:

- Creates `P2PMultiplayer` transport from a `JoinCodeConnection` or `DHTConnection`
- Maps boardgame.io actions to/from WebRTC data channel messages
- Handles reconnection logic

**Usage:**

```typescript
import { P2PMultiplayer } from "p2p/transport";

const client = new Client({
  game: myGame,
  transport: P2PMultiplayer({
    connection,
    role,
    playerID,
    matchID,
    numPlayers,
  }),
});
```

## App P2P Initialization (`App.tsx` → `src/p2p/index.ts`)

`src/p2p/index.ts` is the public API entry point. `App.tsx` calls `startP2P()` to initialize the background P2P stack.

**Lobby flow:**

1. User enters P2PLobby → selects transport → creates/joins room
2. P2PLobby returns `connection` + `role` ("host" | "guest") via `onConnected` callback
3. App switches to "p2p-game" mode and constructs boardgame.io Client with `P2PMultiplayer`

## P2P Message Protocol (`src/p2p/lobby-protocol.ts`)

Lobby-level signaling messages between peers:

- `new-hand` signals for poker hand transitions
- Match lifecycle events

## Asset Transfer (`src/p2p/transfer-pipeline.ts`, `chunking.ts`)

Chunked transfer for large asset packs over P2P:

- Binary format with header (pack ID, total chunks, checksum)
- Chunking/reassembly helpers
- Consent flow for incoming transfers

## Backend Signaling (`packages/backend/src/signaling.ts`)

Minimal WebSocket signaling server for fallback:

- Room-based (`Map<roomId, Room>`)
- Message types: `join`, `leave`, `offer`, `answer`, `ice-candidate`
- In-memory only (no persistence)
- Routes at `ws://host:4000/signaling`

## Important Constraints / Gotchas

- **STUN dependency:** Only Join Code transport uses Google STUN. All others are STUN-free.
- **In-memory signaling:** Backend signaling server stores rooms in process memory — no persistence, no authentication.
- **No MongoDB in backend:** Backend currently has no database code. MongoDB Atlas integration is planned but not implemented.
- **libp2p mock in backend:** `packages/backend/src/index.ts` creates a mock libp2p node but doesn't use it functionally — it's a test stub.
- **DHT requires bootstrap:** Global DHT discovery needs libp2p bootstrap nodes (Protocol Labs nodes). If unavailable, falls back to relay or join code.
- **URL param overrides:** `/?transport=all` resets to defaults; `/?transport=joinCode` forces specific transport.

## Key Files

```
packages/frontend/src/p2p/index.ts                       # Public API entry
packages/frontend/src/p2p/webrtc.ts                     # WebRTC wrapper
packages/frontend/src/p2p/codec.ts                       # Join code encoding
packages/frontend/src/p2p/transport.ts                   # boardgame.io transport adapter
packages/frontend/src/p2p/transport-manager.ts           # Transport selection
packages/frontend/src/p2p/libp2p-config.ts               # libp2p node config
packages/frontend/src/p2p/discovery/dht.ts               # DHT discovery
packages/frontend/src/p2p/discovery/mdns.ts              # mDNS discovery
packages/frontend/src/p2p/discovery/join-code.ts        # Join code discovery
packages/frontend/src/p2p/discovery/signaling.ts         # Signaling server client
packages/frontend/src/p2p/transports/joincode-transport.ts
packages/frontend/src/p2p/transports/relay-transport.ts
packages/frontend/src/p2p/transports/lan-transport.ts
packages/frontend/src/p2p/transports/direct-ip-transport.ts
packages/frontend/src/p2p/lobby-protocol.ts               # Lobby signaling messages
packages/frontend/src/p2p/transfer-pipeline.ts             # Asset transfer
packages/frontend/src/p2p/chunking.ts                      # Chunk helpers
packages/frontend/src/components/P2PLobby.tsx             # P2P lobby UI
packages/frontend/src/components/TransportSettings.tsx    # Transport settings UI
packages/backend/src/index.ts                             # Express + mock libp2p
packages/backend/src/signaling.ts                         # WebSocket signaling server
```

## See Also

- `skill:manamesh-game-modules` — How P2P connects to boardgame.io games
- `skill:manamesh-assets` — P2P asset transfer pipeline
