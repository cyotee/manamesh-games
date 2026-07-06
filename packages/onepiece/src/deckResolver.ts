/**
 * Deck Resolver — DeckList → OnePieceCard[] conversion
 *
 * Bridges the deck builder (which stores card IDs + quantities) with
 * the game engine (which needs full OnePieceCard objects).
 *
 * Pipeline: DeckList → load asset pack → enrichCard → OnePieceCard[]
 */

import type { EnrichedCard } from '@manamesh/frontend/src/deck/types';
import { enrichCard } from '@manamesh/frontend/src/deck/types';
import type { DeckList } from '@manamesh/frontend/src/deck/types';
import type {
  OnePieceCard,
  OnePieceColor,
  OnePieceCardType,
  OnePieceRarity,
} from './types';
import { getLoadedPack, getAllLoadedPacks } from '@manamesh/frontend/src/assets/loader/loader';
import { reloadLocalPack, getAllLocalPacks } from '@manamesh/frontend/src/assets/loader/local-loader';
import { getAllPackMetadata } from '@manamesh/frontend/src/assets/loader/cache';
import type { LoadedAssetPack } from '@manamesh/frontend/src/assets/loader/types';

// =============================================================================
// Type Mappers
// =============================================================================

const COLOR_MAP: Record<string, OnePieceColor> = {
  red: 'red',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  black: 'black',
  yellow: 'yellow',
};

const CARD_TYPE_MAP: Record<string, OnePieceCardType> = {
  character: 'character',
  leader: 'leader',
  event: 'event',
  stage: 'stage',
};

const RARITY_MAP: Record<string, OnePieceRarity> = {
  C: 'C',
  UC: 'UC',
  R: 'R',
  SR: 'SR',
  SEC: 'SEC',
  L: 'L',
  SP: 'SP',
};

function mapColor(s: string): OnePieceColor | null {
  return COLOR_MAP[s.toLowerCase().trim()] ?? null;
}

function mapCardType(s: string): OnePieceCardType {
  return CARD_TYPE_MAP[s.toLowerCase().trim()] ?? 'character';
}

function mapRarity(s: string): OnePieceRarity {
  return RARITY_MAP[s.toUpperCase().trim()] ?? 'C';
}

/**
 * Extract card number from an ID like "OP01-001" → "001".
 */
function extractCardNumber(entry: EnrichedCard): string {
  const match = entry.id.match(/[-_](\d+)$/);
  return match ? match[1] : entry.id;
}

// =============================================================================
// Conversion
// =============================================================================

/**
 * Convert an EnrichedCard (deck builder format) to OnePieceCard (game format).
 *
 * @param enriched - Card with normalized metadata from enrichCard()
 * @param instanceId - Optional override ID (used to make copies unique)
 */
export function enrichedToOnePieceCard(
  enriched: EnrichedCard,
  instanceId?: string,
): OnePieceCard {
  const colors: OnePieceColor[] = enriched.colors
    .map(mapColor)
    .filter((c): c is OnePieceColor => c !== null);

  if (colors.length === 0) colors.push('red');

  return {
    id: instanceId ?? enriched.id,
    name: enriched.name,
    cardType: mapCardType(enriched.cardType),
    cost: enriched.cost ?? undefined,
    power: enriched.power ?? undefined,
    counter: enriched.counter ?? undefined,
    color: colors,
    attributes: enriched.traits.length > 0 ? enriched.traits : undefined,
    trigger: enriched.metadata?.trigger
      ? String(enriched.metadata.trigger)
      : undefined,
    effectText: enriched.effectText || undefined,
    set: enriched.set,
    cardNumber: extractCardNumber(enriched),
    rarity: mapRarity(enriched.rarity),
    life: enriched.life ?? undefined,
  };
}

// =============================================================================
// Result Type
// =============================================================================

/** Result of resolving a DeckList into game-ready cards. */
export interface ResolvedDeck {
  /** OnePieceCard array (leader first, then deck cards) */
  cards: OnePieceCard[];
  /** Maps base card ID → packId for image lookups */
  cardPackMap: Map<string, string>;
}

// =============================================================================
// Deck Resolution
// =============================================================================

