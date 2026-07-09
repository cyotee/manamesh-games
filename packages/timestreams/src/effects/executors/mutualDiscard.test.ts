import { describe, it, expect } from "vitest";
import { playAction } from "../../play";
import { makeCard, makeState, putInEra, putInHand, putActionOnEra } from "../testFixtures";
import { computeScoringSlotsForEra } from "../../scoring";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

const SLOW_TAGS = ["play:scope:today", "score:add-scoring-slots:2"];
const FAST_TAGS = [
  "play:scope:today",
  "score:remove-scoring-slots:2",
  "mutual-discard:subtype:slow-time",
];

describe("mutualDiscardExecutor (Fast Time ↔ Slow Time)", () => {
  it("places Fast Time on era actions and discards itself + one Slow Time", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 }); // medieval
    G.phase = "play";
    putActionOnEra(
      G,
      "medieval",
      makeCard({
        id: "slow-a#0",
        ownerId: "1",
        name: "Slow Time",
        cardType: "action",
        subtypes: ["slow-time"],
        tags: SLOW_TAGS,
      }),
    );
    putInEra(
      G,
      "medieval",
      makeCard({
        id: "other#0",
        ownerId: "1",
        subtypes: ["art"],
      }),
    );
    const fast = makeCard({
      id: "medieval-fast-time#0",
      ownerId: "0",
      name: "Fast Time",
      cardType: "action",
      subtypes: ["fast-time"],
      tags: FAST_TAGS,
    });
    putInHand(G, "0", fast);

    playAction(G, ctxFor("0"), "0", fast.id);

    // Pair removed from era actions; invention stack untouched
    expect(G.timeline.medieval.actions ?? []).not.toContain("slow-a#0");
    expect(G.timeline.medieval.actions ?? []).not.toContain(fast.id);
    expect(G.timeline.medieval.stack).toContain("other#0");
    expect(G.timeline.medieval.stack).not.toContain(fast.id);
    expect(G.players["1"].discard.some((c) => c.id === "slow-a#0")).toBe(true);
    expect(G.players["0"].discard.some((c) => c.id === fast.id)).toBe(true);
    expect(computeScoringSlotsForEra(G, "medieval")).toBe(6);
  });

  it("with two Slow Times, discards only one Slow Time + Fast Time", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.phase = "play";
    putActionOnEra(
      G,
      "stone",
      makeCard({
        id: "slow-a#0",
        ownerId: "0",
        cardType: "action",
        subtypes: ["slow-time"],
        tags: SLOW_TAGS,
      }),
      makeCard({
        id: "slow-b#0",
        ownerId: "0",
        cardType: "action",
        subtypes: ["slow-time"],
        tags: SLOW_TAGS,
      }),
    );
    expect(computeScoringSlotsForEra(G, "stone")).toBe(10); // 6+2+2

    const fast = makeCard({
      id: "medieval-fast-time#0",
      ownerId: "0",
      cardType: "action",
      subtypes: ["fast-time"],
      tags: FAST_TAGS,
    });
    putInHand(G, "0", fast);
    playAction(G, ctxFor("0"), "0", fast.id);

    const remainingSlow = (G.timeline.stone.actions ?? []).filter((id) =>
      id.startsWith("slow-"),
    );
    expect(remainingSlow).toHaveLength(1);
    expect(G.timeline.stone.stack).not.toContain(fast.id);
    expect(computeScoringSlotsForEra(G, "stone")).toBe(8);
  });

  it("when Slow Time is played onto an era with Fast Time, both leave (mutual)", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.phase = "play";
    putActionOnEra(
      G,
      "medieval",
      makeCard({
        id: "medieval-fast-time#0",
        ownerId: "1",
        name: "Fast Time",
        cardType: "action",
        subtypes: ["fast-time"],
        tags: FAST_TAGS,
      }),
    );
    expect(computeScoringSlotsForEra(G, "medieval")).toBe(4);

    const slow = makeCard({
      id: "stone-age-slow-time#0",
      ownerId: "0",
      name: "Slow Time",
      cardType: "action",
      subtypes: ["slow-time"],
      tags: SLOW_TAGS,
    });
    putInHand(G, "0", slow);
    playAction(G, ctxFor("0"), "0", slow.id);

    expect(G.timeline.medieval.actions ?? []).not.toContain("medieval-fast-time#0");
    expect(G.timeline.medieval.actions ?? []).not.toContain(slow.id);
    expect(G.timeline.medieval.stack).not.toContain(slow.id);
    expect(computeScoringSlotsForEra(G, "medieval")).toBe(6);
  });

  it("Fast Time alone attaches to era actions (not stack) and removes 2 slots", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.phase = "play";
    const fast = makeCard({
      id: "medieval-fast-time#0",
      ownerId: "0",
      cardType: "action",
      subtypes: ["fast-time"],
      tags: FAST_TAGS,
    });
    putInHand(G, "0", fast);
    playAction(G, ctxFor("0"), "0", fast.id);

    expect(G.timeline.medieval.actions).toContain(fast.id);
    expect(G.timeline.medieval.stack).not.toContain(fast.id);
    expect(G.players["0"].discard.map((c) => c.id)).not.toContain(fast.id);
    expect(computeScoringSlotsForEra(G, "medieval")).toBe(4);
  });

  it("Slow Time alone attaches to era actions (not stack) and adds 2 slots", () => {
    const G = makeState({ players: ["0"], currentDay: 1 });
    G.phase = "play";
    const slow = makeCard({
      id: "stone-age-slow-time#0",
      ownerId: "0",
      cardType: "action",
      subtypes: ["slow-time"],
      tags: SLOW_TAGS,
    });
    putInHand(G, "0", slow);
    playAction(G, ctxFor("0"), "0", slow.id);

    expect(G.timeline.stone.actions).toContain(slow.id);
    expect(G.timeline.stone.stack).not.toContain(slow.id);
    expect(computeScoringSlotsForEra(G, "stone")).toBe(8);
  });
});
