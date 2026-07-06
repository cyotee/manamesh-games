import { hasTag, tagValue } from '../tags';
import { erasForScope, candidateTargets, locateCard } from '../targets';
import { attachTo } from '../boardOps';
import { getPendingTriggers } from '../state';
import { done, needs, type Executor } from '../types';

export const attachExecutor: Executor = ({ G, playerId, card, choices }) => {
  const promptId = `${card.id}:attach-host`;
  const chosen = choices[promptId];
  if (chosen === undefined) {
    const scope = tagValue(card, 'attach:scope') ?? 'today';
    const options = candidateTargets(G, { kind: 'invention', eras: erasForScope(G, scope, card.id), excludeCardId: card.id });
    if (options.length === 0) return done([`${card.id}: attach fizzles (no host)`]);
    return needs({ id: promptId, deciderId: playerId, kind: 'choose-card', options, min: 1, max: 1, reason: 'play:attach' });
  }

  const hostId = Array.isArray(chosen) ? chosen[0] : chosen;
  attachTo(G, card.id, hostId);
  const log = [`${card.id}: attached to ${hostId}`];

  if (hasTag(card, 'ongoing:trigger:invention-played')) {
    const anchor = tagValue(card, 'trigger:scope') === 'attached-era' ? locateCard(G, hostId)?.era ?? null : null;
    getPendingTriggers(G).push({
      sourceCardId: card.id, ownerId: playerId,
      event: 'invention-played', eraAnchor: anchor, limit: 'ongoing', spent: false,
    });
    log.push(`${card.id}: registered ongoing invention-played trigger on ${anchor}`);
  }
  return done(log);
};
