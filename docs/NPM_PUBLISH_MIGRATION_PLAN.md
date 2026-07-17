# NPM Publish Migration Plan

**Date:** 2026-07-16  
**Status:** Proposed  
**Goal:** Split publishable work out of `manamesh-games`, publish independent packages (and forks) to npm, then retire this monorepo as a development host.

---

## 1. Executive summary

`manamesh-games` is a Yarn 4 monorepo that successfully co-developed several products in parallel. That layout is excellent for iteration and a poor default for **standalone npm packages + long-term ownership**, because:

| Issue | Current reality |
|-------|-----------------|
| Packages are not build artifacts | Most `@manamesh/*` packages set `"main": "./src/index.ts"` and are consumed as raw TypeScript via workspace linking |
| Everything is private / unversioned for release | `@manamesh/boardgameio-crypto`, games, asset-pack-builder: `"private": true`, version `0.1.0` |
| Workspace protocol | `workspace:*` everywhere — not valid on the public registry |
| Circular and deep coupling | Game packages import `@manamesh/frontend/src/...`; frontend depends on several games |
| Mixed git models | `manamesh`, `boardgame.io`, `boardgameIO-p2p` are submodules; crypto / games / asset-pack-builder live only in the outer repo |
| App vs library blur | `@manamesh/frontend` is a Vite SPA, not a library with a public API surface |

**Important clarification:** npm does **not** require one git repo per package. You can publish monorepo packages with `npm publish` / Changesets from a single repo. Separate repos are still the right call here because you want to **retire `manamesh-games`**, give each package independent CI/release history, and host forks (especially boardgame.io) under your org without monorepo baggage.

---

## 2. Inventory — what exists today

### 2.1 Workspaces (root `package.json`)

```
packages/*
!packages/manamesh
packages/manamesh/packages/*   → frontend, backend
```

Root also pins local file deps:

- `boardgame.io` → `file:./packages/boardgame.io`
- `boardgameIO-p2p` → `file:./packages/boardgameIO-p2p`

### 2.2 Candidate publish units (your list + assessment)

| Unit | Path today | Package name today | Ready to publish? | Recommendation |
|------|------------|--------------------|-------------------|----------------|
| **boardgame.io fork** | `packages/boardgame.io` (submodule → upstream) | `boardgame.io` | Needs rename + fork remote | Publish as **`@manamesh/boardgame.io`** (or similar). Do not try to publish as unscoped `boardgame.io` — that name is owned by upstream. |
| **boardgame.io P2P transport** | `packages/boardgameIO-p2p` (submodule → `cyotee/boardgameIO-p2p`) | `@boardgame.io/p2p` | Already a fork repo; **no meaningful functional delta** | Optional. Frontend does **not** import it; custom P2P lives under `frontend/src/p2p/`. Only republish if you still want the PeerJS transport under your org. |
| **Crypto** | `packages/boardgameio-crypto` | `@manamesh/boardgameio-crypto` | Closest to ready (leaf package) | **First-class publish.** Rename optional: keep name or shorten to `@manamesh/crypto`. |
| **ManaMesh P2P** | `packages/manamesh/packages/frontend/src/p2p/` | *(not a package)* | Not extracted | Extract to **`@manamesh/p2p`** before publish. |
| **ManaMesh platform** | `packages/manamesh` (submodule) + nested frontend/backend | `manamesh`, `@manamesh/frontend`, `@manamesh/fbackend` | App shell; not library-shaped | Publish as **application repo(s)** + optional libs (`@manamesh/core` types, assets, deck). Prefer **not** publishing the whole SPA as an npm library. |
| **Asset pack builder** | `packages/manamesh-asset-pack-builder` | `manamesh-asset-pack-builder` | SPA tool | Publish as **`@manamesh/asset-pack-builder`** app/tooling repo; primary distribution can be static hosting/IPFS, npm optional (bin or source). |

### 2.3 Game packages (also monorepo-bound; plan homes even if not first publish)

