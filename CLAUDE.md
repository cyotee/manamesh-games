# CLAUDE.md — manamesh-games

Guidance for AI agents working in this repository. Read this first; then open package-local docs only for the area you are changing.

## What this is

**ManaMesh** is a decentralized, browser-based multiplayer platform for competitive card and board games. Gameplay is **P2P-first** (no required game server). Crypto primitives enable provably fair play between untrusted peers (mental poker, Merkle commitments, threshold HE).

This repo (`manamesh-games`) is a **Yarn 4 monorepo** that hosts:

1. The ManaMesh platform (frontend/backend, nested under `packages/manamesh`)
2. Extracted game modules and shared crypto as first-class workspaces
3. Vendored forks of `boardgame.io` and its P2P transport

## Quick start

```bash
# From monorepo root (Yarn 4 / PnP — do not use npm)
yarn install

yarn dev:frontend          # Vite → typically http://localhost:3000
yarn build                 # Build @manamesh/frontend
yarn test:frontend         # Vitest (frontend workspace)

# Package-scoped tests
yarn workspace @manamesh/timestreams test
yarn workspace @manamesh/poker test
yarn workspace @manamesh/boardgameio-crypto test
yarn workspace @manamesh/onepiece test
yarn workspace @manamesh/mistborn-deckbuilder test

# Timestreams static SPA deploy artifacts
yarn build:timestreams-vercel
# yarn deploy:timestreams   # builds + vercel --prod (needs auth)
```

**Node:** `>=20` (see `@manamesh/frontend` engines).

**Submodules** (required for a full checkout):

```bash
git submodule update --init --recursive
```

| Submodule path | Upstream |
|----------------|----------|
| `packages/manamesh` | `github.com/cyotee/manamesh` |
| `packages/boardgame.io` | boardgame.io fork |
| `packages/boardgameIO-p2p` | P2P transport fork |
| `packages/poker/lib/*` | forge-std, OpenZeppelin, crane |

## Monorepo layout

```
manamesh-games/
├── package.json                 # Root workspaces + convenience scripts
├── packages/
│   ├── manamesh/                # Platform submodule (NOT a yarn workspace root itself)
│   │   ├── packages/
│   │   │   ├── frontend/        # @manamesh/frontend — React + Vite app shell
│   │   │   └── backend/         # Optional Express/WS signaling (not required for play)
│   │   ├── contracts/           # Foundry contracts (platform-level)
│   │   ├── CLAUDE.md            # Platform-oriented agent notes (may lag structure)
│   │   ├── AGENTS.md            # Deep game-module + crypto reference
│   │   ├── PRD.md / docs/       # Product + architecture docs
│   │   └── tasks/               # Task tickets (MM-*)
│   ├── boardgameio-crypto/      # @manamesh/boardgameio-crypto — shared crypto primitives
│   ├── poker/                   # @manamesh/poker — Hold'em + Solidity settlement
│   ├── timestreams/             # @manamesh/timestreams — rules engine + SPA focus
│   ├── onepiece/                # @manamesh/onepiece — One Piece TCG module
│   ├── mistborn-deckbuilder/    # @manamesh/mistborn-deckbuilder
│   ├── manamesh-asset-pack-builder/  # Vite tool for asset packs
│   ├── boardgame.io/            # Vendored game engine
│   └── boardgameIO-p2p/         # Vendored P2P multiplayer transport
├── deploy/timestreams/          # Vercel static deploy tree
├── dist/                        # Built SPA / asset pack outputs
└── docs/                        # Cross-cutting plans/specs
```

### Yarn workspaces (root `package.json`)

```json
"workspaces": [
  "packages/*",
  "!packages/manamesh",
  "packages/manamesh/packages/*"
]
```

- Top-level packages under `packages/*` are workspaces **except** the `manamesh` directory itself.
- Nested `packages/manamesh/packages/*` (`frontend`, `backend`) **are** workspaces.
- Prefer `yarn workspace <name> <script>` over `cd` + local package managers.

## Where code lives (important split)

