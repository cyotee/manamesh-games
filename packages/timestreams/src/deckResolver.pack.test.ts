import { describe, it, expect } from "vitest";
import { materializeHomeEraDecks, resolveDeck } from "./deckResolver";
import { createCryptoInitialState } from "./crypto";
import type { PackCatalog } from "./packCatalog";

describe("materializeHomeEraDecks from pack catalog", () => {
  it("replaces placeholders with home-era pack cards + image URLs", () => {
    const G: any = createCryptoInitialState(
      { playerIDs: ["0", "1"] } as any,
      { playMode: "plaintext" } as any,
    );
    G.players["0"].homeEra = "stone";
    G.players["1"].homeEra = "future";

    const catalog: PackCatalog = {
      stone: [
        {
          id: "stone-age-fire",
          name: "Fire",
          front: "/timestreams-pack/stone_age/cards/Stone_Age-Fire.png",
          metadata: {
            cardType: "invention",
            hasPlayEffect: false,
            hasScoreEffect: true,
            hasReact: false,
            scoreValue: 1,
            tags: [],
          },
          quantity: 2,
        },
      ],
      future: [
        {
          id: "future-tech-nanotech",
          name: "Nanotech",
          front: "/timestreams-pack/future_tech/cards/Future_Tech-Nanotech.png",
          metadata: {
            cardType: "invention",
            hasPlayEffect: false,
            hasScoreEffect: true,
            hasReact: false,
            scoreValue: 2,
            tags: [],
          },
          quantity: 1,
        },
      ],
    };

    materializeHomeEraDecks(G, catalog);

    expect(G.encryptedDecks["0"]).toHaveLength(2);
    expect(G.encryptedDecks["1"]).toHaveLength(1);
    const fire0 = G.cards["stone-age-fire#0"] || G.cards["stone-age-fire"];
    // quantity 2 → #0 and #1
    expect(G.cards["stone-age-fire#0"]?.name).toBe("Fire");
    expect(G.cards["stone-age-fire#0"]?.imageUrl).toContain("Stone_Age-Fire.png");
    expect(G.cards["future-tech-nanotech"]?.name).toBe("Nanotech");
    expect(G._packDecksMaterialized).toBe(true);

    // second call is a no-op
    const before = G.encryptedDecks["0"].length;
    materializeHomeEraDecks(G, catalog);
    expect(G.encryptedDecks["0"]).toHaveLength(before);
  });

  it("resolveDeck expands quantity", () => {
    const deck = resolveDeck(
      [
        {
          id: "x",
          name: "X",
          front: "a.png",
          metadata: { cardType: "invention", hasPlayEffect: false, hasScoreEffect: true, hasReact: false },
          quantity: 3,
        } as any,
      ],
      "0",
    );
    expect(deck).toHaveLength(3);
    expect(deck.map((c) => c.id)).toEqual(["x#0", "x#1", "x#2"]);
  });
});
