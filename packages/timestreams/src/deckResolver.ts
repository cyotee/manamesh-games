import type { CardManifestEntry, LoadedAssetPack } from "@manamesh/frontend/src/game/modules/types";
import type { TimestreamsCard, TimestreamsState, EraId } from "./types";
import { createCardFromManifest, createPlaceholderDeck } from "./deck";
import { DEFAULT_CONFIG } from "./types";
import { initializeCardVisibility } from "./visibility";
import { ERA_TO_SET } from "./packCatalog";
import type { PackCatalog } from "./packCatalog";

/**
 * Deck Resolver for Timestreams.
 *
 * Loads real cards from an asset pack's set (e.g. "stone_age" for Stone Age home era).
 * Used to replace placeholders with actual scanned/OCR'd card data and metadata.
 *
 * For M1, decks are per-home-era sets in the pack.
 */

export { ERA_TO_SET };

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

/**
 * After home eras are claimed, replace placeholder decks with pack decks
 * matching each player's home era. Safe to call once when entering play.
 * Falls back to placeholders when an era set is missing from the catalog.
 */
export function materializeHomeEraDecks(
  G: TimestreamsState,
  catalog?: PackCatalog | null,
): void {
  const pack = catalog ?? G.packCatalog;
  if (!pack) return;

  // Only materialize once (placeholder decks use "*-card-*" ids).
  if ((G as any)._packDecksMaterialized) return;
  (G as any)._packDecksMaterialized = true;

  if (!G.cards) G.cards = {};
  const allCardIds: string[] = [];

  for (const playerId of G.playerOrder) {
    const player = G.players[playerId];
    if (!player) continue;
    const era = player.homeEra as EraId | null;
    const entries = era ? pack[era] : undefined;

    let deckCards: TimestreamsCard[];
    if (entries && entries.length > 0) {
      deckCards = resolveDeck(entries as any, playerId);
    } else {
      // Missing era in pack (e.g. renaissance/industrial not scanned yet).
      deckCards = createPlaceholderDeck(playerId, G.config?.deckSize ?? DEFAULT_CONFIG.deckSize);
    }

    // Clear any previous registry entries for this player's old placeholders
    // (optional — new ids replace encrypted deck).
    // Plaintext play: light shuffle so draw order isn't fixed pack order.
    // (Mental-poker path re-shuffles cryptographically later.)
    for (let i = deckCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deckCards[i], deckCards[j]] = [deckCards[j], deckCards[i]];
    }

    G.encryptedDecks[playerId] = deckCards.map((card) => {
      G.cards![card.id] = card;
      allCardIds.push(card.id);
      return { ciphertext: card.id, layers: 0 };
    });
    // Hands should still be empty at this point (dealt right after).
    player.hand = [];
  }

  if (allCardIds.length > 0) {
    initializeCardVisibility(G, allCardIds);
  }

  // Align deckSize to the largest materialized deck for draw table sanity.
  const sizes = G.playerOrder.map((pid) => G.encryptedDecks[pid]?.length ?? 0);
  if (sizes.some((s) => s > 0)) {
    G.config.deckSize = Math.max(...sizes);
  }
}
