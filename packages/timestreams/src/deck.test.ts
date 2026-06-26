import { describe, it, expect } from "vitest";
import { createPlaceholderDeck, timestreamsCardSchema } from "./deck";

describe("placeholder deck factory", () => {
  it("creates owned cards titled 'Score 1 Point'", () => {
    const deck = createPlaceholderDeck("0", 36);
    expect(deck).toHaveLength(36);
    expect(deck[0]).toMatchObject({
      id: "0-card-0", ownerId: "0", name: "Score 1 Point",
      cardType: "invention", scoreEffect: "Score 1 Point",
    });
    expect(new Set(deck.map((c) => c.id)).size).toBe(36);
  });

  it("includes a few inert action cards", () => {
    const deck = createPlaceholderDeck("0", 36, 6);
    const actions = deck.filter((c) => c.cardType === "action");
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.length).toBeLessThan(deck.length);
  });

  it("schema validates and round-trips", () => {
    const card = timestreamsCardSchema.create({ id: "x", name: "Score 1 Point", ownerId: "0" });
    expect(timestreamsCardSchema.validate(card)).toBe(true);
    expect(timestreamsCardSchema.validate({ id: "y" })).toBe(false);
    expect(timestreamsCardSchema.getAssetKey(card)).toBe("x");
  });
});
