import type { TimestreamsState, EraId } from '../types';
import { ERA_ORDER } from '../types';
import { eraForDay } from '../timeline';
import { getCard } from './state';

export interface CardLocation {
  era: EraId;
  index: number;
  /** Invention stack (scoring) vs era-level action attachment. */
  zone?: "stack" | "actions";
}

export function locateCard(G: TimestreamsState, cardId: string): CardLocation | null {
  for (const era of ERA_ORDER) {
    const index = G.timeline[era].stack.indexOf(cardId);
    if (index !== -1) return { era, index, zone: "stack" };
    const actions = G.timeline[era].actions ?? [];
    const aIdx = actions.indexOf(cardId);
    if (aIdx !== -1) return { era, index: aIdx, zone: "actions" };
  }
  return null;
}

function shiftEra(era: EraId, delta: number): EraId[] {
  const i = ERA_ORDER.indexOf(era) + delta;
  return i >= 0 && i < ERA_ORDER.length ? [ERA_ORDER[i]] : [];
}

/** True when an in-play card extends today-effects to yesterday (Telecommunications). */
export function hasTodayExtendToYesterday(G: TimestreamsState): boolean {
  for (const era of ERA_ORDER) {
    for (const cid of G.timeline[era].stack) {
      const c = getCard(G, cid);
      if (c && (c.tags || []).includes('extend:today-effects-to-yesterday')) {
        // condition:in-today — only while card is in today's era
        if ((c.tags || []).includes('condition:in-today')) {
          const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
          if (era !== today) continue;
        }
        return true;
      }
    }
  }
  return false;
}

export function erasForScope(G: TimestreamsState, scope: string, refCardId?: string): EraId[] {
  // During iterative scoring, "today" is the era being scored (not calendar day).
  const today =
    (G.scoringActiveEra as EraId | null | undefined) ||
    eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
  let refEra = refCardId ? locateCard(G, refCardId)?.era : undefined;
  if (!refEra && (scope === 'this-or-previous-era' || scope === 'same-era' || scope === 'attached-era' || scope === 'next-era')) {
    refEra = today;
  }
  switch (scope) {
    case 'today': {
      const eras: EraId[] = [today];
      if (hasTodayExtendToYesterday(G)) {
        eras.push(...shiftEra(today, -1));
      }
      return eras;
    }
    case 'tomorrow': return shiftEra(today, 1);
    case 'yesterday': return shiftEra(today, -1);
    case 'today-or-tomorrow': return [today, ...shiftEra(today, 1)];
    case 'current-era':
    case 'same-era':
    case 'this-era':
    case 'attached-era':
      return refEra ? [refEra] : [];
    case 'next-era':
      return refEra ? shiftEra(refEra, 1) : [];
    case 'this-or-previous-era':
      return refEra ? ERA_ORDER.slice(0, ERA_ORDER.indexOf(refEra) + 1) : [];
    case 'any-era':
      return [...ERA_ORDER];
    /**
     * Time Jump: candidates may come from any era; the pair must still be
     * validated as different eras at swap time (not the same age).
     */
    case 'different-eras':
      return [...ERA_ORDER];
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
