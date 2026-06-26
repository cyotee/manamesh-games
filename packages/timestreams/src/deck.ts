import type { CardSchema } from "@manamesh/frontend/src/game/modules/types";
import type { TimestreamsCard } from "./types";

export function createPlaceholderDeck(
  ownerId: string, size: number, actionEvery = 6,
): TimestreamsCard[] {
  const deck: TimestreamsCard[] = [];
  for (let i = 0; i < size; i++) {
    const isAction = actionEvery > 0 && i > 0 && i % actionEvery === 0;
    deck.push({
      id: `${ownerId}-card-${i}`,
      name: "Score 1 Point",
      ownerId,
      cardType: isAction ? "action" : "invention",
      scoreEffect: "Score 1 Point",
    });
  }
  return deck;
}

export const timestreamsCardSchema: CardSchema<TimestreamsCard> = {
  validate: (card): card is TimestreamsCard =>
    typeof card === "object" && card !== null &&
    "id" in card && "name" in card && "ownerId" in card && "cardType" in card &&
    ["invention", "action"].includes((card as TimestreamsCard).cardType),
  create: (data) => ({
    id: data.id,
    name: data.name,
    ownerId: (data as Partial<TimestreamsCard>).ownerId ?? "",
    cardType: (data as Partial<TimestreamsCard>).cardType ?? "invention",
    trait: (data as Partial<TimestreamsCard>).trait,
    scoreEffect: (data as Partial<TimestreamsCard>).scoreEffect ?? "Score 1 Point",
  }),
  getAssetKey: (card) => card.id,
};
