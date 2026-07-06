import type { ActiveModifier } from '../../types';
import { hasTag, tagValue } from '../tags';
import { addModifier } from '../modifiers';
import { done, type Executor } from '../types';

export const preventExecutor: Executor = ({ G, playerId, card }) => {
  const duration = (tagValue(card, 'duration') ?? 'rest-of-today') as ActiveModifier['duration'];
  const log: string[] = [];
  const kinds: Array<[string, ActiveModifier['kind']]> = [
    ['prevent:play:action', 'prevent-action-play'],
    ['prevent:move:future', 'prevent-move-future'],
    ['prevent:move:past', 'prevent-move-past'],
  ];
  for (const [tag, kind] of kinds) {
    if (hasTag(card, tag)) {
      addModifier(G, { sourceCardId: card.id, ownerId: playerId, kind, duration });
      log.push(`${card.id}: ${tag} (${duration})`);
    }
  }
  return done(log);
};
