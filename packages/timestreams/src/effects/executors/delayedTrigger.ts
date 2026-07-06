import { hasTag } from '../tags';
import { erasForScope } from '../targets';
import { getPendingTriggers } from '../state';
import { locateCard } from '../targets';
import { done, type Executor } from '../types';

export const delayedTriggerExecutor: Executor = ({ G, playerId, card }) => {
  const triggers = getPendingTriggers(G);
  if (hasTag(card, 'trigger:next-action-in-today')) {
    triggers.push({ sourceCardId: card.id, ownerId: playerId, event: 'action-played', eraAnchor: erasForScope(G, 'today')[0], limit: 'once', spent: false });
  } else if (hasTag(card, 'trigger:next-invention-played')) {
    triggers.push({ sourceCardId: card.id, ownerId: playerId, event: 'invention-played', eraAnchor: null, limit: 'once', spent: false });
  } else if (hasTag(card, 'trigger:sixth-invention-in-era')) {
    const anchor = hasTag(card, 'play:scope:tomorrow') ? erasForScope(G, 'tomorrow')[0] ?? null : erasForScope(G, 'today')[0];
    triggers.push({ sourceCardId: card.id, ownerId: playerId, event: 'invention-played', eraAnchor: anchor, limit: 'once', spent: false });
  } else if (hasTag(card, 'delayed:trigger:after-destination-era-scored')) {
    const loc = locateCard(G, card.id);
    const anchor = loc ? loc.era : erasForScope(G, 'today')[0];
    triggers.push({ sourceCardId: card.id, ownerId: playerId, event: 'era-scored', eraAnchor: anchor, limit: 'once', spent: false });
  }
  return done([`${card.id}: delayed trigger registered`]);
};
