# Trystero Multiplayer — Full Implementation Plan

> **Status:** Implementation in progress / core shipped 2026-07-23 (multi-peer + trystero adapter + three lobbies; live Nostr e2e optional)  
> **For agentic workers:** Prefer task-by-task execution with tests first where noted. Track checkboxes in this file or a branch ledger. Do not expand scope into game-rules rewrites or libp2p DHT revival.

**Goal:** Ship serverless multiplayer via **one shared room code + optional password** (Trystero Quick connect) for **Timestreams**, **Poker**, and **One Piece**, with **Advanced SDP join-code** as a **2-player** fallback only.

**Product requirements:** [`TRYSTERO_MULTIPLAYER_PRD.md`](./TRYSTERO_MULTIPLAYER_PRD.md)  
**Feasibility / design notes:** [`TRYSTERO_MULTIPLAYER_FEASIBILITY.md`](./TRYSTERO_MULTIPLAYER_FEASIBILITY.md)

**Tech stack:** Yarn 4 monorepo, TypeScript, Vite, React, boardgame.io, `@cyotee/boardgameio-p2p` (existing fork), Trystero Nostr strategy (pin exact version; **peerDependency** of p2p trystero subpath), Vitest, Playwright (Timestreams e2e where present).

---

## Architecture decision (locked)

**Extend the existing `@cyotee/boardgameio-p2p` fork** — same role as `@cyotee/boardgameio-crypto` for crypto: reusable, game-agnostic boardgame.io integration. **Do not** invent a new package or a boardgame.io Game **Plugin** for rooms.

| Export | Responsibility | Depends on `trystero`? |
|--------|----------------|------------------------|
| `@cyotee/boardgameio-p2p` / `.` | PeerJS transport (legacy/upstream) | No |
| `@cyotee/boardgameio-p2p/channel` | `P2PChannel`, **multi-peer** `P2PTransport` / `P2PMultiplayer` | No |
| `@cyotee/boardgameio-p2p/trystero` | Room session + `TrysteroChannel` adapter → channels | **Yes** (peerDependency / optional peer) |

```text
┌─────────────────────────────────────────────────────────────┐
│  @cyotee/boardgameio-p2p  (fork — library)                  │
│  ./channel   multi-peer host protocol over P2PChannel       │
│  ./trystero  joinRoom → handshake → Map|single P2PChannel   │
│  NO React lobbies, NO Vite env, NO game rules               │
└─────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────┴───────────────────────────────┐
│  @manamesh/frontend  (shell)                                │
│  Lobbies, room-code UX, orchestrator fallback to join-code  │
│  Vite flags, TURN secrets, Timestreams/Poker/One Piece pages│
└─────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────┴───────────────────────────────┐
│  Game packages (timestreams / poker / onepiece)             │
│  Rules only — NO Trystero, NO P2P discovery imports         │
└─────────────────────────────────────────────────────────────┘
```

**Analogy to crypto:** crypto owns pure math + thin boardgame.io plugin; games own phases/moves; boards hold secrets. Here p2p owns transport + optional discovery adapter; frontend owns lobbies; games stay transport-agnostic.

### Package ownership

| Concern | Package / path |
|---------|----------------|
| Multi-peer host transport | `@cyotee/boardgameio-p2p` → `./channel` (`packages/boardgameIO-p2p/src/channel-transport.ts`) |
| Trystero → `P2PChannel` adapter + table session API | `@cyotee/boardgameio-p2p` → `./trystero` (new; peerDep on `trystero`) |
| Orchestrator (auto → Trystero → join-code), Vite config, TURN | `@manamesh/frontend` → `src/p2p/` |
| Lobby UI (code, password, roster, Start) | `@manamesh/frontend` → pages + optional shared components |
| Join-code SDP fallback (2p) | Existing `…/p2p/discovery/join-code.ts` |
| Timestreams / Poker / One Piece rules | Unchanged game packages — transport-agnostic |

---

## 0. Locked product rules (do not re-litigate)

| Rule | Value |
|------|--------|
| Primary join | **Same 6–8 char room code** for all seats + **optional password** |
| Default backend (after spike go) | `VITE_P2P_BACKEND=auto` (Trystero → SDP fallback) |
| Strategy | Nostr (`trystero`) first |
| Seats Timestreams | Default **max 4**; config for **6** when decks ready |
| Seats Poker | **2–6** |
| Seats One Piece | **2** (module is 2-player today) |
| Seat assignment | **FIFO** (host `"0"`, guests `"1"`… in join order) |
| Match start | Host **Start** when ≥ min players; **auto-start when table full** |
| Topology | Star for game sync: host ↔ each guest (Trystero mesh underneath) |
| Advanced SDP | **2p only** in v1 |
| Fallback timing | Lobby connect only — never mid-hand |
| Asset sharing | Nice-to-have if easy; not a ship blocker per game |

