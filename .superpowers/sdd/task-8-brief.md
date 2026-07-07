### Task 8: Home-era assignment (selectable + cryptographically-fair random)

**Files:**
- Create: `packages/timestreams/src/homeEra.ts`
- Test: `packages/timestreams/src/homeEra.test.ts`

**Interfaces:**
- Consumes: `ERA_ORDER`, `EraId`, `TimestreamsState` from `./types`; `deterministicShuffle`, `sha256Hex` from `@manamesh/boardgameio-crypto`.
- Produces:
  - `claimHomeEra(G, playerId, era): boolean` — selectable mode; rejects (returns false) if `era` already claimed by another player or player is `ready`; otherwise sets `players[playerId].homeEra = era`.
  - `setReady(G, playerId, ready): void`.
  - `allReadyWithDistinctEras(G): boolean` — true iff every player `ready` and home eras are all set and distinct.
  - `assignRandomHomeEras(G, finalSeedHex): void` — `deterministicShuffle(ERA_ORDER.slice(), finalSeedHex)` then assign the first `playerOrder.length` distinct eras to players in `playerOrder` order.
  - `homeEraTurnOrder(G): string[]` — player ids sorted by `ERA_ORDER.indexOf(homeEra)` ascending.
  - `dayFirstPlayer(G, day): string` — `order = homeEraTurnOrder(G); return order[(day - 1) % order.length]`.

- [x] **Step 1: Write the failing test** (completed)

- [x] **Step 2: Run test to verify it fails** (completed — module not found)

- [x] **Step 3: Write `src/homeEra.ts`** (completed)

Implement each Produces function exactly as specified. `assignRandomHomeEras` uses `deterministicShuffle([...ERA_ORDER], finalSeedHex)` and assigns `shuffled[i]` to `playerOrder[i]`.

- [x] **Step 4: Run test to verify it passes** (5 tests)

- [x] **Step 5: Commit** (strict partial)

```bash
git add packages/timestreams/src/homeEra.ts packages/timestreams/src/homeEra.test.ts
git commit -m "feat(timestreams): selectable + cryptographically-fair home-era assignment"
```