| Package | Path | Depends on |
|---------|------|------------|
| `@manamesh/poker` | `packages/poker` | crypto, frontend (deep), boardgame.io, viem |
| `@manamesh/timestreams` | `packages/timestreams` | crypto, frontend (deep) |
| `@manamesh/onepiece` | `packages/onepiece` | crypto, frontend (deep) |
| `@manamesh/mistborn-deckbuilder` | `packages/mistborn-deckbuilder` | crypto, frontend (deep) |

Demo games still live **inside** frontend (`war`, `gofish`, `merkle-battleship`, `threshold-tally`, `he-battleship`).

### 2.4 boardgame.io fork delta (must-publish if Vite consumers stay on your stack)

Against upstream `origin/main`, the submodule is **ahead 3 / behind 9**. Functional change is a single commit:

```
fix(react): export BoardProps as a type to keep dev-server ESM valid
```

`packages/react.ts`: value re-export of `BoardProps` → `export type { BoardProps }`.

Without this, Vite native ESM fails (`does not provide an export named BoardProps`). That alone justifies a maintained fork under your org. Upstream PRs being ignored matches your assumption.

The other two local commits are cspell/tooling noise and should **not** ship in the fork.

`boardgameIO-p2p` local commits are also tooling-only; no functional fork is required unless you want org ownership of that package.

---

## 3. Target end state (after monorepo retirement)

Independent GitHub repos under your org (names suggestive, not mandatory):

```
cyotee/boardgame.io              → npm: @manamesh/boardgame.io
cyotee/boardgameio-p2p           → already exists; npm: @manamesh/boardgame.io-p2p (optional)
cyotee/boardgameio-crypto        → npm: @manamesh/boardgameio-crypto
cyotee/manamesh-p2p              → npm: @manamesh/p2p
cyotee/manamesh                  → platform app (+ optional published libs)
cyotee/manamesh-asset-pack-builder → static SPA / optional npm
cyotee/manamesh-poker            → game (later)
cyotee/manamesh-timestreams      → game (later)
cyotee/manamesh-onepiece         → game (later)
cyotee/manamesh-mistborn         → game (later)
```

`manamesh-games` becomes either:

1. **Archived** (README points at the new repos), or  
2. A thin **meta** README/docs-only archive with no active code.

No requirement to keep workspace linking or submodule pointers after cutover.

---

## 4. Dependency DAG (publish / extract order)

Strict bottom-up order. Arrows mean “depends on”:

```text
@manamesh/boardgame.io          (fork; leaf)
        ↑
@manamesh/boardgameio-crypto    (peer: boardgame.io)
        ↑
@manamesh/p2p                   (optional peer: boardgame.io; uses WebRTC/libp2p)
        ↑
@manamesh/core (NEW, recommended)
   game module types, asset manifest types, deck types
   extracted from frontend/src/game/modules/types, assets/, deck/
        ↑
Game packages (poker, timestreams, …)
        ↑
@manamesh/frontend / manamesh app (consumes games + libs; optional plugin registry)
```

### Critical cycle to break before any “manamesh platform” publish

Today:

```text
@manamesh/frontend ──workspace──▶ @manamesh/poker | onepiece | mistborn | (timestreams via alias)
@manamesh/poker    ──deep import──▶ @manamesh/frontend/src/...
```

**Resolution (required):**

1. Extract **stable contracts** from frontend into a leaf library, e.g. `@manamesh/core` (or `@manamesh/game-module`):
   - `GameModule`, `GameConfig`, `ZoneDefinition`, `CoreCard`, card schema types
   - Asset pack manifest types used by games
   - Deck list / enrichment types (or keep deck as `@manamesh/deck` if large)
2. Games depend on **`@manamesh/core` + `@manamesh/boardgameio-crypto`**, not on the SPA.
3. Frontend depends on games **only at the app composition layer** (registry / pages), or games are optional peer plugins loaded by the app.
4. Stop all `@manamesh/frontend/src/...` deep imports. They are monorepo-only and will not work from npm.

