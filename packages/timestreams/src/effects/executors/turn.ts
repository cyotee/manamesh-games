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
      // Invention is on the board after playInvention places it; action may be in discard.
      const inPlay = !!locateCard(G, card.id);
      const inHand = G.players[playerId]?.hand?.some((c) => c.id === card.id);
      if (!inPlay && !inHand) {
        // Already discarded (re-submit after pay) — continue to opponent picks
      } else {
        return needs({
          id: promptId,
          deciderId: playerId,
          kind: 'confirm',
          options: ['yes', 'no'],
          min: 1,
          max: 1,
          reason: 'cost:discard-self',
        });
      }
    }
    if (answer === 'no' || answer === 'skip') {
      return done([...log, `${card.id}: declined self-discard`]);
    }
    if (answer === 'yes' || answer === undefined) {
      // Pay self once
      if (locateCard(G, card.id)) {
        discardFromPlay(G, card.id, playerId);
        log.push(`${card.id}: discarded self`);
      } else {
        const hand = G.players[playerId]?.hand;
        const ix = hand?.findIndex((c) => c.id === card.id) ?? -1;
        if (ix >= 0 && hand) {
          const [paid] = hand.splice(ix, 1);
          G.players[playerId].discard.push(paid);
          log.push(`${card.id}: discarded self from hand`);
        }
      }

      const n = tagNumber(card, 'discard:opponents-hand') ?? 2;
      // Each opponent chooses which cards to discard (or auto if ≤n and whole-hand-if-fewer).
      for (const pid of G.playerOrder) {
        if (pid === playerId) continue;
        const hand = G.players[pid].hand;
        if (hand.length === 0) continue;
        const removeAll =
          hand.length <= n && hasTag(card, 'discard:whole-hand-if-fewer');
        const need = removeAll ? hand.length : Math.min(n, hand.length);
        const pickKey = `${card.id}:opp-discard-${pid}`;
        if (choices[pickKey] === undefined) {
          if (removeAll) {
            // No choice — discard entire hand
            G.players[pid].discard.push(...hand.splice(0, hand.length));
            log.push(`${card.id}: P${pid} discarded whole hand (${need})`);
            continue;
          }
          return needs({
            id: pickKey,
            deciderId: pid,
            kind: 'choose-card',
            options: hand.map((c) => c.id),
            min: need,
            max: need,
            reason: 'discard:opponents-hand',
            labelCardId: card.id,
          });
        }
        const raw = choices[pickKey];
        const picks = Array.isArray(raw) ? raw : raw ? [raw] : [];
        for (const id of picks.slice(0, need)) {
          const hi = hand.findIndex((c) => c.id === id);
          if (hi >= 0) G.players[pid].discard.push(...hand.splice(hi, 1));
        }
        // Top up if they submitted fewer than needed
        while (picks.length < need && hand.length > 0) {
          G.players[pid].discard.push(...hand.splice(hand.length - 1, 1));
        }
        log.push(`${card.id}: P${pid} discarded ${need} from hand`);
      }
    }
  }

  return done(log);
};
