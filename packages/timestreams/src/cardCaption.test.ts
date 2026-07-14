import { describe, it, expect } from "vitest";
import { displaySubtypes, formatCardCaption } from "./types";

describe("formatCardCaption / displaySubtypes", () => {
  it("shows type · semantic subtypes · score (drops name slug)", () => {
    expect(
      formatCardCaption({
        name: "Anarchy",
        cardType: "invention",
        subtypes: ["anarchy", "government"],
        scoreValue: 3,
      }),
    ).toBe("Invention · Government · 3 pts");
  });

  it("shows art subtype for Cave Paintings", () => {
    expect(
      formatCardCaption({
        name: "Cave Paintings",
        cardType: "invention",
        subtypes: ["cave-paintings", "art"],
        scoreValue: 2,
      }),
    ).toBe("Invention · Art · 2 pts");
  });

  it("actions without score omit pts", () => {
    expect(
      formatCardCaption({
        name: "Big Rock",
        cardType: "action",
        subtypes: ["big-rock"],
      }),
    ).toBe("Action");
  });

  it("displaySubtypes drops only the name slug", () => {
    expect(
      displaySubtypes({
        name: "Anarchy",
        subtypes: ["anarchy", "government"],
      }),
    ).toEqual(["government"]);
    expect(
      displaySubtypes({ name: "Fire", subtypes: ["fire"] }),
    ).toEqual([]);
  });

  it("can include era label for prompt grids", () => {
    expect(
      formatCardCaption(
        {
          name: "Fire",
          cardType: "invention",
          subtypes: ["fire"],
          scoreValue: 2,
        },
        { eraLabel: "Stone Age" },
      ),
    ).toBe("Invention · Stone Age · 2 pts");
  });
});