Until that cycle is broken, you can still publish **crypto** and the **boardgame.io fork**; you cannot cleanly publish games or a reusable manamesh library.

---

## 5. Per-package publish readiness checklist

Every npm package needs the same minimum shape:

```jsonc
{
  "name": "@manamesh/...",
  "version": "0.1.0",
  // "private": true  ← remove before publish
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
    // explicit subpaths only if part of the public API
  },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public"
  },
  "repository": { "type": "git", "url": "..." },
  "license": "MIT" // or chosen license
}
```

Also required:

- [ ] `build` script producing `dist/` (tsc or tsup/unbuild)
- [ ] Tests runnable without monorepo root
- [ ] CI on the package repo (test + build + optional `npm publish`)
- [ ] No `workspace:*` / `file:` deps in published `package.json`
- [ ] Peer deps for heavy frameworks (`boardgame.io`, `react`) where appropriate
- [ ] npm org `@manamesh` created; 2FA / trusted publishing configured
- [ ] LICENSE file; preserve upstream license text for forks

---

## 6. Package-by-package migration plans

### 6.1 `@manamesh/boardgame.io` (fork) — **do this if any Vite app remains on the fork**

**Why:** One-line type export fix is load-bearing for Vite. Upstream is effectively unmaintained for your PR path.

**Steps:**

1. Create `github.com/cyotee/boardgame.io` (or org) as a **fork** of `boardgameio/boardgame.io` (or full history clone).
2. Point the submodule remote (or move out of monorepo) to your fork.
3. Reset/rebase: keep **only** the `BoardProps` type-export commit; drop cspell commits; optionally rebase onto a chosen upstream tag (today vendored as `0.50.2`).
4. Change package metadata:
   - `"name": "@manamesh/boardgame.io"`
   - `"version": "0.50.2-manamesh.0"` (or `0.50.3` under your scope — prefer **semver that encodes fork lineage**)
   - Update `repository`, `bugs`, `homepage` to your fork
   - Keep MIT; retain AUTHORS / upstream copyright notices
5. Ensure `npm run build` / `prepack` still produce `dist/` (upstream already has publish scripts).
6. Publish: `npm publish --access public` from the package root after build.
7. Update all consumers:
   - `package.json`: `"boardgame.io": "npm:@manamesh/boardgame.io@^0.50.2-manamesh.0"`  
     **or** change imports to `@manamesh/boardgame.io` (more churn).
   - Prefer the **npm alias** form so existing `import ... from 'boardgame.io'` keeps working.

**Alternative (smaller blast radius, no npm fork):** ship a tiny patch via `pnpm patch` / `patch-package` in each app. That does **not** help third parties and fights monorepo retirement — only use as a short bridge.

### 6.2 `@cyotee/boardgameio-p2p` — **in progress / primary for multiplayer**

- Repo: `github.com/cyotee/boardgameIO-p2p` (workspace `packages/boardgameIO-p2p`).
- Package renamed to **`@cyotee/boardgameio-p2p@0.5.0`**.
- **Two modes:**
  - `P2P()` — upstream PeerJS transport
  - `P2PMultiplayer({ connection })` / `P2PTransport` — **ManaMesh channel path** (ported from frontend `transport.ts`)
- App discovery (join codes, WebRTC) stays in frontend; transport lives in the package.
- Frontend re-exports from `@cyotee/boardgameio-p2p/channel` so PeerJS is not required for play.
- **Next:** commit package changes to the fork remote; publish when ready.

### 6.3 `@manamesh/boardgameio-crypto` — **first real first-party package**

**Strengths:** Leaf package; documented; Vitest suite; no frontend dependency.

**Gaps:**

| Gap | Action |
|-----|--------|
| `"private": true` | Remove when publishing |
| `main`/`exports` point at `.ts` source | Add `tsconfig.build.json` + emit `dist/`; map exports to `dist/*` |
| No `build` script | Add `tsc` or `tsup` multi-entry for subpaths |
| Latent strict-TS debt (README admits) | Fix or `skipLibCheck` carefully before first release |
| Peer `boardgame.io` | Point peer at `@manamesh/boardgame.io` or npm alias once fork is published |
| Only lives in outer monorepo | `git subtree split` / `git filter-repo` into new repo |

