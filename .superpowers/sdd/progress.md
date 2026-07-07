# Timestreams M1 — Progress Ledger

Plan: packages/timestreams/PLAN_M1.md
Branch: feat/manamesh-crypto-and-poker-contracts
Task 0 BASE: d0b76ec997cbaa47ee428d5959be0a6889b7ef2e

## Status
(append one line per completed task: "Task N: complete (commits <base7>..<head7>, review clean)")
Task 0: complete (commits d0b76ec..e53564e, review clean after commit-scope fix)

## NOTE FOR ALL TASKS
Repo index has a pre-existing STAGED crypto rename (packages/crypto -> packages/boardgameio-crypto, ~42 files).
Implementers MUST commit with: `git add <timestreams paths>` then `git commit -- <same paths>` (partial commit),
NEVER a bare `git commit`, or the staged rename gets swept in. BASE for next task = current HEAD.
Task 1: complete (commits e53564e..f7b66fc, review clean; MINOR: types.test.ts does not assert DEFAULT_CONFIG.proofChainEnabled — brief-spec gap, triage at final review)
Task 2: complete (commits f7b66fc..eeff479, review clean)

## NOTE (during Task 3): the pre-existing crypto rename was UNSTAGED by an implementer.
Working-tree content is fully intact (packages/boardgameio-crypto exists, packages/crypto removed).
Only index staging changed (was staged, now unstaged). User can re-stage with `git add -A`.
Partial-commit method (`git commit -- <paths>`) still used for all tasks.
Task 3: complete (commits eeff479..b076b3f, review clean; MINOR/noted: deck mix only guaranteed at default size=36/actionEvery=6 — the only config M1 uses; guard would be YAGNI; triage at final review)
Task 4: complete (commits b076b3f..835d731, review clean)
Task 5: complete (commits 835d731..5449dfc, review clean; fixed Important first-proof-hash gap with TDD tamper test; MINOR/noted: module-level proofCounter — fine under vitest; NOTE: same first-proof-hash bug exists in packages/onepiece/src/proofChain.ts, out of scope)

## ENV CONSTRAINT (discovered at Task 6): boardgame.io/core and boardgame.io/client do NOT resolve under vitest+PnP (baseline; onepiece crypto/game tests fail to load too).
Resolution for remaining tasks:
- Centralize INVALID_MOVE as a local const: `export const INVALID_MOVE = "INVALID_MOVE" as const;` (value-identical to boardgame.io's, interoperable when the game runs in the real app). Plan to add src/bgio.ts in Task 9 and have crypto.ts/play.ts/game.ts import from it.
- Use `import type { Game, Ctx } from "boardgame.io"` (type-only, erased — resolves fine).
- Task 11 game.test.ts MUST NOT import `boardgame.io/client` (Client) at runtime — test the Game object structure directly (name, Object.keys(phases)) and via TimestreamsGame.setup(...). Update PLAN_M1.md Tasks 11/12 before dispatching them.
Task 6: complete (commits 5449dfc..9ca219b, review clean; fixed 2 Important: added submitPublicKey guard-path tests + _ctx rename; MINOR/noted: truthiness null-guard, dedup comment; NOTE: ERR_INVALID_ARG_TYPE printed during test collection = baseline PnP/dep-load noise, suite passes)

## CRITICAL (Task 7): sha256Hex(seedString) is non-binding — sha256Hex expects Uint8Array; passing a hex string hashes empty input => ALL same-length strings collide. Breaks commit-reveal shuffle binding (fairness). Confirmed empirically. Fixing in timestreams by hashing seed BYTES. SAME BUG in packages/onepiece AND packages/poker commit-reveal (out of scope; flagged to user).

Task 7: complete (commits 2c406b7..f767080, review clean; CRITICAL binding bug fixed with TDD regression test + hashSeedCommit using TextEncoder; secondary ID concern noted but unchanged)
Task 8: complete (commits f767080..8feaf27, review n/a yet; selectable claim + ready + allReady + deterministic random assign + turn order + dayFirstPlayer)
Task 9: complete (commits 8feaf27..37e924e; playInvention / playAction / pass / endDay + day advance + dealForDay integration; fixture hardened for tolerance)
Task 10: complete (commits 37e924e..57ac5e9; cardOwner + resolveScoring with home-era tiebreak; 2 tests)

Current BASE (post Task 10): 57ac5e9
Next: Task 11 (game.ts + module + bgio wiring — note per earlier: avoid boardgame.io/client import in game.test; update PLAN if dispatching)

**2026-06-26 Decision session (via ask_user_question tool):**
- Primary: Full Timestreams M1 completion (Tasks 0-15 priority).
- Workflow: Hybrid (strict SDD for major/architectural tasks like Task 11+).
- Before Task 11: Updated PLAN_M1.md + PRD.md with all decisions (INVALID_MOVE, imports, voided, loadDecks, etc.).
- Additional work: Fix sha256Hex binding bug in packages/poker and packages/onepiece (confirmed high value).
- PRD.md now contains "Implementation Decisions & Constraints" section; PLAN has "Recorded Decisions".
- See updated packages/timestreams/PRD.md and PLAN_M1.md for full details.
