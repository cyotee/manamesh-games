# Trystero Multiplayer — Product Requirements Document

**Status:** Draft for implementation (clarifications locked 2026-07-23)  
**Date:** 2026-07-23  
**Owner:** Platform / multiplayer  
**Primary target (v1):** Timestreams (**up to 4 players**; config path for 6 when decks exist)  
**Follow-on (out of v1 ship gate):** Poker, One Piece product lobbies  
**Feasibility / engineering design:** [`TRYSTERO_MULTIPLAYER_FEASIBILITY.md`](./TRYSTERO_MULTIPLAYER_FEASIBILITY.md)  
**Implementation plan (all games):** [`TRYSTERO_MULTIPLAYER_IMPLEMENTATION_PLAN.md`](./TRYSTERO_MULTIPLAYER_IMPLEMENTATION_PLAN.md)  
**Upstream:** [dmotz/trystero](https://github.com/dmotz/trystero) (MIT)

---

## 1. Summary

ManaMesh multiplayer today depends on **manual two-way join codes** (SDP offer/answer copy-paste) as the production WebRTC path for Timestreams. That path is correct for zero-infra and air-gapped play, but it is high-friction: long codes, multi-step exchange, and frequent user error.

This PRD specifies a **room-code auto-connect** experience powered by **Trystero** (serverless peer discovery + WebRTC data channels), integrated as a new `P2PChannel` behind the existing boardgame.io P2P stack. **Join-code remains the hard fallback.** Game rules, mental-poker crypto, and host-authoritative sync are unchanged.

**v1 ships only for Timestreams.** Poker and One Piece reuse the same transport later under separate milestones.

---

## 2. Problem statement

| Today | Pain |
|-------|------|
| Host generates SDP offer → guest pastes → guest returns answer → host accepts | ~6 steps; fragile paste of large blobs |
| Codes are opaque and long | Hard to share via chat/voice; easy to truncate |
| No automatic discovery once peers share intent | Connection only completes after full manual round-trip |
| Symmetric NAT still fails without TURN | Shared limit with any STUN-only WebRTC path |

Players want: **share a short table code (+ optional password) → all seats connect → play.** They still need a zero-third-party path when public signaling is unavailable.

---

## 3. Goals and non-goals

### 3.1 Goals (v1 — Timestreams)

1. **Primary connect path:** Host and up to **3 guests** (4 players total) establish a Timestreams match via a **short shared room code** (optional table password) without pasting SDP.
2. **Preserve P2P-first architecture:** No required ManaMesh game server; Trystero only carries signaling (and then app data over WebRTC).
3. **Zero game-protocol change:** Continue using `P2PMultiplayer` + existing channel message format over a `P2PChannel` adapter (host maintains one logical channel per guest).
4. **Reliable fallback:** If Trystero cannot connect within a bounded timeout (except auth failures), surface a clear path to the **existing join-code** flow—**only during lobby connect**, never mid-hand.
5. **Security floor:** Optional table password (or open table with short code only); handshake admits only expected role/seat/protocol version; reject a second host; reject joins when the table is full.
6. **Measurable UX win:** Reduce host/guest connection steps from ~6 to ~2; target p50 time-to-connected under 5s on healthy same-network sessions.
7. **Ship bar:** Dual-browser (and multi-guest as available) path reaches a **full match start / in-hand play**, not merely socket connect.

### 3.2 Non-goals (v1)

- Replacing boardgame.io, `P2PTransport` protocol semantics, or mental-poker flows
- Re-enabling libp2p DHT as Timestreams product matchmaking
- Poker or One Piece product lobby migration (follow-on; reuse same transport)
- Shipping **6-player** Timestreams as default (config/flag only once new decks support it)
- Requiring Firebase/Supabase/MQTT accounts for core play
- Media (A/V) chat
- Mid-game silent transport switch (Trystero ↔ join-code)
- Treating Trystero or public relays as a trust root for fairness or identity
- Guaranteeing connect success across all NATs without TURN (document + optional TURN config)
- Asset-pack transfer redesign (nice-to-have if existing channel abstraction already covers it; not a ship blocker)

### 3.3 Platform principles (must hold)

- **P2P-first** — full Timestreams match playable without ManaMesh backend
- **HOST-authoritative** boardgame.io crypto/setup moves stay as today
- **No private keys on the wire** — transport remains untrusted relative to crypto fairness
- **Join-code remains available** for air-gapped / relay-down / advanced users

---

## 4. Users and use cases

### 4.1 Primary users (v1)

| User | Scenario |
|------|----------|
| Timestreams host | Creates a table (default max 4 seats), shares short code (+ optional password) |
| Timestreams guest | Enters code (and password if set) and joins without SDP paste |
| Multi-guest party | 2–3 guests join the same room before the host starts the match |
| Power user / offline | Uses Advanced → join-code when relays fail or they prefer zero third parties |
| QA / CI | Forces `joinCode` or mocked Trystero so e2e does not depend on public Nostr |

### 4.2 Use cases

| ID | Use case | Priority |
|----|----------|----------|
| UC-1 | Host creates Timestreams table → short room code shown → waits for guests | P0 |
| UC-2 | Guest enters room code (+ password if required) → auto WebRTC → handshake → seat → game | P0 |
| UC-2b | Additional guests join same room until table full (up to 4 total including host) | P0 |
| UC-3 | Auto-connect fails (timeout / relay down) → UI offers join-code fallback | P0 |
| UC-4 | Wrong password → error; **no** silent open-room fallback | P0 |
| UC-5 | User chooses “Join code only” (or env forces joinCode) → current flow only | P0 |
| UC-6 | Second host attempts same room → rejected with clear error | P1 |
| UC-7 | Peer disconnect mid-match → existing Timestreams disconnect / abandonment behavior | P1 |
| UC-8 | Deep link `?room=XXXX` pre-fills guest join (optional polish) | P2 |
| UC-9 | Rejoin same room after refresh (reconnect policy) | P2 |
| UC-10 | Config/flag enables 6-player max when deck support exists (not default v1) | P2 |

---

## 5. Product decisions (locked for v1)

| ID | Decision | Choice |
|----|----------|--------|
| D1 | Default strategy | **Nostr** (`trystero` package). Optional `ws-relay` later for controlled demos (not required for Timestreams v1 ship). |
| D2 | Room identity | **Short shareable room code** as Trystero `roomId` + **optional table password** field. When set, password is used as Trystero signaling `password` (or HKDF input). When unset, table is joinable by anyone who knows the short code (casual/open tables). |
| D3 | Host double-open | **Reject** second host in handshake; show error. No silent host election. |
| D4 | Fallback UX | Auto after connect timeout **and** explicit “Switch to join codes” control. Never mid-hand. |
| D5 | Topology | Trystero mesh under the hood; **game traffic star**: host maintains a logical `P2PChannel` (or multiplexed peer target) **per guest**. |
| D6 | Guest–guest channels | Not required for Timestreams v1. Crypto remains via host-authoritative game state. |
| D7 | Feature flag / default | `VITE_P2P_BACKEND=auto \| trystero \| joinCode`. After spike **go**, Timestreams lobby default is **`auto`** (Trystero first). |
| D8 | Scope | **Timestreams only** for ship gate. Poker / One Piece share the same adapter later. |
| D9 | Package home | **Multi-peer transport + Trystero adapter** live in existing fork `@cyotee/boardgameio-p2p` (`./channel`, `./trystero` with peerDep on `trystero`). Frontend owns lobbies, orchestrator fallback, Vite env only. |
| D10 | TURN | Optional via env; same ICE config can be shared with join-code WebRTC. Document that mobile-data / hard NAT may need TURN. |
| D11 | Seat count | **Default max 4 players** (1 host + 3 guests). Configuration option to raise max to **6** once additional decks/rules support exists; not the v1 default. |
| D12 | M2 acceptance | **Full dual-browser hand / match start** — lobby → setup/crypto as required → board with real play progress (at least one turn/draw as appropriate). Connect-only is insufficient. |
| D13 | Asset sharing | **Nice-to-have if easy** — if existing asset-sharing can ride the same channel abstraction without redesign, do it; **not a ship blocker**. |
| D14 | Seat assignment | **FIFO** — first successful guest handshakes fill the next free seat (`"0"` host, `"1"`… in join order). |
| D15 | Room code format | **6–8 character** short codes for Trystero `roomId` (human-shareable). Optional password supplies private-table strength when needed. |
| D16 | Match start | Host may **Start** when at least the minimum players are seated; **auto-start when the table is full** (default max 4). |
| D17 | Table join model | **One shared room code + optional password for the whole table.** All seats (host + guests) use that same identity. Multi-seat (3–4 players) is implemented on **Trystero Quick connect**. |
| D18 | Advanced SDP fallback | **2-player best-effort only.** Manual SDP join codes remain for host↔one guest when Trystero fails or Advanced is chosen. No multi-guest SDP paste UX in v1. Multi-seat parties should use Quick connect; if it fails, UI may explain that multi-player tables need Quick connect (or retry). |

### 5.1 Table join model (locked)

**Product rule:** Everyone at the table joins with the **same short code** and the **same optional password**.

```
Host creates table
  → room code: "XK7M2Q"   (+ optional password)
Guest A joins with "XK7M2Q" (+ password if set)
Guest B joins with "XK7M2Q" (+ password if set)
Guest C joins with "XK7M2Q" (+ password if set)
```

| Path | Role in v1 | Seat capacity |
|------|------------|---------------|
| **Quick connect (Trystero)** | Primary product path; same code for all | **Up to 4** (config for 6 later) |
| **Advanced: SDP join codes** | Fallback / power-user; classic offer/answer | **2 players** (host + one guest) only |

We deliberately **do not** require four people to complete multiple pairwise SDP exchanges in Advanced mode. That would fight the “one code for everyone” product model.

---

## 6. User experience

### 6.1 Connection modes (Timestreams lobby)

| Mode | Label (suggested) | Behavior |
|------|-------------------|----------|
| Auto (default) | **Quick connect** | Try Trystero room code first; on failure open join-code panel with explanation |
| Manual | **Advanced: join codes** | Existing SDP offer/answer flow only |

Users should not need to know what “Trystero” or “Nostr” are. Internal logs/metrics may record `trystero-nostr` vs `joinCode`.

### 6.2 Host flow (happy path)

1. Host opens Timestreams lobby → **Create table** (default max seats = 4).
2. System generates a **short room code**; host may set an **optional password**.
3. Host sees copyable code (+ password reminder if set) and a seat roster (e.g. 1/4 … 4/4).
4. Status: connecting relays → waiting for guests → N guests connected.
5. **Start rules:** host may press **Start** once the minimum player count is seated; when the table reaches **full** (default 4), match **auto-starts**. Boot continues via existing `P2PMultiplayer` wiring for each guest channel.

### 6.3 Guest flow (happy path)

1. Guest opens Timestreams lobby → **Join table**.
2. Guest pastes/types **room code** and **password if the host set one** → **Connect**.
3. Status: finding host → handshake/seat assigned → waiting for start / enter match.

### 6.4 Failure UX

| Condition | User-visible behavior |
|-----------|------------------------|
| Relays unreachable / timeout | “Auto-connect failed. You can still connect with join codes.” Expand Advanced panel; keep room context if useful |
| ICE fails after SDP | Same as timeout path **or** prompt that a TURN server may be required (if no TURN configured) |
| Wrong password | Inline error; stay on join form; **do not** fall back to joining without password |
| Invalid / unknown code format | Inline validation error |
| Table full | “This table is full.” |
| Second host | “This table already has a host.” |
| Peer leaves mid-hand | Existing Timestreams disconnect handling (no transport fallback mid-game) |

### 6.5 Visual / copy constraints

- Prefer plain language: “Table code”, “Connect”, “Use join codes instead”.
- Do not require users to paste multi-line SDP in the primary path.
- Keep Advanced join-code UI reachable in one click from lobby.

---

## 7. Functional requirements

### 7.1 Transport layer

| ID | Requirement |
|----|-------------|
| FR-T1 | Provide `TrysteroChannel` implementing existing `P2PChannel` (`send`, `isConnected`, message + connection-state events). |
| FR-T2 | Provide thin `ConnectionOrchestrator` (or equivalent) that: joinCode-only | try Trystero | fallback join-code per mode and errors. |
| FR-T3 | Carry boardgame.io P2P payloads as **opaque strings** on a dedicated action (e.g. `manamesh-bgio`). Do not invent a second game protocol. |
| FR-T4 | Support handshake action (e.g. `manamesh-hs`) before marking channel connected for game use. |
| FR-T5 | Pin a single strategy import for the main SPA (Nostr). Lazy-load alternate strategies only if added later. |
| FR-T6 | On orchestrator failure (non-auth), call `room.leave()` before presenting fallback. |
| FR-T7 | Expose connect timeout (default **12s**, env-overridable). |

### 7.2 Handshake (v1)

Payload shape (normative intent; field names may match feasibility §7.2):

```ts
type ManameshHandshake = {
  v: 1;
  role: 'host' | 'guest';
  matchID: string;
  gameId: 'timestreams';
  seat?: string;            // boardgame.io playerID when assigned
  clientBuild?: string;
};
```

| ID | Requirement |
|----|-------------|
| FR-H1 | Host announces `role: 'host'`; guests `role: 'guest'`. |
| FR-H2 | Reject handshake if `v` unsupported, `gameId` mismatch, or second host. |
| FR-H3 | Timestreams v1 default: **max 4 seats** (host + up to 3 guests). Reject join when full. |
| FR-H3b | Max seat count is configurable; **6** allowed only when product config enables it (decks/rules ready). Default remains 4. |
| FR-H4 | Optional wallet signature fields may be added later; **not required** for Timestreams v1 ship. |
| FR-H5 | Protocol version string / `v` gate: incompatible clients fail closed with a readable error. |
| FR-H6 | Host assigns `playerID`/seat **FIFO** on successful handshake and maps `trysteroPeerId → playerID`. |

### 7.3 Timestreams lobby integration

| ID | Requirement |
|----|-------------|
| FR-L1 | `TimestreamsLobby` (or its connect wiring in `pages/timestreams/`) uses orchestrator for Create/Join when backend is `auto` or `trystero`. |
| FR-L2 | Host obtains one game-sync channel per guest (or equivalent multi-peer host transport); guests use a single channel to host. Role semantics remain `host` \| `guest`. |
| FR-L3 | Manual join-code path remains available and regression-tested. |
| FR-L4 | Feature flag / env can force join-code for demos and CI. Default product mode after spike go: **`auto`**. |
| FR-L5 | Connection backend used (`trystero-nostr` \| `joinCode`) is loggable for debugging (console and/or lightweight UI status). |
| FR-L6 | Lobby UI: short **room code** + optional **password** on create/join. |
| FR-L7 | Lobby shows connected seat count / roster before match start. |
| FR-L8 | Asset sharing over Trystero: attempt only if low-effort on existing abstractions; **not required** for M2 acceptance. |
| FR-L9 | Seat assignment is **FIFO** for successful guest joins. |
| FR-L10 | Host **Start** enabled at/above minimum players; **auto-start on table full**. |
| FR-L11 | Room codes are **6–8 characters**; optional password field on create/join. |
| FR-L12 | **Same code (+ password) for all seats** on Quick connect; lobby copy must not imply each guest gets a unique code. |
| FR-L13 | Advanced SDP path documents/supports **2p only** in v1; multi-seat messaging points users at Quick connect. |

### 7.4 Configuration

| Variable | Purpose | v1 default |
|----------|---------|------------|
| `VITE_P2P_BACKEND` | `auto` \| `trystero` \| `joinCode` | `auto` after spike go; CI may use `joinCode` |
| `VITE_TRYSTERO_STRATEGY` | `nostr` (\| later `mqtt` \| `ws-relay`) | `nostr` |
| `VITE_TRYSTERO_APP_ID` | Trystero app namespace | `manamesh-v1` (or build-specific) |
| `VITE_TRYSTERO_RELAY_URLS` | Optional relay override | empty (library defaults) |
| `VITE_TRYSTERO_CONNECT_TIMEOUT_MS` | Orchestrator timeout | `12000` |
| `VITE_TRYSTERO_PASSWORD_MODE` | How signaling password is derived: `explicit` (host-set password when provided) \| `none` (open tables) \| legacy `room` | **`explicit`** with open allowed when blank |
| `VITE_TIMESTREAMS_MAX_PLAYERS` | Seat cap for tables | **`4`** (allow `6` only when decks/rules support) |
| `VITE_TURN_URLS` / username / credential | Shared ICE TURN | empty optional |

---

## 8. Non-functional requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-1 | Performance | p50 time-to-connected (same LAN, healthy) **&lt; 5s** for successful Trystero sessions |
| NFR-2 | Reliability | Same-Wi‑Fi connect success for Trystero **≥** join-code baseline in spike/manual matrix |
| NFR-3 | Fallback rate | Track % sessions ending on join-code; investigate if **&gt; 20%** in target casual play |
| NFR-4 | Bundle | Single strategy; record gzip delta in spike appendix; avoid shipping all `@trystero-p2p/*` strategies |
| NFR-5 | Security | Signaling password derived from room secret; no private game keys on transport |
| NFR-6 | Privacy | Document that public relays may observe *that* a room is active; SDP protected by Trystero encryption + our password |
| NFR-7 | Testability | Unit tests mock `joinRoom`; CI must not require live Nostr |
| NFR-8 | Compatibility | Existing Timestreams join-code e2e / smoke still pass with `VITE_P2P_BACKEND=joinCode` |
| NFR-9 | Determinism | No impact on boardgame.io move purity (`Date.now` / `Math.random` rules unchanged) |

---

## 9. Architecture (product view)

```
Timestreams Lobby UI
  Create / Join (room code)     Advanced: join codes
           │                            │
           ▼                            │
  ConnectionOrchestrator                │
    try Trystero ──fail (non-auth)──►   │
           │                            │
           ▼                            ▼
    TrysteroChannel              JoinCodeConnection
           │                            │
           └──────────┬─────────────────┘
                      ▼
                 P2PChannel
                      ▼
        P2PMultiplayer({ connection, role })
                      ▼
           Timestreams boardgame.io Client
```

**Integration boundary:** `packages/boardgameIO-p2p` `P2PChannel` only.  
**Do not** put Trystero types into game modules (`@manamesh/timestreams` rules stay transport-agnostic).

Detailed file sketch, message action IDs, and host/guest mapping: see feasibility doc §§5–7.

---

## 10. Success metrics

| Metric | Target |
|--------|--------|
| User steps to connect (host or guest primary path) | **~2** (share/enter code) vs ~6 SDP steps |
| Time-to-connected p50 (healthy same network) | **&lt; 5s** |
| Connect success (same Wi‑Fi) | Trystero **≥** join-code |
| Cross-network without TURN | Measure baseline; do not block v1; document limits |
| Cross-network with TURN (when configured) | Stretch: **≥ 90%** of attempted rooms |
| Fallback rate | Investigate if **&gt; 20%** |
| Game protocol regressions | **Zero** — existing P2P + Timestreams tests green under joinCode; new unit tests for channel/orchestrator |
| Spike gate | Phase 0 appendix filled; explicit **go / no-go** before Phase 1 product merge |

---

## 11. Milestones and acceptance

Aligned with feasibility phases; **ship gate = Timestreams MVP (Phases 0–2 + minimal hardening)**.

### M0 — Spike (go/no-go)

**Acceptance:**

- [ ] `trystero` pinned in frontend workspace  
- [ ] Two browsers exchange a ping (or boardgame.io-shaped string) on same `roomId`  
- [ ] Connect failures detectable (`onJoinError` / timeout)  
- [ ] Bundle delta + connect notes recorded in feasibility §13 appendix  
- [ ] Explicit **go** decision for M1  

### M1 — Channel + tests

**Acceptance:**

- [ ] `TrysteroChannel` implements `P2PChannel` with unit tests (send, receive, disconnect, handshake reject)  
- [ ] Orchestrator fallback after timeout (mocked)  
- [ ] No Timestreams lobby requirement yet, but APIs stable enough for lobby wiring  

### M2 — Timestreams product path (v1 ship)

**Acceptance:**

- [ ] Create/Join with **one shared** short room code (+ optional password) completes a **full match start / in-hand play** over Trystero (manual dual-browser minimum)  
- [ ] **Multi-guest:** at least one successful session with **3–4 total players** all using the **same** room code on Trystero (manual required; CI may mock)  
- [ ] Advanced SDP path still works for **2p**; no requirement for multi-guest SDP in v1  
- [ ] Seat map host→guests works; table-full and second-host rejected  
- [ ] Advanced join-code still works  
- [ ] Auto-fail surfaces join-code fallback without mid-game switch  
- [ ] Wrong password does not join  
- [ ] Default lobby mode is **`auto`** after spike go  
- [ ] Feature flags / max-player config documented  
- [ ] Regression: `VITE_P2P_BACKEND=joinCode` path still usable  
- [ ] Asset sharing: if not ported, documented as deferred (not a fail)  

### M3 — Hardening (may ship with M2 or immediately after)

**Acceptance:**

- [ ] Env surface for timeout, appId, strategy, TURN, max players  
- [ ] Logging of backend used + connect timing  
- [ ] Optional password used for signaling when provided; open tables when blank  
- [ ] Protocol version gate in handshake  

### Follow-on (not v1 gate)

| Milestone | Scope |
|-----------|--------|
| F1 Poker | PokerLobby UX on same multi-peer adapter (2–6) |
| F2 One Piece | Shared lobby/orchestrator wiring + Phaser board `p2pConnection` compatibility |
| F3 Ops | Optional `ws-relay` for demos |
| F4 Polish | QR codes, deep links, reconnect, binary asset actions |
| F5 Six-player Timestreams | Enable max=6 when new decks/rules land; discard-two-per-age rule etc. stay game-package concerns |

---

## 12. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Public Nostr relays flaky | Higher fallback rate | Timeout + join-code; multi-relay redundancy; optional later ws-relay |
| Hard NAT without TURN | Failed ICE | Document; shared TURN env; same honesty as current join-code |
| Bundle size growth | SPA weight | Single strategy import; spike measurement |
| Room enumeration / unwanted join | Griefing | High-entropy codes + password; handshake admission |
| Impersonation of `selfId` | Wrong seat | Handshake role/seat; later optional wallet bind |
| Scope creep to Poker/One Piece | Delayed Timestreams ship | Explicit v1 boundary in this PRD |
| Mid-game transport confusion | Desync / abandoned hands | Fallback **lobby-only** policy |
| Multi-peer host complexity (4 seats) | Higher than 2p spike | Star topology + seat map in M1/M2; test 2p first then 4p |
| Short open room codes | Easier room squatting | Optional password; rate-limit/UX warnings; avoid tiny codes |
| 6-player config enabled too early | Rules/deck gaps | Default max 4; gate 6 on deck/product readiness |

---

## 13. Dependencies

| Dependency | Role |
|------------|------|
| `trystero` (Nostr strategy) | Discovery + WebRTC setup |
| `@cyotee/boardgameio-p2p` / `P2PChannel` | Game sync boundary |
| Existing `JoinCodeConnection` | Fallback |
| Timestreams lobby + page entry | Product UI |
| Optional TURN provider | Cross-NAT reliability |

**Does not depend on:** ManaMesh Express/WS backend, libp2p DHT, poker settlement contracts, Firebase/Supabase.

---

## 14. Documentation deliverables

1. This PRD (product requirements and ship gate)  
2. Feasibility doc kept as engineering plan; update appendix after spike and phase status  
3. Short developer note in frontend (or `Claude.md` gotcha if product path changes): Timestreams default connect = Trystero auto → join-code fallback  
4. User-facing help string in lobby for Advanced join codes and NAT/TURN expectations  

---

## 15. Open items (explicitly deferred)

| Item | When |
|------|------|
| Wallet-signed handshake | Post-v1 identity hardening |
| Poker product lobby on this stack | F1 |
| One Piece shared lobby | F2 |
| Self-hosted ws-relay default for any environment | F3 / ops decision |
| Deep links and QR | F4 |
| Default 6-player Timestreams | F5 when decks/rules ready |
| Guest–guest crypto data channels | Only if a game proves host path insufficient |
| Asset-pack transfer redesign | Only if nice-to-have path insufficient |
| Monetized / real-money adjacency room policies | Out of scope for ManaMesh casual play |

---

## 16. Recommended implementation order

1. Approve this PRD for **Timestreams-first** scope.  
2. Execute **M0 spike**; fill feasibility appendix; go/no-go.  
3. Implement **M1** channel + tests.  
4. Wire **M2** Timestreams lobby; manual dual-browser acceptance.  
5. Apply **M3** hardening as needed for release confidence.  
6. Schedule F1/F2 only after Timestreams metrics look healthy.

---

## 17. References

- [`docs/TRYSTERO_MULTIPLAYER_FEASIBILITY.md`](./TRYSTERO_MULTIPLAYER_FEASIBILITY.md) — architecture, phases, API sketches, risks  
- Root `Claude.md` — P2P-first, Timestreams join-code historical production path  
- `packages/boardgameIO-p2p/src/channel.ts` — `P2PChannel`  
- `packages/manamesh/packages/frontend/src/p2p/discovery/join-code.ts` — fallback  
- `packages/manamesh/packages/frontend/src/pages/timestreams/TimestreamsLobby.tsx` — primary UI  
- Platform PRD / architecture docs under `packages/manamesh/` for broader product context  

---

*Document owner: platform / multiplayer. Update status when M0–M2 complete or when default backend changes.*
