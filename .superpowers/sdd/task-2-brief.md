### Task 2: Timeline helpers (pure)

**Files:**
- Create: `packages/timestreams/src/timeline.ts`
- Test: `packages/timestreams/src/timeline.test.ts`

**Interfaces:**
- Consumes: `ERA_ORDER`, `EraId`, `EraState`, `TimestreamsState`, `TimestreamsConfig` from `./types`.
- Produces:
  - `createTimeline(): Record<EraId, EraState>` — every era with an empty `stack`.
  - `eraForDay(day: number): EraId` — `day` is 1-indexed; throws `RangeError` if `day < 1 || day > 6`.
  - `dayForEra(era: EraId): number` — inverse, 1-indexed.
  - `appendToEra(timeline: Record<EraId, EraState>, era: EraId, cardId: string): void` — pushes onto `stack`.
  - `scoringSlotCardIds(era: EraState, scoringSlots: number): string[]` — first `scoringSlots` ids of `stack`.
  - `isLastDay(day: number): boolean` — `day === 6`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/timeline.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  createTimeline, eraForDay, dayForEra, appendToEra, scoringSlotCardIds, isLastDay,
} from "./timeline";

describe("timeline helpers", () => {
  it("creates six empty era stacks", () => {
    const t = createTimeline();
    expect(Object.keys(t)).toHaveLength(6);
    expect(t.stone.stack).toEqual([]);
    expect(t.future.id).toBe("future");
  });

  it("maps days to eras 1-indexed", () => {
    expect(eraForDay(1)).toBe("stone");
    expect(eraForDay(6)).toBe("future");
    expect(dayForEra("renaissance")).toBe(3);
    expect(() => eraForDay(0)).toThrow(RangeError);
    expect(() => eraForDay(7)).toThrow(RangeError);
  });

  it("appends cards and reads scoring slots", () => {
    const t = createTimeline();
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) appendToEra(t, "stone", id);
    expect(t.stone.stack).toHaveLength(7);
    expect(scoringSlotCardIds(t.stone, 6)).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("flags the last day", () => {
    expect(isLastDay(6)).toBe(true);
    expect(isLastDay(5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/timeline.test.ts`
Expected: FAIL — cannot resolve `./timeline`.

- [ ] **Step 3: Write `src/timeline.ts`**

```ts
import { ERA_ORDER, type EraId, type EraState } from "./types";

export function createTimeline(): Record<EraId, EraState> {
  const t = {} as Record<EraId, EraState>;
  for (const id of ERA_ORDER) t[id] = { id, stack: [] };
  return t;
}

export function eraForDay(day: number): EraId {
  if (day < 1 || day > ERA_ORDER.length) {
    throw new RangeError(`day out of range: ${day}`);
  }
  return ERA_ORDER[day - 1];
}

export function dayForEra(era: EraId): number {
  return ERA_ORDER.indexOf(era) + 1;
}

export function appendToEra(
  timeline: Record<EraId, EraState>, era: EraId, cardId: string,
): void {
  timeline[era].stack.push(cardId);
}

export function scoringSlotCardIds(era: EraState, scoringSlots: number): string[] {
  return era.stack.slice(0, scoringSlots);
}

export function isLastDay(day: number): boolean {
  return day === ERA_ORDER.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/timeline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/timeline.ts packages/timestreams/src/timeline.test.ts
git commit -m "feat(timestreams): pure timeline/era helpers"
```

---

