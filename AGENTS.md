# Agent guidance — manamesh-games

Read [CLAUDE.md](CLAUDE.md) at the start of work in this repository. It is the
shared project guide for all agents: architecture, package ownership, commands,
conventions, security constraints, and the documentation map. Read package-local
instructions and relevant docs before editing that package.

## Current checkout corrections

- The frontend workspace is **`@cyotee/manamesh`**, located at
  `packages/manamesh/packages/frontend`. Older docs call it `@manamesh/frontend`.
- Shared crypto is **`@cyotee/boardgameio-crypto`**, located at
  `packages/boardgameio-crypto`. Older skills use `@manamesh/boardgameio-crypto`
  or the former frontend `src/crypto` directory. Check current package exports
  and imports before using examples from those skills.
- Use Yarn 4 / PnP from this monorepo root. For a finite frontend test run use
  `yarn workspace @cyotee/manamesh test:run [test-file]`; `test` is watch-capable.
  Root `yarn build` builds the frontend. Use package-scoped Vitest or Foundry
  commands for the affected game/crypto/contract package.
- Timestreams uses manual WebRTC join codes. Historical libp2p discovery guidance
  is not the current Timestreams product default.
- Package manifests, current imports, and implementation establish actual names
  and paths when older documentation disagrees. Follow local behavioral rules.

## Domain skills

Codex skill discovery uses `.agents/skills/`. These are relative directory links
to `.opencode/skills/`, which contains the complete root skill catalog and its
supporting resources. Read only skills relevant to the task, and resolve their
relative references against the source skill directory. Do not create divergent
copies for individual agents.

| Work | Skills to consult |
| --- | --- |
| Project structure and game integration | `manamesh-architecture`, `manamesh-game-modules`, `boardgame.io` |
| Multiplayer fairness, key exchange, deck operations | `boardgameio-crypto` first; `manamesh-crypto` for historical context |
| WebRTC, join codes, discovery | `manamesh-p2p`, `libp2p` |
| Card packs, IPFS, offline caches | `manamesh-assets`, `helia` |
| Wallets and settlement UI | `manamesh-ui-tx-testing`, `viem`, `wagmi`, `ethskills-wallets` |
| Solidity and Diamond contracts | `manamesh-contracts`, relevant `crane-*` skills and `forge-*` skills |
| Contract security | `ethskills-security`, `crane-adversarial-testing`, `defi-incident-patterns`; `ethskills-audit` for requested audits |
| ZK circuits | `circom`, `snarkjs` |

Before mental-poker changes, read the `boardgameio-crypto` skill. Private keys
must never enter shared game state or multiplayer move arguments. Host execution
(`client: false`) does not itself authenticate players or validate cryptographic
proofs; preserve identity binding and validation in the actual moves.

Maintain discovery with `python3 scripts/sync-agent-skills.py --write` after
adding root skills; verify with `python3 scripts/sync-agent-skills.py --check`.
If skill discovery has not refreshed in a running session, read the source
`SKILL.md` directly; restart Codex for a fresh instruction/discovery load.

## Workflow and tools

- Inspect working-tree changes before editing; preserve unrelated work. Packages
  including ManaMesh, Poker, and Timestreams are separate submodule repositories.
  Check the owning repository before commits or PRs.
- Use the available `up`, `design`, and `backlog` skills for context, PRD/task
  design, and backlog/worktree workflows when appropriate. For task work, read
  the relevant `tasks/INDEX.md`, ticket, `PROMPT.md`, and `PROGRESS.md` if present.
- Use existing Playwright CLI tests and injected EIP-1193 wallet fixtures for UI
  transaction checks. Read `manamesh-ui-tx-testing` for commands and evidence.
- Use package test/build/typecheck commands for diagnostics. Claude's
  `mcp__ide__getDiagnostics` permission entry does not provide that tool to Codex.
- Agent-specific permission lists are not portable tool implementations or
  authorization for new external actions. Use the tools and permissions of the
  active session. No repository MCP servers or hooks need migration here.
- Run the smallest meaningful checks for the change and report what actually
  ran. Configuration/link changes do not require the full game test suite.

See [docs/agent-configuration.md](docs/agent-configuration.md) for the parity
review, maintenance details, and remaining environment limitations.
