import type { EraId } from '../../types';
import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard } from '../targets';
import { moveWithinEra, moveToEra, isMoveBlocked } from '../boardOps';
import { isMoveDirectionPrevented } from '../modifiers';
import { checkReactForMove } from '../react';
import { done, needs, type Executor, type ExecCtx } from '../types';

interface Destination { era: EraId; position: 'top' | 'bottom'; }

function parseDestination(ctx: ExecCtx, dest: string): Destination | null {
  const { G, card } = ctx;
  const at = (scope: string) => erasForScope(G, scope, card.id)[0];
  switch (dest) {
    case 'top-today': return { era: at('today'), position: 'top' };
    case 'bottom-today': return { era: at('today'), position: 'bottom' };
    case 'tomorrow': {
      const era = erasForScope(G, 'tomorrow', card.id)[0];
      return era ? { era, position: 'bottom' } : null;
    }
    case 'top-of-era': {
      const era = locateCard(G, card.id)?.era;
      return era ? { era, position: 'top' } : null;
    }
    default: return null;
  }
}

function pickSource(ctx: ExecCtx): { options: string[]; deterministic?: string; fizzle?: string } {
  const { G, card } = ctx;
  const source = tagValue(card, 'move-source');
  // Backwards Compatibility: "the card at the bottom of Yesterday" — fixed target, no prompt.
  // (Vortex is move-source:yesterday and *does* prompt for a choice.)
  if (source === 'bottom-yesterday') {
    const era = erasForScope(G, 'yesterday')[0];
    if (!era) {
      return { options: [], fizzle: 'no yesterday (day 1?)' };
    }
    const stack = G.timeline[era]?.stack ?? [];
    if (stack.length === 0) {
      return { options: [], fizzle: 'yesterday empty' };
    }
    // stack[0] = first scoring slot (top); last index = bottom of the era.
    return { options: [], deterministic: stack[stack.length - 1] };
  }
  if (source === 'yesterday' || source === 'today') {
    const eras = erasForScope(G, source);
    const kind = tagValue(card, 'move:target') === 'any-card' ? 'any' : 'invention';
    return { options: candidateTargets(G, { kind, eras, excludeCardId: card.id }) };
  }
  // move:target driven (self or chosen)
  const target = tagValue(card, 'move:target');
  if (target === 'self') return { options: [], deterministic: card.id };
  const scope = tagValue(card, 'move:scope') ?? 'today';
  const kind = target === 'action' ? 'action' : target === 'any-card' ? 'any' : 'invention';
  const exclude = hasTag(card, 'target:exclude-self') || target !== 'any-card' ? card.id : undefined;
  return { options: candidateTargets(G, { kind, eras: erasForScope(G, scope, card.id), excludeCardId: exclude }) };
}

function isMoveDeclined(chosen: string | string[] | undefined): boolean {
  if (chosen === undefined) return false;
  if (chosen === '' || chosen === '__none__' || chosen === 'stay' || chosen === 'no') return true;
  if (Array.isArray(chosen) && chosen.length === 0) return true;
  if (Array.isArray(chosen) && chosen.length === 1) {
    const v = chosen[0];
    return v === '' || v === '__none__' || v === 'stay' || v === 'no';
  }
  return false;
}

export const moveExecutor: Executor = (ctx) => {
  const { G, playerId, card, choices } = ctx;
  const promptId = `${card.id}:move-card`;
  const src = pickSource(ctx);
  const optional = isOptionalFor(card, 'move');

  if (src.fizzle) {
    return done([`${card.id}: move fizzles (${src.fizzle})`]);
  }

  let moving = src.deterministic ?? undefined;
  if (moving !== undefined && optional) {
    // Deterministic target (e.g. self) + move:optional — player may leave it
    // where it was played (Air Cars / The Wheel: "you may move this up N").
    const chosen = choices[promptId];
    if (chosen === undefined) {
      return needs({
        id: promptId,
        deciderId: playerId,
        kind: 'choose-option',
        // Explicit stay vs move so the board can label clearly (min 1).
        options: ['move', 'stay'],
        min: 1,
        max: 1,
        reason: 'play:move',
      });
    }
    if (isMoveDeclined(chosen)) {
      return done([`${card.id}: move declined`]);
    }
    // 'move' | 'yes' | card id all mean apply the optional self-move
  } else if (moving === undefined) {
    const chosen = choices[promptId];
    if (chosen === undefined) {
      if (src.options.length === 0) return done([`${card.id}: move fizzles (no targets)`]);
      const options = optional ? [...src.options, '__none__'] : src.options;
      return needs({
        id: promptId, deciderId: playerId, kind: 'choose-card',
        options, min: optional ? 0 : 1, max: 1,
        reason: 'play:move',
      });
    }
    if (isMoveDeclined(chosen)) return done([`${card.id}: move declined`]);
    moving = Array.isArray(chosen) ? chosen[0] : chosen;
    if (moving === '__none__') return done([`${card.id}: move declined`]);
  }
  if (!moving) return done([`${card.id}: move fizzles (nothing to move)`]);

  const from = locateCard(G, moving);
  if (!from) return done([`${card.id}: move fizzles (${moving} not in play)`]);

  const blocked = isMoveBlocked(G, moving, playerId);
  if (blocked) return done([`${card.id}: move of ${moving} fizzles (${blocked})`]);

  const react = checkReactForMove(G, moving, playerId);
  if (react.cancelled) {
    return done([`${card.id}: move of ${moving} fizzles (react:cancel)`]);
  }
  let effectiveMoving = moving;
  if (react.redirectTo) {
    effectiveMoving = react.redirectTo;
  }

  // Relative move within era (amount + direction)
  const amount = tagNumber(card, 'move:amount');
  if (amount !== undefined) {
    const dir = tagValue(card, 'move:direction') ?? 'up';
    let delta = -amount; // 'up' = toward index 0
    if (dir === 'up-or-down') {
      const posChoice = choices[`${card.id}:move-position`];
      if (posChoice === undefined) {
        return needs({
          id: `${card.id}:move-position`, deciderId: playerId, kind: 'choose-option',
          options: ['up', 'down'], min: 1, max: 1, reason: 'move:direction:up-or-down',
        });
      }
      delta = posChoice === 'down' ? amount : -amount;
    }
    moveWithinEra(G, effectiveMoving, from.index + delta);
    return done([`${card.id}: moved ${effectiveMoving} ${delta < 0 ? 'up' : 'down'} ${Math.abs(delta)}`]);
  }

  const destTag = tagValue(card, 'move-destination');
  const dest = destTag ? parseDestination(ctx, destTag) : null;
  if (!dest) return done([`${card.id}: move fizzles (no destination)`]);

  if (dest.era !== from.era && isMoveDirectionPrevented(G, from.era, dest.era)) {
    return done([`${card.id}: move of ${effectiveMoving} to ${dest.era} fizzles (prevented direction)`]);
  }
  moveToEra(G, effectiveMoving, dest.era, dest.position);
  return done([`${card.id}: moved ${effectiveMoving} to ${dest.position} of ${dest.era}`]);
};