**Ship order (product):** Timestreams → Poker → One Piece.  
**Engineering order:** Shared foundation (incl. multi-peer transport) → Timestreams → Poker → One Piece.

---

## 1. Current state (codebase facts)

### 1.1 What works today

```
JoinCodeConnection (1:1 WebRTC)
  → P2PChannel
  → P2PMultiplayer / P2PTransport  (single connection)
  → boardgame.io Client
```

| Game | Lobby | Multiplayer today | Notes |
|------|-------|-------------------|--------|
| **Timestreams** | `TimestreamsLobby.tsx` — dual SDP paste | `P2PMultiplayer` in `pages/timestreams/main.tsx` | `maxPlayers` prop default **2**; resume/persist exists for host |
| **Poker** | `PokerLobby.tsx` — matchmaking service + join-code transport | `P2PMultiplayer` in `pages/poker/main.tsx` | Designed for multi-seat lobby protocol; still hands **one** `JoinCodeConnection` into transport |
| **One Piece** | **None** on page | `Local()` only in `pages/onepiece/main.tsx` | Phaser board accepts optional `p2pConnection` for assets; no production P2P match path |

### 1.2 Critical gap: single-connection host transport

`packages/boardgameIO-p2p/src/channel-transport.ts`:

- `P2PTransportOpts.connection` is a **single** `P2PChannel`.
- Host path **hardcodes** guest subscription / proactive sync for player **`"1"`**.
- `sendToGuest` sends on that one channel only.

**Implication:** Timestreams 3–4p and Poker 3–6p **cannot** ship on Trystero without either:

1. **Preferred:** Extend `P2PTransport` to a **multi-peer host mode** (`connections: Map<playerID, P2PChannel>` or a `P2PHostHub` that implements fan-out), **or**
2. A multiplexing `P2PChannel` that frames messages with `playerID`/`peerId` (still requires transport changes for per-player subscribe/sync).

This plan treats **multi-peer host transport** as **Phase A foundation**, before multi-seat lobbies go product-default.

### 1.3 Abstraction that stays fixed

```ts
// packages/boardgameIO-p2p/src/channel.ts
interface P2PChannel {
  send(data: string): void;
  isConnected(): boolean;
  events: { onMessage; onConnectionStateChange };
}
```

Game modules must **not** import Trystero. Frontend imports `@cyotee/boardgameio-p2p/trystero` and `/channel`; only the p2p package may import `trystero` (inside `./trystero` sources).

---

## 2. Target architecture

```
┌──────────── Frontend lobby (per game page) ──────────────────────┐
│  Room code (6–8) + optional password · roster · Start/auto-full  │
│  ConnectionOrchestrator: auto | trystero | joinCode              │
└────────────────────────────┬─────────────────────────────────────┘
                             │
         ┌───────────────────┴───────────────────┐
         ▼                                       ▼
┌────────────────────────────┐    ┌──────────────────────────┐
│ @cyotee/boardgameio-p2p    │    │ frontend join-code       │
│ /trystero                  │    │ JoinCodeConnection (2p)  │
│ joinTrysteroTable(...)     │    └────────────┬─────────────┘
│ → channels + seat map      │                 │
└────────────┬───────────────┘                 │
             │  P2PChannel | Map<playerID, P2PChannel>
             └──────────────────┬──────────────┘
                                ▼
                 @cyotee/boardgameio-p2p/channel
                 P2PMultiplayer / P2PTransport (multi-peer host)
                                ▼
                    boardgame.io Client + Game
```

### 2.1 Trystero message actions (library defaults; app may namespace)

| Action ID | Payload | Purpose |
|-----------|---------|---------|
| `manamesh-hs` | handshake JSON | role, matchID, gameId, seat, protocol `v` |
| `manamesh-bgio` | string (existing P2P JSON) | boardgame.io sync |
| `manamesh-lobby` | optional lobby JSON | ready / start if not pure UI |
| `manamesh-bin` | optional binary | asset packs later |

### 2.2 Handshake (v1)