| Concern | Location |
|---------|----------|
| App shell, lobby, P2P, IPFS assets, Phaser, registry | `packages/manamesh/packages/frontend/src/` |
| Demo / in-tree game modules (war, gofish, merkle-battleship, threshold-tally, he-battleship) | `…/frontend/src/game/modules/` |
| Game registry (imports extracted packages + local modules) | `…/frontend/src/game/registry.ts` |
| Shared crypto (SRA, Merkle, Paillier, Feldman DKG, DLEQ, plugin) | `packages/boardgameio-crypto/src/` |
| Poker game + board + EIP-712 + Forge contracts | `packages/poker/` |
| Timestreams rules engine, crypto deck ops, board, e2e | `packages/timestreams/` |
| One Piece / Mistborn modules | `packages/onepiece/`, `packages/mistborn-deckbuilder/` |
| Optional signaling server | `packages/manamesh/packages/backend/` |

**Extracted modules are consumed as workspace packages**, e.g.:

```ts
import { PokerBoard, CryptoPokerGame } from "@manamesh/poker";
import { TimestreamsBoard, TimestreamsModule } from "@manamesh/timestreams";
import { verifyMerkleProof } from "@manamesh/boardgameio-crypto";
```

When changing a game, prefer editing its package (`packages/poker`, etc.) over the frontend shell unless the change is routing, lobby, or shared UI.

## Architecture (agent map)

### Design principles

- **P2P-first** — A full game should work with no backend; signaling is optional fallback.
- **Modular games** — Rules live in game modules; shell owns transport, assets, and registry.
- **Crypto fairness** — In-play secrets use commitments / mental poker / HE; do not put private keys in shared boardgame.io state for production modes.
- **HOST-authoritative crypto moves** — Crypto moves typically use `client: false` so the host runs them (clients cannot unilaterally invent shared crypto state).

### Three crypto paradigms

1. **Mental poker (SRA + cooperative decrypt)** — hidden shuffled decks: War, Poker, Go Fish, Timestreams, One Piece deck ops. Primitives: `@manamesh/boardgameio-crypto` mental-poker + Shamir escrow.
2. **Merkle commitments** — binding board placement: Merkle Battleship.
3. **Threshold HE** — private inputs, public aggregate: Threshold Tally (Feldman DKG + EC ElGamal + DLEQ).

### P2P transports (frontend)

Priority / options live under `packages/manamesh/packages/frontend/src/p2p/`:

- **Join codes** (manual SDP offer/answer) — zero-infra path used by Timestreams
- LAN / direct IP / relay / experimental libp2p discovery (some paths retired for Timestreams)

Timestreams SPA entry: `packages/manamesh/packages/frontend/src/pages/timestreams/`  
Dev URL: `http://localhost:3000/src/pages/timestreams/`

### Game module contract

Modules implement `GameModule` / registry `GameInfo` patterns:

- `getGame()` / optional `getCryptoGame()`
- Zones, card schema, pure logic separated from boardgame.io wrappers where possible
- Board React components (and Phaser for One Piece)

Deep module-by-module notes: `packages/manamesh/AGENTS.md`.

## Essential commands by package

| Package | Test / build |
|---------|----------------|
| `@manamesh/frontend` | `yarn workspace @manamesh/frontend dev` / `test` / `build` |
| `@manamesh/backend` | `yarn workspace @manamesh/backend dev` |
| `@manamesh/timestreams` | `yarn workspace @manamesh/timestreams test` · e2e: `test:e2e` (Playwright) |
| `@manamesh/poker` | `yarn workspace @manamesh/poker test` · `forge:test` (Foundry in package dir) |
| `@manamesh/boardgameio-crypto` | `yarn workspace @manamesh/boardgameio-crypto test` |
| `@manamesh/onepiece` | `yarn workspace @manamesh/onepiece test` |
| `@manamesh/mistborn-deckbuilder` | `yarn workspace @manamesh/mistborn-deckbuilder test` |

Single frontend test file example:

```bash
yarn workspace @manamesh/frontend test src/game/modules/war/game.test.ts
```

## Docs map (read when relevant)

| Doc | Use when |
|-----|----------|
| `packages/manamesh/AGENTS.md` | Game modules, crypto flows, phases/moves |
| `packages/manamesh/docs/ARCHITECTURE.md` | Platform architecture depth |
| `packages/manamesh/PRD.md` | Product goals / non-goals |
| `packages/manamesh/PROJECT_STATUS.md` | Health, security blockers, completeness |
| `packages/manamesh/SECURITY_REPORT.md` | Crypto/P2P security findings |
| `packages/timestreams/PRD.md`, `RULES.md`, `RULES_ENGINE_*.md` | Timestreams rules engine work |
| `packages/poker/docs/*` | Poker settlement / deployment |
| `.opencode/skills/*` | Domain skills (architecture, crypto, p2p, contracts, boardgame.io, …) |
| `.grok/skills/boardgameio-crypto` | **How to use `@manamesh/boardgameio-crypto`** (keychain, no sk on wire, mental poker) — also `.opencode/skills/boardgameio-crypto` |