/**
 * Collect packs to build the card pool from.
 *
 * If `packId` is 'multi', aggregates cards from all available packs:
 * 1. In-memory caches (getAllLoadedPacks + getAllLocalPacks)
 * 2. IndexedDB stored metadata (getAllPackMetadata → reloadLocalPack)
 *
 * Otherwise loads a single pack by ID.
 */
async function collectPacks(packId: string): Promise<LoadedAssetPack[]> {
  if (packId === 'multi') {
    // Multi-pack deck: aggregate all available packs
    const memPacks = getAllLoadedPacks();
    const localPacks = getAllLocalPacks();

    // Deduplicate by pack ID (memory takes precedence)
    const seen = new Set<string>();
    const packs: LoadedAssetPack[] = [];
    for (const p of memPacks) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        packs.push(p);
      }
    }
    for (const p of localPacks) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        packs.push(p);
      }
    }

    // If no packs in memory, try reloading from IndexedDB
    if (packs.length === 0) {
      const storedMeta = await getAllPackMetadata();
      for (const meta of storedMeta) {
        if (!seen.has(meta.id)) {
          const reloaded = await reloadLocalPack(meta.id);
          if (reloaded) {
            seen.add(meta.id);
            packs.push(reloaded);
          }
        }
      }
    }

    return packs;
  }

  // Single-pack deck: try memory cache first, then IndexedDB
  let pack = getLoadedPack(packId);
  if (!pack) {
    pack = await reloadLocalPack(packId);
  }
  return pack ? [pack] : [];
}

/**
 * Resolve a saved DeckList into an array of OnePieceCard instances
 * ready for the loadDeck game move.
 *
 * Each card copy gets a unique instance ID (`cardId#index`) so the
 * game engine can track visibility per physical card.
 *
 * Supports multi-pack decks (packId === 'multi') by aggregating
 * cards from all loaded packs.
 *
 * @returns ResolvedDeck (cards + cardPackMap), or null if pack not found
 */
export async function resolveDeckList(
  deckList: DeckList,
  playerTag?: string,
): Promise<ResolvedDeck | null> {
  const packs = await collectPacks(deckList.packId);
  if (packs.length === 0) {
    console.error(
      `[deckResolver] Pack "${deckList.packId}" not found in memory or IndexedDB`,
    );
    return null;
  }

  // Build card pool from all packs, tracking which pack each card came from
  const cardPool = new Map<string, EnrichedCard>();
  const cardPackMap = new Map<string, string>();
  for (const pack of packs) {
    for (const entry of pack.cards) {
      if (!cardPool.has(entry.id)) {
        cardPool.set(entry.id, enrichCard(entry));
        cardPackMap.set(entry.id, pack.id);
      }
    }
  }

  const cards: OnePieceCard[] = [];

  // Resolve leader
  const leaderEntry = cardPool.get(deckList.leaderId);
  if (!leaderEntry) {
    console.error(
      `[deckResolver] Leader "${deckList.leaderId}" not found in pack`,
    );
    return null;
  }
  // Leader gets a player-tagged ID when playerTag is provided
  const leaderInstanceId = playerTag != null
    ? `${leaderEntry.id}#p${playerTag}`
    : leaderEntry.id;
  cards.push(enrichedToOnePieceCard(leaderEntry, leaderInstanceId));

  // Resolve main deck cards (expand quantities, unique IDs per copy).
  // When playerTag is provided, ALL instance IDs include the player tag
  // to prevent cross-player visibility collisions in G.cardVisibility.
  for (const [cardId, quantity] of Object.entries(deckList.cards)) {
    const entry = cardPool.get(cardId);
    if (!entry) {
      console.warn(
        `[deckResolver] Card "${cardId}" not found in pack, skipping`,
      );
      continue;
    }
    for (let i = 0; i < quantity; i++) {
      let instanceId: string;
      if (playerTag != null) {
        instanceId = `${cardId}#p${playerTag}.${i}`;
      } else {
        instanceId = quantity > 1 ? `${cardId}#${i}` : cardId;
      }
      cards.push(enrichedToOnePieceCard(entry, instanceId));
    }
  }

  return { cards, cardPackMap };
}