```ts
type ManameshHandshake = {
  v: 1;
  role: 'host' | 'guest';
  matchID: string;
  gameId: 'timestreams' | 'poker' | 'onepiece';
  seat?: string;
  clientBuild?: string;
};
```

Reject: bad `v`, wrong `gameId`, second host, table full, password failure (Trystero `onJoinError` / wrong password — no open-room fallback).

### 2.3 Env surface

```bash
VITE_P2P_BACKEND=auto              # auto | trystero | joinCode
VITE_TRYSTERO_STRATEGY=nostr
VITE_TRYSTERO_APP_ID=manamesh-v1
VITE_TRYSTERO_RELAY_URLS=
VITE_TRYSTERO_CONNECT_TIMEOUT_MS=12000
VITE_TRYSTERO_PASSWORD_MODE=explicit
VITE_TIMESTREAMS_MAX_PLAYERS=4     # allow 6 when decks ready
VITE_POKER_MAX_PLAYERS=6
VITE_TURN_URLS=
VITE_TURN_USERNAME=
VITE_TURN_CREDENTIAL=
```

---

## 3. Phased roadmap (all three games)

| Phase | Name | Games | Effort (1 eng) | Depends on |
|-------|------|-------|----------------|------------|
| **0** | Spike | — | 0.5–1 d | — |
| **A** | Foundation in **boardgameio-p2p** (multi-peer + `./trystero`) + thin frontend orchestrator | platform | 3–5 d | 0 go |
| **B** | Timestreams product path | Timestreams | 3–5 d | A |
| **C** | Poker product path | Poker | 2–4 d | A (+ B patterns) |
| **D** | One Piece product path | One Piece | 2–4 d | A (+ B patterns) |
| **E** | Hardening, TURN, metrics, flags | all | 1–2 d | B (partial ok after each game) |
| **F** | Polish (optional) | all | optional | E |

**Calendar (serial):** ~2–3.5 weeks to Timestreams+Poker; +~0.5–1 week One Piece; hardening overlapping.

**Parallelism:** After Phase A, C and D can proceed in parallel if two engineers; B should land first as reference lobby.

---

## Phase 0 — Spike (go / no-go)

**Goal:** Prove Trystero reliability and bundle cost before product code.

### Tasks

- [x] **0.1** Pin `trystero` in the monorepo for the spike (frontend and/or `boardgameIO-p2p` as peerDep candidate); `yarn install`.
- [x] **0.2** Minimal dual-tab ping (dev route or package-local demo): same `roomId`, `makeAction('ping')` — may live temporarily in frontend; production adapter still lands in p2p Phase A. *(mocked joinRoom unit coverage; live Nostr optional)*
- [x] **0.3** Measure same-machine connect p50, failure modes, approximate gzip delta of pulling `trystero`. *(bundle not measured live; peerDep isolation verified)*
- [x] **0.4** Fill feasibility doc §13 appendix; record **go / no-go**.

**Exit:** Ping works; ICE/`onJoinError` detectable; go decision for Phase A.

**If no-go:** Stop product integration; document blocker (relays, bundle, ICE).

---

## Phase A — Shared foundation (library first)

**Goal:** Complete **`@cyotee/boardgameio-p2p`** multi-peer channel transport + optional `./trystero` adapter; thin frontend orchestrator only for fallback policy and env.

### A.1 Multi-peer transport — `@cyotee/boardgameio-p2p/channel`

**Files:**

- Modify: `packages/boardgameIO-p2p/src/channel-transport.ts`
- Modify: `packages/boardgameIO-p2p/src/channel.ts` (types only if needed)
- Modify: `packages/boardgameIO-p2p/package.json` exports if needed
- Tests: `test/` multi-peer channel-transport tests (mocked `P2PChannel`)

**API (recommended):**

```ts
export type P2PTransportOpts = {
  role: 'host' | 'guest';
  matchID: string;
  playerID: string;
  numPlayers: number;
  game: Game;
  setupData?: unknown;
  restoreFromPersist?: boolean;
  // Exactly one of:
  connection?: P2PChannel;                    // guest, or host 2p legacy
  hostConnections?: Map<string, P2PChannel>;  // playerID → channel (host N-guest)
};
```

**Host behavior changes:**

| Today | Required |
|-------|----------|
| Subscribe only `"1"` | Subscribe **each** guest `playerID` as channels are provided |
| `sendToGuest` once | **Broadcast** state updates to **all** guest channels; target sync/errors to requesting player |
| Assume guest is always `"1"` | Use `playerID` from `sync-req` / action args |
| Single channel connect | Host ready when master init + local subscribe; map may be filled at match start from lobby session |

