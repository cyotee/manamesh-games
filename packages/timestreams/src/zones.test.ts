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
