# Repository agent configuration

Reviewed 2026-09-05. This setup makes the repository's existing guidance and
domain skills accessible to Codex without maintaining another copy of them.

## Sources and adaptations

| Existing configuration | Codex support |
| --- | --- |
| Root `CLAUDE.md` | Root `AGENTS.md` explicitly loads the shared guide and supplies current checkout corrections. |
| Package-local `CLAUDE.md` / `AGENTS.md` | Read when working in the owning package; preserve submodule boundaries. |
| `.opencode/skills/` (41 skills) | One relative directory symlink per skill under `.agents/skills/`; supporting files remain accessible. |
| `.claude/skills/`, `.grok/skills/` | Every root skill name is present in the OpenCode catalog; overlapping `SKILL.md` contents match at review time. |
| `.claude/settings.local.json` | Contains only permissions, including shell/read/search/skill tools and an IDE diagnostics permission. No hooks, agents, or MCP server definitions are configured there. |
| Existing Codex user skills | `up`, `design`, `backlog`, and `librarian` are available in the reviewed session for their respective workflows. These user installations are not shipped by this repository. |
| Yarn / Foundry / Playwright workflows | Use the installed CLI tools and repository scripts directly. |

The extra reference files in the Grok copy of `manamesh-ui-tx-testing` duplicate
the IndexedEx references already available via `indexedex-ui-tx-testing`; its
`SKILL.md` matches the OpenCode version. That skill links to IndexedEx by name.

## Corrections and constraints

- Frontend: `@cyotee/manamesh`, not the historical `@manamesh/frontend`.
- Shared crypto: `@cyotee/boardgameio-crypto`, not the historical
  `@manamesh/boardgameio-crypto` used in older skill examples.
- Platform paths are under `packages/manamesh/packages/`; extracted games and
  shared crypto are top-level packages. Use actual manifests/imports to resolve
  stale documentation rather than copying outdated examples verbatim.
- Frontend `test` invokes Vitest without `run`; use `test:run` for a finite check.
- Timestreams defaults to manual join codes. Host execution of moves does not
  replace player authentication or cryptographic validation.
- Root discovery does not install the hundreds of skills inside vendored Crane
  dependencies. Read those dependencies' local instructions/skills when the task
  concerns them. Start Codex at the outer monorepo root for this configuration;
  an independently opened submodule has its own Git root and discovery scope.

## Maintenance

```sh
python3 scripts/sync-agent-skills.py --check
python3 scripts/sync-agent-skills.py --write
```

The sync command adds missing links and refuses to overwrite conflicting paths.
It reports broken or unmapped links for manual review. Edit source skills under
`.opencode/skills/`, keeping other agents' existing copies synchronized according
to their own workflow. All Codex links are relative and portable with the repo.

At review time, these pre-existing source directories were untracked:
`ethskills-wallets`, `indexedex-ui-tx-testing`, and `manamesh-ui-tx-testing`
(in all three agent catalogs). They work locally. When committing this setup,
include the intended source skill files as well as the links so a fresh checkout
does not receive dangling links. No files were staged or committed by this setup.

## Verification and limits

The reviewed environment has Node 22.23.1, Yarn 4.11.0, Foundry 1.5.1, and
Codex CLI 0.153.4. `cast` and `anvil` are also on PATH. Skill-link validation
checks all 41 destinations against their source directories; a repeat sync
should create zero links. No application code, dependency installation, or
application test run is required for this configuration change.

An instruction file cannot supply Claude's `mcp__ide__getDiagnostics` tool,
transfer its permission grants, or create a browser MCP connection. Use the
available diagnostics and Playwright CLI instead. Browser binaries, authenticated
services, RPC endpoints, and live settlement are validated when needed by a task;
this review does not claim they were exercised. No root MCP server configuration
or custom agent/hook definitions were found to migrate.

Official documentation confirms [repository skill discovery and symlink support](https://learn.chatgpt.com/docs/build-skills)
and [AGENTS.md instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
Restart Codex to load the new root instructions in a fresh session. If skills
have not refreshed, restart or read their source `SKILL.md` directly in the
current session.
