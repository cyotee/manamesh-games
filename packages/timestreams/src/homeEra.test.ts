import { describe, it, expect } from "vitest";
import {
  claimHomeEra, setReady, allReadyWithDistinctEras,
  assignRandomHomeEras, homeEraTurnOrder, dayFirstPlayer,
} from "./homeEra";

function G(ids = ["0", "1", "2"]) {
  const players: any = {};
  for (const id of ids) players[id] = { homeEra: null, ready: false };
  return { players, playerOrder: ids } as any;
}

describe("home-era assignment", () => {
  it("selectable: prevents duplicate claims", () => {
    const g = G(["0", "1"]);
    expect(claimHomeEra(g, "0", "stone")).toBe(true);
    expect(claimHomeEra(g, "1", "stone")).toBe(false);
    expect(claimHomeEra(g, "1", "future")).toBe(true);
  });

  it("selectable: claims editable until ready", () => {
    const g = G(["0", "1"]);
    claimHomeEra(g, "0", "stone");
    expect(claimHomeEra(g, "0", "medieval")).toBe(true);
    setReady(g, "0", true);
    expect(claimHomeEra(g, "0", "future")).toBe(false);
  });

  it("detects all-ready-with-distinct-eras", () => {
    const g = G(["0", "1"]);
    claimHomeEra(g, "0", "stone"); claimHomeEra(g, "1", "future");
    setReady(g, "0", true); setReady(g, "1", true);
    expect(allReadyWithDistinctEras(g)).toBe(true);
  });

  it("random: deterministic distinct assignment from a seed", () => {
    const a = G(["0", "1", "2"]); const b = G(["0", "1", "2"]);
    assignRandomHomeEras(a, "ab".repeat(32));
    assignRandomHomeEras(b, "ab".repeat(32));
    const eras = Object.values(a.players).map((p: any) => p.homeEra);
    expect(new Set(eras).size).toBe(3);
    expect(Object.values(b.players).map((p: any) => p.homeEra)).toEqual(eras);
  });

  it("turn order follows era chronology and rotates by day", () => {
    const g = G(["0", "1"]);
    g.players["0"].homeEra = "future";
    g.players["1"].homeEra = "stone";
    expect(homeEraTurnOrder(g)).toEqual(["1", "0"]);
    expect(dayFirstPlayer(g, 1)).toBe("1");
    expect(dayFirstPlayer(g, 2)).toBe("0");
  });
});
