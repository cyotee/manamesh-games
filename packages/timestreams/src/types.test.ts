import { describe, it, expect } from "vitest";
import { ERA_ORDER, DEFAULT_CONFIG } from "./types";

describe("era constants & defaults", () => {
  it("has six eras in chronological order", () => {
    expect(ERA_ORDER).toEqual([
      "stone", "medieval", "renaissance", "industrial", "modern", "future",
    ]);
    expect(ERA_ORDER).toHaveLength(6);
  });

  it("default config matches the spec", () => {
    expect(DEFAULT_CONFIG.scoringSlots).toBe(6);
    expect(DEFAULT_CONFIG.deckSize).toBe(36);
    expect(DEFAULT_CONFIG.drawTable).toEqual({ 2: 6, 3: 5, 4: 4 });
    expect(DEFAULT_CONFIG.homeEraAssignment).toBe("selectable");
    expect(DEFAULT_CONFIG.deckEncryption).toBe("mental-poker");
  });
});
