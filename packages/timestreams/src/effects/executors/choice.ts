import { requestDraws } from '../../crypto';
import type { TimestreamsCard } from '../../types';
import { hasTag, tagValue } from '../tags';
import { erasForScope, candidateTargets } from '../targets';
import { discardFromPlay, isDiscardBlocked } from '../boardOps';
import { requireCard } from '../state';
import { done, needs, type Executor, type ExecCtx } from '../types';
import { playOnce } from '../playOnce';

export function parseBranch(card: { tags?: string[] }, key: 'option-a' | 'option-b'): string[] {
  const prefix = `${key}:`;
  return (card.tags ?? []).filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length));
}

function branchNumber(branch: string[], prefix: string): number | undefined {
  // Prefer exact numeric tails: draw:2, discard:1, discard:hand:3
  const hits = branch.filter(t => t.startsWith(`${prefix}:`));
  for (const hit of hits) {
    const rest = hit.slice(prefix.length + 1);
    // discard:hand:3 when prefix is discard:hand
    if (/^\d+$/.test(rest)) {
      const n = Number.parseInt(rest, 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function scopeLabel(scope: string | undefined): string {
  switch (scope) {
    case 'today-or-tomorrow': return 'in Today or Tomorrow';
    case 'today': return 'in Today';
    case 'tomorrow': return 'in Tomorrow';
    case 'yesterday': return 'in Yesterday';
    case 'any-era': return 'in any era';
    default: return scope ? `in ${scope}` : 'in play';
  }
}

/**
 * Human-readable label for play:choice / score:choice option-a|b buttons,
 * derived from the card's branch tags.
 */
export function describeChoiceOption(
  card: TimestreamsCard | { tags?: string[]; playEffectText?: string } | undefined,
  option: 'option-a' | 'option-b',
): string {
  if (!card) return option === 'option-a' ? 'Option A' : 'Option B';
  const branch = parseBranch(card, option);
  const parts: string[] = [];

  const drawN = branchNumber(branch, 'draw');
  if (drawN !== undefined) {
    const who = branch.includes('draw:to:self') ? 'You draw' : 'Draw';
    parts.push(`${who} ${drawN} card${drawN === 1 ? '' : 's'}`);
  }

  if (branch.includes('discard:target')) {
    parts.push('Discard that invention from play');
  }

  const handN = branchNumber(branch, 'discard:hand');
  if (handN !== undefined) {
    parts.push(`Discard ${handN} card${handN === 1 ? '' : 's'} from your hand`);
  }

  // In-play discard: option-b:discard:1 + discard:target:any-card + discard:scope:…
  const inPlayN = branchNumber(branch, 'discard');
  const targetAny = branch.find(t => t.startsWith('discard:target:') && t !== 'discard:target');
  const scopeTag = branch.find(t => t.startsWith('discard:scope:'));
  if (inPlayN !== undefined && (targetAny || scopeTag)) {
    const scope = scopeTag?.slice('discard:scope:'.length);
    parts.push(
      `Discard ${inPlayN} card${inPlayN === 1 ? '' : 's'} ${scopeLabel(scope)}`,
    );
  }

  const addSlots = branch.find(t => t.startsWith('add-scoring-slots:'));
  if (addSlots) {
    const n = addSlots.split(':')[1];
    parts.push(`Add ${n} scoring slot${n === '1' ? '' : 's'}`);
  }
  const remSlots = branch.find(t => t.startsWith('remove-scoring-slots:'));
  if (remSlots) {
    const n = remSlots.split(':')[1];
    parts.push(`Remove ${n} scoring slot${n === '1' ? '' : 's'}`);
  }

  if (parts.length > 0) return parts.join('; ');
  return option === 'option-a' ? 'Option A' : 'Option B';
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
      return needs({
        id: `${card.id}:choose-opponent`,
        deciderId: playerId,
        kind: 'choose-option',
        options: opponents,
        min: 1,
        max: 1,
        reason: 'target:choose:opponent',
      });
    }
    deciderId = Array.isArray(pid) ? pid[0] : pid;
  }

  if (hasTag(card, 'target:choose:invention')) {
    const chosen = choices[`${card.id}:choose-target`];
    if (chosen === undefined) {
      const scope = tagValue(card, 'target:scope') ?? 'today';
      const options = candidateTargets(G, {
        kind: 'invention',
        eras: erasForScope(G, scope, card.id),
        excludeCardId: card.id,
      });
      if (options.length === 0) return done([`${card.id}: choice fizzles (no target)`]);
      return needs({
        id: `${card.id}:choose-target`,
        deciderId: playerId,
        kind: 'choose-card',
        options,
        min: 1,
        max: 1,
        reason: 'target:choose:invention',
      });
    }
    targetCardId = Array.isArray(chosen) ? chosen[0] : chosen;
    if (tagValue(card, 'decider') === 'target-owner') {
      // Always string-compare with boardgame playerIDs ("0", "1", …).
      deciderId = String(requireCard(G, targetCardId).ownerId);
    }
  }

  // 2. Option selection (with forced fallback).
  let option = choices[`${card.id}:option`] as string | undefined;
  const forced = (card.tags ?? []).find(t => t.startsWith('forced:'));
  const deciderHand = G.players[deciderId]?.hand ?? [];
  if (forced === 'forced:option-a:if-hand-under-3' && deciderHand.length < 3) {
    option = 'option-a';
  }
  if (option === undefined) {
    return needs({
      id: `${card.id}:option`,
      deciderId: String(deciderId),
      kind: 'choose-option',
      options: ['option-a', 'option-b'],
      min: 1,
      max: 1,
      reason: 'play:choice',
      // Target invention for “YOUR invention …” copy — option *labels* come from
      // the played card via playedCardIdFromPromptId (see TimestreamsBoard).
      labelCardId: targetCardId || card.id,
    });
  }

  // 3. Apply the chosen branch.
  const branch = parseBranch(card, option as 'option-a' | 'option-b');
  const log: string[] = [];

  const drawN = branchNumber(branch, 'draw');
  if (drawN !== undefined) {
    const to = branch.includes('draw:to:self') ? playerId : deciderId;
    // Idempotent: re-submitting the same option must not queue another draw.
    log.push(
      ...playOnce(G, card.id, `choice-draw:${option}:${to}:${drawN}`, () => {
        requestDraws(G, to, drawN);
        return [`${card.id}: ${option} -> ${to} draws ${drawN}`];
      }),
    );
  }

  // Pre-chosen invention target (Surgical Strike option-a: discard:target)
  if (branch.includes('discard:target') && targetCardId) {
    const blocked = isDiscardBlocked(G, targetCardId, playerId);
    if (blocked) log.push(`${card.id}: ${option} discard fizzles (${blocked})`);
    else {
      discardFromPlay(G, targetCardId, playerId);
      log.push(`${card.id}: ${option} -> discarded ${targetCardId}`);
    }
  }

  // Branch-level in-play discard (High-powered Laser option-b):
  // option-b:discard:1 + option-b:discard:target:any-card + option-b:discard:scope:today-or-tomorrow
  const inPlayDiscardN = branchNumber(branch, 'discard');
  const discardTargetKind = branch.find(
    t => t.startsWith('discard:target:') && t !== 'discard:target',
  );
  const discardScope = branch.find(t => t.startsWith('discard:scope:'));
  if (
    inPlayDiscardN !== undefined &&
    (discardTargetKind || discardScope) &&
    !branch.includes('discard:target') // not the pre-chosen-target path
  ) {
    const pickKey = `${card.id}:${option}-discard-target`;
    const picks = choices[pickKey];
    const scope = discardScope?.slice('discard:scope:'.length) ?? 'today';
    const kindRaw = discardTargetKind?.slice('discard:target:'.length) ?? 'any-card';
    const kind = kindRaw === 'invention' ? 'invention' : kindRaw === 'action' ? 'action' : 'any';
    const options = candidateTargets(G, {
      kind,
      eras: erasForScope(G, scope, card.id),
      excludeCardId: card.id,
    });
    if (picks === undefined) {
      if (options.length === 0) {
        return done([`${card.id}: ${option} discard fizzles (no targets)`]);
      }
      return needs({
        id: pickKey,
        deciderId,
        kind: 'choose-card',
        options,
        min: Math.min(inPlayDiscardN, options.length),
        max: Math.min(inPlayDiscardN, options.length),
        reason: 'play:choice-discard',
      });
    }
    const ids = Array.isArray(picks) ? picks : picks === '' ? [] : [picks];
    for (const id of ids.slice(0, inPlayDiscardN)) {
      if (!options.includes(id)) continue;
      const blocked = isDiscardBlocked(G, id, playerId);
      if (blocked) {
        log.push(`${card.id}: ${option} discard of ${id} fizzles (${blocked})`);
        continue;
      }
      discardFromPlay(G, id, playerId);
      log.push(`${card.id}: ${option} -> discarded ${id}`);
    }
  }

  const handN = branchNumber(branch, 'discard:hand');
  if (handN !== undefined) {
    const who = deciderId;
    const pickKey = `${card.id}:${option}-hand`;
    const picks = choices[pickKey];
    const hand = G.players[who].hand;
    if (picks === undefined && hand.length > handN) {
      return needs({
        id: pickKey,
        deciderId: who,
        kind: 'choose-card',
        options: hand.map(c => c.id),
        min: handN,
        max: handN,
        reason: `${option}:discard:hand:${handN}`,
      });
    }
    const ids =
      picks === undefined
        ? hand.map(c => c.id)
        : Array.isArray(picks)
          ? picks
          : [picks];
    for (const id of ids.slice(
      0,
      Math.max(handN, ids.length === hand.length ? ids.length : handN),
    )) {
      const idx = hand.findIndex(c => c.id === id);
      if (idx !== -1) G.players[who].discard.push(...hand.splice(idx, 1));
    }
    log.push(`${card.id}: ${option} -> ${who} discarded from hand`);
  }

  return done(log);
};
