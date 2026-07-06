import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets } from '../targets';
import { discardFromPlay, isDiscardBlocked } from '../boardOps';
import { done, needs, type Executor } from '../types';

export const discardExecutor: Executor = ({ G, playerId, card, choices }) => {
  const count = tagNumber(card, 'play:discard') ?? 1;
  const optional = isOptionalFor(card, 'discard');
  const target = tagValue(card, 'discard:target') ?? 'any-card';
  const scope = tagValue(card, 'discard:scope')
    ?? (target === 'top-today' || target === 'today:any' ? 'today' : 'today');

  const eras = erasForScope(G, scope, card.id);
  let options: string[];
  if (target === 'top-today') {
    const top = G.timeline[eras[0]].stack[0];
    options = top ? [top] : [];
  } else {
    const kind = target === 'invention' ? 'invention' : 'any';
    const subtypes = target === 'art' ? ['art'] : undefined;
    options = candidateTargets(G, { kind, eras, subtypes, excludeCardId: card.id });
  }

  const promptId = `${card.id}:discard`;
  const chosen = choices[promptId];
  if (chosen === undefined) {
    if (options.length === 0) return done([`${card.id}: discard fizzles (no targets)`]);
    return needs({
      id: promptId, deciderId: playerId, kind: 'choose-card',
      options, min: optional ? 0 : Math.min(count, options.length), max: count,
      reason: `discard:target:${target}`,
    });
  }

  const picks = Array.isArray(chosen) ? chosen : chosen === '' ? [] : [chosen];
  const log: string[] = [];
  for (const id of picks) {
    if (!options.includes(id)) continue;
    const blocked = isDiscardBlocked(G, id, playerId);
    if (blocked) { log.push(`${card.id}: discard of ${id} fizzles (${blocked})`); continue; }
    discardFromPlay(G, id, playerId);
    log.push(`${card.id}: discarded ${id}`);
  }
  return done(log);
};
