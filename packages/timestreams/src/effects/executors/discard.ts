import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets } from '../targets';
import { discardFromPlay, isDiscardBlocked } from '../boardOps';
import { fireEvent } from '../triggers';
import { shouldCancelDiscard, getRedirectTargetForDiscard, getReplaceOutcomeForDiscard } from '../react';
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
    if (shouldCancelDiscard(G, id)) {
      log.push(`${card.id}: discard of ${id} fizzles (react:cancel)`);
      continue;
    }
    const redirect = getRedirectTargetForDiscard(G, id);
    if (redirect) {
      // simplistic: if redirect to self, fizzle for demo (real would move effect)
      log.push(`${card.id}: discard of ${id} redirected to ${redirect}`);
      // for demo, treat as cancel/fizzle after log
      continue;
    }
    const replace = getReplaceOutcomeForDiscard(G, id);
    if (replace) {
      log.push(`${card.id}: discard of ${id} replaced (${replace})`);
      // for demo, skip the actual discard
      continue;
    }
    discardFromPlay(G, id, playerId);
    fireEvent(G, { type: 'discarded-from-play', cardId: id, eraId: null, actorPlayerId: playerId });
    log.push(`${card.id}: discarded ${id}`);
  }
  return done(log);
};
