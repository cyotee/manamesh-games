import { describe, it, expect } from "vitest";
import { playInvention } from "../../play";
import { makeCard, makeState, putInEra, putInHand } from "../testFixtures";

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

describe("copyExecutor (Biotechnology)", () => {
  it("prompts for invention target then copies play:draw", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.phase = "play";
    // seed deck so draw can work
    G.encryptedDecks["0"] = [
      { ciphertext: "future-tech-a", layers: 0 },
      { ciphertext: "future-tech-b", layers: 0 },
    ];
    G.cards = {
      "future-tech-a": makeCard({ id: "future-tech-a", ownerId: "0" }),
      "future-tech-b": makeCard({ id: "future-tech-b", ownerId: "0" }),
    };

    putInEra(
      G,
      "future",
      makeCard({
        id: "src-draw#0",
        ownerId: "1",
        tags: ["play:draw:1"],
      }),
    );

    const bio = makeCard({
      id: "future-tech-biotechnology#0",
      ownerId: "0",
      tags: [
        "play:copy",
        "copy:play-ability",
        "copy:target:invention",
        "target:scope:today",
        "target:exclude-self",
        "copy:as-if-own",
      ],
    });
    putInHand(G, "0", bio);

    playInvention(G, ctxFor("0"), "0", bio.id);
    expect(G.pendingPrompts?.length).toBe(1);
    expect(G.pendingPrompts![0].reason).toBe("play:copy");
    expect(G.pendingPrompts![0].options).toContain("src-draw#0");

    const handBefore = G.players["0"].hand.length;
    playInvention(G, ctxFor("0"), "0", bio.id, {
      [`${bio.id}:copy-target`]: "src-draw#0",
    });
    expect(G.pendingPrompts ?? []).toEqual([]);
    // copied draw:1 should increase hand
    expect(G.players["0"].hand.length).toBeGreaterThanOrEqual(handBefore);
  });

  it("fizzles when no invention targets in scope", () => {
    const G = makeState({ players: ["0"], currentDay: 6 });
    G.phase = "play";
    const bio = makeCard({
      id: "future-tech-biotechnology#0",
      ownerId: "0",
      tags: ["play:copy", "copy:play-ability", "copy:target:invention", "target:scope:today"],
    });
    putInHand(G, "0", bio);
    playInvention(G, ctxFor("0"), "0", bio.id);
    expect(G.pendingPrompts ?? []).toEqual([]);
  });

  it("copy of High-powered Laser choice attaches labelCardId for UI tags", () => {
    const G = makeState({ players: ["0", "1"], currentDay: 6 });
    G.phase = "play";
    const laser = makeCard({
      id: "future-tech-high-powered-laser#0",
      ownerId: "1",
      name: "High-powered Laser",
      tags: [
        "play:choice",
        "decider:self",
        "option-a:draw:2",
        "option-b:discard:1",
        "option-b:discard:target:any-card",
        "option-b:discard:scope:today-or-tomorrow",
      ],
    });
    putInEra(G, "future", laser);
    const bio = makeCard({
      id: "future-tech-biotechnology#0",
      ownerId: "0",
      tags: [
        "play:copy",
        "copy:play-ability",
        "copy:target:invention",
        "target:scope:today",
        "target:exclude-self",
      ],
    });
    putInHand(G, "0", bio);

    playInvention(G, ctxFor("0"), "0", bio.id, {
      [`${bio.id}:copy-target`]: laser.id,
    });
    expect(G.pendingPrompts?.length).toBe(1);
    const p = G.pendingPrompts![0];
    expect(p.reason).toBe("play:choice");
    expect(p.options).toEqual(["option-a", "option-b"]);
    // Labels re-read Laser tags via labelCardId (not Biotechnology)
    expect(p.labelCardId).toBe(laser.id);

    // Resolve option-a (draw 2) through the nested copy path
    G.encryptedDecks["0"] = [
      { ciphertext: "a", layers: 0 },
      { ciphertext: "b", layers: 0 },
      { ciphertext: "c", layers: 0 },
    ];
    G.cards!["a"] = makeCard({ id: "a", ownerId: "0" });
    G.cards!["b"] = makeCard({ id: "b", ownerId: "0" });
    G.cards!["c"] = makeCard({ id: "c", ownerId: "0" });
    playInvention(G, ctxFor("0"), "0", bio.id, {
      [`${bio.id}:copy-target`]: laser.id,
      [`${bio.id}:option`]: "option-a",
    });
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.pendingDealRemaining?.["0"]).toBe(2);
  });
});
