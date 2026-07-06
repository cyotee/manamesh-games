import { ERA_ORDER } from '../../types';
import { eraForDay } from '../../timeline';
import { hasTag, tagValue, tagNumber } from '../tags';
import { getTurnFlags } from '../state';
import { discardFromPlay } from '../boardOps';
import { locateCard } from '../targets';
import { done, needs, type Executor } from '../types';

export const turnExecutor: Executor = ({ G, playerId, card, choices }) => {
  const log: string[] = [];

  if (hasTag(card, 'play:extra-turn')) {
    const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
    const conditionOk = !hasTag(card, 'condition:today-modern-or-future') || today === 'modern' || today === 'future';
    if (conditionOk) {
      const promptId = `${card.id}:extra-turn`;
      const optional = hasTag(card, 'extra-turn:optional');
      const answer = choices[promptId];
      if (optional && answer === undefined) {
        return needs({ id: promptId, deciderId: playerId, kind: 'confirm', options: ['yes', 'no'], min: 1, max: 1, reason: 'play:extra-turn' });
      }
      if (!optional || answer === 'yes') {
        const flags = getTurnFlags(G, playerId);
        flags.extraTurns += 1;
        if (hasTag(card, 'extra-turn:restriction:no-invention-play')) flags.noInventionThisTurn = true;
        log.push(`${card.id}: extra turn granted`);
      }
    }
  }

  if (hasTag(card, 'play:skip-turn') && tagValue(card, 'skip:target') === 'self') {
    getTurnFlags(G, playerId).skipNextTurn = true;
    log.push(`${card.id}: skip next turn (not passing)`);
  }

  if (hasTag(card, 'play:allow-next-invention')) {
    const scope = tagValue(card, 'allow:scope');
    if (scope === 'yesterday-or-tomorrow') {
      getTurnFlags(G, playerId).allowNextInventionEra = 'yesterday-or-tomorrow';
      log.push(`${card.id}: next invention may go to yesterday or tomorrow`);
    }
  }

  if (hasTag(card, 'cost:discard-self') && tagNumber(card, 'discard:opponents-hand') !== undefined) {
    const promptId = `${card.id}:pay-self`;
    const answer = choices[promptId];
    if (answer === undefined) {
      if (!locateCard(G, card.id)) return done(log); // not in play: nothing to pay
      return needs({ id: promptId, deciderId: playerId, kind: 'confirm', options: ['yes', 'no'], min: 1, max: 1, reason: 'cost:discard-self' });
    }
    if (answer === 'yes') {
      discardFromPlay(G, card.id, playerId);
      const n = tagNumber(card, 'discard:opponents-hand') ?? 2;
      for (const pid of G.playerOrder) {
        if (pid === playerId) continue;
        const hand = G.players[pid].hand;
        const removeAll = hand.length <= n && hasTag(card, 'discard:whole-hand-if-fewer');
        const removed = removeAll ? hand.splice(0, hand.length) : hand.splice(Math.max(0, hand.length - n), n);
        G.players[pid].discard.push(...removed);
      }
      log.push(`${card.id}: paid self; opponents discarded ${n}`);
    }
  }

  return done(log);
};
