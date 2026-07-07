# Task 8 Report — Home-era assignment (selectable + cryptographically-fair random)

## Functions Implemented in `packages/timestreams/src/homeEra.ts`

| Export | Purpose |
|---|---|
| `claimHomeEra(G, playerId, era)` | Selectable UI claim; prevents dups and changes after ready. |
| `setReady(G, playerId, ready)` | Marks player ready (used by lobby + game setup). |
| `allReadyWithDistinctEras(G)` | Gate for advancing from setup when using selectable. |
| `assignRandomHomeEras(G, finalSeedHex)` | Uses `deterministicShuffle` on era list for fair assignment; respects playerOrder. |
| `homeEraTurnOrder(G)` | Chronological sort by ERA_ORDER index (earliest era first). |
| `dayFirstPlayer(G, day)` | Rotates first player each day using the turn order. |

## Design Notes
- `assignRandomHomeEras` shuffles a **copy** of ERA_ORDER and takes prefix N to guarantee distinct eras.
- Turn order is derived purely from assigned `homeEra` values + ERA_ORDER; no reliance on player join order.
- `dayFirstPlayer` uses modulo rotation for 6 days.
- No direct use of eraAssignmentRng here — the RNG state lives in G (Task 6/7 scaffolding); actual commit/reveal for random home era assignment will be wired in game.ts (Task 11) using these helpers + the existing shuffle seed machinery (or dedicated eraAssignmentRng).

## TDD Evidence

### RED
```
yarn workspace @manamesh/timestreams test src/homeEra.test.ts
→ Failed to load url ./homeEra (module not found)
```

### GREEN
```
yarn workspace @manamesh/timestreams test src/homeEra.test.ts
✓ src/homeEra.test.ts  (5 tests) 8ms
Test Files  1 passed (1)
Tests  5 passed (5)
```

## Commit
```
commit 8feaf2723983ecf89a35b4648f9592513365b283
packages/timestreams/src/homeEra.test.ts | 53 ++++++++++++++++++++++++++
packages/timestreams/src/homeEra.ts      | 65 ++++++++++++++++++++++++++++++++
2 files changed, 118 insertions(+)
```
Only the two target files. ✓ (via `git commit -m "..." -- paths`)

## Integration Points (for later tasks)
- Used by: setup phase (selectable claims + ready gate), random path (via eraAssignmentRng finalize), play phase turn order, scoring tie-breakers (Task 10).
- State already had `homeEra`, `eraAssignmentRng` slots from Task 1/6.
- Will be consumed by Task 9 (endDay), Task 11 (game phases), Task 14 (lobby).

## Concerns
- None blocking. The random path in full game will need wiring of `commitEraSeed`/`revealEraSeed` moves (analogous to shuffle) that call `assignRandomHomeEras` on final seed. Out of scope for this pure helper task.
