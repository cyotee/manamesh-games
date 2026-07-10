import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard } from '../targets';
import { discardFromPlay, isDiscardBlocked, moveToEra } from '../boardOps';
import { fireEvent } from '../triggers';
import {
  checkReactForDiscard,
  shouldCancelDiscard,
  hasOptionalDiscardRedirect,
  adjacentRedirectOptions,
} from '../react';
import { getCard } from '../state';
import { done, needs, type Executor } from '../types';
import { playOnce } from '../playOnce';

/** Choice value: take the hit (no redirect). */
export const REDIRECT_TAKE = 'take';

export const discardExecutor: Executor = ({ G, playerId, card, choices }) => {
  const count = tagNumber(card, 'play:discard') ?? 1;
  const optional = isOptionalFor(card, 'discard');
  const target = tagValue(card, 'discard:target') ?? 'any-card';
  const scope = tagValue(card, 'discard:scope')
    ?? (target === 'top-today' || target === 'today:any' ? 'today' : 'today');

  const eras = erasForScope(G, scope, card.id);
  let options: string[];
  if (target === 'top-today') {
    const top = G.timeline[eras[0]]?.stack[0];
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

    const targetCard = getCard(G, id);

    // Thought Police etc.: owner may redirect to an adjacent invention.
    // Do NOT auto-redirect — that was discarding the just-played Fire below TP.
    if (targetCard && hasOptionalDiscardRedirect(targetCard)) {
      const redirKey = `${id}:redirect-choice`;
      const redirAns = choices[redirKey];
      if (redirAns === undefined) {
        const adjacents = adjacentRedirectOptions(G, id);
        // Owner may always "take" (accept discard on this card).
        // Adjacent options redirect the discard to that invention.
        return needs({
          id: redirKey,
          deciderId: targetCard.ownerId || playerId,
          kind: 'choose-option',
          options: [REDIRECT_TAKE, ...adjacents],
          min: 1,
          max: 1,
          reason: 'redirect:optional',
          labelCardId: id,
        });
      }
      const pick = Array.isArray(redirAns) ? redirAns[0] : redirAns;
      if (pick && pick !== REDIRECT_TAKE && pick !== '' && pick !== 'no') {
        // Owner redirected — resolve against adjacent (with protect checks)
        let effectiveId = pick;
        log.push(`${card.id}: discard of ${id} redirected to ${effectiveId} (owner chose)`);
        if (
          shouldCancelDiscard(G, effectiveId, playerId) ||
          isDiscardBlocked(G, effectiveId, playerId)
        ) {
          log.push(`${card.id}: redirected discard of ${effectiveId} fizzles`);
          continue;
        }
        // Nested optional redirect on the new target is rare; discard directly
        discardFromPlay(G, effectiveId, playerId);
        fireEvent(G, {
          type: 'discarded-from-play',
          cardId: effectiveId,
          eraId: null,
          actorPlayerId: playerId,
        });
        log.push(`${card.id}: discarded ${effectiveId}`);
        continue;
      }
      // take — fall through to discard original id
      log.push(`${card.id}: ${id} owner declined redirect (takes discard)`);
    }

    let effectiveId = id;
    const react = checkReactForDiscard(G, id, playerId, card.id);

    if (react.cancelled) {
      log.push(`${card.id}: discard of ${id} fizzles (react:cancel)`);
      continue;
    }
    if (react.redirectTo) {
      log.push(`${card.id}: discard of ${id} redirected to ${react.redirectTo}`);
      effectiveId = react.redirectTo;
      const redirReact = checkReactForDiscard(G, effectiveId, playerId, card.id);
      if (
        redirReact.cancelled ||
        shouldCancelDiscard(G, effectiveId, playerId) ||
        isDiscardBlocked(G, effectiveId, playerId)
      ) {
        log.push(`${card.id}: redirected discard of ${effectiveId} fizzles`);
        continue;
      }
    }
    const isRetargetedOrReplaced = !!(react.redirectTo || react.replaceWith);
    const blocked = !isRetargetedOrReplaced && isDiscardBlocked(G, effectiveId, playerId);
    if (blocked) {
      log.push(`${card.id}: discard of ${effectiveId} fizzles (${blocked})`);
      continue;
    }

    if (react.replaceWith) {
      log.push(`${card.id}: discard of ${id} replaced (${react.replaceWith})`);
      const loc = locateCard(G, id);
      if (loc && react.replaceWith === 'replace-with-move') {
        moveToEra(G, id, loc.era, 'top');
      }
      continue;
    }
    if (react.retaliate) {
      log.push(`${card.id}: discard of ${id} triggered retaliate`);
      const actorHand = G.players[playerId].hand;
      if (actorHand.length > 0) {
        const [ret] = actorHand.splice(0, 1);
        G.players[playerId].discard.push(ret);
        log.push(`${card.id}: retaliated by discarding ${ret.id} from actor`);
      }
    }

    log.push(
      ...playOnce(G, card.id, `discard:${effectiveId}`, () => {
        discardFromPlay(G, effectiveId, playerId);
        fireEvent(G, {
          type: 'discarded-from-play',
          cardId: effectiveId,
          eraId: null,
          actorPlayerId: playerId,
        });
        return [`${card.id}: discarded ${effectiveId}`];
      }),
    );
  }
  return done(log);
};
