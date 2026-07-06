import { requestDraws } from '../../crypto';
import { hasTag, tagValue, tagsWithPrefix } from '../tags';
import { erasForScope, candidateTargets } from '../targets';
import { discardFromPlay, isDiscardBlocked } from '../boardOps';
import { requireCard } from '../state';
import { done, needs, type Executor, type ExecCtx } from '../types';

function parseBranch(card: { tags?: string[] }, key: 'option-a' | 'option-b'): string[] {
  const prefix = `${key}:`;
  return (card.tags ?? []).filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length));
}

function branchNumber(branch: string[], prefix: string): number | undefined {
  const hit = branch.find(t => t.startsWith(`${prefix}:`));
  if (!hit) return undefined;
  const n = Number.parseInt(hit.slice(prefix.length + 1), 10);
  return Number.isNaN(n) ? undefined : n;
}

export const choiceExecutor: Executor = (ctx: ExecCtx) => {
  const { G, playerId, card, choices } = ctx;

  // 1. Establish the decider and (optionally) the target card.
  let deciderId = playerId;
  let targetCardId: string | null = null;

  if (hasTag(card, 'target:choose:opponent')) {
    const pid = choices[`${card.id}:choose-opponent`];
    if (pid === undefined) {
      const opponents = G.playerOrder.filter(p => p !== playerId);
      return needs({ id: `${card.id}:choose-opponent`, deciderId: playerId, kind: 'choose-option', options: opponents, min: 1, max: 1, reason: 'target:choose:opponent' });
    }
    deciderId = Array.isArray(pid) ? pid[0] : pid;
  }

  if (hasTag(card, 'target:choose:invention')) {
    const chosen = choices[`${card.id}:choose-target`];
    if (chosen === undefined) {
      const scope = tagValue(card, 'target:scope') ?? 'today';
      const options = candidateTargets(G, { kind: 'invention', eras: erasForScope(G, scope, card.id), excludeCardId: card.id });
      if (options.length === 0) return done([`${card.id}: choice fizzles (no target)`]);
      return needs({ id: `${card.id}:choose-target`, deciderId: playerId, kind: 'choose-card', options, min: 1, max: 1, reason: 'target:choose:invention' });
    }
    targetCardId = Array.isArray(chosen) ? chosen[0] : chosen;
    if (tagValue(card, 'decider') === 'target-owner') deciderId = requireCard(G, targetCardId).ownerId;
  }

  // 2. Option selection (with forced fallback).
  let option = choices[`${card.id}:option`] as string | undefined;
  const forced = (card.tags ?? []).find(t => t.startsWith('forced:'));
  if (forced === 'forced:option-a:if-hand-under-3' && G.players[deciderId].hand.length < 3) option = 'option-a';
  if (option === undefined) {
    return needs({ id: `${card.id}:option`, deciderId, kind: 'choose-option', options: ['option-a', 'option-b'], min: 1, max: 1, reason: 'play:choice' });
  }

  // 3. Apply the chosen branch.
  const branch = parseBranch(card, option as 'option-a' | 'option-b');
  const log: string[] = [];

  const drawN = branchNumber(branch, 'draw');
  if (drawN !== undefined) {
    const to = branch.includes('draw:to:self') ? playerId : deciderId;
    requestDraws(G, to, drawN);
    log.push(`${card.id}: ${option} -> ${to} draws ${drawN}`);
  }

  if (branch.includes('discard:target') && targetCardId) {
    const blocked = isDiscardBlocked(G, targetCardId, playerId);
    if (blocked) log.push(`${card.id}: ${option} discard fizzles (${blocked})`);
    else { discardFromPlay(G, targetCardId, playerId); log.push(`${card.id}: ${option} -> discarded ${targetCardId}`); }
  }

  const handN = branchNumber(branch, 'discard:hand');
  if (handN !== undefined) {
    const who = deciderId;
    const pickKey = `${card.id}:${option}-hand`;
    const picks = choices[pickKey];
    const hand = G.players[who].hand;
    if (picks === undefined && hand.length > handN) {
      return needs({ id: pickKey, deciderId: who, kind: 'choose-card', options: hand.map(c => c.id), min: handN, max: handN, reason: `${option}:discard:hand:${handN}` });
    }
    const ids = picks === undefined ? hand.map(c => c.id) : (Array.isArray(picks) ? picks : [picks]);
    for (const id of ids.slice(0, Math.max(handN, ids.length === hand.length ? ids.length : handN))) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx !== -1) G.players[who].discard.push(...hand.splice(idx, 1));
    }
    log.push(`${card.id}: ${option} -> ${who} discarded from hand`);
  }

  return done(log);
};
