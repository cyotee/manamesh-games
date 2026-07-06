import type { TimestreamsState, EraId } from '../types';
import { ERA_ORDER } from '../types';
import { eraForDay } from '../timeline';
import { getCard } from './state';

export interface CardLocation { era: EraId; index: number; }

export function locateCard(G: TimestreamsState, cardId: string): CardLocation | null {
  for (const era of ERA_ORDER) {
    const index = G.timeline[era].stack.indexOf(cardId);
    if (index !== -1) return { era, index };
  }
  return null;
}

function shiftEra(era: EraId, delta: number): EraId[] {
  const i = ERA_ORDER.indexOf(era) + delta;
  return i >= 0 && i < ERA_ORDER.length ? [ERA_ORDER[i]] : [];
}

export function erasForScope(G: TimestreamsState, scope: string, refCardId?: string): EraId[] {
  const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
  const refEra = refCardId ? locateCard(G, refCardId)?.era : undefined;
  switch (scope) {
    case 'today': return [today];
    case 'tomorrow': return shiftEra(today, 1);
    case 'yesterday': return shiftEra(today, -1);
    case 'today-or-tomorrow': return [today, ...shiftEra(today, 1)];
    case 'current-era':
    case 'same-era':
    case 'attached-era':
      return refEra ? [refEra] : [];
    case 'next-era':
      return refEra ? shiftEra(refEra, 1) : [];
    case 'this-or-previous-era':
      return refEra ? ERA_ORDER.slice(0, ERA_ORDER.indexOf(refEra) + 1) : [];
    case 'any-era': return [...ERA_ORDER];
    default:
      throw new Error(`unknown scope: ${scope}`);
  }
}

export function candidateTargets(
  G: TimestreamsState,
  opts: { kind: 'invention' | 'action' | 'any'; eras: EraId[]; excludeCardId?: string; subtypes?: string[] },
): string[] {
  const out: string[] = [];
  for (const era of opts.eras) {
    for (const cardId of G.timeline[era].stack) {
      if (cardId === opts.excludeCardId) continue;
      const card = getCard(G, cardId);
      if (!card) continue;
      if (opts.kind !== 'any' && card.cardType !== opts.kind) continue;
      if (opts.subtypes && !opts.subtypes.some(s => card.subtypes?.includes(s))) continue;
      out.push(cardId);
    }
  }
  return out;
}

export function cardAtOffset(G: TimestreamsState, refCardId: string, offset: number): string | null {
  const loc = locateCard(G, refCardId);
  if (!loc) return null;
  return G.timeline[loc.era].stack[loc.index + offset] ?? null;
}
