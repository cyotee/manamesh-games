import type { TimestreamsState, TimestreamsCard, ActiveModifier, PendingTrigger, TurnFlags, EraId } from '../types';
import { ERA_ORDER } from '../types';

export function getCards(G: TimestreamsState): Record<string, TimestreamsCard> {
  if (!G.cards) G.cards = {};
  return G.cards;
}

/**
 * If a live card is missing rules tags (e.g. materialised without pack metadata),
 * re-apply tags/subtypes/scoreValue from G.packCatalog by base card id.
 * Mutates the card in place so scoring/play effects work.
 */
export function hydrateCardFromPack(
  G: TimestreamsState,
  card: TimestreamsCard,
): TimestreamsCard {
  if (!card) return card;
  const needsTags = !card.tags?.length;
  const needsScore =
    card.hasScoreEffect &&
    (needsTags ||
      (!(card.tags || []).some((t) => t.startsWith('score:') || t.startsWith('option-'))));
  if (!needsTags && !needsScore) return card;
  if (!G.packCatalog) return card;

  const baseId = card.id.includes('#') ? card.id.slice(0, card.id.indexOf('#')) : card.id;
  for (const era of ERA_ORDER) {
    const entries = G.packCatalog[era as EraId];
    if (!entries) continue;
    const entry = entries.find((e) => e.id === baseId || e.id === card.id);
    if (!entry?.metadata) continue;
    const meta = entry.metadata as Record<string, unknown>;
    if (Array.isArray(meta.tags) && meta.tags.length) {
      card.tags = meta.tags as string[];
    }
    if (Array.isArray(meta.subtypes) && !(card.subtypes?.length)) {
      card.subtypes = meta.subtypes as string[];
    }
    if (typeof meta.scoreValue === 'number' && card.scoreValue == null) {
      card.scoreValue = meta.scoreValue;
    }
    if (typeof meta.hasScoreEffect === 'boolean') {
      card.hasScoreEffect = meta.hasScoreEffect;
    }
    if (typeof meta.scoreEffectText === 'string' && !card.scoreEffectText) {
      card.scoreEffectText = meta.scoreEffectText;
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

export function getAttachments(G: TimestreamsState): Record<string, string[]> {
  if (!G.attachments) G.attachments = {};
  return G.attachments;
}

export function getModifiers(G: TimestreamsState): ActiveModifier[] {
  if (!G.modifiers) G.modifiers = [];
  return G.modifiers;
}

export function getPendingTriggers(G: TimestreamsState): PendingTrigger[] {
  if (!G.pendingTriggers) G.pendingTriggers = [];
  return G.pendingTriggers;
}

export function getTurnFlags(G: TimestreamsState, playerId: string): TurnFlags {
  if (!G.turnFlags) G.turnFlags = {};
  if (!G.turnFlags[playerId]) {
    G.turnFlags[playerId] = {
      skipNextTurn: false, extraTurns: 0, noInventionThisTurn: false, allowNextInventionEra: null,
    };
  }
  return G.turnFlags[playerId];
}
