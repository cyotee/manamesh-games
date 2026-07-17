# NPM Publish Migration Plan

**Date:** 2026-07-16 (updated 2026-07-17)  
**Status:** Active — decisions locked; implementation in progress  
**Goal:** Split publishable work out of `manamesh-games`, publish independent packages (and forks) to npm under **`@cyotee/*`**, then retire this monorepo as a development host.

**Checkpoints (local git tags):**

| Tag | Meaning |
|-----|---------|
| `checkpoint/pre-npm-publish-2026-07-17` | Full monorepo snapshot before publish-oriented cutover |
| `checkpoint/npm-publish-plan-2026-07-17` | This plan document with locked decisions (this commit) |

---

## 0. Decisions locked (2026-07-16 → 2026-07-17)

These choices supersede earlier drafts that used `@manamesh/*` as the npm scope.

### 0.1 npm account and scope

| Decision | Choice | Rationale |
|----------|--------|-----------|
| npm user | **`cyotee`** (CLI logged in) | Existing GitHub / npm identity |
| Package scope | **`@cyotee/*` only** | No npm organization required |
| Convert user → org? | **No** | User scope is enough; avoid irreversible account conversion |
| Create free org `manamesh`? | **No (for now)** | Prefer ship under `@cyotee`; can introduce `@manamesh` later as new package names if branding needs it |
| Public vs private packages | **Public** | Open-source libs / forks |

Scoped packages require:

```bash
npm publish --access public
# or publishConfig.access: "public" in package.json
```

Node **20 + npm 10** is sufficient for publish; npm 12 is **not** required (and needs Node 22+).

### 0.2 Package names (npm)

