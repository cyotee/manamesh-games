# Task 3 Report: Mistborn early rules engine — green tests

**Status:** DONE  
**Date:** 2026-07-21  
**Commit:** `5ded071` — `fix(mistborn): burn-limit/sideways and coin validation for early rules tests`

## Summary

Green early rules-engine tests for `@manamesh/mistborn-deckbuilder` by fixing two confirmed root causes:

1. **Buy cost false green** — default `boxingsAvailable: 14` and funding+coin double-count made cost-3 buys look affordable.
2. **Sideways play false red** — burn-limit gate applied to all `playCard` before sideways short-circuit.

Incomplete-pack hardening in `createInitialState` (filter null starters / market fallback) was already present as WIP and retained.

## Changes

### `packages/mistborn-deckbuilder/src/game.test.ts`

Replaced weak / conditional assertions with fixtures that pin the bugs:

| Test | Behavior locked in |
|------|--------------------|
| `computeCoins counts funding and coin tags without double-count` | funding-1 + coinshot + boxings=4 → exact total (no funding double-count) |
| `validateMove blocks buy when not enough coins` | empty play, `boxingsAvailable=0` → cost-3 buy invalid with `/coin/i` error |
| `buy respects coinsSpent against cost` | single funding (1 coin), coinsSpent 0 then 1 → both fail cost 3 |
| `playCard sideways allowed when required metal already burned` | burnLimit=1 + pewter burned → sideways OK; vertical fails with metal/burn error |

### `packages/mistborn-deckbuilder/src/game.ts`

**`validateMove` burn-limit scope**

- Before: `burnMetal || playCard || useAsMetal` all hit the burn-limit gate first.
- After: only `burnMetal || useAsMetal`.
- `playCard` with `sideways=true` returns valid without requiring unburned metal or free burn slots.
- Vertical `playCard` still requires an unburned metal of the card’s type.

**`computeCoins` no double-count**

- Coin-tag / “gain coin” effects count once (`coinValue` or cost heuristic or 1).
- Funding (+1) applies only when the card was not already counted as a coin card.
- Boxings still contribute `Math.min(2, floor(boxings/2))`; tests zero them when asserting pure play-zone coins.

**Kept:** incomplete-pack starter/market fallback in `createInitialState` (filter `Boolean`, fall back to raw pack entries).

## Test results

```text
yarn workspace @manamesh/mistborn-deckbuilder test

Test Files  2 passed (2)
Tests       8 passed (8)
  - src/game.test.ts   (6)
  - src/crypto.test.ts (2)
```

Crypto tests remained green (Task 2 keychain path unchanged).

## Coin semantics note

Mock `coinshot` has `cost: 2` and a coin tag. Without `coinValue`, the heuristic uses cost → 2 coins. With boxings=4 (+2) and funding-1 as coin-only (+1, no extra funding), total is **5**, not 4. Tests assert that exact total.

## Out of scope (not done)

- One Piece keychain (Task 4)
- Full Mistborn rules engine / production buy/burn move logic beyond validation
- Changing default `boxingsAvailable: 14` in initial state (tests zero it explicitly)

## Commit

```bash
git add packages/mistborn-deckbuilder/src/game.ts packages/mistborn-deckbuilder/src/game.test.ts
git commit -m "fix(mistborn): burn-limit/sideways and coin validation for early rules tests"
# → 5ded071
```

Only mistborn-deckbuilder source files were committed (vitest `results.json` left unstaged).
