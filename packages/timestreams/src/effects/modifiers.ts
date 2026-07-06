import type { TimestreamsState, ActiveModifier, EraId } from '../types';
import { dayForEra } from '../timeline';
import { getModifiers } from './state';

export function addModifier(G: TimestreamsState, m: ActiveModifier): void {
  getModifiers(G).push(m);
}

export function clearRestOfToday(G: TimestreamsState): void {
  const kept = getModifiers(G).filter(m => m.duration !== 'rest-of-today');
  G.modifiers = kept;
}

export function isActionPlayPrevented(G: TimestreamsState): boolean {
  return getModifiers(G).some(m => m.kind === 'prevent-action-play');
}

export function isMoveDirectionPrevented(G: TimestreamsState, fromEra: EraId, toEra: EraId): boolean {
  const forward = dayForEra(toEra) > dayForEra(fromEra);
  return getModifiers(G).some(m =>
    (m.kind === 'prevent-move-future' && forward) || (m.kind === 'prevent-move-past' && !forward),
  );
}
