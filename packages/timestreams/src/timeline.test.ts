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