**Staggered join:** Lobby holds the Trystero session until Start; then pass `hostConnections` into `P2PMultiplayer`. Avoid mid-hand transport rebuild in v1.

**Guest:** Unchanged single `connection`.

- [ ] **A.1.1** Implement multi-peer host path + tests.
- [ ] **A.1.2** Grep-audit: no remaining hardcodes that force sole guest `"1"` for N>2.
- [ ] **A.1.3** Keep 2p single-`connection` host path working (backward compatible).

### A.2 Trystero adapter — `@cyotee/boardgameio-p2p/trystero`

**Files (new under package):**

```
packages/boardgameIO-p2p/src/trystero/
  index.ts              # public API
  types.ts
  room-code.ts          # generate/validate 6–8 char codes (pure helpers OK here)
  handshake.ts          # ManameshHandshake v1
  channel.ts            # TrysteroChannel implements P2PChannel
  table-session.ts      # joinTrysteroTable / host+guest session
  *.test.ts             # mock joinRoom — no live Nostr in CI
```

**package.json:**

- [ ] **A.2.1** Add export `"./trystero"` → built dist.
- [ ] **A.2.2** `peerDependencies`: `trystero` (pin range); document that consumers of `./trystero` must install it. Do **not** hard-require trystero for `./channel` consumers.
- [ ] **A.2.3** Optional: `peerDependenciesMeta.trystero.optional = true` so install doesn’t fail for channel-only users.

**Public API sketch:**

```ts
// @cyotee/boardgameio-p2p/trystero
joinTrysteroTable(opts: {
  appId: string;
  roomCode: string;
  password?: string;
  role: 'host' | 'guest';
  gameId: string;
  matchID: string;
  maxPlayers: number;
  turnConfig?: RTCIceServer[];
  connectTimeoutMs?: number;
  // strategy import is internal (default nostr) or injectable for tests
}): Promise<TrysteroTableSession>;

type TrysteroTableSession = {
  role: 'host' | 'guest';
  playerID: string;
  seatMap: Map<string /*playerID*/, string /*trystero peerId*/>;
  /** Guest / 2p: channel to host. Host may also expose for local only. */
  connection?: P2PChannel;
  /** Host: one channel per seated guest playerID */
  hostConnections?: Map<string, P2PChannel>;
  leave(): void;
  // events: onPeerJoin / onPeerLeave / roster for lobby UI
};
```

- [ ] **A.2.4** `TrysteroChannel`: `makeAction('manamesh-bgio')` to target peer; leave → connection state.
- [ ] **A.2.5** Host: claim host in handshake; FIFO seats; reject second host / full table.
- [ ] **A.2.6** Guest: handshake → assigned seat → single channel to host.
- [ ] **A.2.7** Password: pass as Trystero `password` when set; omit for open tables.
- [ ] **A.2.8** Unit tests with **mocked** `joinRoom` (no live Nostr in CI).
- [ ] **A.2.9** README section: how to use `./channel` vs `./trystero`.

### A.3 Frontend thin shell (orchestrator + env only)

**Files:**

```
packages/manamesh/packages/frontend/src/p2p/
  connect/
    config.ts           # VITE_* → options for joinTrysteroTable
    orchestrator.ts     # auto | trystero | joinCode; fallback policy
    roomCode.ts         # re-export or wrap p2p helper for UI
    *.test.ts
  discovery/join-code.ts  # unchanged Advanced path
```

Optional shared UI (after Timestreams proves flow):

```
…/components/lobby/
  RoomCodeConnect.tsx
  SeatRoster.tsx
  ConnectModeToggle.tsx
```

```
createOrJoin({ gameId, role, roomCode, password?, maxPlayers, mode }):
  if mode/backend is joinCode:
    return JoinCodeConnection flow (2p)
  try joinTrysteroTable(...) within timeout
  on success: return TrysteroTableSession
  on password/auth failure: throw; do not fallback
  on timeout/relay failure: session.leave(); signal fallback UI
```

- [ ] **A.3.1** Orchestrator + tests (mock table session).
- [ ] **A.3.2** Wire frontend `package.json` dependency on workspace `@cyotee/boardgameio-p2p` + `trystero` (so peerDep is satisfied).
- [ ] **A.3.3** Document env vars (frontend README or short connect README).

### A.4 Acceptance (Phase A)