**Suggested extract commands (history-preserving):**

```bash
# From manamesh-games root, after commit is clean:
git subtree split -P packages/boardgameio-crypto -b split/boardgameio-crypto
# New empty repo:
git clone git@github.com:cyotee/boardgameio-crypto.git
cd boardgameio-crypto
git pull ../manamesh-games split/boardgameio-crypto
```

**Publish order:** after boardgame.io fork is available (or peerDep allows either `boardgame.io@0.50.x` or your scoped alias during transition).

**Versioning:** start `0.1.0` public; use Changesets or manual semver; treat crypto API as **0.x unstable** until keychain/mental-poker surface freezes.

### 6.4 `@manamesh/p2p` — **extract from manamesh frontend**

**Source:** `packages/manamesh/packages/frontend/src/p2p/`

**Before extract:**

1. Inventory public surface (from `p2p/index.ts`): transports (join-code, LAN, direct-IP, relay), WebRTC helpers, lobby protocol, asset-sharing pipeline, matchmaking adapters.
2. Strip **game-specific** matchmaking folders (`discovery/matchmaking/poker`, `.../timestreams`) into game packages or app layer — keep `@manamesh/p2p` generic.
3. Ensure no imports from React app shell (`App.tsx`, pages). P2P should depend only on:
   - Web APIs / libp2p / Peer-related deps as needed
   - optionally `@manamesh/boardgameio-crypto` if identity/signing is shared (prefer not)
4. Add package.json, build, tests (many tests already live next to sources).
5. Move into `packages/manamesh-p2p` **or** straight into a new repo; update frontend imports to `@manamesh/p2p`.

**Publish** only after crypto (if needed) and a successful build outside the monorepo.

### 6.5 ManaMesh platform (`manamesh` repo)

Already a separate git remote: `github.com/cyotee/manamesh.git`.

**Do not** try to publish the entire monorepo submodule as one npm package. Split concerns:

| Publishable / shippable unit | Form |
|------------------------------|------|
| `@manamesh/core` | npm library (types + pure helpers) |
| `@manamesh/assets` or keep inside app | asset loader, IPFS/Helia helpers (if reusable) |
| `@manamesh/deck` | deck model (if extracted) |
| `@manamesh/p2p` | npm library (above) |
| Frontend SPA | **not** primarily an npm package — deploy as static site / Vercel / IPFS |
| Backend (`@manamesh/fbackend`) | optional service package or Docker image; rename for clarity |

**App-facing work after libraries publish:**

1. Replace `workspace:*` / Vite path aliases with semver deps on published packages.
2. Registry: compose games via optional dependencies or separate deployable apps per game (Timestreams already has SPA entry + Vercel path).
3. Remove vendored trees under `packages/manamesh/vendor/boardgame.io` if still present — depend on the published fork.
4. Backend package rename (`fbackend` → `@manamesh/backend` or `signaling-server`).

**Note:** frontend currently aliases `@manamesh/timestreams` and serves timestreams packs from `packages/timestreams` via Vite middleware. After split, Timestreams either:

- is its own deployable app depending on published platform libs, or  
- is a versioned npm game package the shell loads.

### 6.6 `manamesh-asset-pack-builder`

Already almost a standalone Vite SPA (`private: true`, no workspace deps).

**Migration:**

1. `git subtree split -P packages/manamesh-asset-pack-builder` → new repo.
2. Scope name: `@manamesh/asset-pack-builder`.
3. Decide distribution:
   - **Primary:** static build (`vite build`) → IPFS / GitHub Pages / Vercel (matches README).
   - **Optional npm:** publish as a package with `"bin"` CLI or `"files": ["dist"]` for embedding — only if someone installs it via npm; not required for end users.

No crypto/boardgame dependency. Can ship in parallel with crypto.

