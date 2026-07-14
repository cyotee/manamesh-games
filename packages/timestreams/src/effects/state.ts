import type { TimestreamsState, TimestreamsCard, ActiveModifier, PendingTrigger, TurnFlags, EraId } from '../types';
import { ERA_ORDER } from '../types';

export function getCards(G: TimestreamsState): Record<string, TimestreamsCard> {
  if (!G.cards) G.cards = {};
  return G.cards;
}

/**
 * Re-apply pack metadata onto a live card when fields are missing.
 * - tags/subtypes/scoreValue for rules engine
 * - imageUrl/backImageUrl/name for UI (critical on P2P when cards rehydrate without art)
 */
export function hydrateCardFromPack(
  G: TimestreamsState,
  card: TimestreamsCard,
): TimestreamsCard {
  if (!card || !G.packCatalog) return card;

  const needsTags = !card.tags?.length;
  const needsArt = !card.imageUrl;
  const needsName = !card.name || card.name === card.id;
  const needsSubtypes = !card.subtypes?.length;
  const needsScoreValue = card.scoreValue == null;
  if (!needsTags && !needsArt && !needsName && !needsSubtypes && !needsScoreValue) {
    return card;
  }

  const baseId = card.id.includes('#') ? card.id.slice(0, card.id.indexOf('#')) : card.id;
  for (const era of ERA_ORDER) {
    const entries = G.packCatalog[era as EraId];
    if (!entries) continue;
    const entry = entries.find((e) => e.id === baseId || e.id === card.id);
    if (!entry) continue;
    const meta = (entry.metadata || {}) as Record<string, unknown>;

    if (needsTags && Array.isArray(meta.tags) && meta.tags.length) {
      card.tags = meta.tags as string[];
    }
    if (needsSubtypes && Array.isArray(meta.subtypes)) {
      card.subtypes = meta.subtypes as string[];
    }
    if (needsScoreValue && typeof meta.scoreValue === 'number') {
      card.scoreValue = meta.scoreValue;
    }
    if (typeof meta.hasScoreEffect === 'boolean' && card.hasScoreEffect == null) {
      card.hasScoreEffect = meta.hasScoreEffect;
    }
    if (typeof meta.scoreEffectText === 'string' && !card.scoreEffectText) {
      card.scoreEffectText = meta.scoreEffectText;
    }
    // Pack loader rewrites front/back to absolute URLs when available.
    if (needsArt && entry.front) {
      card.imageUrl = entry.front;
    }
    if (!card.backImageUrl && entry.back) {
      card.backImageUrl = entry.back;
    }
    if (needsName && entry.name) {
      card.name = entry.name;
    }
    break;
  }
  return card;
}

export function registerCard(G: TimestreamsState, card: TimestreamsCard): void {
  hydrateCardFromPack(G, card);
  getCards(G)[card.id] = card;
}

export function getCard(G: TimestreamsState, cardId: string): TimestreamsCard | undefined {
  const card = getCards(G)[cardId];
  if (card) hydrateCardFromPack(G, card);
  return card;
}

export function requireCard(G: TimestreamsState, cardId: string): TimestreamsCard {
  const card = getCard(G, cardId);
  if (!card) throw new Error(`unknown card: ${cardId}`);
  return card;
}

/** Assign a missing bag on G, or return fallback when G is frozen/sealed. */
function ensureBag<T>(G: TimestreamsState, key: string, create: () => T): T {
  const g = G as any;
  if (g[key] != null) return g[key] as T;
  const value = create();
  try {
    g[key] = value;
    return g[key] as T;
  } catch {
    return value;
  }
}

export function getAttachments(G: TimestreamsState): Record<string, string[]> {
  return ensureBag(G, "attachments", () => ({}));
}

export function getModifiers(G: TimestreamsState): ActiveModifier[] {
  return ensureBag(G, "modifiers", () => []);
}

export function getPendingTriggers(G: TimestreamsState): PendingTrigger[] {
  return ensureBag(G, "pendingTriggers", () => []);
}

const EMPTY_FLAGS = (): TurnFlags => ({
  skipNextTurn: false,
  extraTurns: 0,
  noInventionThisTurn: false,
  allowNextInventionEra: null,
});

export function getTurnFlags(G: TimestreamsState, playerId: string): TurnFlags {
  // boardgame.io may freeze G during turn-order next() / playerView;
  // never throw when adding bags.
  const flags = ensureBag(G, "turnFlags", () => ({} as Record<string, TurnFlags>));
  if (!flags[playerId]) {
    const fresh = EMPTY_FLAGS();
    try {
      flags[playerId] = fresh;
    } catch {
      return fresh;
    }
  }
  return flags[playerId];
}