| Role | npm name | GitHub repo (existing) |
|------|----------|-------------------------|
| boardgame.io engine fork | **`@cyotee/boardgame.io`** | [cyotee/boardgame.io](https://github.com/cyotee/boardgame.io) |
| boardgame.io multiplayer transport | **`@cyotee/boardgameio-p2p`** | [cyotee/boardgameIO-p2p](https://github.com/cyotee/boardgameIO-p2p) |
| Crypto primitives | **`@cyotee/boardgameio-crypto`** | [cyotee/boardgameio-crypto](https://github.com/cyotee/boardgameio-crypto) |
| ManaMesh platform | **App / deploy** — not one fat npm library | [cyotee/manamesh](https://github.com/cyotee/manamesh) |
| Asset pack builder | **Static SPA first**; optional later `@cyotee/asset-pack-builder` | (split from monorepo when ready) |
| Games (poker, timestreams, …) | **Phase 2** after core extraction | Separate repos later |

**Do not** publish unscoped `boardgame.io` or `@boardgame.io/p2p` — those scopes/names are upstream-owned.

### 0.3 Phase 1 publish set (order)

```text
1. @cyotee/boardgame.io          (engine fork; BoardProps type fix)
2. @cyotee/boardgameio-p2p       (PeerJS + ManaMesh channel transport)
3. @cyotee/boardgameio-crypto    (leaf; peer boardgame.io)
```

Then: monorepo / games install those as **normal semver dependencies** (or npm alias for the engine).

### 0.4 P2P architecture (corrected course)

| Decision | Choice |
|----------|--------|
| Was the app using upstream PeerJS P2P? | **No** — a parallel in-app transport was built (MM-005 era) while the fork sat unused |
| Is that wrong given we forked p2p? | **Yes** — the fork should own the multiplayer transport |
| Fix | **Port channel transport into `@cyotee/boardgameio-p2p`** and extend the package |
| PeerJS path | **Keep** as `P2P({ isHost })` (upstream-compatible) |
| ManaMesh path | **`P2PMultiplayer({ connection, role, … })`** on an injected **`P2PChannel`** (join-code WebRTC, etc.) |
| Discovery / join codes / lobbies / asset transfer UI | **Stay in the app** (`frontend/src/p2p/discovery`, webrtc, …) — not dumped wholesale into the package |
| App import surface | Re-export from `@cyotee/boardgameio-p2p/channel` so PeerJS is not required for play |

**Status (done in monorepo, pre-publish):**

- Package renamed to `@cyotee/boardgameio-p2p@0.5.0`
- Channel transport ported (`channel-transport.ts`, `channel.ts`, `extension-messages.ts`)
- Frontend `transport.ts` is a thin re-export; `JoinCodeConnection` implements `P2PChannel`
- Transport unit + P2P game integration tests pass (15 + 8)
- Submodule commits exist locally (`boardgameIO-p2p`, `manamesh`); **not necessarily pushed / not yet on npm**

### 0.5 What we will not publish in Phase 1

- `@manamesh/frontend` / whole SPA as an npm library  
- Game packages still deep-importing `@manamesh/frontend/src/...`  
- Asset pack builder as a required npm package (static deploy is enough)  
- Optional “ManaMesh discovery” package until transport is published and stable  

### 0.6 Consumer install pattern (after publish)

```json
{
  "dependencies": {
    "boardgame.io": "npm:@cyotee/boardgame.io@0.50.2-cyotee.0",
    "@cyotee/boardgameio-p2p": "^0.5.0",
    "@cyotee/boardgameio-crypto": "^0.1.0"
  }
}
```

Prefer the **npm alias** for the engine so existing `import … from 'boardgame.io'` stays valid.

### 0.7 Monorepo retirement

After packages publish and games/apps depend on registry versions:

- Retire **`manamesh-games`** as the active development host (archive or docs-only pointer map).  
- Do **not** maintain permanent workspace re-embeds solely for these libs.  
- Platform continues in **`cyotee/manamesh`**; games in their own repos when extracted.

---

## 1. Executive summary

`manamesh-games` is a Yarn 4 monorepo that successfully co-developed several products in parallel. That layout is excellent for iteration and a poor default for **standalone npm packages + long-term ownership**, because:

| Issue | Current reality |
|-------|-----------------|
| Packages are not build artifacts | Many packages set `"main": "./src/index.ts"` and are consumed as raw TypeScript via workspace linking |
| Private / unversioned for release | Crypto, games, asset-pack-builder: historically `"private": true`, version `0.1.0` |
| Workspace protocol | `workspace:*` / `file:` — not valid on the public registry |
| Circular and deep coupling | Game packages import `@manamesh/frontend/src/...`; frontend depends on several games |
| Mixed git models | `manamesh`, `boardgame.io`, `boardgameIO-p2p` are submodules; crypto / games live in the outer repo |
| App vs library blur | `@manamesh/frontend` is a Vite SPA, not a library with a public API surface |

**npm clarification:** npm does **not** require one git repo per package. Separate repos remain the right call here because we want to **retire `manamesh-games`**, give each package independent release history, and host forks under **cyotee**.

---

## 2. Inventory — what exists today

### 2.1 Workspaces (root `package.json`)

```
packages/*
!packages/manamesh
packages/manamesh/packages/*   → frontend, backend
```

Workspace now includes **`@cyotee/boardgameio-p2p`** (renamed from `@boardgame.io/p2p`). Root / frontend depend on it via `workspace:*` until published.

### 2.2 Phase 1 units (aligned with locked names)

| Unit | Path | npm name | Ready? | Notes |
|------|------|----------|--------|--------|
| boardgame.io fork | `packages/boardgame.io` | `@cyotee/boardgame.io` | Needs rename + remote → cyotee fork + BoardProps-only history | Functional fix: `export type { BoardProps }` for Vite |
| P2P transport | `packages/boardgameIO-p2p` | `@cyotee/boardgameio-p2p` | **Package shaped; publish next** | PeerJS + channel modes; version `0.5.0` |
| Crypto | `packages/boardgameio-crypto` | `@cyotee/boardgameio-crypto` | Needs rename from `@manamesh/…`, `dist` build, un-private | Leaf; keychain + mental poker present in tree |
| Platform | `packages/manamesh` | App | Deploy, not fat npm lib | Already wired to channel transport re-exports |
| Asset pack builder | `packages/manamesh-asset-pack-builder` | optional later | SPA | Primary: static/IPFS |

### 2.3 Game packages (Phase 2)

| Package (workspace name today) | Path | Blocker for independent npm |
|--------------------------------|------|------------------------------|
| `@manamesh/poker` | `packages/poker` | Deep imports of `@manamesh/frontend/src/...` |
| `@manamesh/timestreams` | `packages/timestreams` | Same |
| `@manamesh/onepiece` | `packages/onepiece` | Same |
| `@manamesh/mistborn-deckbuilder` | `packages/mistborn-deckbuilder` | Same |

Demo games still live **inside** frontend (`war`, `gofish`, `merkle-battleship`, `threshold-tally`, `he-battleship`).

### 2.4 boardgame.io fork delta

Against upstream, functional change is:

```
fix(react): export BoardProps as a type to keep dev-server ESM valid
```

cspell/tooling-only commits should **not** ship. Point submodule remote at **cyotee/boardgame.io**, not only upstream `boardgameio/boardgame.io`.

---

## 3. Target end state (after monorepo retirement)

```
cyotee/boardgame.io              → npm: @cyotee/boardgame.io
cyotee/boardgameIO-p2p           → npm: @cyotee/boardgameio-p2p
cyotee/boardgameio-crypto        → npm: @cyotee/boardgameio-crypto
cyotee/manamesh                  → platform app (+ optional future libs e.g. @cyotee/core)
cyotee/manamesh-asset-pack-builder → static SPA / optional npm
cyotee/manamesh-poker            → game (later)
cyotee/manamesh-timestreams      → game (later)
…
```

Optional later (discovery only, if extracted):

```
cyotee/manamesh-connect or similar → join-code / lobby helpers (not boardgame.io transport)
```

`manamesh-games` becomes archived or a thin pointer map. No requirement to keep workspace linking after cutover.

---

## 4. Dependency DAG (publish / extract order)

```text
@cyotee/boardgame.io                 (fork; leaf)
        ↑
@cyotee/boardgameio-p2p              (peer: boardgame.io)
@cyotee/boardgameio-crypto           (peer: boardgame.io)
        ↑
@cyotee/core (NEW, recommended later)
   game module types, asset manifest types, deck types
        ↑
Game packages (poker, timestreams, …)
        ↑
manamesh app / game SPAs
```

### Critical cycle (still blocks game / platform lib publish)

```text
@manamesh/frontend ──workspace──▶ games
games packages ──deep import──▶ @manamesh/frontend/src/...
```

**Resolution (before game npm packages):**

1. Extract **`@cyotee/core`** (or similar) for `GameModule`, zones, card types, asset manifest types.  
2. Games depend on **core + crypto + boardgame.io alias**, not the SPA.  
3. Stop all `@manamesh/frontend/src/...` deep imports.

Until then: **still publish engine, p2p, and crypto.**

---

## 5. Per-package publish readiness checklist

```jsonc
{
  "name": "@cyotee/...",
  "version": "0.x.y",
  // no "private": true
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "https://github.com/cyotee/..." },
  "license": "MIT"
}
```

Also:

- [ ] `build` → `dist/`  
- [ ] Tests outside monorepo  
- [ ] No `workspace:*` / `file:` in published deps  
- [ ] Peer deps for `boardgame.io` / `react` where appropriate  
- [ ] LICENSE + upstream notices on forks  
- [ ] Explicit **user approval** before each `npm publish`  

---

## 6. Package-by-package plans

### 6.1 `@cyotee/boardgame.io` (engine fork)

**Why:** Vite needs `export type { BoardProps }`.

**Steps:**

1. Ensure [cyotee/boardgame.io](https://github.com/cyotee/boardgame.io) holds the fork history.  
2. Keep only BoardProps fix; drop cspell noise.  
3. `"name": "@cyotee/boardgame.io"`, version e.g. **`0.50.2-cyotee.0`**.  
4. Build + `npm publish --access public`.  
5. Consumers: `"boardgame.io": "npm:@cyotee/boardgame.io@0.50.2-cyotee.0"`.

### 6.2 `@cyotee/boardgameio-p2p` — **primary multiplayer transport**

| Mode | API | Connection |
|------|-----|------------|
| PeerJS | `P2P({ isHost })` | PeerJS |
| Channel (ManaMesh) | `P2PMultiplayer({ connection, role, … })` | `P2PChannel` (join-code WebRTC, etc.) |

**Done locally:**

- Rename + channel port + `/channel` export  
- Frontend rewire + tests  

**Still to do for publish:**

1. Push submodule commits to [cyotee/boardgameIO-p2p](https://github.com/cyotee/boardgameIO-p2p).  
2. Verify `yarn workspace @cyotee/boardgameio-p2p build` / pack dry-run.  
3. `npm publish --access public` (with approval).  
4. Switch monorepo from `workspace:*` to `^0.5.0` (or keep workspace until all Phase 1 packages ship).

Discovery (join codes, DHT, lobbies, asset pack UX) remains **outside** this package.

### 6.3 `@cyotee/boardgameio-crypto`

**Strengths:** Leaf; Vitest; keychain + mental poker in tree.

**Gaps before publish:**

| Gap | Action |
|-----|--------|
| Name still `@manamesh/boardgameio-crypto` | Rename to `@cyotee/boardgameio-crypto` |
| `"private": true` | Remove |
| `main` → `.ts` source | Build `dist/` + exports map |
| History only in monorepo | Sync to [cyotee/boardgameio-crypto](https://github.com/cyotee/boardgameio-crypto) (subtree split / push) |
| Peer `boardgame.io` | `^0.50.2` or alias to `@cyotee/boardgame.io` |

### 6.4 Optional later: discovery package

Do **not** name it `@cyotee/boardgameio-p2p` (taken by transport). If extracted:

- Join-code / WebRTC wrappers  
- Matchmaking lobbies  
- Asset transfer pipeline  

Suggested name only when needed: `@cyotee/manamesh-connect` or similar.

### 6.5 ManaMesh platform (`manamesh` repo)

- Continue as **application** (SPA + optional signaling).  
- Depend on published `@cyotee/boardgameio-*` packages.  
- Optional future `@cyotee/core` for game module contracts.  
- Rename `@manamesh/fbackend` before any backend publish.

### 6.6 Asset pack builder

- Split to own repo when convenient.  
- **Primary distribution:** static build / IPFS.  
- npm optional.

### 6.7 Game packages (Phase 2)

After `@cyotee/core` + published crypto/engine:

1. Drop frontend deep imports.  
2. Depend on registry packages.  
3. One repo per productized game (Timestreams is a good first full SPA product).

---

## 7. Phased execution (updated)

### Phase 0 — Auth & policy ✅

- [x] npm account `cyotee` + CLI login  
- [x] Scope decision: `@cyotee`  
- [x] No org conversion  
- [x] Checkpoint tag `checkpoint/pre-npm-publish-2026-07-17`  
- [x] This plan tag `checkpoint/npm-publish-plan-2026-07-17`  

### Phase 1 — Publish stack (next)

- [ ] `@cyotee/boardgame.io` publish-ready + publish  
- [ ] `@cyotee/boardgameio-p2p` push + publish (channel already in tree)  
- [ ] `@cyotee/boardgameio-crypto` rename, build, sync repo, publish  
- [ ] Monorepo installs registry versions (or npm aliases)  

### Phase 2 — Core extraction & games

- [ ] `@cyotee/core` (types/contracts)  
- [ ] Games off `@manamesh/frontend/src` deep imports  
- [ ] Optional discovery package  

### Phase 3 — Retire monorepo

- [ ] Apps/games on published deps only  
- [ ] Archive `manamesh-games` with pointer README  

---

## 8. Tooling notes

| Concern | Choice |
|---------|--------|
| Scope | `@cyotee` |
| Publish CLI | `npm publish --access public` after build |
| Engine consumer alias | `"boardgame.io": "npm:@cyotee/boardgame.io@…"` |
| Monorepo package manager | Yarn 4 / PnP today; published packages should work with npm/pnpm/yarn |
| CI later | GitHub Actions + trusted publishing or granular npm token |

---

## 9. Risks (unchanged essentials)

1. Publishing the SPA as a library without extraction.  
2. Name collision if we try unscoped `boardgame.io`.  
3. Card art / IP in npm tarballs — publish code and pack *format*, not copyrighted art dumps.  
4. Crypto not production-audited — document experimental status.  
5. Breaking monorepo too early before interop proven on published versions.  

---

## 10. Success criteria (Phase 1)

1. `npm view @cyotee/boardgame.io`  
2. `npm view @cyotee/boardgameio-p2p`  
3. `npm view @cyotee/boardgameio-crypto`  
4. A clean app can install without the monorepo:

```bash
npm i boardgame.io@npm:@cyotee/boardgame.io @cyotee/boardgameio-p2p @cyotee/boardgameio-crypto
```

5. Vite + channel P2P path still works with join codes.  

---

## 11. Relation to older docs

- `packages/manamesh/docs/PACKAGING_STRATEGY.md` / `EMBEDDED_PACKAGE_GUIDE.md` — monorepo-first extraction; **superseded for endgame** by this plan (publish + retire monorepo).  
- Embedded-package checklist (`dist`, exports, no cross-package relative imports) still applies before each first publish.  

---

## 12. Immediate next actions

1. Prepare and publish **`@cyotee/boardgame.io`**.  
2. Push and publish **`@cyotee/boardgameio-p2p@0.5.0`**.  
3. Prepare **`@cyotee/boardgameio-crypto`** (rename + dist + repo sync) and publish.  
4. Point games/frontend at registry dependencies instead of only `workspace:*`.  
5. Continue with `@cyotee/core` only after Phase 1 is live.  
