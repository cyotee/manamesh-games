/**
 * Asset loading helpers for Mistborn.
 *
 * Provides small utilities to work with the Mistborn asset pack(s)
 * and explicitly model which sets map to which game concepts (market, starters, etc.).
 *
 * In a full Manamesh app, you would typically do:
 *   const pack = useAssetPack(DEFAULT_MISTBORN_PACK_SOURCE);
 * Then use these helpers with pack.cards or the resolved data.
 *
 * The pack is loaded once; sets map to board elements (market row, player starters, etc.).
 */

import type { AssetPackManifest, CardManifestEntry } from '@manamesh/frontend/src/assets/manifest/types';
import type { MistbornSet, DeckType } from './types';
import { MISTBORN_SETS, DECK_SET_MAPPING } from './types';

// Re-export for convenience
export { MISTBORN_SETS, DECK_SET_MAPPING } from './types';
export type { MistbornSet, DeckType } from './types';

/**
 * Recommended sources for the Mistborn asset pack.
 *
 * - For IPFS deployment: Use an IPFS CID (publish the packs/mistborn/ folder to IPFS).
 * - For user local filesystem: Use local-directory or let the user pick via loadLocalDirectory.
 * - For Vercel/static bundling: Bundle assets and use local-directory with appropriate base.
 *
 * The pack contains multiple sets (market, metal-training, etc.) under one root manifest.
 * Load once with useAssetPack, then use helpers to get cards per logical deck.
 */

// Default for local development / bundled Vercel deploy (relative to the app)
export const DEFAULT_MISTBORN_PACK_SOURCE = {
  type: 'local-directory' as const,
  baseUrl: 'assets/packs/mistborn',
};

/**
 * Placeholder for official IPFS-published pack.
 * Once you publish `assets/packs/mistborn` to IPFS (e.g. `ipfs add -r --wrap-with-directory`),
 * replace with the resulting CID (or use the directory CID).
 *
 * Example:
 *   { type: 'ipfs', cid: 'bafybeih...' }  // or 'ipfs-zip' if you zip it
 */
export const IPFS_MISTBORN_PACK_SOURCE = {
  type: 'ipfs' as const,
  // TODO: Replace with real CID after publishing the pack folder
  cid: 'YOUR_MISTBORN_PACK_CID_HERE',
};

/**
 * Helper to create a source for a user-provided local directory.
 * Use with the frontend's loadLocalDirectory or directory picker.
 */
export function createLocalMistbornSource(baseUrl: string) {
  return {
    type: 'local-directory' as const,
    baseUrl,
  };
}

/**
 * Small helper to get cards belonging to a specific set from a flat list of cards.
 * (After resolveNestedManifests has flattened everything.)
 *
 * If your LoadedAssetPack already tags cards with metadata.set, you can filter that way too.
 */
export function getCardsForSet(
  cards: CardManifestEntry[],
  set: MistbornSet
): CardManifestEntry[] {
  // Since manifests use ids like "Market_Card-XXX", we can also match by prefix for robustness.
  // But the clean way is to have the root manifest + per-set.
  // For now, we do a simple heuristic based on id prefix + known sets.
  const prefixMap: Record<MistbornSet, string> = {
    [MISTBORN_SETS.MARKET]: 'Market_Card-',
    [MISTBORN_SETS.MISSIONS]: 'Mission_Card-',
    [MISTBORN_SETS.LORD_RULER]: 'Lord_Ruler_Challenge_Card-',
    [MISTBORN_SETS.METAL_TRAINING]: 'Metal_Training_Card-',
    [MISTBORN_SETS.CHARACTERS]: 'Chartacter_Card-',
    [MISTBORN_SETS.FUNDING]: 'Funding_Card_',
  };

  const prefix = prefixMap[set];
  if (!prefix) return [];

  return cards.filter((card) => card.id.startsWith(prefix));
}

/**
 * Get all cards for a logical "deck type" (e.g. market, starters).
 * Starters will combine multiple sets.
 */
export function getCardsForDeckType(
  cards: CardManifestEntry[],
  deckType: DeckType
): CardManifestEntry[] {
  const sets = DECK_SET_MAPPING[deckType];
  return sets.flatMap((set) => getCardsForSet(cards, set as MistbornSet));
}

/**
 * Helper to merge our gameplay card data (costs, metals, tags, effectText)
 * with image data coming from the asset pack.
 *
 * This is useful in Phase 1 while we still maintain a small cards.json for
 * gameplay metadata.
 */
export function enrichCardWithPackImage<T extends { id: string; imagePath?: string }>(
  card: T,
  packCards: CardManifestEntry[]
): T & { imagePath?: string } {
  const packCard = packCards.find((pc) => pc.id === card.id);
  if (packCard) {
    return {
      ...card,
      imagePath: packCard.front,
    };
  }
  return card;
}

/**
 * Example usage with a LoadedAssetPack from useAssetPack:
 *
 * const pack = useAssetPack(...);
 * if (!pack.pack) return;
 *
 * const marketCards = getCardsForDeckType(pack.pack.cards, 'market');
 * const starterCards = getCardsForDeckType(pack.pack.cards, 'starters');
 *
 * // Then when building your MistbornCard instances for initial state or market:
 * const marketCardData = marketCards.map(c => ({ id: c.id, name: c.name, ... }));
 */

/**
 * For direct filesystem / package-local use (before full pack loading is wired).
 * Returns paths relative to the package's assets/packs/mistborn directory.
 */
export function getLocalSetCardPaths(set: MistbornSet): string[] {
  // In a real build this could scan or be generated.
  // For now we return known patterns.
  const patterns: Record<MistbornSet, string> = {
    [MISTBORN_SETS.MARKET]: 'market/cards/Market_Card-*.png',
    [MISTBORN_SETS.MISSIONS]: 'missions/cards/Mission_Card-*.png',
    [MISTBORN_SETS.LORD_RULER]: 'lord-ruler/cards/Lord_Ruler_Challenge_Card-*.png',
    [MISTBORN_SETS.METAL_TRAINING]: 'metal-training/cards/Metal_Training_Card-*.png',
    [MISTBORN_SETS.CHARACTERS]: 'character/cards/Chartacter_Card-*.png',
    [MISTBORN_SETS.FUNDING]: 'funding/cards/Funding_Card_*.png',
  };
  return [patterns[set]];
}

/**
 * Enrich pack card entries with real Mistborn card metadata (cost, metals, effectText, tags, etc.).
 * Since we have enriched the manifests themselves, this now pulls from card.metadata if present.
 */
export function enrichCardsWithMetadata(cards: CardManifestEntry[]): any[] {
  return cards.map(card => ({
    ...card,
    // If manifest has metadata, use it; otherwise basic fallback
    metadata: card.metadata || {
      cost: 0,
      effectText: card.name,
      tags: [],
    },
  }));
}

/** Get enriched cards for a specific set from a loaded pack's flat cards list */
export function getEnrichedCardsForSet(
  cards: CardManifestEntry[],
  set: MistbornSet
): any[] {
  const raw = getCardsForSet(cards, set);
  return enrichCardsWithMetadata(raw);
}