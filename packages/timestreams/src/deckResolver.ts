import type { CardManifestEntry, LoadedAssetPack } from "@manamesh/frontend/src/game/modules/types";
import type { TimestreamsCard, EraId } from "./types";
import { createCardFromManifest } from "./deck";
import { DEFAULT_CONFIG } from "./types";

/**
 * Deck Resolver for Timestreams.
 *
 * Loads real cards from an asset pack's set (e.g. "stone_age" for Stone Age home era).
 * Used to replace placeholders with actual scanned/OCR'd card data and metadata.
 *
 * For M1, decks are per-home-era sets in the pack.
 */

/** Maps era id to the corresponding set name in the asset pack. */
const ERA_TO_SET: Record<EraId, string> = {
  stone: "stone_age",
  medieval: "medieval",
  renaissance: "renaissance",
  industrial: "industrial",
  modern: "modern",
  future: "future_tech",
};

/** Internal helper to get the card entries for a given era's set from the pack. */
function getPackSetCards(pack: LoadedAssetPack, homeEra: EraId): CardManifestEntry[] {
  const setName = ERA_TO_SET[homeEra];
  if (!setName) return [];
  return (pack.cards || []).filter((c: any) => {
    // Heuristic: card ids are prefixed like "stone-age-..." or contain the set name
    return c.id.startsWith(setName.replace("_", "-")) || c.id.includes(setName);
  });
}

/**
 * Resolve a deck for a player from a list of card entries (already filtered to the correct set).
 * Respects per-card "quantity" (from Deck List) by emitting multiple instances.
 * Duplicate physical cards get distinct ids like "id#0", "id#1" (matching OnePiece pattern).
 */
export function resolveDeck(
  packCards: CardManifestEntry[],
  ownerId: string,
): TimestreamsCard[] {
  if (!packCards || packCards.length === 0) {
    return [];
  }
  const deck: TimestreamsCard[] = [];
  for (const entry of packCards) {
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

/**
 * Resolve a deck for a player from a LoadedAssetPack, selecting the set based on homeEra.
 */
export function resolveDeckFromPack(
  pack: LoadedAssetPack,
  ownerId: string,
  homeEra: EraId,
): TimestreamsCard[] {
  const setCards = getPackSetCards(pack, homeEra);
  return resolveDeck(setCards, ownerId);
}

/**
 * Resolve decks for all players using their home eras from the pack.
 */
export function resolveDecksFromPack(
  pack: LoadedAssetPack,
  playerOrder: string[],
  homeEras: Record<string, EraId>,
): Record<string, TimestreamsCard[]> {
  const decks: Record<string, TimestreamsCard[]> = {};
  for (const playerId of playerOrder) {
    const era = homeEras[playerId];
    decks[playerId] = era ? resolveDeckFromPack(pack, playerId, era) : [];
  }
  return decks;
}

/**
 * Derive the total deck size for a player's home era directly from the asset pack.
 * Sums `quantity` (defaulting to 1) across all card entries for that set.
 * This allows decks of different sizes (different factions, custom decks, etc.)
 * without being bound to a hardcoded default like 36.
 */
export function getDeckSizeFromPack(
  pack: LoadedAssetPack,
  homeEra: EraId
): number {
  const setCards = getPackSetCards(pack, homeEra);
  if (setCards.length === 0) {
    return DEFAULT_CONFIG.deckSize;
  }
  return setCards.reduce((total: number, card: any) => {
    const qty = (card as any).quantity ?? (card.metadata as any)?.quantity ?? 1;
    return total + qty;
  }, 0);
}
