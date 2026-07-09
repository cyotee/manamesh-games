import type { CardSchema, CardManifestEntry } from "@manamesh/frontend/src/game/modules/types";
import type { TimestreamsCard, TimestreamsDeckCardMetadata } from "./types";
import { DEFAULT_CONFIG } from "./types";

/**
 * Create a placeholder deck (fallback for unscanned eras or testing).
 */
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
      subtypes: [],
      addlCardText: undefined,
      flavorText: undefined,
      hasPlayEffect: false,
      playEffectText: undefined,
      hasScoreEffect: true,
      scoreEffectText: "Score 1 Point",
      hasReact: false,
      reactEffectText: undefined,
      scoreValue: 1,
      tags: [],
    });
  }
  return deck;
}

/**
 * Create a TimestreamsCard from a CardManifestEntry + its Timestreams metadata.
 */
export function createCardFromManifest(
  entry: CardManifestEntry,
  ownerId: string,
): TimestreamsCard {
  const meta = (entry.metadata || {}) as Partial<TimestreamsDeckCardMetadata>;

  return {
    id: entry.id,
    name: entry.name,
    ownerId,
    cardType: meta.cardType || "invention",
    subtypes: meta.subtypes || [],
    addlCardText: meta.addlCardText,
    flavorText: meta.flavorText,
    hasPlayEffect: meta.hasPlayEffect ?? false,
    playEffectText: meta.playEffectText,
    hasScoreEffect: meta.hasScoreEffect ?? true,
    scoreEffectText: meta.scoreEffectText,
    hasReact: meta.hasReact ?? false,
    reactEffectText: meta.reactEffectText,
    scoreValue: meta.scoreValue,
    tags: meta.tags || [],
    // Pack loader rewrites front/back to absolute URLs when available.
    imageUrl: entry.front || undefined,
    backImageUrl: entry.back || undefined,
  };
}

/**
 * Create a deck by loading cards from a specific set in an asset pack.
 * Falls back to placeholders if no matching cards found.
 * Respects "quantity" on entries (expands to multiple copies with distinct ids when >1).
 */
export function createDeckFromPack(
  ownerId: string,
  setPath: string,
  packCards: CardManifestEntry[],
): TimestreamsCard[] {
  const setCards = packCards.filter((c) => {
    // Cards in the set will have ids like "stone-age-xxx" or we match by presence
    // For now, we assume the packCards passed are already the ones for this set.
    return true;
  });

  if (setCards.length === 0) {
    return createPlaceholderDeck(ownerId, DEFAULT_CONFIG.deckSize);
  }

  const deck: TimestreamsCard[] = [];
  for (const entry of setCards) {
    const qty = (entry as any).quantity ?? ((entry as any).metadata?.quantity as number | undefined) ?? 1;
    for (let i = 0; i < qty; i++) {
      const card = createCardFromManifest(entry, ownerId);
      if (qty > 1) {
        card.id = `${entry.id}#${i}`;
      }
      deck.push(card);
    }
  }
  return deck;
}

export const timestreamsCardSchema: CardSchema<TimestreamsCard> = {
  validate: (card): card is TimestreamsCard =>
    typeof card === "object" && card !== null &&
    "id" in card && "name" in card && "ownerId" in card && "cardType" in card &&
    ["invention", "action"].includes((card as TimestreamsCard).cardType) &&
    typeof (card as any).hasPlayEffect === 'boolean' &&
    'addlCardText' in (card as any),  // optional but present in shape
  create: (data) => ({
    id: data.id,
    name: data.name,
    ownerId: (data as Partial<TimestreamsCard>).ownerId ?? "",
    cardType: (data as Partial<TimestreamsCard>).cardType ?? "invention",
    subtypes: (data as Partial<TimestreamsCard>).subtypes || [],
    addlCardText: (data as Partial<TimestreamsCard>).addlCardText,
    flavorText: (data as Partial<TimestreamsCard>).flavorText,
    hasPlayEffect: (data as Partial<TimestreamsCard>).hasPlayEffect ?? false,
    playEffectText: (data as Partial<TimestreamsCard>).playEffectText,
    hasScoreEffect: (data as Partial<TimestreamsCard>).hasScoreEffect ?? true,
    scoreEffectText: (data as Partial<TimestreamsCard>).scoreEffectText,
    hasReact: (data as Partial<TimestreamsCard>).hasReact ?? false,
    reactEffectText: (data as Partial<TimestreamsCard>).reactEffectText,
    scoreValue: (data as Partial<TimestreamsCard>).scoreValue,
    tags: (data as Partial<TimestreamsCard>).tags || [],
  }),
  getAssetKey: (card) => card.id,
};
