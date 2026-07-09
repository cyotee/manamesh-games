# @manamesh/timestreams

Timestreams game module for ManaMesh — structured, rules-aware P2P play with
mental-poker deck fairness. The module exposes a boardgame.io game
(`TimestreamsModule.getBoardgameIOGame()`), a React board (`TimestreamsBoard`),
the rules engine, and the crypto/scoring helpers.

## Goal: a serverless single-page application

Timestreams is meant to run as a **static single-page application** — served
from a plain file host (or even `file://`) with **no game server to deploy or
pay for**. Two players connect their browsers directly and play.

## Networking / P2P

WebRTC is the only way for two browsers to talk directly, and WebRTC *always*
needs a signaling channel to exchange connection info (SDP offer/answer + ICE
candidates) before the direct link opens. "Serverless" therefore means "no
signaling server **we** run" — the signaling still has to happen somehow.

### Chosen approach: manual two-way join codes (zero infrastructure)

Timestreams uses **manual join-code signaling** — the truly zero-infrastructure
option:

1. **Host** creates the game → gets an **invite code** (its SDP offer) and shares
   it with the opponent out-of-band (chat, etc.).
2. **Guest** pastes the invite code → gets an **answer code** and sends it back.
3. **Host** pastes the answer code → the direct P2P data channel opens.

From there all game traffic flows peer-to-peer (DTLS-encrypted) with no server
involved. This works even fully offline on the same machine or LAN. Across the
open internet it relies only on public **STUN** servers (currently Google's) so
peers can discover their public addresses.

The implementation lives in the ManaMesh frontend:
`packages/manamesh/packages/frontend/src/p2p/` —
`webrtc.ts`, `codec.ts`, and `discovery/join-code.ts` (`JoinCodeConnection`).

**Known WebRTC limitation:** peers behind symmetric NAT / CGNAT (some mobile,
corporate, or university networks) cannot connect with STUN alone and would need
a **TURN relay** — a real server that relays traffic. This is inherent to
WebRTC, not to this code, and affects a small minority of network pairs.

### Retired: libp2p / DHT discovery

An earlier iteration attempted automatic peer discovery via an in-browser
**libp2p kad-DHT + gossipsub** matchmaking service (`p2p/libp2p-config.ts`,
`p2p/discovery/dht.ts`, `p2p/discovery/matchmaking/`). In-browser DHT
bootstrapping proved slow and unreliable, and it pulled in heavy infrastructure
that undercuts the "runs from a static file" goal. **This path is retired for
Timestreams** — the Timestreams lobby no longer depends on it and uses the
manual join-code exchange described above. (The libp2p code remains in the
shared frontend for other experiments but is not on the Timestreams path.)

### Future consideration: Trystero

For *seamless* matchmaking (share a room name instead of copy/pasting codes)
while staying serverless, [**Trystero**](https://github.com/dmotz/trystero) is
the current best-in-class option. It abstracts WebRTC signaling over
decentralized media (BitTorrent trackers, Nostr, MQTT, IPFS, Supabase, Firebase)
so no matchmaking server is required, sends game data directly peer-to-peer and
end-to-end encrypted, and drops into a static SPA. This trades "zero
infrastructure" for "public decentralized relays," so it is tracked as a future
enhancement rather than the default. Note its documented ceiling on many
simultaneous `RTCPeerConnection`s — a non-issue for small player counts.

## Development / playtest

```bash
# From monorepo root
yarn dev:frontend          # Vite on http://localhost:3000
# Open the Timestreams SPA:
#   http://localhost:3000/src/pages/timestreams/

# From this package
yarn test                  # vitest run (rules engine + board + module tests)
yarn test:watch
python3 scripts/tag_test_gap_report.py   # stamp gap report counts
```

**Day-to-day testing is local** (not Vercel redeploy). Two tabs → Host / Join.

Tag / rules progress:
- [TAG_TEST_GAP_REPORT.md](./TAG_TEST_GAP_REPORT.md) — coverage inventory  
- [TAG_TEST_IMPLEMENTATION_PLAN.md](./TAG_TEST_IMPLEMENTATION_PLAN.md) — plan (engine **and** board UI tests)

### Menu options

| Button | Purpose |
| --- | --- |
| **Host P2P Game** | Create invite code, wait for guest answer, then play over WebRTC |
| **Join as Guest** | Paste host invite, send answer code back, play as player 1 |
| **Local 2-Seat** | Two boards in one browser (shared `Local` master) — no network |

Default `playMode` is **mental-poker**: after home-era setup the game runs
key exchange → encrypt → shuffle, then **cooperative decrypt draws**. The board
auto-peels each decryption layer (no popups); a compact **activity log** shows
lines like “P0 requested decrypt…” and “Decrypt complete — P1 received a card.”
Use `moduleConfig.playMode: "plaintext"` only for rules-only debugging without crypto.

### Remote play with another person

1. Both open the SPA URL (must be `http(s)://`, not only `file://`, for WebRTC).
2. Host → **Host P2P Game** → **Copy Invite Code** → send via chat.
3. Guest → **Join as Guest** → paste invite → **Generate Answer Code** → send back.
4. Host pastes answer → **Connect** → both land on setup, claim eras, Ready, play.

STUN only (Google). Peers behind hard symmetric NAT may need TURN later.

See `PRD.md`, `RULES.md`, and `RULES_ENGINE_PRD.md` for game and rules-engine
specifications.
