Wonderful, then# Trystero Multiplayer Feasibility & Implementation Plan

**Status:** Investigation / plan (not implemented)  
**Date:** 2026-07-23  
**Upstream:** [dmotz/trystero](https://github.com/dmotz/trystero) (v0.25.3 as of 2026-07-13)  
**License:** MIT  
**Scope:** Evaluate Trystero as a multiplayer connection path for ManaMesh, with automatic fallback to the existing join-code / transport stack when Trystero fails.  
**Product requirements (Timestreams-first):** [`TRYSTERO_MULTIPLAYER_PRD.md`](./TRYSTERO_MULTIPLAYER_PRD.md)  
**Implementation plan (Timestreams + Poker + One Piece):** [`TRYSTERO_MULTIPLAYER_IMPLEMENTATION_PLAN.md`](./TRYSTERO_MULTIPLAYER_IMPLEMENTATION_PLAN.md)

---

## 1. Executive summary

| Question | Answer |
|----------|--------|
| Is Trystero feasible for ManaMesh? | **Yes**, primarily as a **signaling / matchmaking + data-channel adapter**, not as a replacement for boardgame.io or crypto game logic. |
| Best fit | Short **room codes** that auto-establish WebRTC, replacing painful two-way SDP copy/paste for most users. |
| Keep existing stack? | **Yes.** Join-code WebRTC remains the **hard fallback** (and LAN/direct/relay stay optional). |
| Risk level | **Medium** for product UX; **low** for architecture if integrated behind `P2PChannel`. |
| Recommended first slice | Timestreams + Poker lobbies: Trystero room → `P2PChannel` → existing `P2PMultiplayer`. |

**Verdict:** Trystero is a strong fit for **serverless peer discovery**. ManaMesh already isolates game sync behind a thin channel interface (`P2PChannel`). Implementing a `TrysteroChannel` that implements that interface, and ranking it ahead of join-code in the connection ladder, is the lowest-risk path.

---

## 2. What Trystero is (upstream)

Trystero makes browsers **discover each other and open WebRTC data channels** without a custom matchmaking server. App data after connect is **peer-to-peer and end-to-end encrypted**; only **signaling (SDP / ICE)** rides the chosen strategy medium.

### 2.1 Strategies (same API)

| Import | Medium | Notes |
|--------|--------|--------|
| `trystero` (default) | **Nostr** | High relay redundancy; good default for decentralized UX. |
| `@trystero-p2p/mqtt` | MQTT | Next preferred decentralized option per upstream. |
| `@trystero-p2p/torrent` | BitTorrent trackers | Tracker-dependent. |
| `@trystero-p2p/ipfs` | IPFS | Least robust of the decentralized set per upstream. |
| `@trystero-p2p/supabase` | Supabase Realtime | Managed middle ground. |
| `@trystero-p2p/firebase` | Firebase RTDB | Managed middle ground. |
| `@trystero-p2p/ws-relay` | Self-hosted WS | Full control; requires running a relay. |

### 2.2 Core API surface (relevant to us)

```ts
import { joinRoom, selfId } from 'trystero' // or strategy-specific package

const room = joinRoom(
  {
    appId: 'manamesh',           // required unique app namespace
    password?: string,           // stronger SDP encryption (shared secret)
    turnConfig?: IceServer[],    // TURN for hard NAT
    rtcConfig?: RTCConfiguration,
    relayConfig?: { urls?, redundancy?, ... },
  },
  roomId,                        // shared table / lobby namespace
  {
    onJoinError?(details),
    onPeerHandshake?(peerId, send, receive, isInitiator), // admission gate
    handshakeTimeoutMs?: number,
  },
)

room.onPeerJoin = (peerId) => { ... }
room.onPeerLeave = (peerId) => { ... }
const action = room.makeAction<MyPayload>('bgio') // typed actions
await action.send(payload, { target: peerId })
action.onMessage = (data, { peerId, metadata }) => { ... }
room.leave()
room.getPeers() // Map peerId → RTCPeerConnection
room.ping(peerId)
```

**Useful built-ins:** automatic serialization/chunking, progress for large binary (asset packs), request/response actions, React-friendly idempotent `joinRoom`, optional media streams (not required for card games).

### 2.3 Explicit limitations (from upstream + WebRTC reality)

1. **Signaling is not free or private by default** — public Nostr/MQTT/torrent relays can observe *that* a room is active; SDP is encrypted (appId+roomId key by default, or custom `password`).
2. **Hard NAT / symmetric NAT** still needs **TURN** — same fundamental limit as our STUN-only join-code path.
3. **Browsers limit concurrent WebRTC peer connections** — design around small rooms (poker 2–6, Timestreams 2p).
4. **Room ID must be shared out-of-band** (link, QR, chat) — better UX than full SDP codes, but still shared knowledge.
5. **Not a game engine** — no turn order, no authoritative host, no boardgame.io integration out of the box.

---

## 3. Current ManaMesh multiplayer architecture

### 3.1 Layers (what we already have)

```
┌─────────────────────────────────────────────────────────────┐
│  Game modules (Poker, Timestreams, …) + mental poker crypto │
│  boardgame.io Game moves (client: false for crypto)         │
└────────────────────────────▲────────────────────────────────┘
                             │ multiplayer transport
┌────────────────────────────┴────────────────────────────────┐
│  @cyotee/boardgameio-p2p  channel P2PTransport /            │
│  P2PMultiplayer({ connection, role, matchID, … })           │
│  Speaks boardgame.io protocol over a string data channel    │
└────────────────────────────▲────────────────────────────────┘
                             │ P2PChannel
┌────────────────────────────┴────────────────────────────────┐
│  P2PChannel { send, isConnected, events }                   │
│  Implementations today: JoinCodeConnection (+ LAN/relay…)   │
└────────────────────────────▲────────────────────────────────┘
                             │ discovery / ICE
┌────────────────────────────┴────────────────────────────────┐
│  WebRTC PeerConnection wrapper, SDP codec, TransportManager │
│  Priority (historical): lan → directIp → relay → joinCode   │
│  Production path for Timestreams: manual join codes         │
│  (libp2p DHT matchmaking retired for Timestreams product)   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Critical abstraction: `P2PChannel`

From `packages/boardgameIO-p2p/src/channel.ts`:

```ts
export interface P2PChannel {
  send(data: string): void;
  isConnected(): boolean;
  events: {
    onMessage: (data: string) => void;
    onConnectionStateChange: (state: ConnectionState) => void;
  };
}
```

Anything that implements this can feed `P2PMultiplayer` without touching game rules.  
**This is the correct integration point for Trystero.**

### 3.3 What “existing solution” means (fallback target)

| Path | Role today | Fallback value |
|------|------------|----------------|
| **Join codes** (manual SDP offer/answer) | Primary production path for Timestreams; poker lobby also uses it | Works with zero third-party relays; offline-ish LAN-adjacent; predictable |
| LAN / direct IP / relay adapters | Present in `TransportManager` | Optional; uneven browser support |
| Optional Express/WS signaling backend | Non-required fallback | Can host our own signaling if public strategies fail |
| libp2p DHT | Retired for Timestreams product matchmaking | Do not re-enable as default without product decision |

Join-code pain points Trystero can address:

- Long, fragile copy/paste codes  
- Two-round trip UX (offer → answer → accept)  
- No automatic peer discovery once room ID is known  
- Symmetric NAT failures (shared with Trystero unless TURN is added)

---

## 4. Feasibility analysis

### 4.1 Architectural fit — **Strong**

| ManaMesh need | Trystero capability | Fit |
|---------------|---------------------|-----|
| Establish WebRTC between browsers | `joinRoom` + ICE strategies | Excellent |
| Host-authoritative boardgame.io | Host still runs `P2PMultiplayer` role=`host`; Trystero only carries bytes | Excellent if we map mesh → star |
| Short shareable table code | `roomId` string | Excellent |
| Fallback without rewriting games | New `P2PChannel` impl + lobby branch | Excellent |
| Large binary (asset packs) | `makeAction` chunking + progress | Good (optional later) |
| Crypto fairness (SRA / keychain) | Out of scope for transport — stays in game packages | Neutral / good |
| Identity = wallet / playerID | `onPeerHandshake` + app-level seat map | Needs design |
| N-player poker (2–6) | Full mesh of RTCPeerConnections | Feasible for small N; host may still only *use* N−1 channels for game sync |

### 4.2 What Trystero should **not** own

- boardgame.io move protocol / host master  
- Mental-poker key exchange or settlement  
- EIP-712 / on-chain settler  
- Asset pack content validation (only transport)  
- Permanent replacement of join-code (keep for air-gapped / relay-down scenarios)

### 4.3 Strategy recommendation for ManaMesh

| Priority | Strategy | Why |
|----------|----------|-----|
| **Primary (product)** | **Nostr** (`trystero`) *or* **MQTT** | Zero ManaMesh infra; public redundancy. Prefer Nostr first per upstream. |
| **Controlled deploy** | **Self-hosted `ws-relay`** | Predictable ops for poker testnet / demos; can run next to optional backend. |
| **Enterprise / private tables** | Supabase or Firebase | SLA-ish; not required for P2P-first ethos. |
| **Avoid as default** | Public BitTorrent / IPFS alone | Upstream ranks them less robust; OK as secondary strategy later. |

**Bundle strategy:** import **one** strategy entrypoint (tree-shake). Do not ship all strategy packages in the main SPA unless lazy-loaded.

### 4.4 Security & privacy considerations

| Topic | Assessment | Mitigation |
|-------|------------|------------|
| SDP on public relays | Encrypted by default; derivable without custom password | Always set `password` derived from room secret (see below) |
| Room enumeration | Knowing `appId` + `roomId` may allow join attempts | High-entropy room IDs; optional password; `onPeerHandshake` admission |
| Peer impersonation | `selfId` is Trystero-local, not wallet identity | Handshake: wallet signature or host-issued seat token; map to boardgame.io `playerID` |
| MITM on data channel | WebRTC DTLS E2E after connect | Trust model same as current WebRTC; app-layer crypto still required for fairness |
| Relay operator DoS / censorship | Public Nostr relays can flake | Multi-relay `redundancy` + fallback to join-code |
| Poker real-money adjacency | Matchmaking is not settlement | Do not treat Trystero as trust root for chips |

**Room secret scheme (recommended):**

```
roomId     = public short code (e.g. base32, 8–10 chars)  // shared in UI / URL
password   = HKDF(roomSecret) or same secret as roomId if entropy high enough
// Prefer: generate 128-bit secret, encode as room code; use it as both roomId and password
// for private tables. For public lobbies, use separate password field in lobby.
```

### 4.5 Host / guest role model (important)

Trystero is a **mesh**: every peer can talk to every other peer. ManaMesh games use **host-authoritative** boardgame.io (`role: 'host' | 'guest'`).

**Recommended mapping:**

1. Creator joins room with `passive: false` and declares itself **host** via handshake (`{ role: 'host', seat: 0, matchID }`).
2. Guests join same `roomId`, handshake as `{ role: 'guest', requestedSeat? }`.
3. Only **host ↔ each guest** channels carry boardgame.io traffic (star topology over mesh).
4. Guest–guest traffic optional for crypto peels if a game ever needs it; today coop decrypt can go via host moves or direct channels later.
5. If two hosts appear (double-tab), handshake rejects the second host or uses deterministic election (`selfId` lexicographic) — **prefer reject + show error**.

### 4.6 Failure modes → fallback

| Failure | Detect | Fallback action |
|---------|--------|-----------------|
| Relay sockets never open | `getRelaySockets()` empty / timeout (~5–10s) | Drop to join-code UX |
| SDP exchanged, ICE fails | `onJoinError` with peer/ICE error | Prompt TURN config **or** join-code (same NAT pain) |
| Wrong password | `onJoinError` | User-visible error; no silent fallback to open room |
| Handshake reject | timeout / throw | Stay in lobby; do not start game |
| Peer leave mid-hand | `onPeerLeave` | Existing disconnect / abandonment paths |
| Bundle / strategy crash | try/catch around `joinRoom` | Join-code only |

**UX rule:** never silently switch mid-hand. Fallback is **only during lobby connect**. Mid-game: reconnect policy (rejoin same room) before giving up.

### 4.7 Feasibility scorecard

| Dimension | Score (1–5) | Notes |
|-----------|-------------|-------|
| Technical fit | 5 | Clean `P2PChannel` boundary |
| UX improvement | 5 | Short room codes vs dual SDP |
| Security fit | 3–4 | Needs password + handshake |
| Ops burden (Nostr/MQTT) | 5 | Near-zero |
| Ops burden (ws-relay) | 3 | One small process |
| NAT coverage | 2–3 without TURN; 4 with TURN | Same as today |
| Testability | 4 | Mock channel; Playwright dual browser |
| Bundle impact | 3–4 | One strategy package |
| Multi-player poker | 4 | Small N mesh OK |

**Overall:** **Feasible and recommended** as primary *discovery* path with join-code fallback.

---

## 5. Target architecture

```
┌──────────────── Lobby UI (Timestreams / Poker) ────────────────┐
│  [ Create table ] → generate roomCode                           │
│  [ Join table ]   → enter roomCode                              │
│  Connection mode: Auto (Trystero → JoinCode) | JoinCode only    │
└───────────────────────────┬────────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  ConnectionOrchestrator   │
              │  (new, thin)              │
              └─────────────┬─────────────┘
                 try │                 │ fallback
        ┌────────────▼──────┐   ┌──────▼──────────────┐
        │ TrysteroTransport │   │ JoinCodeConnection  │
        │  joinRoom(appId,  │   │  (existing)         │
        │   roomCode, …)    │   │                     │
        └────────────┬──────┘   └──────┬──────────────┘
                     │                 │
                     └────────┬────────┘
                              ▼
                    P2PChannel adapter
                              │
                              ▼
                 P2PMultiplayer({ connection, role })
                              │
                              ▼
                      boardgame.io Client + Game
```

### 5.1 New types (sketch)

```ts
// packages/manamesh/packages/frontend/src/p2p/transports/trystero-transport.ts

export type MatchmakingBackend = 'trystero' | 'joinCode';

export interface TrysteroConfig {
  appId: string;                    // e.g. 'manamesh-v1'
  strategy: 'nostr' | 'mqtt' | 'ws-relay';
  relayUrls?: string[];             // optional overrides / required for ws-relay
  turnConfig?: RTCIceServer[];
  connectTimeoutMs?: number;        // default 12000
  passwordFromRoomCode?: boolean;   // default true for private tables
}

/** Adapts one logical peer (usually host↔guest) to P2PChannel. */
export class TrysteroChannel implements P2PChannel {
  send(data: string): void;
  isConnected(): boolean;
  events: P2PChannelEvents;
  // internals: room.makeAction('manamesh-bgio') targeting fixed peerId
}
```

Extend `TransportType` (optional, for TransportManager parity):

```ts
// proposed
export type TransportType = 'trystero' | 'lan' | 'directIp' | 'relay' | 'joinCode';
export const TRANSPORT_PRIORITY: TransportType[] = [
  'lan',
  'trystero',   // automatic global discovery
  'directIp',
  'relay',
  'joinCode',   // last-resort manual SDP
];
```

**Note:** Timestreams product path may skip LAN/libp2p and use only `trystero → joinCode` to keep UX simple.

### 5.2 Message protocol on Trystero actions

Keep boardgame.io traffic opaque strings (already JSON):

| Action ID | Payload | Purpose |
|-----------|---------|---------|
| `manamesh-bgio` | `string` (existing P2P messages) | Game sync |
| `manamesh-hs` | handshake JSON | Seat / role / version / optional wallet proof |
| `manamesh-lobby` (optional) | lobby protocol messages | Pre-game deck lists / asset sharing |
| `manamesh-bin` (optional) | ArrayBuffer + metadata | Asset pack chunks |

Do **not** invent a second boardgame.io transport — wrap existing channel protocol only.

### 5.3 Connection orchestrator algorithm

```
createOrJoin(roomCode, role):
  1. if mode === 'joinCodeOnly' → existing join-code flow; return
  2. try Trystero:
       a. joinRoom(config, roomCode, { onJoinError, onPeerHandshake })
       b. wait until expected peer connected OR timeout
       c. complete handshake (role, protocol version, seat)
       d. return TrysteroChannel(peerId)
  3. on failure (except wrong password):
       a. room.leave()
       b. surface "Auto-connect failed — switching to join codes"
       c. existing JoinCodeConnection flow
  4. on wrong password: do not fallback; show error
```

---

## 6. Implementation plan

### Phase 0 — Spike (0.5–1 day)

**Goal:** Prove two browsers can exchange boardgame.io-shaped messages via Trystero.

Tasks:

1. Add dependency to frontend workspace: `trystero` (Nostr) — pin exact version (e.g. `0.25.3`).
2. Create a **dev-only page** or Vitest-browser/Playwright smoke: two tabs, same `roomId`, `makeAction('ping')`.
3. Measure: connect time, reliability on same machine / two networks, bundle delta.
4. Document spike results in this file (appendix).

**Exit criteria:** ping RTT works; ICE failure is detectable via `onJoinError`.

### Phase 1 — `TrysteroChannel` + unit tests (1–2 days)

**Goal:** First-class `P2PChannel` implementation.

Files (proposed):

| Path | Responsibility |
|------|----------------|
| `frontend/src/p2p/trystero/config.ts` | `appId`, strategy, env (`VITE_TRYSTERO_*`) |
| `frontend/src/p2p/trystero/channel.ts` | `TrysteroChannel` implements `P2PChannel` |
| `frontend/src/p2p/trystero/handshake.ts` | role/seat/version admission |
| `frontend/src/p2p/trystero/orchestrator.ts` | try Trystero → fallback join-code |
| `frontend/src/p2p/trystero/*.test.ts` | mock room / fake actions |

Tests:

- Channel `send` → action `send` to target peer  
- Inbound action → `events.onMessage`  
- Disconnect → `onConnectionStateChange('disconnected'|'failed')`  
- Handshake reject does not mark connected  
- Orchestrator falls back after timeout (mocked)

**Exit criteria:** unit tests green; no lobby UI change required yet.

### Phase 2 — Lobby integration (Timestreams first) (2–3 days)

**Goal:** Product path uses short room codes via Trystero; join-code remains secondary UI.

1. Update `TimestreamsLobby` (and optionally poker lobby):
   - Host: generate room code → orchestrator host path  
   - Guest: paste/type code → orchestrator guest path  
2. Keep **manual join-code** behind “Advanced / fallback” expandable panel.
3. On auto-fail: auto-open join-code panel with explanation.
4. Wire successful `P2PChannel` into existing `P2PMultiplayer` call sites (`pages/timestreams/main.tsx`).

**Exit criteria:** two browsers play a Timestreams hand over Trystero without SDP paste.

### Phase 3 — Poker lobby + multi-peer (2–3 days)

**Goal:** 2–6 player tables.

1. Host creates room; each guest joins same `roomId`.
2. Host maintains map `trysteroPeerId → boardgame.io playerID`.
3. Star topology: guests only open logical game channel to host (still mesh under the hood).
4. Seat assignment protocol (FIFO or host picks).
5. PokerLobby UX: room code + optional password.

**Exit criteria:** 3-player crypto poker setup (key exchange) completes over Trystero.

### Phase 4 — Hardening (1–2 days)

1. **TURN** config via env (`VITE_TURN_URLS`, username, credential) shared with join-code STUN/TURN if present.
2. Custom `password` always set for private tables.
3. Protocol version gate in handshake (`manamesh-p2p/1`).
4. Metrics/logging: which backend connected (`trystero-nostr` vs `joinCode`), connect ms, fallback reason.
5. Feature flags: `VITE_P2P_BACKEND=auto|trystero|joinCode`.

### Phase 5 — Optional controlled relay (ops)

For demos / testnet poker where public relays are flaky:

1. Deploy `@trystero-p2p/ws-relay` (or tiny custom topic strategy) next to optional backend.
2. Strategy switch: `VITE_TRYSTERO_STRATEGY=ws-relay` + `VITE_TRYSTERO_RELAY_URLS=wss://…`.
3. Document in poker `DEPLOYMENT.md` when that exists.

### Phase 6 — Asset sharing & polish (optional)

1. Route large asset transfers through Trystero binary actions (progress UI).
2. QR codes for room codes.
3. Deep links: `?room=XXXX&game=timestreams`.
4. Reconnect: re-`joinRoom` same code after refresh (match state restore already partially exists for host).

---

## 7. Detailed design notes

### 7.1 Env surface (proposed)

```bash
# Matchmaking
VITE_P2P_BACKEND=auto              # auto | trystero | joinCode
VITE_TRYSTERO_STRATEGY=nostr       # nostr | mqtt | ws-relay
VITE_TRYSTERO_APP_ID=manamesh-v1
VITE_TRYSTERO_RELAY_URLS=          # comma-separated; required for ws-relay
VITE_TRYSTERO_CONNECT_TIMEOUT_MS=12000
VITE_TRYSTERO_PASSWORD_MODE=room   # room | none | explicit

# NAT (shared with WebRTC)
VITE_TURN_URLS=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

### 7.2 Handshake payload (v1)

```ts
type ManameshHandshake = {
  v: 1;
  role: 'host' | 'guest';
  matchID: string;
  gameId: string;           // 'timestreams' | 'poker' | …
  seat?: string;            // boardgame.io playerID if pre-assigned
  clientBuild?: string;
  // optional hardening:
  walletAddress?: `0x${string}`;
  walletSig?: Hex;          // signs matchID + roomId + selfId
};
```

Reject if: wrong `v`, second host, full table, bad signature when required.

### 7.3 Interaction with mental poker

Transport remains untrusted:

- No private keys on the wire (separate crypto work for poker encrypt path).  
- `validatePlayerIdentity` / keychain still apply after seats bind.  
- Prefer binding Trystero `selfId` → seat at lobby time so move-level `playerId` matches.

### 7.4 Testing strategy

| Layer | Approach |
|-------|----------|
| Unit | Mock `joinRoom` / actions; test channel + orchestrator fallback |
| Integration | Playwright two contexts, same `roomId`, assert lobby → game |
| Manual | Cross-network phones; document TURN requirement |
| Regression | Existing join-code e2e still pass with `VITE_P2P_BACKEND=joinCode` |

Do **not** require real Nostr in CI: inject a fake strategy or mock module.

### 7.5 Dependency & monorepo notes

- **Library home:** extend `@cyotee/boardgameio-p2p` — multi-peer on `./channel`; Trystero adapter on `./trystero` with **peerDependency** on `trystero` (not required for channel-only consumers).  
- **Shell:** `@manamesh/frontend` lobbies + orchestrator (fallback to join-code); install `trystero` so the peerDep is satisfied.  
- Yarn 4 / PnP: normal workspace/package dependency.  
- Prefer **single strategy import** inside `./trystero` to control bundle size.  
- Pin versions; strategy packages under `@trystero-p2p/*` if used later.

### 7.6 What we deliberately do **not** do in v1

- Replace `P2PTransport` with Trystero actions as the game protocol  
- Re-enable libp2p DHT as default matchmaking  
- Require Firebase/Supabase accounts for core play  
- Media (A/V) chat  
- Trust public relays for privacy-critical signaling without passwords  

---

## 8. Effort estimate

| Phase | Effort | Risk |
|-------|--------|------|
| 0 Spike | 0.5–1 d | Low |
| 1 Channel + tests | 1–2 d | Low |
| 2 Timestreams lobby | 2–3 d | Medium (UX) |
| 3 Poker multi-peer | 2–3 d | Medium |
| 4 Hardening + TURN | 1–2 d | Medium (NAT) |
| 5 Optional ws-relay | 0.5–1 d | Low |
| 6 Polish / assets | optional | Low |

**MVP (Phases 0–2):** ~1 week calendar for one engineer.  
**Poker-ready multi-peer (through 4):** ~1.5–2 weeks.

---

## 9. Risks & open decisions

| ID | Risk / decision | Recommendation |
|----|-----------------|----------------|
| D1 | Default strategy: Nostr vs self-hosted relay | **Nostr for public beta**; ws-relay for controlled demos |
| D2 | Room code entropy | ≥ 80 bits for private money-adjacent tables; shorter OK for casual |
| D3 | Host double-open | Reject second host in handshake |
| D4 | Fallback mid-handshake UX | Explicit “Switch to join codes” button + auto after timeout |
| D5 | Guest–guest channels for crypto peels | v1: via host game state only; revisit if latency hurts |
| D6 | TURN funding | Need for production parity with “works on mobile data”; plan budget (e.g. Cloudflare Calls free tier) |
| D7 | License / supply chain | MIT, pin versions, watch npm package renames (`trystero` vs `@trystero-p2p/*`) |
| D8 | Interaction with retired DHT | Keep DHT dead for product path; Trystero replaces that *need*, not join-code |

---

## 10. Success metrics

1. **Connect success rate** (same Wi‑Fi): Trystero ≥ join-code.  
2. **Connect success rate** (cross-network without TURN): measure baseline; with TURN target ≥ 90% of attempted rooms.  
3. **Time-to-connected (p50):** Trystero room code < 5s on healthy network.  
4. **Fallback rate:** track % sessions ending on join-code; investigate if > 20% in target audience.  
5. **Zero game-protocol regressions:** existing boardgame.io P2P tests + Timestreams smoke still pass.  
6. **User step count:** host/guest steps reduced from ~6 (dual SDP) to ~2 (share code / enter code).

---

## 11. References

### Upstream

- https://github.com/dmotz/trystero  
- https://trystero.dev  
- README sections used: How it works, Strategies, `joinRoom` API, Encryption, TURN troubleshooting, `onPeerHandshake`, ws-relay, custom strategy  

### ManaMesh code

| Area | Path |
|------|------|
| Channel interface | `packages/boardgameIO-p2p/src/channel.ts` |
| Channel transport | `packages/boardgameIO-p2p/src/channel-transport.ts` |
| Join-code discovery | `packages/manamesh/packages/frontend/src/p2p/discovery/join-code.ts` |
| Transport manager | `packages/manamesh/packages/frontend/src/p2p/transport-manager.ts` |
| Transport types / priority | `…/p2p/transports/types.ts` |
| Timestreams lobby | `…/pages/timestreams/TimestreamsLobby.tsx` |
| Poker lobby | `…/pages/poker/PokerLobby.tsx` |
| P2P index exports | `…/p2p/index.ts` |

### Related product docs

- Root `Claude.md` — P2P-first, Timestreams join-code production path  
- `packages/manamesh/PRD_Implementation.md` — original join-code WebRTC design  
- Poker deploy docs — settlement is independent of matchmaking  

---

## 12. Recommended next step

**Approve Phase 0 spike:** add `trystero`, dual-browser ping in a dev route, record reliability + bundle size in §13 appendix, then proceed to Phase 1 only if results are acceptable.

---

## 13. Appendix — Spike results (fill in)

| Metric | Result |
|--------|--------|
| Date | 2026-07-23 |
| Trystero version | 0.25.3 |
| Strategy | Nostr (default package); tests use mocked joinRoom |
| Bundle delta (gzip) | Not measured in live browser this session; peerDep optional on `./trystero` only |
| Same-machine connect p50 | N/A (CI: mocked unit tests only) |
| Cross-network connect p50 | N/A |
| Failure modes observed | Auth/handshake rejects fail closed; timeout → orchestrator join-code fallback |
| Decision | **go** for Phase A+ (multi-peer transport + trystero adapter + lobbies shipped) |

---

*Document owner: platform / multiplayer. Update this file when strategy choice, env vars, or phase status changes.*
