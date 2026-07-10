import { describe, it, expect } from "vitest";
import {
  repairHandOrder,
  ensureContiguousGroups,
  buildGroups,
  flattenGroups,
  sortHandIds,
  reorderIds,
  reorderGroups,
  groupKeyForCard,
  cardsByIdMap,
} from "./handLayout";
import type { HandLayoutCard } from "./handLayout";

function card(
  id: string,
  partial: Partial<HandLayoutCard> = {},
): HandLayoutCard {
  return { id, name: id.split("#")[0], cardType: "invention", scoreValue: 1, ...partial };
}

describe("handLayout", () => {
  it("groupKeyForCard strips instance suffix", () => {
    expect(groupKeyForCard({ id: "stone-age-fire#0" })).toBe("stone-age-fire");
    expect(groupKeyForCard({ id: "x", name: "X" })).toBe("x");
  });

  it("repairHandOrder drops played and appends drawn", () => {
    expect(repairHandOrder(["a", "b", "c"], ["c", "a", "d"])).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("ensureContiguousGroups merges non-adjacent duplicates", () => {
    const hand = [
      card("fire#0", { name: "Fire" }),
      card("herb#0", { name: "Herbalism" }),
      card("fire#1", { name: "Fire" }),
    ];
    const byId = cardsByIdMap(hand);
    const order = ensureContiguousGroups(
      ["fire#0", "herb#0", "fire#1"],
      byId,
    );
    expect(order).toEqual(["fire#0", "fire#1", "herb#0"]);
  });

  it("buildGroups / flatten round-trip after contiguity", () => {
    const hand = [
      card("fire#0", { name: "Fire", scoreValue: 2 }),
      card("fire#1", { name: "Fire", scoreValue: 2 }),
      card("wheel#0", { name: "Wheel", scoreValue: 1 }),
    ];
    const byId = cardsByIdMap(hand);
    const groups = buildGroups(
      ["fire#0", "fire#1", "wheel#0"],
      byId,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].cardIds).toEqual(["fire#0", "fire#1"]);
    expect(groups[0].representativeId).toBe("fire#0");
    expect(flattenGroups(groups)).toEqual(["fire#0", "fire#1", "wheel#0"]);
  });

  it("reorderGroups moves whole stack", () => {
    const groups = buildGroups(
      ["fire#0", "fire#1", "herb#0", "wheel#0"],
      cardsByIdMap([
        card("fire#0"),
        card("fire#1"),
        card("herb#0"),
        card("wheel#0"),
      ]),
    );
    // fire stack, herb, wheel → move fire after herb
    const next = reorderGroups(groups, 0, 1);
    expect(next).toEqual(["herb#0", "fire#0", "fire#1", "wheel#0"]);
  });

  it("reorderIds moves single card", () => {
    expect(reorderIds(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("sort by name keeps duplicates adjacent", () => {
    const hand = [
      card("b#0", { name: "B" }),
      card("a#0", { name: "A" }),
      card("b#1", { name: "B" }),
    ];
    const byId = cardsByIdMap(hand);
    const sorted = sortHandIds(["b#0", "a#0", "b#1"], byId, "name", "asc");
    expect(sorted[0]).toBe("a#0");
    expect(sorted.slice(1).sort()).toEqual(["b#0", "b#1"].sort());
    // B copies adjacent
    const bi = sorted.indexOf("b#0");
    const bj = sorted.indexOf("b#1");
    expect(Math.abs(bi - bj)).toBe(1);
  });

  it("sort by score puts missing scores last (asc and desc)", () => {
    const hand = [
      card("act#0", { name: "Big Rock", cardType: "action", scoreValue: null }),
      card("f#0", { name: "Fire", scoreValue: 2 }),
      card("w#0", { name: "Wheel", scoreValue: 1 }),
    ];
    const byId = cardsByIdMap(hand);
    const asc = sortHandIds(
      ["act#0", "f#0", "w#0"],
      byId,
      "score",
      "asc",
    );
    expect(asc[asc.length - 1]).toBe("act#0");
    expect(asc.slice(0, 2)).toEqual(["w#0", "f#0"]);

    const desc = sortHandIds(
      ["act#0", "f#0", "w#0"],
      byId,
      "score",
      "desc",
    );
    expect(desc[desc.length - 1]).toBe("act#0");
    expect(desc.slice(0, 2)).toEqual(["f#0", "w#0"]);
  });

  it("sort by type: inventions before actions (asc)", () => {
    const hand = [
      card("a#0", { name: "Smoke", cardType: "action", scoreValue: null }),
      card("i#0", { name: "Fire", cardType: "invention", scoreValue: 2 }),
    ];
    const byId = cardsByIdMap(hand);
    const sorted = sortHandIds(["a#0", "i#0"], byId, "type", "asc");
    expect(sorted[0]).toBe("i#0");
    expect(sorted[1]).toBe("a#0");
  });
});
