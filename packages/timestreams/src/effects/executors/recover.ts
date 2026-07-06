import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { done, needs, type Executor, type PlayerPrompt } from '../types';

export const recoverExecutor: Executor = ({ G, playerId, card, choices }) => {
  const player = G.players[playerId];
  const count = tagNumber(card, 'recover:from-discard') ?? 1;
  const toHand = hasTag(card, 'recover:to-hand');
  if (!toHand) return done([`${card.id}: recover deferred (non-hand destination)`]);

  const prompts: PlayerPrompt[] = [];
  const recoverId = `${card.id}:recover`;
  const costId = `${card.id}:recover-cost`;
  const needsCost = hasTag(card, 'cost:discard-from-hand:1');

  let picks: string[];
  if (hasTag(card, 'recover:target:top-of-discard')) {
    const top = player.discard[player.discard.length - 1];
    picks = top ? [top.id] : [];
  } else if (choices[recoverId] !== undefined) {
    const c = choices[recoverId];
    picks = Array.isArray(c) ? c : c === '' ? [] : [c];
  } else {
    const options = player.discard.map(c => c.id);
    if (options.length === 0) return done([`${card.id}: recover fizzles (empty discard)`]);
    prompts.push({
      id: recoverId, deciderId: playerId, kind: 'choose-card',
      options, min: isOptionalFor(card, 'recover') ? 0 : Math.min(count, options.length), max: count,
      reason: 'recover:from-discard',
    });
    picks = [];
  }

  let costPick: string | null = null;
  if (needsCost) {
    if (choices[costId] !== undefined) {
      const c = choices[costId];
      costPick = Array.isArray(c) ? c[0] ?? null : c || null;
    } else {
      const options = player.hand.filter(c => c.id !== card.id).map(c => c.id);
      if (options.length === 0) return done([`${card.id}: recover fizzles (no card to pay)`]);
      prompts.push({ id: costId, deciderId: playerId, kind: 'choose-card', options, min: 1, max: 1, reason: 'cost:discard-from-hand:1' });
    }
  }

  if (prompts.length) return { ok: true, prompts, log: [] };
  if (picks.length === 0) return done([`${card.id}: recover declined`]);

  const log: string[] = [];
  if (needsCost && costPick) {
    const idx = player.hand.findIndex(c => c.id === costPick);
    if (idx !== -1) {
      const [paid] = player.hand.splice(idx, 1);
      player.discard.push(paid);
      log.push(`${card.id}: paid ${costPick} from hand`);
    }
  }
  for (const id of picks.slice(0, count)) {
    const idx = player.discard.findIndex(c => c.id === id);
    if (idx === -1) continue;
    const [recovered] = player.discard.splice(idx, 1);
    player.hand.push(recovered);
    log.push(`${card.id}: recovered ${id} to hand`);
  }
  return done(log);
};