### 6.7 Game packages (phase 2 after core extraction)

For each of poker / timestreams / onepiece / mistborn:

1. Replace `@manamesh/frontend/src/...` with `@manamesh/core` (and thin UI peers if boards stay in-game).
2. UI that currently imports `CryptoTransparencyPanel`, `useAssetPack`, etc. either:
   - moves into the app shell (game exports pure boardgame.io `Game` + minimal board props), or  
   - games depend on `@manamesh/ui` (only if you extract shared React UI).
3. Poker also carries Foundry contracts — keep contracts in the poker repo; npm package can be TS-only with `contracts/` as optional subtree.
4. Publish as `@manamesh/poker` etc. when independent CI is green.

Timestreams may be the best **first game app** to leave the monorepo as a full product (already has e2e + Vercel build scripts).

---

## 7. Phased execution plan

### Phase 0 — Org and policy (1 day)

- [ ] Create / claim npm organization `@manamesh`
- [ ] Decide licenses (MIT recommended for libs; confirm for game IP / assets)
- [ ] Decide public vs private packages (recommendation: public libs, public forks)
- [ ] Auth: npm automation tokens or GitHub OIDC trusted publishing
- [ ] Freeze “no new deep imports of `@manamesh/frontend/src`” as a repo rule for remaining monorepo work

### Phase 1 — boardgame.io fork (1–2 days)

- [ ] Create fork repo; apply only the BoardProps type-export fix
- [ ] Publish `@manamesh/boardgame.io@0.50.2-manamesh.0`
- [ ] Point monorepo (and later each consumer) at the npm alias
- [ ] Smoke-test Vite: `yarn workspace @manamesh/frontend dev`

### Phase 2 — Crypto package (2–4 days)

- [ ] Add production build (`dist` + exports + types)
- [ ] Fix or quarantine typecheck failures
- [ ] Remove `private`; set `publishConfig`
- [ ] Split repo history; CI (test + build)
- [ ] Publish `@manamesh/boardgameio-crypto@0.1.0`
- [ ] Switch monorepo consumers from `workspace:*` to `^0.1.0` (or keep workspace until all split — either works until retirement)

### Phase 3 — Break frontend ↔ games cycle (3–7 days; **blocking for platform/games**)

- [ ] Create `@manamesh/core` from module + asset + deck types
- [ ] Update games to import core only
- [ ] Update frontend to import core; drop reverse type deps
- [ ] Extract `@manamesh/p2p` from `src/p2p`
- [ ] Publish core + p2p

### Phase 4 — Asset pack builder (1 day, parallelizable)

- [ ] Split repo; CI build
- [ ] Deploy static artifact; optional npm publish

### Phase 5 — Manamesh app cutover (3–7 days)

- [ ] `cyotee/manamesh` becomes the sole platform source (stop developing via outer monorepo only)
- [ ] Depend on published `@manamesh/*` packages
- [ ] Remove submodule / vendor copies of boardgame.io when npm fork works
- [ ] Optional: publish backend as separate package/image

### Phase 6 — Games out, monorepo retire (ongoing)

- [ ] One game per repo (or one `manamesh-games` product repo per shippable SPA)
- [ ] Archive `manamesh-games` with README map of new homes
- [ ] Tag final monorepo commit for archaeology

---

## 8. Recommended tooling