## Conventions

- **Package manager:** Yarn 4 (PnP). Do not introduce `package-lock.json` at root; avoid `npm install` for workspaces.
- **Language:** TypeScript. Prefer pure functions for game logic; keep boardgame.io wrappers thin.
- **Tests:** Vitest for TS packages; Playwright for Timestreams e2e; Foundry (`forge test`) for Solidity under `packages/poker`.
- **Game logic purity:** Avoid `Date.now()` / `Math.random()` inside move handlers (breaks deterministic replay). Use `ctx` fields or crypto RNG as appropriate.
- **Crypto safety:** Never store private keys in shared G (game state) for secure modes. Prefer cooperative decrypt / escrow patterns already used in modules.
- **Assets:** Card art via asset packs + IPFS/Helia + IndexedDB caches; Timestreams pack served at `/timestreams-pack/` in Vite dev.
- **Scope edits:** Prefer the smallest package that owns the behavior. Shell changes belong in frontend; rules/crypto deck ops usually belong in the game package or `boardgameio-crypto`.

## Gotchas

1. **Dual tree confusion** — Platform shell is under `packages/manamesh/packages/frontend`, not `packages/frontend`. Paths in older docs/skills that say `packages/frontend` mean the nested frontend.
2. **Stale nested CLAUDE/AGENTS** — `packages/manamesh/CLAUDE.md` and parts of `AGENTS.md` still describe crypto under `src/crypto/` and poker under frontend modules. Crypto is **`@manamesh/boardgameio-crypto`**; poker/timestreams/onepiece/mistborn are top-level packages. Prefer this root file + current imports.
3. **`packages/manamesh` is a submodule** — Commits there may need a separate push/PR from the outer monorepo commit that only bumps the submodule pointer.
4. **Workspace exclusion** — `!packages/manamesh` means you cannot `yarn workspace manamesh …`; use nested package names (`@manamesh/frontend`, etc.).
5. **Timestreams P2P** — Production path is **manual join codes**, not libp2p DHT matchmaking (DHT path retired for Timestreams).
6. **Symmetric NAT** — Join-code + STUN-only WebRTC fails for some networks without TURN (inherent WebRTC limit).
7. **Demo crypto** — HE Battleship, Go Fish ZK attest, and some HE/DKG paths are demos/scaffolding; do not treat as production-ready fairness.
8. **Security open issues** — See `PROJECT_STATUS.md` / `SECURITY_REPORT.md` (e.g. `playerId` vs `ctx.playerID` binding, decrypt share validation gaps in some SRA games).
9. **boardgame.io debug panel** — Frontend Vite config stubs Svelte debug imports via `stubs/empty-debug.js`; do not “fix” by re-enabling Svelte debug without intent.
10. **Large vendored trees** — `packages/boardgame.io`, Foundry `lib/`, and `reference/` trees are huge; avoid mass refactors or commit noise there unless the task is specifically about those deps.

## Suggested agent workflow

1. Identify the package that owns the feature (table above).
2. Read the package `PRD.md` / `README.md` if present, plus relevant tests.
3. For platform/P2P/assets changes, start from `registry.ts`, `App.tsx`, and `src/p2p/`.
4. For fairness/crypto changes, work in `boardgameio-crypto` first, then update consumers. Read **`.grok/skills/boardgameio-crypto/SKILL.md`** (or invoke skill `boardgameio-crypto`) before touching mental-poker moves — never put private keys in shared `G` or multiplayer move args.
5. Run the **smallest** relevant test command; then frontend build if shell/bundle is affected.
6. Do not expand scope into unrelated games or vendored engines.

## Out of scope for casual edits

- Real-money gambling features
- Replacing boardgame.io wholesale
- Re-enabling Timestreams libp2p DHT as default matchmaking without an explicit product decision
- Committing secrets, private keys, or large binary dumps outside asset-pack conventions
