import type { EraId } from '../../types';
import { hasTag, tagValue, tagNumber, isOptionalFor } from '../tags';
import { erasForScope, candidateTargets, locateCard } from '../targets';
import { moveWithinEra, moveToEra, isMoveBlocked, attachTo } from '../boardOps';
import { getAttachments } from '../state';
import { isMoveDirectionPrevented } from '../modifiers';
import {
  checkReactForMove,
  findClothMoveRedirectClaimants,
  applyClothMoveRedirect,
} from '../react';
import {
  getEraStoneCancelOffer,
  resolveEraStoneCancelChoice,
  eraStoneCancelPrompt,
} from '../eraAbilities';
import { getCard } from '../state';
import { done, needs, type Executor, type ExecCtx } from '../types';
import { playOnce } from '../playOnce';

interface Destination { era: EraId; position: 'top' | 'bottom' | number; }

function parseDestination(
  ctx: ExecCtx,
  dest: string,
  movingId?: string,
): Destination | null {
  const { G, card, choices } = ctx;
  const at = (scope: string) => erasForScope(G, scope, card.id)[0];
  switch (dest) {
    case 'top-today': return { era: at('today'), position: 'top' };
    case 'bottom-today': return { era: at('today'), position: 'bottom' };
    case 'tomorrow': {
      const era = erasForScope(G, 'tomorrow', card.id)[0];
      return era ? { era, position: 'bottom' } : null;
    }
    case 'top-of-era': {
      const era = locateCard(G, movingId || card.id)?.era;
      return era ? { era, position: 'top' } : null;
    }
    case 'any-position-same-era': {
      // Internet: any position in the same era as the target
      const loc = movingId ? locateCard(G, movingId) : null;
      if (!loc) return null;
      const posKey = `${card.id}:move-position-index`;
      const raw = choices[posKey];
      if (raw === undefined) {
        // Signal caller to prompt — return null with special handling
        return null;
      }
      const idx = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
      return {
        era: loc.era,
        position: Number.isNaN(idx) ? 'bottom' : idx,
      } as Destination;
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
  // Advertising: re-host action attachments
  if (target === 'action') {
    const eras = erasForScope(G, scope, card.id);
    const options: string[] = [];
    const attachments = getAttachments(G);
    for (const e of eras) {
      for (const invId of G.timeline[e]?.stack ?? []) {
        for (const actId of attachments[invId] ?? []) {
          if (actId !== card.id) options.push(actId);
        }
      }
      for (const actId of G.timeline[e]?.actions ?? []) {
        if (actId !== card.id) options.push(actId);
      }
    }
    return { options };
  }
  const kind = target === 'any-card' ? 'any' : 'invention';
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
      if (!G.firedTags) G.firedTags = [];
      const declineKey = `play-move-declined:${card.id}`;
      if (G.firedTags.includes(declineKey)) return done([]);
      G.firedTags.push(declineKey);
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
    if (isMoveDeclined(chosen) || (Array.isArray(chosen) ? chosen[0] : chosen) === '__none__') {
      if (!G.firedTags) G.firedTags = [];
      const declineKey = `play-move-declined:${card.id}`;
      if (G.firedTags.includes(declineKey)) return done([]);
      G.firedTags.push(declineKey);
      return done([`${card.id}: move declined`]);
    }
    moving = Array.isArray(chosen) ? chosen[0] : chosen;
  }
  if (!moving) return done([`${card.id}: move fizzles (nothing to move)`]);

  const from = locateCard(G, moving);
  if (!from) return done([`${card.id}: move fizzles (${moving} not in play)`]);

  const blocked = isMoveBlocked(G, moving, playerId);
  if (blocked) return done([`${card.id}: move of ${moving} fizzles (${blocked})`]);

  // Era-Stone: once-per-game cancel when a Stone Age invention would be moved
  {
    const offer = getEraStoneCancelOffer(G, moving, 'move', card.id);
    if (offer) {
      const ans = choices[offer.promptId];
      if (ans === undefined) {
        return needs(eraStoneCancelPrompt(offer));
      }
      if (resolveEraStoneCancelChoice(G, offer, ans)) {
        return done([
          `${card.id}: move of ${moving} cancelled (era-stone once-per-game)`,
        ]);
      }
    }
  }

  // Within-era reacts only (Cloth is out-of-era — handled after dest known)
  const react = checkReactForMove(G, moving, playerId, { outOfEra: false });
  if (react.cancelled) {
    return done([`${card.id}: move of ${moving} fizzles (react:cancel)`]);
  }
  let effectiveMoving = moving;
  if (react.redirectTo) {
    effectiveMoving = react.redirectTo;
  }

  // Relative move within era (amount + direction) — Cloth does not apply
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
    // Re-resolve after prompts must not shove the card again.
    const logs = playOnce(G, card.id, `move-rel:${effectiveMoving}:${delta}`, () => {
      // Re-locate at apply time (stack may have shifted since `from`).
      const live = locateCard(G, effectiveMoving);
      if (!live) return [`${card.id}: move fizzles (${effectiveMoving} not in play)`];
      moveWithinEra(G, effectiveMoving, live.index + delta);
      return [
        `${card.id}: moved ${effectiveMoving} ${delta < 0 ? 'up' : 'down'} ${Math.abs(delta)}`,
      ];
    });
    return done(logs);
  }

  const destTag = tagValue(card, 'move-destination');

  // Advertising: re-attach action to a different invention in the same era
  if (destTag === 'different-invention') {
    const hostKey = `${card.id}:move-new-host`;
    const hostChoice = choices[hostKey];
    const fromHost = Object.entries(getAttachments(G)).find(([, list]) =>
      list.includes(effectiveMoving),
    )?.[0];
    const era = from.era;
    const hosts = G.timeline[era].stack.filter((id) => id !== fromHost);
    if (hostChoice === undefined) {
      if (hosts.length === 0) return done([`${card.id}: re-host fizzles (no host)`]);
      return needs({
        id: hostKey,
        deciderId: playerId,
        kind: 'choose-card',
        options: hosts,
        min: 1,
        max: 1,
        reason: 'move-destination:different-invention',
      });
    }
    const newHost = Array.isArray(hostChoice) ? hostChoice[0] : hostChoice;
    if (!hosts.includes(newHost)) return done([`${card.id}: re-host fizzles (bad host)`]);
    // Detach from old host
    for (const [h, list] of Object.entries(getAttachments(G))) {
      const i = list.indexOf(effectiveMoving);
      if (i >= 0) list.splice(i, 1);
    }
    // Remove from era.actions if present
    const acts = G.timeline[era].actions ?? [];
    const ai = acts.indexOf(effectiveMoving);
    if (ai >= 0) acts.splice(ai, 1);
    attachTo(G, effectiveMoving, newHost);
    return done([`${card.id}: re-hosted ${effectiveMoving} onto ${newHost}`]);
  }

  // Internet: choose index within same era
  if (destTag === 'any-position-same-era') {
    const posKey = `${card.id}:move-position-index`;
    if (choices[posKey] === undefined) {
      const stack = G.timeline[from.era].stack;
      const options = stack.map((_, i) => String(i));
      return needs({
        id: posKey,
        deciderId: playerId,
        kind: 'choose-option',
        options: options.length ? options : ['0'],
        min: 1,
        max: 1,
        reason: 'move-destination:any-position-same-era',
      });
    }
  }

  const dest = destTag ? parseDestination(ctx, destTag, effectiveMoving) : null;
  if (!dest) return done([`${card.id}: move fizzles (no destination)`]);

  // Re-locate after possible self-redirect
  const fromLive = locateCard(G, effectiveMoving) ?? from;

  if (dest.era !== fromLive.era && isMoveDirectionPrevented(G, fromLive.era, dest.era)) {
    return done([`${card.id}: move of ${effectiveMoving} to ${dest.era} fizzles (prevented direction)`]);
  }

  // Cloth: out-of-era move of a peer invention must redirect to Cloth (multi = owner chooses)
  if (dest.era !== fromLive.era) {
    const cloths = findClothMoveRedirectClaimants(G, effectiveMoving);
    if (cloths.length > 0) {
      const clothKey = `${card.id}:cloth-absorb:${effectiveMoving}`;
      let chosen: string | undefined;
      if (cloths.length === 1) {
        chosen = cloths[0];
      } else if (choices[clothKey] !== undefined) {
        const raw = choices[clothKey];
        chosen = Array.isArray(raw) ? raw[0] : raw;
      } else {
        const owner =
          getCard(G, cloths[0])?.ownerId || fromLive.era || playerId;
        return needs({
          id: clothKey,
          deciderId: String(owner),
          kind: 'choose-card',
          options: cloths,
          min: 1,
          max: 1,
          reason: 'redirect:multi-cloth',
          labelCardId: cloths[0],
        });
      }
      const clothReact = applyClothMoveRedirect(
        G,
        effectiveMoving,
        playerId,
        chosen,
      );
      if (clothReact.cancelled) {
        return done([
          `${card.id}: move of ${effectiveMoving} fizzles (${clothReact.log || 'cloth-redirect'})`,
        ]);
      }
      if (clothReact.redirectTo) {
        effectiveMoving = clothReact.redirectTo;
      }
    } else {
      // Target itself may still have redirect tags
      const outReact = checkReactForMove(G, effectiveMoving, playerId, {
        outOfEra: true,
      });
      if (outReact.cancelled) {
        return done([
          `${card.id}: move of ${effectiveMoving} fizzles (${outReact.log || 'react'})`,
        ]);
      }
      if (outReact.redirectTo) effectiveMoving = outReact.redirectTo;
    }
  }

  const logs = playOnce(
    G,
    card.id,
    `move-era:${effectiveMoving}:${dest.era}:${dest.position}`,
    () => {
      moveToEra(G, effectiveMoving, dest.era, dest.position);
      return [
        `${card.id}: moved ${effectiveMoving} to ${dest.position} of ${dest.era}`,
      ];
    },
  );
  return done(logs);
};
