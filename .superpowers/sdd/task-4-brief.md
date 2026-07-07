### Task 4: Zone definitions

**Files:**
- Create: `packages/timestreams/src/zones.ts`
- Test: `packages/timestreams/src/zones.test.ts`

**Interfaces:**
- Consumes: `ZoneDefinition` from `@manamesh/frontend/src/game/modules/types`.
- Produces:
  - `TIMESTREAMS_ZONES: ZoneDefinition[]` — `deck` (hidden, ordered, `["shuffle","draw"]`), `hand` (owner-only, `["play","reveal"]`), `timeline` (public, shared, ordered, `["play"]`), `discard` (public, ordered, `["search"]`), `scorePile` (public, `[]`).
  - `ZONE_IDS` const map; `getZoneById(id: string): ZoneDefinition | undefined`.

- [ ] **Step 1: Write the failing test**

`packages/timestreams/src/zones.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TIMESTREAMS_ZONES, ZONE_IDS, getZoneById } from "./zones";

describe("zones", () => {
  it("defines the five timestreams zones", () => {
    expect(TIMESTREAMS_ZONES.map((z) => z.id).sort()).toEqual(
      ["deck", "discard", "hand", "scorePile", "timeline"],
    );
  });
  it("deck is hidden and ordered; timeline is public and shared", () => {
    expect(getZoneById("deck")).toMatchObject({ visibility: "hidden", ordered: true });
    expect(getZoneById("timeline")).toMatchObject({ visibility: "public", shared: true });
  });
  it("exposes ZONE_IDS constants", () => {
    expect(ZONE_IDS.DECK).toBe("deck");
    expect(ZONE_IDS.TIMELINE).toBe("timeline");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @manamesh/timestreams test src/zones.test.ts`
Expected: FAIL — cannot resolve `./zones`.

- [ ] **Step 3: Write `src/zones.ts`**

Mirror `packages/onepiece/src/zones.ts`. Define `TIMESTREAMS_ZONES` with the five zones above, the `ZONE_IDS` const (`DECK`, `HAND`, `TIMELINE`, `DISCARD`, `SCORE_PILE`), and `getZoneById`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @manamesh/timestreams test src/zones.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/timestreams/src/zones.ts packages/timestreams/src/zones.test.ts
git commit -m "feat(timestreams): zone definitions"
```

---

