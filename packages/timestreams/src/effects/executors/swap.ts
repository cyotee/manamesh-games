import { hasTag, tagValue, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard, cardAtOffset } from '../targets';
import { isMoveBlocked } from '../boardOps';
import { done, needs, type Executor } from '../types';

function swapPositions(G: any, aId: string, bId: string): void {
  const a = locateCard(G, aId)!; const b = locateCard(G, bId)!;
  G.timeline[a.era].stack[a.index] = bId;
  G.timeline[b.era].stack[b.index] = aId;
}

export const swapExecutor: Executor = ({ G, playerId, card, choices }) => {
  const optional = isOptionalFor(card, 'swap');
  const scope = tagValue(card, 'swap:scope') ?? 'today';

  const performSwap = (aId: string, bId: string) => {
    for (const id of [aId, bId]) {
      const blocked = isMoveBlocked(G, id, playerId);
      if (blocked) return done([`${card.id}: swap fizzles (${id} ${blocked})`]);
    }
    swapPositions(G, aId, bId);
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

  // two-card shape
  const exclude = hasTag(card, 'target:exclude-self') ? card.id : undefined;
  const options = candidateTargets(G, { kind: 'invention', eras: erasForScope(G, scope, card.id), excludeCardId: exclude });
  const promptId = `${card.id}:swap-pair`;
  const chosen = choices[promptId];
  if (chosen === undefined) {
    if (options.length < 2) return done([`${card.id}: swap fizzles (fewer than 2 targets)`]);
    return needs({ id: promptId, deciderId: playerId, kind: 'choose-card', options, min: optional ? 0 : 2, max: 2, reason: 'swap:count:2' });
  }
  const pair = Array.isArray(chosen) ? chosen : [chosen];
  if (pair.length < 2) return done([`${card.id}: swap declined`]);
  return performSwap(pair[0], pair[1]);
};
