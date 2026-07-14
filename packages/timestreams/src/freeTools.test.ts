import { describe, it, expect } from "vitest";
import {
  applyFreeTool,
  canUseFreeTools,
  canPlayerUseFreeTool,
  disableRulesEngine,
  initManualScoring,
  finalizeManualScores,
  previewEraCleanup,
  findCardAnywhere,
} from "./freeTools";
import { makeState, makeCard, putInEra, putInHand } from "./effects/testFixtures";
import { getAttachments, getCard } from "./effects/state";
import { beginScoringPhase } from "./scoring";

describe("freeTools", () => {
  it("rejects free tools when rules are ON", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: true };
    const c = makeCard({ id: "fire#0", name: "Fire", ownerId: "0" });
    putInHand(G, "0", c);
    expect(canUseFreeTools(G)).toBe(false);
    expect(applyFreeTool(G, "0", "free:discard", { cardId: "fire#0" }, "0")).toBe(
      "INVALID_MOVE",
    );
  });

  it("attach from hand, detach to owner hand, host discard discards attachment", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    const host = makeCard({
      id: "cloth#0",
      name: "Cloth",
      ownerId: "0",
      cardType: "invention",
    });
    const act = makeCard({
      id: "hib#0",
      name: "Hibernation",
      ownerId: "0",
      cardType: "action",
    });
    putInEra(G, "stone", host);
    putInHand(G, "0", act);

    expect(
      applyFreeTool(
        G,
        "0",
        "free:attach",
        { cardId: "hib#0", hostCardId: "cloth#0" },
        "0",
      ),
    ).toBe(true);
    expect(getAttachments(G)["cloth#0"]).toContain("hib#0");
    expect(G.players["0"].hand.find((c) => c.id === "hib#0")).toBeUndefined();

    // Detach → owner hand
    expect(applyFreeTool(G, "0", "free:detach", { cardId: "hib#0" }, "0")).toBe(
      true,
    );
    expect(G.players["0"].hand.some((c) => c.id === "hib#0")).toBe(true);
    expect(getAttachments(G)["cloth#0"] || []).not.toContain("hib#0");

    // Re-attach then discard host
    applyFreeTool(
      G,
      "0",
      "free:attach",
      { cardId: "hib#0", hostCardId: "cloth#0" },
      "0",
    );
    expect(
      applyFreeTool(G, "0", "free:discard", { cardId: "cloth#0" }, "0"),
    ).toBe(true);
    expect(G.timeline.stone.stack).not.toContain("cloth#0");
    expect(G.players["0"].discard.some((c) => c.id === "cloth#0")).toBe(true);
    expect(G.players["0"].discard.some((c) => c.id === "hib#0")).toBe(true);
  });

  it("to-era, reorder, swap across eras", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    const a = makeCard({ id: "a#0", name: "A", ownerId: "0" });
    const b = makeCard({ id: "b#0", name: "B", ownerId: "1" });
    putInEra(G, "stone", a);
    putInEra(G, "medieval", b);

    expect(
      applyFreeTool(
        G,
        "0",
        "free:to-era",
        { cardId: "a#0", eraId: "future", position: "top" },
        "0",
      ),
    ).toBe(true);
    expect(G.timeline.future.stack[0]).toBe("a#0");
    expect(G.timeline.stone.stack).not.toContain("a#0");

    applyFreeTool(
      G,
      "0",
      "free:to-era",
      { cardId: "b#0", eraId: "future", position: "bottom" },
      "0",
    );
    expect(G.timeline.future.stack).toEqual(["a#0", "b#0"]);

    applyFreeTool(G, "0", "free:reorder", { cardId: "b#0", index: 0 }, "0");
    expect(G.timeline.future.stack).toEqual(["b#0", "a#0"]);

    applyFreeTool(
      G,
      "0",
      "free:swap",
      { cardIds: ["b#0", "a#0"] },
      "0",
    );
    expect(G.timeline.future.stack).toEqual(["a#0", "b#0"]);
  });

  it("draw, recover-hand, empty-hand", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    const deckCard = makeCard({ id: "deck#0", name: "DeckCard", ownerId: "0" });
    G.cards = { ...(G.cards || {}), [deckCard.id]: deckCard };
    G.encryptedDecks["0"] = [{ ciphertext: "deck#0", layers: 0 }];

    expect(applyFreeTool(G, "0", "free:draw", { amount: 1 }, "0")).toBe(true);
    expect(G.players["0"].hand.some((c) => c.id === "deck#0")).toBe(true);

    applyFreeTool(G, "0", "free:discard", { cardId: "deck#0" }, "0");
    expect(G.players["0"].discard.some((c) => c.id === "deck#0")).toBe(true);

    expect(
      applyFreeTool(G, "0", "free:recover-hand", { cardId: "deck#0" }, "0"),
    ).toBe(true);
    expect(G.players["0"].hand.some((c) => c.id === "deck#0")).toBe(true);

    expect(
      applyFreeTool(G, "0", "free:empty-hand-to-discard", {}, "0"),
    ).toBe(true);
    expect(G.players["0"].hand.length).toBe(0);
    expect(G.players["0"].discard.some((c) => c.id === "deck#0")).toBe(true);
  });

  it("recover-hand only takes from the acting player's own discard", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    G.phase = "play";
    const oppCard = makeCard({ id: "opp#0", name: "Opp", ownerId: "1" });
    G.players["1"].discard.push(oppCard);
    G.cards = { ...(G.cards || {}), [oppCard.id]: oppCard };

    // P0 cannot pull P1's discarded card
    expect(
      applyFreeTool(G, "0", "free:recover-hand", { cardId: "opp#0" }, "0"),
    ).toBe("INVALID_MOVE");
    expect(G.players["1"].discard.some((c) => c.id === "opp#0")).toBe(true);
    expect(G.players["0"].hand.some((c) => c.id === "opp#0")).toBe(false);

    // P1 can recover their own
    expect(
      applyFreeTool(G, "1", "free:recover-hand", { cardId: "opp#0" }, "1"),
    ).toBe(true);
    expect(G.players["1"].hand.some((c) => c.id === "opp#0")).toBe(true);
  });

  it("play free tools require current player; scoring allows any seat", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    G.phase = "play";
    expect(canPlayerUseFreeTool(G, "1", "0")).toBe(false);
    expect(canPlayerUseFreeTool(G, "0", "0")).toBe(true);
    G.phase = "scoring";
    expect(canPlayerUseFreeTool(G, "1", "0")).toBe(true);
  });

  it("manual scoring: bonus, claim pile, cleanup mode A vs B, finalize", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false, scoringSlots: 2 };
    const cards = [
      makeCard({ id: "c0", name: "C0", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "c1", name: "C1", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "c2", name: "C2", ownerId: "1", scoreValue: 3 }),
    ];
    putInEra(G, "stone", ...cards);
    initManualScoring(G);
    expect(G.phase).toBe("scoring");

    applyFreeTool(
      G,
      "0",
      "free:score-bonus-delta",
      { targetPlayerId: "0", amount: 5, note: "test" },
      "0",
    );
    expect(G.manualBonus!["0"]).toBe(5);

    // Mark c0 processed only
    applyFreeTool(
      G,
      "0",
      "free:score-mark-processed",
      { cardId: "c0", processed: true },
      "0",
    );

    const previewA = previewEraCleanup(G, "stone", "outside-capacity");
    expect(previewA.toPile).toEqual(["c0", "c1"]); // cap 2
    expect(previewA.toDiscard).toEqual(["c2"]);

    const previewB = previewEraCleanup(G, "stone", "unprocessed");
    expect(previewB.toPile).toEqual(["c0"]);
    expect(previewB.toDiscard).toEqual(["c1", "c2"]);

    // Mode A cleanup
    applyFreeTool(
      G,
      "0",
      "free:score-era-cleanup",
      { eraId: "stone", mode: "outside-capacity" },
      "0",
    );
    expect(G.players["0"].scorePile.map((c) => c.id).sort()).toEqual(["c0", "c1"]);
    expect(G.players["1"].discard.some((c) => c.id === "c2")).toBe(true);

    finalizeManualScores(G);
    // pile: 1+2=3 + bonus 5 = 8 for P0; P1 = 0
    expect(G.scores["0"]).toBe(8);
    expect(G.winner).toBe("0");
    expect(G.phase).toBe("gameOver");
  });

  it("disableRulesEngine is one-way", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: true };
    expect(disableRulesEngine(G, "0")).toBe(true);
    expect(G.config.rulesEnabled).toBe(false);
    expect(G.config.rulesLockedOff).toBe(true);
    expect(disableRulesEngine(G, "0")).toBe(false);
  });

  it("beginScoringPhase with rules off enters manual desk (not gameOver)", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    putInEra(
      G,
      "stone",
      makeCard({ id: "x", name: "X", ownerId: "0", scoreValue: 1 }),
    );
    const done = beginScoringPhase(G);
    expect(done).toBe(false);
    expect(G.phase).toBe("scoring");
    expect(G.winner).toBeNull();
    expect(findCardAnywhere(G, "x")?.zone).toBe("stack");
  });

  it("activity log records free actions", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    const c = makeCard({ id: "z", name: "Z", ownerId: "0" });
    putInHand(G, "0", c);
    applyFreeTool(G, "0", "free:discard", { cardId: "z" }, "0");
    const last = G.activityLog?.[G.activityLog.length - 1];
    expect(last?.message).toMatch(/free:discard/);
  });

  it("to-score-pile and from-score-pile", () => {
    const G = makeState({ players: ["0", "1"] });
    G.config = { ...G.config, rulesEnabled: false };
    const c = makeCard({ id: "q", name: "Q", ownerId: "0", scoreValue: 4 });
    putInEra(G, "modern", c);
    applyFreeTool(
      G,
      "0",
      "free:to-score-pile",
      { cardId: "q", pileOwnerId: "0" },
      "0",
    );
    expect(G.players["0"].scorePile.some((x) => x.id === "q")).toBe(true);
    applyFreeTool(
      G,
      "0",
      "free:from-score-pile",
      { cardId: "q", dest: "era", eraId: "future" },
      "0",
    );
    expect(G.timeline.future.stack).toContain("q");
    expect(getCard(G, "q")).toBeTruthy();
  });
});