- [ ] `@cyotee/boardgameio-p2p` tests green: multi-peer transport + trystero unit (mocked).
- [ ] Frontend orchestrator tests green.
- [ ] APIs stable for lobbies:
  - Guest: `connection: P2PChannel`
  - Host multi: `hostConnections: Map<playerID, P2PChannel>`
  - Seat map + `matchID` agreed out-of-band (room code derived)
- [ ] Tree-shake: importing only `./channel` does not pull `trystero` into the graph when unused (verify as best-effort in spike/bundle notes).

---

## Phase B — Timestreams (first product ship)

**Goal:** Timestreams default path is shared room code; 2–4 players on Trystero; full match play; SDP Advanced 2p fallback.

### B.1 Lobby rewrite / dual-mode UI

**Files:**

- Modify: `…/pages/timestreams/TimestreamsLobby.tsx`
- Modify: `…/pages/timestreams/main.tsx`
- Possibly: `…/pages/timestreams/index.html` copy only if needed

**Behavior:**

| Control | Spec |
|---------|------|
| Create table | Generate 6–8 char code; optional password; max seats from `VITE_TIMESTREAMS_MAX_PLAYERS` (default 4) |
| Join table | Enter same code + password if set |
| Roster | Show seats 0..max-1 FIFO; host labeled |
| Start | Enabled when `seated >= minPlayers` (define min = 2); **auto-start when full** |
| Advanced | Expandable SDP join-code (existing flow); 2p only |
| Fallback | On Quick connect fail → open Advanced + message |
| Types | `onGameStart` accepts `P2PChannel` or host connection map — **stop requiring `JoinCodeConnection` concrete type** |

- [ ] **B.1.1** Widen `TimestreamsLobbyProps.onGameStart` connection type to `P2PChannel` (+ host multi map).
- [ ] **B.1.2** Quick connect host/guest flows via orchestrator.
- [ ] **B.1.3** Keep era assignment / rules toggles from current lobby.
- [ ] **B.1.4** Resume-after-refresh: still supported for host persist; new WebRTC via **same room code rejoin** preferred when Trystero (stretch if hard — at least don’t regress join-code resume story).

### B.2 Client wiring

- [ ] **B.2.1** `main.tsx`: build `P2PMultiplayer` with multi-peer opts when `numPlayers > 2` or host map present.
- [ ] **B.2.2** `matchID`: derive stably from room code (e.g. `ts_<roomCode>`) so all peers agree without SDP fragment.
- [ ] **B.2.3** Update menu copy: “share a table code” not “invite + answer codes”.

### B.3 Testing & acceptance

- [ ] **B.3.1** Unit: lobby helpers (code gen, FIFO, full auto-start).
- [ ] **B.3.2** Manual: 2-browser full hand over Trystero (PRD D12).
- [ ] **B.3.3** Manual: 3–4 browser/players same code, FIFO seats, auto-start at full, play progresses.
- [ ] **B.3.4** Manual: wrong password fails closed.
- [ ] **B.3.5** Manual/regression: Advanced SDP 2p still works; `VITE_P2P_BACKEND=joinCode`.
- [ ] **B.3.6** Playwright: extend or add smoke if e2e harness can mock Trystero; else document manual checklist.

**Phase B exit = PRD M2 ship gate for Timestreams.**

---

## Phase C — Poker

**Goal:** Poker tables use the **same** room-code model; 2–6 players; crypto setup over multi-peer host transport.

### C.1 Current lobby issues to replace/simplify

`PokerLobby.tsx` uses `MatchmakingService` + `JoinCodeTransport` and still ends in a single `JoinCodeConnection`. For Trystero:

- Prefer **reuse** `ConnectionOrchestrator` + `TrysteroRoomSession` rather than extending DHT/gossip matchmaking.
- Retire or bypass libp2p-oriented matchmaking for the **product** poker path (same product decision as Timestreams: no DHT default).

### C.2 Tasks

**Files:**

- Modify: `…/pages/poker/PokerLobby.tsx`
- Modify: `…/pages/poker/main.tsx`
- Leave: `@manamesh/poker` game logic unless seat/numPlayers plumbing bugs surface

- [ ] **C.1.1** Replace primary connect UI with shared room code + optional password + roster (extract shared components from Timestreams if present).
- [ ] **C.1.2** `maxPlayers` default 6; FIFO seats; host Start + auto-start when full.
- [ ] **C.1.3** On start: host passes `hostConnections` map into `P2PMultiplayer`; guests pass single channel.
- [ ] **C.1.4** Preserve blinds/buy-in display config (local UI); ensure `numPlayers` matches seated count at start (not empty max).
- [ ] **C.1.5** Advanced SDP 2p fallback for heads-up only.
- [ ] **C.1.6** `gameId: 'poker'` in handshake; reject Timestreams clients joining poker rooms.

