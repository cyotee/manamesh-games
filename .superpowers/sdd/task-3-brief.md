### Task 3: Placeholder deck factory & card schema

**Files:**
- Create: `packages/timestreams/src/deck.ts`
- Test: `packages/timestreams/src/deck.test.ts`

**Interfaces:**
- Consumes: `TimestreamsCard` from `./types`; `CardSchema` from `@manamesh/frontend/src/game/modules/types`.
- Produces:
  - `createPlaceholderDeck(ownerId: string, size: number, actionEvery?: number): TimestreamsCard[]` — `size` cards owned by `ownerId`; every `actionEvery`-th card (default 6) is `cardType: "action"`, the rest `"invention"`; all have `name: "Score 1 Point"`, `scoreEffect: "Score 1 Point"`, and `id` = `${ownerId}-card-${i}`.
  - `timestreamsCardSchema: CardSchema<TimestreamsCard>` — `validate`, `create`, `getAssetKey` (returns `card.id`).

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/deck.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createPlaceholderDeck, timestreamsCardSchema } from "./deck";

describe("placeholder deck factory", () => {
  it("creates owned cards titled 'Score 1 Point'", () => {
    const deck = createPlaceholderDeck("0", 36);
    expect(deck).toHaveLength(36);
    expect(deck[0]).toMatchObject({
      id: "0-card-0", ownerId: "0", name: "Score 1 Point",
      cardType: "invention", scoreEffect: "Score 1 Point",
    });
    expect(new Set(deck.map((c) => c.id)).size).toBe(36);
  });

  it("includes a few inert action cards", () => {
    const deck = createPlaceholderDeck("0", 36, 6);
    const actions = deck.filter((c) => c.cardType === "action");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThan(deck.length);
  });

  it("schema validates and round-trips", () => {
    const card = timestreamsCardSchema.create({ id: "x", name: "Score 1 Point", ownerId: "0" });
    expect(timestreamsCardSchema.validate(card)).toBe(true);
    expect(timestreamsCardSchema.validate({ id: "y" })).toBe(false);
    expect(timestreamsCardSchema.getAssetKey(card)).toBe("x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/deck.test.ts`
Expected: FAIL — cannot resolve `./deck`.

- [ ] **Step 3: Write `src/deck.ts`**

```ts
import type { CardSchema } from "@manamesh/frontend/src/game/modules/types";
import type { TimestreamsCard } from "./types";

export function createPlaceholderDeck(
  ownerId: string, size: number, actionEvery = 6,
): TimestreamsCard[] {
  const deck: TimestreamsCard[] = [];
  for (let i = 0; i < size; i++) {
    const isAction = actionEvery > 0 && i > 0 && i % actionEvery === 0;
    deck.push({
      id: `${ownerId}-card-${i}`,
      name: "Score 1 Point",
      ownerId,
      cardType: isAction ? "action" : "invention",
      scoreEffect: "Score 1 Point",
    });
  }
  return deck;
}

export const timestreamsCardSchema: CardSchema<TimestreamsCard> = {
  validate: (card): card is TimestreamsCard =>
    typeof card === "object" && card !== null &&
    "id" in card && "name" in card && "ownerId" in card && "cardType" in card &&
    ["invention", "action"].includes((card as TimestreamsCard).cardType),
  create: (data) => ({
    id: data.id,
    name: data.name,
    ownerId: (data as Partial<TimestreamsCard>).ownerId ?? "",
    cardType: (data as Partial<TimestreamsCard>).cardType ?? "invention",
    trait: (data as Partial<TimestreamsCard>).trait,
    scoreEffect: (data as Partial<TimestreamsCard>).scoreEffect ?? "Score 1 Point",
  }),
  getAssetKey: (card) => card.id,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/deck.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/deck.ts packages/timestreams/src/deck.test.ts
git commit -m "feat(timestreams): placeholder deck factory and card schema"
```

---

