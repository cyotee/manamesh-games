import { describe, it, expect } from "vitest";
import {
  initializeCardVisibility, transitionCardVisibility, getCardVisibility,
  isCardVisibleTo, isValidTransition,
} from "./visibility";

function blankState(): any {
  return { cardVisibility: {}, proofChain: [] };
}

describe("visibility state machine", () => {
  it("initializes cards as encrypted", () => {
    const s = blankState();
    initializeCardVisibility(s, ["a", "b"]);
    expect(getCardVisibility(s, "a")).toBe("encrypted");
  });
  it("allows encrypted -> owner-known -> public", () => {
    expect(isValidTransition("encrypted", "owner-known")).toBe(true);
    expect(isValidTransition("owner-known", "public")).toBe(true);
    expect(isValidTransition("public", "encrypted")).toBe(false);
  });
  it("transitions and records visibility", () => {
    const s = blankState();
    initializeCardVisibility(s, ["a"]);
    transitionCardVisibility(s, "a", "owner-known", "0", "draw");
    expect(getCardVisibility(s, "a")).toBe("owner-known");
  });
  it("computes viewer visibility", () => {
    expect(isCardVisibleTo("public", false)).toBe(true);
    expect(isCardVisibleTo("owner-known", true)).toBe(true);
    expect(isCardVisibleTo("owner-known", false)).toBe(false);
    expect(isCardVisibleTo("encrypted", true)).toBe(false);
  });
});