### C.3 Crypto / multi-peer verification

- [ ] **C.2.1** Manual or integration: **3-player** table completes key exchange / encrypt setup over Trystero (exit criterion from feasibility Phase 3).
- [ ] **C.2.2** Confirm no private keys in shared `G` or move args (existing boardgameio-crypto rules — transport must not regress).
- [ ] **C.2.3** Regression: 2p join-code path still boots Client.

### C.4 Acceptance

- [ ] 2p and ≥3p poker sessions over shared room code.
- [ ] Full table (up to 6) can seat and auto-start (manual; CI mock optional).
- [ ] Wrong gameId / full table / second host rejected.
- [ ] Fallback 2p SDP documented in lobby Advanced.

---

## Phase D — One Piece

**Goal:** First-class **2-player** P2P via same room code model; replace `Local()`-only page entry.

### D.1 Current gap

`pages/onepiece/main.tsx` only:

```ts
multiplayer={Local()}
```

No lobby, no `P2PMultiplayer`. Phaser board already has optional `p2pConnection` for asset sharing patterns.

### D.2 Tasks

**Files:**

- Create: `…/pages/onepiece/OnePieceLobby.tsx` (or reuse shared `RoomCodeConnect` with `gameId: 'onepiece'`, maxPlayers=2)
- Modify: `…/pages/onepiece/main.tsx` — lobby → game phases like poker/timestreams
- Modify: `…/components/OnePiecePhaserBoard.tsx` only if board props need `P2PChannel` instead of `JoinCodeConnection`
- Package `@manamesh/onepiece`: no rules changes expected

- [ ] **D.1.1** Lobby: Create/Join shared code + optional password; FIFO seats 0/1; auto-start when full (2); host can Start at 2 (same as full).
- [ ] **D.1.2** Wire `P2PMultiplayer` with single guest channel (2p — multi-peer map optional but consistent API ok).
- [ ] **D.1.3** Advanced SDP 2p fallback.
- [ ] **D.1.4** Handshake `gameId: 'onepiece'`.
- [ ] **D.1.5** Pass connection into board only if asset-sharing needs it; else leave undefined.
- [ ] **D.1.6** Manual: two browsers complete lobby → in-game action (draw/play as game allows).

### D.3 Acceptance

- [ ] One Piece is playable P2P without Local multiplayer for remote peers.
- [ ] Same UX language as Timestreams/Poker (table code + optional password).
- [ ] Local hot-seat optional later — **out of scope** unless already present elsewhere.

**Note:** One Piece remains **2p** until the game module supports more; do not advertise 4p.

---

## Phase E — Hardening (all games)

- [ ] **E.1** TURN env merged into Trystero `turnConfig` and join-code WebRTC config.
- [ ] **E.2** Logging: backend used, connect ms, fallback reason, seat map (dev-friendly).
- [ ] **E.3** Feature flags honored on all three pages.
- [ ] **E.4** Protocol version mismatches show readable errors.
- [ ] **E.5** Update root `Claude.md` gotcha: Timestreams production path is Trystero auto → join-code fallback (not join-code-only).
- [ ] **E.6** Cross-link PRD + feasibility status (“Phase B complete”, etc.).
- [ ] **E.7** Optional: self-hosted `ws-relay` docs for demos (`VITE_TRYSTERO_STRATEGY=ws-relay`).

---

## Phase F — Polish (optional, all games)

- [ ] QR code for room code
- [ ] Deep links: `?game=timestreams&room=XK7M2Q` (password never in URL)
- [ ] Rejoin same room after refresh
- [ ] Asset pack binary actions via Trystero
- [ ] Shared `RoomCodeConnect` extracted if duplicated thrice
- [ ] Timestreams max=6 when decks/rules ready (`VITE_TIMESTREAMS_MAX_PLAYERS=6`)

---

## 4. Cross-cutting task checklist (implementation order)

Use this as the master sequence for a single engineer:

### Foundation

1. [ ] Phase 0 spike + go/no-go  
2. [ ] **p2p** multi-peer `P2PTransport` + tests  
3. [ ] **p2p** `./trystero`: room-code helpers, handshake, channel, table session + mock tests  
4. [ ] **p2p** package exports + peerDep on `trystero`  
5. [ ] **frontend** orchestrator + env config + tests  
6. [ ] Frontend depends on workspace p2p + `trystero`  