| Concern | Tool |
|---------|------|
| Version bumps / changelogs | [Changesets](https://github.com/changesets/changesets) in each repo (or single release PR workflow) |
| Build | `tsup` (simple multi-entry ESM + dts) or `tsc` project references |
| Extract history | `git subtree split` or `git filter-repo` |
| Patch during transition | npm package alias: `"boardgame.io": "npm:@manamesh/boardgame.io@..."` |
| CI | GitHub Actions: `yarn/npm test` + `build` + `npm publish` on tag |
| Registry | npmjs.com scope `@manamesh`; avoid dual-publishing to GitHub Packages unless needed |

Avoid keeping Yarn PnP monorepo-only assumptions in library packages: published packages should work with npm, pnpm, and yarn.

---

## 9. Risks and sharp edges

1. **Publishing `@manamesh/frontend` as a library without extraction** — ships the SPA, Phaser, wallet stack, and game registry; consumers cannot tree-shake it, and deep path imports break. Extract contracts first.
2. **Name collision on `boardgame.io`** — must use a scoped fork name.
3. **Game IP / card assets** — do not publish copyrighted card art inside npm packages; publish code + pack *format*; host packs separately.
4. **Security posture** — monorepo docs still flag decrypt-share validation and `playerId` binding issues. Prefer not advertising crypto as production-audited until those are closed (or document clearly as experimental).
5. **Submodule double-nesting** — `manamesh` submodule already has its own vendor copies of boardgame.io/p2p; clean those during cutover to avoid three copies of the engine.
6. **Timestreams not declared in frontend `package.json`** — only Vite alias; will break the moment the monorepo dissolves unless made an explicit dependency or separate app.
7. **Backend name typo** — `@manamesh/fbackend` should be fixed before any publish.
8. **Retiring monorepo too early** — complete Phase 3 before deleting the integration workspace, or you lose the only place that proves packages interoperate.

---

## 10. Success criteria

Migration is done when:

1. `@manamesh/boardgame.io` is installable from npm and Vite apps work without a local submodule.
2. `@manamesh/boardgameio-crypto` installs from npm; Vitest suite passes in its own repo CI.
3. `@manamesh/p2p` (and ideally `@manamesh/core`) are separate packages with no dependency on the SPA.
4. No consumer uses `workspace:*` or `@manamesh/frontend/src/...` deep imports.
5. Asset pack builder lives in its own repo and deploys as a static site.
6. `manamesh` platform develops against **published** (or path-linked-for-dev) packages without requiring `manamesh-games`.
7. `manamesh-games` is archived with a pointer map; no new feature work lands there.

---

## 11. Suggested first week (concrete)

| Day | Outcome |
|-----|---------|
| 1 | npm org + boardgame.io fork repo + BoardProps-only branch |
| 2 | Publish `@manamesh/boardgame.io`; wire monorepo alias; smoke Vite |
| 3–4 | Crypto build pipeline + type fixes; subtree split to new repo |
| 5 | Publish `@manamesh/boardgameio-crypto@0.1.0`; CI green |
| Next | Start `@manamesh/core` extraction (types only) — unblocks everything else |

---

## 12. Out of scope / non-goals

- Keeping `manamesh-games` as a permanent meta-monorepo with submodules after publish (explicitly retired).
- Upstream merge of the BoardProps fix as a hard dependency (nice if accepted; do not block on it).
- Publishing demo games (`war`, `gofish`, HE demos) as separate packages unless productized.
- Real-money / production fairness certification as part of the npm release process.

---

## 13. Appendix — current publish blockers (quick reference)

```
packages/boardgameio-crypto
  private: true
  main → ./src/index.ts  (no dist)
  no build script

packages/manamesh/packages/frontend
  app only; no exports map
  depends on workspace games
  games deep-import this package's /src tree

packages/manamesh-asset-pack-builder
  private: true
  SPA; fine as repo+deploy; npm optional

packages/boardgame.io
  name collides with upstream on npm
  remote still points at boardgameio/boardgame.io
  1 real commit + 2 noise commits ahead of origin

packages/boardgameIO-p2p
  unused by frontend; tooling-only local delta
```

---

## 14. Relation to existing docs

Older guidance lives in:

- `packages/manamesh/docs/PACKAGING_STRATEGY.md` (2026-05-19) — monorepo-first extraction with later submodules  
- `packages/manamesh/docs/EMBEDDED_PACKAGE_GUIDE.md` — embedded package shape  

This plan **supersedes** those for the endgame: **publish to npm and retire the monorepo**, rather than keep a permanent workspace with submodule re-embeds. The embedded-package checklist (exports, `dist`, tests, no cross-package relative imports) remains valid and should be applied before each first publish.
