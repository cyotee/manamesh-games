### Task 5: Cross-package verification gate

**Files:** none (verification only)

- [ ] **Step 1: Run dependency and game suites**

```bash
yarn workspace @cyotee/boardgameio-crypto test
yarn workspace @manamesh/poker test
yarn workspace @manamesh/timestreams test
yarn workspace @manamesh/onepiece test
yarn workspace @manamesh/mistborn-deckbuilder test
```

Expected all exit 0.

- [ ] **Step 2: Regression greps**

```bash
# No deep src imports in game packages
rg -n "from ['\"]@cyotee/manamesh/src/" \
  packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder \
  --glob '**/*.{ts,tsx}'

# One Piece uses keychain APIs
rg -n "keychainAdd|requirePrivateKeyMatchesPublished|MENTAL_POKER_KEYCHAIN_POLICY" \
  packages/onepiece/src/crypto.ts
```

Expected: first command empty; second command ≥ 1 hit each pattern.

- [ ] **Step 3: Optional frontend smoke (only if export changes break SPA)**

```bash
yarn workspace @cyotee/manamesh test:run
# or a single targeted vitest if full suite is heavy
```

If SPA build is required for publish readiness:

```bash
yarn workspace @cyotee/manamesh build
```

Only run build if Task 1 touched dist generation; skip if source-only exports.

- [ ] **Step 4: Final commit only if verification fixed stragglers; else stop**

No empty commits. If greps/tests fail, fix in the owning task and re-run this gate.

---

## Testing matrix (definition of done)

| Check | Command | Pass criteria |
|-------|---------|---------------|
| Crypto leaf | `yarn workspace @cyotee/boardgameio-crypto test` | all pass |
| Poker | `yarn workspace @manamesh/poker test` | all pass |
| Timestreams | `yarn workspace @manamesh/timestreams test` | all pass |
| One Piece | `yarn workspace @manamesh/onepiece test` | all pass, including deckResolver + keychain cases |
| Mistborn | `yarn workspace @manamesh/mistborn-deckbuilder test` | all pass (crypto + rules) |
| Import hygiene | grep `@cyotee/manamesh/src/` in four games | zero hits |
| Keychain parity | grep keychain APIs in onepiece crypto | present |

---

## Risk notes

| Risk | Mitigation |
|------|------------|
| Subpath exports work in monorepo but not in published `dist` | Task 1 can stay source-mapped for monorepo; follow-up publish task can dual-map `import`→dist and `types`→.d.ts without changing public specifier names |
| PokerBoard deep imports pull React/UI into typecheck of pure packages | Prefer type-only imports where possible; do not move board files into crypto packages |
| Canonical pubkey breaks equality checks in One Piece UI | Prefer `publicKeysEqual` / normalize at boundaries; update tests in Task 4 Step 5 |
| Mistborn coin semantics change gameplay balance | Keep Phase 1 simple; document funding-vs-coin rule in comment; tests pin behavior |

---

## Self-review (plan quality)

1. **Spec coverage:** Export surface + migration + Mistborn rules failures + One Piece keychain lag + final verification — each has a task.
2. **Placeholders:** None intentional; export paths must be confirmed against real files in Task 1 Step 2 (adjust map if filenames differ).
3. **Type consistency:** Keychain APIs use the same names as Poker/Mistborn (`keychainAdd`, `MENTAL_POKER_KEYCHAIN_POLICY`, `requirePrivateKeyMatchesPublished`). Manamesh subpaths use stable names without `/src/`.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-21-game-packages-followup-fixes.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration (`superpowers:subagent-driven-development`)
2. **Inline Execution** — execute tasks in this session with checkpoints (`superpowers:executing-plans`)

**Suggested order if parallelizing humans/agents:** Task 3 (Mistborn) can run in parallel with Task 1; Task 2 waits on Task 1; Task 4 can start after Task 2’s One Piece import migration (or in parallel if imports already resolve); Task 5 last.