### Timestreams

7. [ ] Lobby Quick connect + Advanced  
8. [ ] `main.tsx` multi-peer wiring via `P2PMultiplayer`  
9. [ ] Manual 2p + 4p acceptance  
10. [ ] joinCode regression  

### Poker

11. [ ] Lobby swap to shared model  
12. [ ] Multi-seat start with seated `numPlayers`  
13. [ ] 3p crypto path manual test  
14. [ ] joinCode 2p regression  

### One Piece

15. [ ] Lobby + page state machine  
16. [ ] `P2PMultiplayer` replace `Local()` for remote mode  
17. [ ] Manual 2p acceptance  
18. [ ] joinCode 2p regression  

### Hardening

19. [ ] TURN + flags + logging  
20. [ ] Docs (`Claude.md`, PRD status, feasibility appendix, p2p README)  

---

## 5. Testing strategy

| Layer | What | CI? |
|-------|------|-----|
| Unit | room codes, handshake, channel mock, orchestrator fallback, multi-peer transport mock | Yes |
| Package | `@cyotee/boardgameio-p2p` multi-peer tests | Yes |
| Integration | Optional Playwright with mocked Trystero module | Prefer yes |
| Manual matrix | Same Wi‑Fi 2p/4p Timestreams; 3p Poker; 2p One Piece; wrong password; timeout→fallback; Advanced SDP 2p | Required for ship |
| Live Nostr | Not required in CI | Manual only |
| Crypto | Existing poker/timestreams crypto tests unchanged; smoke multi-peer setup | Yes + manual |

**Commands (from monorepo root):**

```bash
yarn workspace @manamesh/frontend test
yarn workspace @cyotee/boardgameio-p2p test   # if workspace script exists; else package-local
yarn workspace @manamesh/timestreams test
yarn workspace @manamesh/poker test
yarn workspace @manamesh/onepiece test
# optional:
yarn workspace @manamesh/timestreams test:e2e
```

---

## 6. Per-game acceptance matrix

| Criterion | Timestreams | Poker | One Piece |
|-----------|-------------|-------|-----------|
| Shared room code + optional password | Required | Required | Required |
| Default `auto` after spike | Required | Required | Required |
| FIFO seats | Required | Required | Required (2) |
| Host Start + auto-start full | Required | Required | Required (full=2) |
| Max seats | 4 (cfg 6) | 6 | 2 |
| Full match / hand progress over Trystero | Required | Required (≥3p setup) | Required (in-game action) |
| Advanced SDP 2p fallback | Required | Required | Required |
| Multi-guest SDP | No | No | No |
| Mental poker / crypto unaffected | Yes | Yes | If used |
| Asset sharing | Optional | Optional | Optional |

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Multi-peer transport bugs desync state | High | Unit tests with mock channels; staged 2p then Np; don’t ship multi-seat until transport tests pass |
| Hardcoded guest `"1"` left in code paths | High | Grep/`playerID` audit in `channel-transport.ts`; reject PRs that assume single guest |
| Poker matchmaking dual stacks | Medium | Product path = Trystero only; leave old matchmaking dead-code or behind flag |
| One Piece only Local today | Medium | Budget full lobby page work; don’t underestimate shell wiring |
| Public Nostr flakiness | Medium | Timeout + SDP fallback; optional ws-relay later |
| 4p Timestreams rules/UI incomplete | Medium | Transport allows 4; if board/rules assume 2, gate UI max until rules ready — **confirm against `@manamesh/timestreams` before enabling max=4 in UI** |
| Bundle size | Low–Med | Single strategy import; spike measurement |
| Password in deep links | Low | Never put password in query string |

### 7.1 Timestreams rules capacity check (do early in Phase B)

Before advertising max=4 in UI:

- [ ] Verify `TimestreamsGame` / setup supports `numPlayers` 3–4 (PRD claims 2–4).
- [ ] If only 2p is battle-tested, ship Trystero with **max=2** first, then raise to 4 once multi-peer transport + rules verified (still same plan; split B into B-2p and B-4p).

---

## 8. Effort summary

