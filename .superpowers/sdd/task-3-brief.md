### Task 3: Mistborn early rules engine — green tests

**Files:**
- Modify: `packages/mistborn-deckbuilder/src/game.ts` (`validateMove`, possibly `computeCoins`)
- Modify: `packages/mistborn-deckbuilder/src/game.test.ts`
- Keep: incomplete-pack hardening already in `createInitialState` (filter null starters / market fallback)
- Test: `yarn workspace @manamesh/mistborn-deckbuilder test`

**Interfaces:**
- Consumes: `setPackCardsForValidation`, `createInitialState`, `validateMove`, `computeCoins`
- Produces: deterministic validation for buy/play with mock packs; all tests in `game.test.ts` pass

**Root causes (confirmed 2026-07-21):**

1. **Buy cost check false green:** `createInitialState` sets `boxingsAvailable: 14` → `computeCoins` adds `Math.min(2, floor(14/2)) = 2` even with empty play zone. Funding mock with both `tags: ['coin']` and `cardType: 'funding'` can double-count. Tests that leave default boxings can afford a cost-3 card “for free.”
2. **Sideways play false red:** `validateMove` applies the burn-limit gate to **all** `playCard` moves before sideways short-circuit. Burning one metal with `burnLimit === 1` makes **sideways** fail with `Burn limit reached` even though sideways is defined as “card provides its own metal.”

- [ ] **Step 1: Add focused failing tests (make expectations explicit)**

In `game.test.ts`, replace / extend the two weak cases with fixtures that pin the bugs:

```ts
it("validateMove blocks buy when not enough coins", () => {
  const state = createInitialState({
    numPlayers: 2,
    playerIDs: ["p0", "p1"],
    packCards: mockPackCards as any,
  });
  state.zones.play = { p0: [], p1: [] };
  state.boxingsAvailable = 0;
  state.coinsSpent = { p0: 0, p1: 0 };
  state.market = ["market-foo"];
  state.currentPlayer = "p0";

  const res = validateMove(state, "buyCard", "p0", "market-foo");
  expect(res.valid).toBe(false);
  expect(res.error).toMatch(/coin/i);
});

it("buy respects coinsSpent against cost", () => {
  const state = createInitialState({
    numPlayers: 1,
    playerIDs: ["p0"],
    packCards: mockPackCards as any,
  });
  state.boxingsAvailable = 0;
  state.zones.play = { p0: [{ id: "funding-1" }] };
  state.market = ["market-foo"];
  state.coinsSpent = { p0: 0 };
  state.currentPlayer = "p0";

  // funding-1 alone must be < 3 after Task 3 computeCoins semantics
  expect(computeCoins(state, "p0")).toBeLessThan(3);

  let res = validateMove(state, "buyCard", "p0", "market-foo");
  expect(res.valid).toBe(false);

  state.coinsSpent.p0 = 1;
  res = validateMove(state, "buyCard", "p0", "market-foo");
  expect(res.valid).toBe(false);
});

it("playCard sideways allowed when required metal already burned", () => {
  const state = createInitialState({
    numPlayers: 1,
    playerIDs: ["p0"],
    packCards: mockPackCards as any,
  });
  state.currentPlayer = "p0";
  state.zones.hand.p0 = [{ id: "pewter-card" }];
  const pewter = state.players.p0.metals.find((m: any) => m.metal === "pewter");
  pewter.burned = true;
  // burnLimit stays 1; one metal burned

  const resSide = validateMove(state, "playCard", "p0", "pewter-card", true);
  expect(resSide.valid).toBe(true);

  const resNormal = validateMove(state, "playCard", "p0", "pewter-card", false);
  expect(resNormal.valid).toBe(false);
  expect(resNormal.error).toMatch(/metal|burn/i);
});
```

- [ ] **Step 2: Run tests — expect sideways and/or buy still failing before code fix**

```bash
yarn workspace @manamesh/mistborn-deckbuilder test src/game.test.ts
```

Expected: at least one FAIL on sideways and/or buy until Step 3–4 land.

- [ ] **Step 3: Fix `validateMove` burn-limit scope**

In `packages/mistborn-deckbuilder/src/game.ts`, change the early burn-limit gate so sideways `playCard` is not blocked by already-burned metals (sideways uses the card as metal and does not consume an additional burn slot in Phase 1):

```ts
// BEFORE (blocks sideways after any burn when burnLimit is 1)
if (move === "burnMetal" || move === "playCard" || move === "useAsMetal") {
  const currentBurns = (player.metals || []).filter((m: any) => m.burned).length;
  if (currentBurns >= (player.burnLimit || 1)) {
    return { valid: false, error: `Burn limit reached (${player.burnLimit})` };
  }
}

// AFTER
if (move === "burnMetal" || move === "useAsMetal") {
  const currentBurns = (player.metals || []).filter((m: any) => m.burned).length;
  if (currentBurns >= (player.burnLimit || 1)) {
    return { valid: false, error: `Burn limit reached (${player.burnLimit})` };
  }
}

if (move === "playCard") {
  const cardId = args[0];
  const sideways = !!args[1];
  // ... existing meta lookup ...

  if (sideways) {
    // Card provides its own metal; do not require unburned metal and do not
    // treat existing burns as "burn limit reached" for this play style.
    return { valid: true };
  }

  // Vertical play: still respect burn limit if this play would burn a metal.
  // Phase 1: if any metal is already at limit and card requires metal, reject
  // missing metal (existing check) — optional: also reject if burning would
  // exceed limit when implementation starts burning on play.
  // Keep requiredMetal check as today.
}
```

Ensure the **sideways branch still runs after** any turn/player checks, and that vertical `playCard` with missing metal still fails.

- [ ] **Step 4: Fix `computeCoins` double-count + keep boxings explicit in tests**

Prefer test fixtures setting `boxingsAvailable = 0` (Step 1). Additionally fix double-count so a funding card with a `coin` tag does not grant both the coin-tag value and a second funding +1 unless intentional:

```ts
// In computeCoins forEach:
let added = 0;
if (tags.includes("coin") || effect.includes("coin") || /gain\s+\d*\s*coin/.test(effect)) {
  added += meta.coinValue ?? (meta.cost && meta.cost > 0 ? meta.cost : 1);
}
// Funding contributes 1 only if not already counted as a coin card
if ((tags.includes("funding") || cardType === "funding") && added === 0) {
  added += 1;
}
coins += added;
```

Document the rule in a one-line comment above the loop. With this semantics, `funding-1` with only coin tag yields **1** coin when boxings are 0 — insufficient for cost 3.

- [ ] **Step 5: Run full Mistborn package tests**

```bash
yarn workspace @manamesh/mistborn-deckbuilder test
```

Expected:

```text
Test Files  2 passed
Tests       8 passed (or higher if new cases added)
```

Crypto tests must remain green (`src/crypto.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/mistborn-deckbuilder/src/game.ts packages/mistborn-deckbuilder/src/game.test.ts
git commit -m "fix(mistborn): burn-limit/sideways and coin validation for early rules tests"
```

---

