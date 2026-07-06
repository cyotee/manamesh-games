import type { TimestreamsState, EraId } from '../types';
import { ERA_ORDER } from '../types';
import { eraForDay } from '../timeline';
import { getCard, getTurnFlags } from './state';
import { hasTag, tagValue, tagsWithPrefix } from './tags';
import { isActionPlayPrevented } from './modifiers';

function requiredSubtypePresent(G: TimestreamsState, subtype: string, eras: EraId[], scoringSlotOnly: boolean): boolean {
  const slots = G.config.scoringSlots ?? 6;
  for (const era of eras) {
    const stack = scoringSlotOnly ? G.timeline[era].stack.slice(0, slots) : G.timeline[era].stack;
    for (const cardId of stack) {
      if (getCard(G, cardId)?.subtypes?.includes(subtype)) return true;
    }
  }
  return false;
}

export function canPlayCard(
  G: TimestreamsState, playerId: string, cardId: string,
): { ok: boolean; reason?: string } {
  const card = G.players[playerId]?.hand.find(c => c.id === cardId);
  if (!card) return { ok: false, reason: 'not-in-hand' };

  const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
  const todayIndex = ERA_ORDER.indexOf(today);

  if (card.cardType === 'action' && isActionPlayPrevented(G)) {
    return { ok: false, reason: 'prevent:play:action' };
  }
  if (card.cardType === 'invention' && getTurnFlags(G, playerId).noInventionThisTurn) {
    return { ok: false, reason: 'extra-turn:restriction:no-invention-play' };
  }

  if (hasTag(card, 'play:requires-card')) {
    const scope = tagValue(card, 'requires:scope') ?? 'today';
    const eras: EraId[] = scope === 'today-or-past' ? [...ERA_ORDER.slice(0, todayIndex + 1)] : [today];
    const slotOnly = hasTag(card, 'requires:in-scoring-slot');
    for (const subtype of tagsWithPrefix(card, 'requires:subtype')) {
      if (!requiredSubtypePresent(G, subtype, eras, slotOnly)) {
        return { ok: false, reason: `requires:subtype:${subtype}` };
      }
    }
  }

  if (hasTag(card, 'rule:one-government-per-era')) {
    const hasGov = G.timeline[today].stack.some(id => getCard(G, id)?.subtypes?.includes('government'));
    if (hasGov) return { ok: false, reason: 'rule:one-government-per-era' };
  }

  return { ok: true };
}