| Phase | Effort | Deliverable |
|-------|--------|-------------|
| 0 Spike | 0.5–1 d | Go/no-go |
| A Foundation | 3–5 d | Trystero + multi-peer transport |
| B Timestreams | 3–5 d | First product ship |
| C Poker | 2–4 d | 2–6p tables |
| D One Piece | 2–4 d | 2p P2P (was Local-only) |
| E Hardening | 1–2 d | Production confidence |
| F Polish | optional | UX niceties |

**MVP product (Timestreams only):** Phases 0 + A + B (+ partial E) ≈ **1.5–2.5 weeks**.  
**All three games:** ≈ **3–5 weeks** one engineer, less if C/D parallelized after A/B.

---

## 9. Definition of done (program)

- [ ] Phase 0 appendix recorded go  
- [ ] Shared foundation merged with unit tests  
- [ ] Timestreams: Quick connect default, 2p+ multi-seat as enabled, full play, SDP 2p fallback  
- [ ] Poker: same join model, multi-seat crypto path verified  
- [ ] One Piece: remote P2P via same join model (not Local-only)  
- [ ] Flags, TURN docs, `Claude.md` updated  
- [ ] PRD milestones marked complete  

---

## 10. Suggested first PR sequence

| PR | Scope | Merge gate |
|----|-------|------------|
| PR1 | Spike notes + pin `trystero` (dev ping ok) | Spike go |
| PR2 | **`boardgameIO-p2p`**: multi-peer host transport + tests | Package tests green; 2p regression |
| PR3 | **`boardgameIO-p2p`**: `./trystero` adapter + peerDep + tests | Package tests green (mocked joinRoom) |
| PR4 | Frontend orchestrator + env + Timestreams lobby/main | Manual 2p (+4p if rules ok) |
| PR5 | Poker lobby + main | Manual 3p crypto |
| PR6 | One Piece lobby + main | Manual 2p play |
| PR7 | Hardening/docs/flags/TURN | Checklist |

**Rule:** PR2/PR3 land in the **p2p package** before multi-seat product lobbies. Do not put Trystero implementation only under frontend `src/p2p/trystero/` as the long-term home.

---

## 11. Open items (non-blocking — decide during implementation)

Nothing blocks starting Phase 0/A. Resolve opportunistically:

| Item | Default if unspecified |
|------|------------------------|
| Room code alphabet | Crockford base32 or similar; avoid ambiguous `0/O/1/I` |
| Min players before host Start | **2** |
| Timestreams UI max if rules flaky at 4 | Ship Trystero at max=2 first, then raise (plan §7.1) |
| Exact `trystero` version pin | Spike chooses latest stable (e.g. 0.25.x); pin exact |
| Submodule commit for `boardgameIO-p2p` | Bump outer monorepo pointer when package is a submodule |

---

## 12. Plan finalization checklist

- [x] Product rules locked (PRD)  
- [x] Timestreams-first ship order; Poker + One Piece follow  
- [x] One shared room code + optional password; multi-seat on Trystero; SDP 2p only  
- [x] FIFO seats; host Start + auto-start when full  
- [x] **Architecture:** extend `boardgameIO-p2p` with multi-peer `./channel` + optional `./trystero` (peerDep); frontend lobbies/orchestrator only  
- [x] No game-package Trystero imports  
- [x] Phases, PR sequence, acceptance matrices documented  

**Ready to implement** starting at Phase 0.

---

## 13. References

| Doc / code | Why |
|------------|-----|
| `docs/TRYSTERO_MULTIPLAYER_PRD.md` | Product requirements |
| `docs/TRYSTERO_MULTIPLAYER_FEASIBILITY.md` | Upstream API, env sketch, risks |
| `packages/boardgameIO-p2p/` | Fork home: `./channel` + new `./trystero` |
| `packages/boardgameIO-p2p/src/channel.ts` | `P2PChannel` |
| `packages/boardgameIO-p2p/src/channel-transport.ts` | Host/guest protocol (extend multi-peer) |
| `packages/boardgameio-crypto/` | Layering precedent (library vs games vs shell) |
| `…/frontend/src/p2p/discovery/join-code.ts` | SDP fallback |
| `…/pages/timestreams/TimestreamsLobby.tsx` | First lobby target |
| `…/pages/poker/PokerLobby.tsx` | Multi-seat lobby replace |
| `…/pages/onepiece/main.tsx` | Local → P2P |
| `.grok/skills/boardgameio-crypto/SKILL.md` | Crypto safety when testing poker/timestreams |

---

*Owner: platform / multiplayer. Update phase checkboxes as work completes. Keep PRD as product source of truth; this file as engineering execution plan. Architecture section is authoritative for package split.*
