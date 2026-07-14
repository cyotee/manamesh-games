/**
 * Matrix §2.3 — every free tool + rules-off policy.
 */
import { describe, it, expect } from "vitest";
import {
  applyFreeTool,
  canUseFreeTools,
  disableRulesEngine,
  initManualScoring,
  finalizeManualScores,
  previewEraCleanup,
} from "./freeTools";
import { makeState, makeCard, putInEra, putInHand } from "./effects/testFixtures";
import { getAttachments } from "./effects/state";
import { playInvention } from "./play";

const OFF = (G: any) => {
  G.config = { ...G.config, rulesEnabled: false, rulesLockedOff: true };
};

describe("matrix §2.3 free tools complete", () => {
  it("FT attach/detach/follow/discard glue", () => {
    const G = makeState({ players: ["0"] });
    OFF(G);
    putInEra(G, "stone", makeCard({ id: "h#0", ownerId: "0" }));
    putInHand(G, "0", makeCard({ id: "a#0", ownerId: "0", cardType: "action" }));
    applyFreeTool(G, "0", "free:attach", { cardId: "a#0", hostCardId: "h#0" }, "0");
    expect(getAttachments(G)["h#0"]).toContain("a#0");
    applyFreeTool(
      G,
      "0",
      "free:to-era",
      { cardId: "h#0", eraId: "medieval", position: "top" },
      "0",
    );
    expect(getAttachments(G)["h#0"]).toContain("a#0");
    applyFreeTool(G, "0", "free:detach", { cardId: "a#0" }, "0");
    expect(G.players["0"].hand.some((c) => c.id === "a#0")).toBe(true);
    applyFreeTool(G, "0", "free:attach", { cardId: "a#0", hostCardId: "h#0" }, "0");
    applyFreeTool(G, "0", "free:discard", { cardId: "h#0" }, "0");
    expect(G.players["0"].discard.some((c) => c.id === "a#0")).toBe(true);
  });

  it("FT to-era reorder swap piles draw recover", () => {
    const G = makeState({ players: ["0", "1"] });
    OFF(G);
    putInEra(
      G,
      "stone",
      makeCard({ id: "x#0", ownerId: "0" }),
      makeCard({ id: "y#0", ownerId: "1" }),
    );
    applyFreeTool(G, "0", "free:swap", { cardIds: ["x#0", "y#0"] }, "0");
    expect(G.timeline.stone.stack[0]).toBe("y#0");
    applyFreeTool(G, "0", "free:reorder", { cardId: "x#0", index: 0 }, "0");
    applyFreeTool(
      G,
      "0",
      "free:to-score-pile",
      { cardId: "x#0", pileOwnerId: "0" },
      "0",
    );
    expect(G.players["0"].scorePile.some((c) => c.id === "x#0")).toBe(true);
    applyFreeTool(
      G,
      "0",
      "free:from-score-pile",
      { cardId: "x#0", dest: "hand" },
      "0",
    );
    expect(G.players["0"].hand.some((c) => c.id === "x#0")).toBe(true);
    G.encryptedDecks["0"] = [{ ciphertext: "d#0", layers: 0 }];
    G.cards!["d#0"] = makeCard({ id: "d#0", ownerId: "0" });
    applyFreeTool(G, "0", "free:draw", { amount: 1 }, "0");
    expect(G.players["0"].hand.some((c) => c.id === "d#0")).toBe(true);
    applyFreeTool(G, "0", "free:discard", { cardId: "d#0" }, "0");
    applyFreeTool(G, "0", "free:recover-hand", { cardId: "d#0" }, "0");
    expect(G.players["0"].hand.some((c) => c.id === "d#0")).toBe(true);
  });

  it("FT scoring desk bonus cap mark cleanup A/B finalize", () => {
    const G = makeState({ players: ["0", "1"] });
    OFF(G);
    putInEra(
      G,
      "stone",
      makeCard({ id: "c0", ownerId: "0", scoreValue: 2 }),
      makeCard({ id: "c1", ownerId: "0", scoreValue: 1 }),
      makeCard({ id: "c2", ownerId: "1", scoreValue: 3 }),
    );
    initManualScoring(G);
    applyFreeTool(
      G,
      "0",
      "free:score-bonus-delta",
      { targetPlayerId: "0", amount: 2 },
      "0",
    );
    expect(G.manualBonus!["0"]).toBe(2);
    applyFreeTool(
      G,
      "0",
      "free:score-slot-cap",
      { eraId: "stone", amount: -1 },
      "0",
    );
    applyFreeTool(
      G,
      "0",
      "free:score-mark-processed",
      { cardId: "c0", processed: true },
      "0",
    );
    const a = previewEraCleanup(G, "stone", "outside-capacity");
    const b = previewEraCleanup(G, "stone", "unprocessed");
    expect(a.toPile.length + a.toDiscard.length).toBe(3);
    expect(b.toPile).toContain("c0");
    applyFreeTool(
      G,
      "0",
      "free:score-era-cleanup",
      { eraId: "stone", mode: "outside-capacity" },
      "0",
    );
    finalizeManualScores(G);
    expect(G.phase).toBe("gameOver");
    expect(G.winner).toBeTruthy();
  });

  it("FT rules OFF invent does not auto-draw", () => {
    const G = makeState({ players: ["0"] });
    OFF(G);
    G.encryptedDecks["0"] = [
      { ciphertext: "z#0", layers: 0 },
      { ciphertext: "z2#0", layers: 0 },
    ];
    G.cards = {
      "z#0": makeCard({ id: "z#0", ownerId: "0" }),
      "z2#0": makeCard({ id: "z2#0", ownerId: "0" }),
    };
    putInHand(
      G,
      "0",
      makeCard({
        id: "stone-age-fermented-fruit#0",
        ownerId: "0",
        tags: ["play:draw:2"],
      }),
    );
    const deckBefore = G.encryptedDecks["0"].length;
    playInvention(G, { currentPlayer: "0" } as any, "0", "stone-age-fermented-fruit#0");
    // structural place only — deck size unchanged by tags when rules off
    expect(G.timeline.stone.stack).toContain("stone-age-fermented-fruit#0");
    expect(G.encryptedDecks["0"].length).toBe(deckBefore);
  });

  it("FT disable rules one-way mid-game", () => {
    const G = makeState({ players: ["0"] });
    G.config = { ...G.config, rulesEnabled: true };
    expect(disableRulesEngine(G, "0")).toBe(true);
    expect(canUseFreeTools(G)).toBe(true);
    expect(G.config.rulesLockedOff).toBe(true);
    expect(disableRulesEngine(G, "0")).toBe(false);
  });

  it("FT empty-hand and score-ack", () => {
    const G = makeState({ players: ["0", "1"] });
    OFF(G);
    putInHand(G, "0", makeCard({ id: "h#0", ownerId: "0" }));
    applyFreeTool(G, "0", "free:empty-hand-to-discard", {}, "0");
    expect(G.players["0"].hand.length).toBe(0);
    initManualScoring(G);
    applyFreeTool(G, "0", "free:score-ack", {}, "0");
    applyFreeTool(G, "1", "free:score-ack", {}, "0");
    expect(G.manualScoreAcks).toBeDefined();
  });
});
