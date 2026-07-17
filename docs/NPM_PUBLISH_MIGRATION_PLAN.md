# NPM Publish Migration Plan

**Date:** 2026-07-16 (updated 2026-07-17)  
**Status:** Active — packages publish-ready; **registry publish blocked on npm 2FA** (need automation token with bypass-2fa). Run `node scripts/npm-publish-phase1.mjs` after `export NPM_TOKEN=…`.  
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
| Create free org `manamesh`? | **No** | Ship under `@cyotee`; platform name is `@cyotee/manamesh` |
| Public vs private packages | **Public** | Open-source libs / forks |
| Separate `@cyotee/core` package? | **No** | Do not extract a core types package; contracts stay in `@cyotee/manamesh` or in-game packages |

Scoped packages require:

```bash
npm publish --access public
# or publishConfig.access: "public" in package.json
```

Node **20 + npm 10** is sufficient for publish; npm 12 is **not** required (and needs Node 22+).

### 0.2 Package names (npm)

**Naming rule for boardgame.io forks:** publish under **`@cyotee`** with the **same package name** as the library identity (not a rebranded slug). Do not invent alternate names.

| Role | npm name | GitHub repo (existing) |
|------|----------|-------------------------|
| boardgame.io engine fork | **`@cyotee/boardgame.io`** | [cyotee/boardgame.io](https://github.com/cyotee/boardgame.io) |
| boardgame.io multiplayer transport | **`@cyotee/boardgameio-p2p`** | [cyotee/boardgameIO-p2p](https://github.com/cyotee/boardgameIO-p2p) |
| Crypto primitives | **`@cyotee/boardgameio-crypto`** | [cyotee/boardgameio-crypto](https://github.com/cyotee/boardgameio-crypto) |
| ManaMesh platform | **`@cyotee/manamesh`** | [cyotee/manamesh](https://github.com/cyotee/manamesh) |
| Asset pack builder | **`@cyotee/manamesh-asset-pack-builder`** (npx app + static SPA) | (split / own repo when ready; lives in monorepo today) |
| Games (poker, timestreams, …) | **Phase 2** (no core package prerequisite) | Separate repos later |

**Do not** publish unscoped `boardgame.io` or `@boardgame.io/p2p` — those scopes/names are upstream-owned.

**Do not** publish a separate `@cyotee/core` (or similar) package.

### 0.3 Phase 1 publish set (order)

```text
1. @cyotee/boardgame.io                    (engine fork; BoardProps type fix)
2. @cyotee/boardgameio-p2p                 (PeerJS + ManaMesh channel transport)
3. @cyotee/boardgameio-crypto              (leaf; peer boardgame.io)
4. @cyotee/manamesh                        (platform; depends on 1–3)
5. @cyotee/manamesh-asset-pack-builder     (npx CLI + shipped static SPA; independent of 4)
```

All five are **Phase 1 publish targets**. Consumers install the libraries / platform as **normal semver dependencies** (or npm alias for the engine). Games may still live in the monorepo until Phase 2.

**`@cyotee/manamesh`** is the ManaMesh platform package (today nested as `@manamesh/frontend` / related workspaces). It must be renamed and published to npm in Phase 1 — not deferred as rename-only.

**Asset pack builder** is an application package: users run it with:

```bash
npx @cyotee/manamesh-asset-pack-builder
# optional bin alias after install:
# manamesh-asset-pack-builder
```

It still ships the Vite-built static SPA (also deployable to IPFS); the `bin` entry starts a local static server (or equivalent) so no monorepo checkout is required.

### 0.4 P2P architecture (corrected course)

| Decision | Choice |
|----------|--------|
| Was the app using upstream PeerJS P2P? | **No** — a parallel in-app transport was built (MM-005 era) while the fork sat unused |
| Is that wrong given we forked p2p? | **Yes** — the fork should own the multiplayer transport |
| Fix | **Port channel transport into `@cyotee/boardgameio-p2p`** and extend the package |
| PeerJS path | **Keep** as `P2P({ isHost })` (upstream-compatible) |
| ManaMesh path | **`P2PMultiplayer({ connection, role, … })`** on an injected **`P2PChannel`** (join-code WebRTC, etc.) |
| Discovery / join codes / lobbies / asset transfer UI | **Stay in `@cyotee/manamesh`** (`frontend/src/p2p/discovery`, webrtc, …) — not dumped wholesale into the p2p package |
| App import surface | Re-export from `@cyotee/boardgameio-p2p/channel` so PeerJS is not required for play |

**Status (done in monorepo, pre-publish):**

- Package renamed to `@cyotee/boardgameio-p2p@0.5.0`
- Channel transport ported (`channel-transport.ts`, `channel.ts`, `extension-messages.ts`)
- Frontend `transport.ts` is a thin re-export; `JoinCodeConnection` implements `P2PChannel`
- Transport unit + P2P game integration tests pass (15 + 8)
- Submodule commits exist locally (`boardgameIO-p2p`, `manamesh`); **not necessarily pushed / not yet on npm**

### 0.5 What we will not publish in Phase 1

- Entire `manamesh-games` monorepo as one package  
- Game packages still blocked by deep workspace SPA imports (Phase 2)  
- Optional “ManaMesh discovery” package until transport is published and stable  
- **Any `@cyotee/core` package**  
- Card art / scraped image dumps inside the asset-pack-builder tarball (tool only)  

**We will publish `@cyotee/manamesh`** in Phase 1 (platform package).

### 0.6 Consumer install pattern (after publish)

```json
{
  "dependencies": {
    "boardgame.io": "npm:@cyotee/boardgame.io@0.50.2-cyotee.0",
    "@cyotee/boardgameio-p2p": "^0.5.0",
    "@cyotee/boardgameio-crypto": "^0.1.0",
    "@cyotee/manamesh": "^0.x.x"
  }
}
```

Prefer the **npm alias** for the engine so existing `import … from 'boardgame.io'` stays valid.

Asset pack builder is typically **not** a library dependency — invoke via **npx**:

```bash
npx @cyotee/manamesh-asset-pack-builder
```

### 0.7 Monorepo retirement

After packages publish and games/apps depend on registry versions:

- Retire **`manamesh-games`** as the active development host (archive or docs-only pointer map).  
- Do **not** maintain permanent workspace re-embeds solely for these libs.  
- Platform continues as **`@cyotee/manamesh`** in **`cyotee/manamesh`**; games in their own repos when extracted.

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
| App vs library blur | Nested `@manamesh/frontend` is a Vite SPA; target published name is **`@cyotee/manamesh`** |

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
| Platform | `packages/manamesh` | **`@cyotee/manamesh`** | **Phase 1 publish** — rename from `@manamesh/*`, define surface, publish | Platform package; not a separate “core” package |
| Asset pack builder | `packages/manamesh-asset-pack-builder` | **`@cyotee/manamesh-asset-pack-builder`** | Needs rename, un-private, `bin` + CLI, ship `dist/` | npx app; static SPA also IPFS-friendly |

### 2.3 Game packages (Phase 2)

| Package (workspace name today) | Path | Blocker for independent npm |
|--------------------------------|------|------------------------------|
| `@manamesh/poker` | `packages/poker` | Deep imports of platform SPA paths (`@manamesh/frontend/src/...`) |
| `@manamesh/timestreams` | `packages/timestreams` | Same |
| `@manamesh/onepiece` | `packages/onepiece` | Same |
| `@manamesh/mistborn-deckbuilder` | `packages/mistborn-deckbuilder` | Same |

Demo games still live **inside** the platform (`war`, `gofish`, `merkle-battleship`, `threshold-tally`, `he-battleship`).

Phase 2 games may later publish under `@cyotee/…` product names (e.g. `@cyotee/manamesh-poker`) without introducing a core package—shared contracts live in **`@cyotee/manamesh`** or stay private to each game.

### 2.4 boardgame.io fork delta

Against upstream, functional change is:

```
fix(react): export BoardProps as a type to keep dev-server ESM valid
```

cspell/tooling-only commits should **not** ship. Point submodule remote at **cyotee/boardgame.io**, not only upstream `boardgameio/boardgame.io`.

---

## 3. Target end state (after monorepo retirement)

```
cyotee/boardgame.io                → npm: @cyotee/boardgame.io
cyotee/boardgameIO-p2p             → npm: @cyotee/boardgameio-p2p
cyotee/boardgameio-crypto          → npm: @cyotee/boardgameio-crypto
cyotee/manamesh                    → npm: @cyotee/manamesh
cyotee/manamesh-asset-pack-builder → npm: @cyotee/manamesh-asset-pack-builder  (npx)
cyotee/manamesh-poker              → game (later)
cyotee/manamesh-timestreams        → game (later)
…
```

Optional later (discovery only, if extracted):

```
@cyotee/manamesh-connect or similar → join-code / lobby helpers (not boardgame.io transport)
```

**Not in plan:** `@cyotee/core` or any equivalent types-only package.

`manamesh-games` becomes archived or a thin pointer map. No requirement to keep workspace linking after cutover.

---

## 4. Dependency DAG (publish / extract order)

```text
@cyotee/boardgame.io                 (fork; leaf)
        ↑
@cyotee/boardgameio-p2p              (peer: boardgame.io)
@cyotee/boardgameio-crypto           (peer: boardgame.io)
        ↑
@cyotee/manamesh                     (platform app; owns module contracts / shell)
        ↑
Game packages / game SPAs (later)

@cyotee/manamesh-asset-pack-builder  (standalone npx app; no runtime dep on the above)
```

### Critical cycle (still blocks independent game npm packages)

```text
@cyotee/manamesh (today: @manamesh/frontend) ──workspace──▶ games
games packages ──deep import──▶ platform src/...
```

**Resolution (before game npm packages) — without a core package:**

1. Put shared module/types contracts on **`@cyotee/manamesh`** public export surface (or keep them internal and only ship games as apps).  
2. Games depend on **published engine + p2p + crypto + `@cyotee/manamesh`** as needed — not deep SPA source paths.  
3. Stop all `@manamesh/frontend/src/...` (and equivalent) deep imports.

Until then: **still publish engine, p2p, crypto, and `@cyotee/manamesh`.** Independent game packages wait on deep-import cleanup, not on holding back platform publish.

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

**Naming:** same library name under `@cyotee` (not a rebrand).

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

Discovery (join codes, DHT, lobbies, asset pack UX) remains **in `@cyotee/manamesh`**, outside this package.

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

### 6.5 `@cyotee/manamesh` — **platform (Phase 1 publish)**

- **npm name:** **`@cyotee/manamesh`** (not `@manamesh/frontend`, not a separate `@cyotee/core`).  
- **Must publish in Phase 1** after engine / p2p / crypto are on the registry (or alongside if workspace still resolves peers during cutover).  
- Platform application (SPA + optional signaling) with a deliberate public surface for consumers/games.  
- Depend on published `@cyotee/boardgame.io`, `@cyotee/boardgameio-p2p`, `@cyotee/boardgameio-crypto` (no permanent `workspace:*` in the published tarball).  
- Owns game-module contracts / shell APIs that would previously have been shoved into a “core” package.  
- Nested workspace names (`@manamesh/frontend`, `@manamesh/backend`) migrate toward **`@cyotee/manamesh`** (backend may stay private or get a separate name later if ever published).

**Gaps before publish:**

| Gap | Action |
|-----|--------|
| Workspace name `@manamesh/frontend` (etc.) | Rename primary package to `@cyotee/manamesh` |
| Consumed as monorepo source / SPA only | Define publish surface (`exports`, `files`, build `dist/` or documented app entry) |
| `workspace:*` deps on crypto/p2p/engine | Point at registry versions / npm alias before or at publish |
| Public vs private | Remove `private: true` on the published package; `publishConfig.access: "public"` |
| Repo | Already [cyotee/manamesh](https://github.com/cyotee/manamesh) |

**Success check:**

```bash
npm view @cyotee/manamesh
npm i @cyotee/manamesh
```

### 6.6 `@cyotee/manamesh-asset-pack-builder` — **npx application**

Browser-based tool for scraping card images and building ManaMesh-compatible asset packs. Today: private Vite SPA (`manamesh-asset-pack-builder@0.1.0`) with `dist/` static build.

**Publish goal:** install-free usage via npx, while keeping the same static SPA (also deployable to IPFS).

| Concern | Choice |
|---------|--------|
| npm name | **`@cyotee/manamesh-asset-pack-builder`** |
| Primary UX | **`npx @cyotee/manamesh-asset-pack-builder`** opens/serves the builder UI locally |
| Secondary | Static `dist/` for IPFS / static hosts |
| Bin name | `manamesh-asset-pack-builder` (matches product) |

**Gaps before publish:**

| Gap | Action |
|-----|--------|
| Name still unscoped `manamesh-asset-pack-builder` | Rename to `@cyotee/manamesh-asset-pack-builder` |
| `"private": true` | Remove |
| No `bin` | Add `bin` CLI that serves packaged `dist/` (e.g. small Node static server; open browser optional) |
| `files` | Ship `dist/`, `bin/`, README, LICENSE — not monorepo tooling only |
| `publishConfig.access` | `"public"` |
| Own git history | Split / push to e.g. `cyotee/manamesh-asset-pack-builder` when ready |
| Deps | Runtime `bin` should not require Vite as a production dependency of the published CLI if possible (prebuild SPA; CLI only serves static files) |

**Target `package.json` shape (illustrative):**

```jsonc
{
  "name": "@cyotee/manamesh-asset-pack-builder",
  "version": "0.1.0",
  "bin": {
    "manamesh-asset-pack-builder": "./bin/cli.js"
  },
  "files": ["dist", "bin", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=20" }
}
```

**Success check:**

```bash
npx @cyotee/manamesh-asset-pack-builder
# serves builder UI; user can scrape / build packs without cloning manamesh-games
```

### 6.7 Game packages (Phase 2)

After Phase 1 packages are live — including **`@cyotee/manamesh`** (no core package required):

1. Drop platform deep imports.  
2. Depend on registry packages (`@cyotee/boardgame.io` alias, p2p, crypto, and `@cyotee/manamesh` as needed).  
3. One repo per productized game (Timestreams is a good first full SPA product).

---

## 7. Phased execution (updated)

### Phase 0 — Auth & policy ✅

- [x] npm account `cyotee` + CLI login  
- [x] Scope decision: `@cyotee`  
- [x] No org conversion  
- [x] No `@cyotee/core` package  
- [x] Platform package: **`@cyotee/manamesh`** (publish in Phase 1, not rename-only)  
- [x] Asset pack builder: `@cyotee/manamesh-asset-pack-builder` as **npx** app  
- [x] Boardgame.io forks: `@cyotee` + same library name  
- [x] Checkpoint tag `checkpoint/pre-npm-publish-2026-07-17`  
- [x] This plan tag `checkpoint/npm-publish-plan-2026-07-17`  

### Phase 1 — Publish stack (next)

- [ ] `@cyotee/boardgame.io` publish-ready + publish  
- [ ] `@cyotee/boardgameio-p2p` push + publish (channel already in tree)  
- [ ] `@cyotee/boardgameio-crypto` rename, build, sync repo, publish  
- [ ] **`@cyotee/manamesh`** rename, publish surface, publish to npm  
- [ ] `@cyotee/manamesh-asset-pack-builder` rename, `bin` CLI, publish for **npx**  
- [ ] Consumers / monorepo install registry versions (or npm aliases) for all of the above  

### Phase 2 — Games (no core extraction)

- [ ] Games off platform deep imports (`@manamesh/frontend/src` / equivalent)  
- [ ] Shared contracts via `@cyotee/manamesh` public API **or** keep games app-only  
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
| Platform package | `@cyotee/manamesh` |
| Asset pack builder | `@cyotee/manamesh-asset-pack-builder` via **npx** |
| Monorepo package manager | Yarn 4 / PnP today; published packages should work with npm/pnpm/yarn |
| CI later | GitHub Actions + trusted publishing or granular npm token |

---

## 9. Risks (unchanged essentials)

1. Publishing the entire SPA as a library without a clear public surface for `@cyotee/manamesh`.  
2. Name collision if we try unscoped `boardgame.io`.  
3. Card art / IP in npm tarballs — publish **tool code** only (asset-pack-builder + libs), not copyrighted art dumps.  
4. Crypto not production-audited — document experimental status.  
5. Breaking monorepo too early before interop proven on published versions.  
6. npx CLI that still depends on monorepo / Vite at runtime instead of prebuilt `dist/`.  

---

## 10. Success criteria (Phase 1)

1. `npm view @cyotee/boardgame.io`  
2. `npm view @cyotee/boardgameio-p2p`  
3. `npm view @cyotee/boardgameio-crypto`  
4. `npm view @cyotee/manamesh`  
5. `npm view @cyotee/manamesh-asset-pack-builder`  
6. A clean consumer can install without the monorepo:

```bash
npm i boardgame.io@npm:@cyotee/boardgame.io @cyotee/boardgameio-p2p @cyotee/boardgameio-crypto @cyotee/manamesh
```

7. Asset pack builder runs without the monorepo:

```bash
npx @cyotee/manamesh-asset-pack-builder
```

8. Vite + channel P2P path still works with join codes.  

---

## 11. Relation to older docs

- `packages/manamesh/docs/PACKAGING_STRATEGY.md` / `EMBEDDED_PACKAGE_GUIDE.md` — monorepo-first extraction; **superseded for endgame** by this plan (publish + retire monorepo).  
- Embedded-package checklist (`dist`, exports, no cross-package relative imports) still applies before each first publish.  
- Earlier drafts recommending `@cyotee/core` are **void** — use `@cyotee/manamesh` instead.  

---

## 12. Immediate next actions

1. Prepare and publish **`@cyotee/boardgame.io`**.  
2. Push and publish **`@cyotee/boardgameio-p2p@0.5.0`**.  
3. Prepare **`@cyotee/boardgameio-crypto`** (rename + dist + repo sync) and publish.  
4. Prepare and publish **`@cyotee/manamesh`** (rename from `@manamesh/*`, public surface, registry deps).  
5. Prepare and publish **`@cyotee/manamesh-asset-pack-builder`** (`bin` + prebuilt SPA for **npx**).  
6. Point consumers at registry dependencies instead of only `workspace:*`.  
7. **Do not** introduce `@cyotee/core`.  
