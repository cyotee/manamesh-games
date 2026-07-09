import { hasTag, tagValue, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard, cardAtOffset } from '../targets';
import { isMoveBlocked } from '../boardOps';
import { done, needs, type Executor } from '../types';

/** Swap two cards' positions on the timeline (same or different eras). */
export function swapPositions(G: any, aId: string, bId: string): boolean {
  const a = locateCard(G, aId);
  const b = locateCard(G, bId);
  if (!a || !b) return false;
  if (a.zone === 'actions' || b.zone === 'actions') return false;
  G.timeline[a.era].stack[a.index] = bId;
  G.timeline[b.era].stack[b.index] = aId;
  return true;
}

export const swapExecutor: Executor = ({ G, playerId, card, choices }) => {
  const optional = isOptionalFor(card, 'swap');
  const scope = tagValue(card, 'swap:scope') ?? 'today';

  const performSwap = (aId: string, bId: string) => {
    for (const id of [aId, bId]) {
      const blocked = isMoveBlocked(G, id, playerId);
      if (blocked) return done([`${card.id}: swap fizzles (${id} ${blocked})`]);
    }
    if (!swapPositions(G, aId, bId)) {
      return done([`${card.id}: swap fizzles (locate failed)`]);
    }
    return done([`${card.id}: swapped ${aId} <-> ${bId}`]);
  };

  if (tagValue(card, 'swap:target') === 'self') {
    const withKind = tagValue(card, 'swap:with') ?? 'invention';
    let options: string[];
    if (scope === 'adjacent') {
      options = [cardAtOffset(G, card.id, -1), cardAtOffset(G, card.id, 1)].filter((x): x is string => !!x);
    } else {
      options = candidateTargets(G, {
        kind: withKind === 'art' ? 'any' : 'invention',
        eras: erasForScope(G, scope, card.id),
        excludeCardId: card.id,
        subtypes: withKind === 'art' ? ['art'] : undefined,
      });
    }
    const promptId = `${card.id}:swap-with`;
    const chosen = choices[promptId];
    if (chosen === undefined) {
      if (options.length === 0) return done([`${card.id}: swap fizzles (no partner)`]);
      return needs({ id: promptId, deciderId: playerId, kind: 'choose-card', options, min: optional ? 0 : 1, max: 1, reason: 'swap:target:self' });
    }
    if (chosen === '' || (Array.isArray(chosen) && chosen.length === 0)) return done([`${card.id}: swap declined`]);
    return performSwap(card.id, Array.isArray(chosen) ? chosen[0] : chosen);
  }

  // two-card shape (Shell Game / Time Jump)
  const exclude = hasTag(card, 'target:exclude-self') ? card.id : undefined;
  let eras;
  try {
    eras = erasForScope(G, scope, card.id);
  } catch {
    return done([`${card.id}: swap fizzles (unknown scope ${scope})`]);
  }
  const options = candidateTargets(G, {
    kind: 'invention',
    eras,
    excludeCardId: exclude,
  });
  const promptId = `${card.id}:swap-pair`;
  const chosen = choices[promptId];
  const requireDifferentEras = scope === 'different-eras';
  // Need at least two inventions; for different-eras, prefer options spanning eras
  // but still allow pick when only one era has cards (will fizzle on confirm).
  if (chosen === undefined) {
    if (options.length < 2) {
      return done([`${card.id}: swap fizzles (fewer than 2 targets)`]);
    }
    if (requireDifferentEras) {
      const erasPresent = new Set(
        options.map((id) => locateCard(G, id)?.era).filter(Boolean),
      );
      if (erasPresent.size < 2) {
        return done([`${card.id}: swap fizzles (no inventions in two different eras)`]);
      }
    }
    return needs({
      id: promptId,
      deciderId: playerId,
      kind: 'choose-card',
      options,
      min: optional ? 0 : 2,
      max: 2,
      reason: requireDifferentEras ? 'swap:different-eras' : 'swap:count:2',
    });
  }
  const pair = Array.isArray(chosen) ? chosen : [chosen];
  if (pair.length < 2) return done([`${card.id}: swap declined`]);
  if (requireDifferentEras) {
    const a = locateCard(G, pair[0]);
    const b = locateCard(G, pair[1]);
    if (!a || !b || a.era === b.era) {
      return done([`${card.id}: swap fizzles (must be different eras)`]);
    }
  }
  return performSwap(pair[0], pair[1]);
};
