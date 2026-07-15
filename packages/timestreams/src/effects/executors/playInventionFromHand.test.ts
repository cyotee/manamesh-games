import { describe, it, expect } from "vitest";
import { playAction } from "../../play";
import { makeCard, makeState, putInHand } from "../testFixtures";
import { eraForDay } from "../../timeline";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

describe("playInventionFromHandExecutor (Coronation)", () => {
  it("prompts for invention, places on timeline, attaches coronation", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 2 });
    G.phase = "play";
    const invent = makeCard({
      id: "medieval-longbow#0",
      ownerId: "0",
      cardType: "invention",
      scoreValue: 2,
    });
    const coronation = makeCard({
      id: "medieval-coronation#0",
      ownerId: "0",
      cardType: "action",
      tags: ["play:play-invention", "play:attach", "attach:to:played-invention"],
    });
    putInHand(G, "0", invent, coronation);

    playAction(G, ctxFor("0"), "0", coronation.id);
    expect(G.pendingPrompts?.length).toBe(1);
    expect(G.pendingPrompts![0].reason).toBe("play:play-invention");
    expect(G.pendingPrompts![0].options).toContain(invent.id);

    playAction(G, ctxFor("0"), "0", coronation.id, {
      [`${coronation.id}:play-invention`]: invent.id,
    });
    expect(G.pendingPrompts ?? []).toEqual([]);
    const era = eraForDay(2);
    expect(G.timeline[era].stack).toContain(invent.id);
    expect(G.players["0"].hand.map((c) => c.id)).not.toContain(invent.id);
    expect(G.attachments?.[invent.id] || []).toContain(coronation.id);
    // Coronation must sit on the invention — not abandoned in discard
    expect(G.players["0"].discard.map((c) => c.id)).not.toContain(coronation.id);
  });

  it("fizzles when no invention in hand", () => {
    const G = makeState({ players: ["0"], currentDay: 2 });
    G.phase = "play";
    const coronation = makeCard({
      id: "medieval-coronation#0",
      ownerId: "0",
      cardType: "action",
      tags: ["play:play-invention", "play:attach", "attach:to:played-invention"],
    });
    putInHand(G, "0", coronation);
    playAction(G, ctxFor("0"), "0", coronation.id);
    expect(G.pendingPrompts ?? []).toEqual([]);
  });
});
