import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard } from '../targets';
import { discardFromPlay, isDiscardBlocked, moveToEra } from '../boardOps';
import { fireEvent } from '../triggers';
import { checkReactForDiscard, shouldCancelDiscard } from '../react';
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

    let effectiveId = id;
    const react = checkReactForDiscard(G, id, playerId, card.id);

    if (react.cancelled) {
      log.push(`${card.id}: discard of ${id} fizzles (react:cancel)`);
      continue;
    }
    if (react.redirectTo) {
      log.push(`${card.id}: discard of ${id} redirected to ${react.redirectTo}`);
      effectiveId = react.redirectTo;
      // re-check on the new (retargeted) target (protects, blocks, and possibly further reacts)
      const redirReact = checkReactForDiscard(G, effectiveId, playerId, card.id);
      if (redirReact.cancelled || shouldCancelDiscard(G, effectiveId, playerId) || isDiscardBlocked(G, effectiveId, playerId)) {
        log.push(`${card.id}: redirected discard of ${effectiveId} fizzles`);
        continue;
      }
    }
    // Blocked check: skip for retargeted or replaced (redirected may still fizzle above; replace transforms)
    const isRetargetedOrReplaced = !!(react.redirectTo || react.replaceWith);
    const blocked = !isRetargetedOrReplaced && isDiscardBlocked(G, effectiveId, playerId);
    if (blocked) { log.push(`${card.id}: discard of ${effectiveId} fizzles (${blocked})`); continue; }

    if (react.replaceWith) {
      log.push(`${card.id}: discard of ${id} replaced (${react.replaceWith})`);
      // Execute the replacement outcome on the original target (e.g. move self to top for CDT)
      const loc = locateCard(G, id);
      if (loc && react.replaceWith === 'replace-with-move') {
        moveToEra(G, id, loc.era, 'top');
        // fire a move-like event? for now the log suffices; could fireEvent if needed
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

    discardFromPlay(G, effectiveId, playerId);
    fireEvent(G, { type: 'discarded-from-play', cardId: effectiveId, eraId: null, actorPlayerId: playerId });
    log.push(`${card.id}: discarded ${effectiveId}`);
  }
  return done(log);
};
