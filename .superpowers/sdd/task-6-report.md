# Task 6 Report: Crypto Initial State + Key Exchange

## What Was Adapted from onepiece

### createCryptoInitialState
Adapted from `packages/onepiece/src/crypto.ts` lines 114–221.

Key differences from onepiece:
- **Per-player decks**: `G.encryptedDecks[playerId]` (array of `{ ciphertext: cardId, layers: 0 }` placeholders) instead of onepiece's shared `encryptedZones`.
- **Placeholder decks**: Uses `createPlaceholderDeck(playerId, deckSize)` from `./deck` for each player; card IDs become the `ciphertext` field.
- **Timeline**: `createTimeline()` from `./timeline` produces the 6-slot `Record<EraId, EraState>`.
- **cardPoints**: Empty (`{}`) — deferred to the encrypt step (onepiece builds this asynchronously in `setup()`).
- **Player shape**: `TimestreamsPlayerState` (`homeEra, ready, hand, discard, scorePile, hasPassedThisDay, publicKey, hasEncrypted, hasShuffled`) replaces onepiece's `OnePieceCryptoPlayerState`.
- **Config**: Merges `DEFAULT_CONFIG` with `moduleConfig` overrides; `dayFirstPlayer` set to `playerOrder[0]`.
- **cardVisibility**: Seeded via `initializeCardVisibility(G, allCardIds)` after state construction.

### submitPublicKey
Adapted from `packages/onepiece/src/crypto.ts` lines 230–271.

Identical in structure: validates phase, checks player existence, guards against double-submission, records key, checks all-submitted condition, then sets `phase = "encrypt"` and `resetSetupPlayer(G)`. Only `G.crypto.publicKeys` dict write was dropped (no `crypto` sub-object in `TimestreamsState`).

## boardgame.io/core Resolution Issue

`boardgame.io` is a workspace package at `packages/boardgame.io` (the raw source). Its `dist/` has not been built, so `boardgame.io/core` fails to resolve under vite+PnP. This is a **known baseline issue** documented in the project memory (`dual-root-yarn-frontend-tests.md`).

Resolution: `INVALID_MOVE` defined locally as `const INVALID_MOVE = "INVALID_MOVE" as const` — semantically identical to the boardgame.io export (confirmed in `packages/boardgame.io/src/core/constants.ts:6`).

## TDD Evidence

### RED (test fails, `crypto.ts` not yet created)
```
$ yarn workspace @manamesh/timestreams test src/crypto.test.ts
FAIL  src/crypto.test.ts
Error: Failed to load url ./crypto (resolved id: ./crypto)...
Test Files  1 failed (1)
Tests  no tests
```

### GREEN (after implementation)
```
$ yarn workspace @manamesh/timestreams test src/crypto.test.ts
✓ src/crypto.test.ts  (2 tests) 46ms
Test Files  1 passed (1)
Tests  2 passed (2)
```
(web-worker stderr noise is from SRA crypto lib attempting Worker in Node — does not affect test results)

## Files Changed
- `packages/timestreams/src/crypto.test.ts` (new) — verbatim from brief
- `packages/timestreams/src/crypto.ts` (new) — implementation

## git show --stat HEAD
```
commit 7ee3fd2bd2fc4477d64ca64b8a18c58e140dc006
    feat(timestreams): crypto initial state and key exchange

 packages/timestreams/src/crypto.test.ts |  32 +++++++
 packages/timestreams/src/crypto.ts      | 150 ++++++++++++++++++++++++++++++++
 2 files changed, 182 insertions(+)
```
Only the 2 specified files appear.

## Self-Review / Deviations

1. **`INVALID_MOVE` import**: Not imported from `boardgame.io/core` (build not available); defined locally as `const INVALID_MOVE = "INVALID_MOVE" as const`. This is semantically correct and unblocks tests. A later task can replace this with the real import once the dist is available.

2. **`dayFirstPlayer`**: Required by `TimestreamsState` but not mentioned in the brief. Set to `playerOrder[0]` (the first player in turn order) as the natural default.

3. **`setupPlayerIndex` not reset by `resetSetupPlayer` in `submitPublicKey`**: The onepiece version calls `resetSetupPlayer(G)` when all keys submitted. This correctly sets `setupPlayerIndex = 0` for the sequential encrypt step. Implemented identically.

4. **No changes to `vitest.config.ts`**: The boardgame.io resolution issue was worked around in the implementation file, keeping the commit to exactly the 2 specified files.

## Concerns

- `boardgame.io/core` cannot be imported under vite+PnP until `packages/boardgame.io` is built. If a future task's test checks for `INVALID_MOVE` returns from `submitPublicKey`, the local definition will need to match the exported value (it does: `'INVALID_MOVE'`).
- The `web-worker` stderr on every test run is cosmetic noise from the elliptic curve library's Worker detection but is distracting.

## Fix: guard-path tests + unused param

### Test Results
```
$ yarn workspace @manamesh/timestreams test src/crypto.test.ts
✓ src/crypto.test.ts  (5 tests) 67ms

Test Files  1 passed (1)
     Tests  5 passed (5)
  Start at  10:34:02
  Duration  3.71s (transform 342ms, setup 0ms, collect 1.63s, tests 67ms, environment 0ms, prepare 335ms)
```

All 5 tests pass: 2 original + 3 new guard-path tests (double-submit, wrong phase, unknown player).

### Commit
```
commit 9ca219b1e4f224e7c1c1dc176d99eaf095ec57f1
Author: cyotee <not_cyotee@proton.me>
Date:   Fri Jun 26 10:34:16 2026 -0700

    test(timestreams): cover submitPublicKey guard paths
    
    Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

 packages/timestreams/src/crypto.test.ts | 15 +++++++++++++++
 packages/timestreams/src/crypto.ts      |  2 +-
 2 files changed, 16 insertions(+), 1 deletion(-)
```

### Changes
1. **crypto.test.ts**: Added 3 guard-path tests asserting `INVALID_MOVE` for double-submit, wrong phase, and unknown player.
2. **crypto.ts**: Renamed unused `ctx` parameter to `_ctx` in `submitPublicKey` signature.
