# Task 5 Report: Cross-package verification gate

**Date:** 2026-07-21  
**Branch:** main  
**Status:** DONE  
**Commits:** none (verification only; no stragglers to fix)

---

## Summary

All definition-of-done matrix checks passed. No code changes required.

| Check | Result |
|-------|--------|
| `@cyotee/boardgameio-crypto` tests | PASS — 149/149 |
| `@manamesh/poker` tests | PASS — 314/314 |
| `@manamesh/timestreams` tests | PASS — 547/547 |
| `@manamesh/onepiece` tests | PASS — 238/238 |
| `@manamesh/mistborn-deckbuilder` tests | PASS — 8/8 |
| Import hygiene (`@cyotee/manamesh/src/`) | PASS — zero hits |
| One Piece keychain parity | PASS — all three APIs present |

**Grand total:** 1,256 tests passed across 5 packages.

Optional manamesh frontend build/test was **skipped** (source-only exports; SPA smoke not required for this gate).

---

## Step 1: Dependency and game suites

### 1. `yarn workspace @cyotee/boardgameio-crypto test`

- **Exit code:** 0
- **Summary:**
  ```
  Test Files  9 passed (9)
       Tests  149 passed (149)
    Duration  26.39s
  ```

### 2. `yarn workspace @manamesh/poker test`

- **Exit code:** 0
- **Summary:**
  ```
  Test Files  19 passed (19)
       Tests  314 passed (314)
    Duration  192.46s
  ```

### 3. `yarn workspace @manamesh/timestreams test`

- **Exit code:** 0
- **Summary:**
  ```
  Test Files  81 passed (81)
       Tests  547 passed (547)
    Duration  179.49s
  ```

### 4. `yarn workspace @manamesh/onepiece test`

- **Exit code:** 0
- **Summary:**
  ```
  Test Files  8 passed (8)
       Tests  238 passed (238)
    Duration  35.93s
  ```
- Includes `deckResolver` (26) and keychain cases in `crypto.test.ts` (11).

### 5. `yarn workspace @manamesh/mistborn-deckbuilder test`

- **Exit code:** 0
- **Summary:**
  ```
  Test Files  2 passed (2)
       Tests  8 passed (8)
    Duration  27.40s
  ```
- Files: `src/game.test.ts` (6), `src/crypto.test.ts` (2).

---

## Step 2: Regression greps

### Import hygiene

```bash
rg -n "from ['\"]@cyotee/manamesh/src/" \
  packages/poker packages/timestreams packages/onepiece packages/mistborn-deckbuilder \
  --glob '**/*.{ts,tsx}'
```

- **Exit code:** 1 (no matches — expected for empty result)
- **Output:** empty
- **Pass criteria:** zero hits ✓

### One Piece keychain APIs

```bash
rg -n "keychainAdd|requirePrivateKeyMatchesPublished|MENTAL_POKER_KEYCHAIN_POLICY" \
  packages/onepiece/src/crypto.ts
```

- **Exit code:** 0
- **Hits:**
  - `keychainAdd`: 2
  - `requirePrivateKeyMatchesPublished`: 2
  - `MENTAL_POKER_KEYCHAIN_POLICY`: 4
- **Pass criteria:** ≥ 1 hit each pattern ✓

Representative lines:
```
41:  keychainAdd,
42:  MENTAL_POKER_KEYCHAIN_POLICY,
43:  requirePrivateKeyMatchesPublished,
274:    MENTAL_POKER_KEYCHAIN_POLICY,
276:  const admitted = keychainAdd(
280:    MENTAL_POKER_KEYCHAIN_POLICY,
339:  if (!requirePrivateKeyMatchesPublished(privateKey, published)) {
```

---

## Step 3: Optional frontend smoke

**Skipped.** Task brief: only run if export changes break SPA or Task 1 touched dist generation. Source-only export path; gate criteria do not require `@cyotee/manamesh` build/test.

---

## Step 4: Commit

**No commit.** All checks green; no straggler fixes.

---

## Notes / non-blocking noise

- Several packages emit `web-worker` stderr during collect (`TypeError: The "id" argument must be of type string. Received undefined` under Yarn PnP). Tests still pass; not treated as failures.
- Poker/timestreams suites are long (~3 min each when run alone); first parallel attempt under a 5-minute wrapper timed out mid-run; sequential full runs completed cleanly with exit 0.

---

## Definition of done matrix (final)

| Check | Command | Pass criteria | Result |
|-------|---------|---------------|--------|
| Crypto leaf | `yarn workspace @cyotee/boardgameio-crypto test` | all pass | **149 passed, exit 0** |
| Poker | `yarn workspace @manamesh/poker test` | all pass | **314 passed, exit 0** |
| Timestreams | `yarn workspace @manamesh/timestreams test` | all pass | **547 passed, exit 0** |
| One Piece | `yarn workspace @manamesh/onepiece test` | all pass, incl. deckResolver + keychain | **238 passed, exit 0** |
| Mistborn | `yarn workspace @manamesh/mistborn-deckbuilder test` | all pass | **8 passed, exit 0** |
| Import hygiene | grep `@cyotee/manamesh/src/` in four games | zero hits | **0 hits** |
| Keychain parity | grep keychain APIs in onepiece crypto | present | **all three present** |
