import type { TimestreamsState, TimestreamsCard, EraId, PendingTrigger } from '../types';
import { requestDraws } from '../crypto';
import { getCard, getPendingTriggers, getTurnFlags, getAttachments } from './state';
import { hasTag, tagValue, tagNumber } from './tags';
import { locateCard, cardAtOffset, candidateTargets } from './targets';
import { moveToEra, discardFromPlay, effectiveScoreValue } from './boardOps';
import { applyReactsForEvent } from './react';
import { eraForDay } from '../timeline';
import type { PlayerPrompt } from './types';

export interface PlayEvent {
  type: 'invention-played' | 'action-played' | 'discarded-from-play' | 'move' | string;
  cardId: string;
  eraId: EraId | null;
  actorPlayerId: string;
}

/** Register standing watchers carried by a card entering play (Taxes, Crop Rotation, Dot Com, …). */
export function registerStaticTriggers(G: TimestreamsState, card: TimestreamsCard): void {
  if (hasTag(card, 'ongoing:trigger:discarded-from-play')) {
    getPendingTriggers(G).push({
      sourceCardId: card.id, ownerId: card.ownerId,
      event: 'discarded-from-play', eraAnchor: null, limit: 'ongoing', spent: false,
    });
  }
  // Crusades: retaliate when opponent discards your inventions (not necessarily on Crusades itself)
  if (
    hasTag(card, 'react:discard') &&
    hasTag(card, 'retaliate:discard') &&
    hasTag(card, 'trigger:source:opponent') &&
    hasTag(card, 'trigger:target:own-inventions')
  ) {
    getPendingTriggers(G).push({
      sourceCardId: card.id,
      ownerId: card.ownerId,
      event: 'discarded-from-play',
      eraAnchor: null,
      limit: 'ongoing',
      spent: false,
    });
  }
  if (
    hasTag(card, 'ongoing:trigger:invention-played') ||
    hasTag(card, 'react:invention-played')
  ) {
    const loc = locateCard(G, card.id);
    const persist = hasTag(card, 'trigger:persists:after-today-advances');
    getPendingTriggers(G).push({
      sourceCardId: card.id,
      ownerId: card.ownerId,
      event: 'invention-played',
      eraAnchor: loc?.era ?? null,
      limit: 'ongoing',
      spent: false,
    });
    // ensure eraAnchor updates aren't required when persists — fireEvent compares era
    void persist;
  }
  if (hasTag(card, 'react:move') && hasTag(card, 'condition:higher-value-invention')) {
    // Dot Com also watches moves into its era via fireEvent move (if emitted)
    getPendingTriggers(G).push({
      sourceCardId: card.id,
      ownerId: card.ownerId,
      event: 'move',
      eraAnchor: locateCard(G, card.id)?.era ?? null,
      limit: 'ongoing',
      spent: false,
    });
  }
  // International Diplomacy: react when this card is moved / value-changed by opponent
  if (
    hasTag(card, 'react:move') &&
    hasTag(card, 'retaliate:discard') &&
    hasTag(card, 'trigger:target:self')
  ) {
    getPendingTriggers(G).push({
      sourceCardId: card.id,
      ownerId: card.ownerId,
      event: 'move',
      eraAnchor: null,
      limit: 'ongoing',
      spent: false,
    });
  }
}

function findAttachedHost(G: TimestreamsState, attachedId: string): string | null {
  for (const [host, atts] of Object.entries(getAttachments(G))) {
    if (atts.includes(attachedId)) return host;
  }
  return null;
}

function applyTriggerEffect(
  G: TimestreamsState,
  trigger: PendingTrigger,
  source: TimestreamsCard,
  ev: PlayEvent,
  log: string[],
  prompts: PlayerPrompt[],
): void {
  // Dot Com: mandatory discard self when higher-value invention enters same era
  if (
    hasTag(source, 'discard:self') &&
    hasTag(source, 'condition:higher-value-invention') &&
    (ev.type === 'invention-played' || (ev as any).type === 'move')
  ) {
    if (ev.cardId === source.id) return;
    const peer = getCard(G, ev.cardId);
    if (!peer || peer.cardType !== 'invention') return;
    const srcLoc = locateCard(G, source.id);
    const peerLoc = locateCard(G, ev.cardId);
    const sameEra =
      (trigger.eraAnchor && peerLoc?.era === trigger.eraAnchor) ||
      (srcLoc && peerLoc && srcLoc.era === peerLoc.era) ||
      (ev.eraId && srcLoc && srcLoc.era === ev.eraId);
    if (!sameEra) return;
    if (effectiveScoreValue(G, ev.cardId) > effectiveScoreValue(G, source.id)) {
      discardFromPlay(G, source.id, ev.actorPlayerId);
      log.push(`${source.id}: discarded self (higher-value invention ${ev.cardId})`);
    }
    return;
  }

  // Crop Rotation: optional swap with adjacent when invention played in era
  if (
    hasTag(source, 'swap:target:self') &&
    hasTag(source, 'swap:scope:adjacent') &&
    ev.type === 'invention-played'
  ) {
    if (ev.cardId === source.id) return;
    const options = [cardAtOffset(G, source.id, -1), cardAtOffset(G, source.id, 1)].filter(
      (x): x is string => !!x,
    );
    if (options.length === 0) {
      log.push(`${source.id}: crop-rotation no adjacent partner`);
      return;
    }
    const promptId = `${source.id}:crop-swap:${ev.cardId}`;
    // Surface optional swap: partner choice or __none__
    // reason is distinct from invent play:swap (`swap:target:self` / Organ Transplant)
    // so submitPlayChoice routes Crop here and Organ through resolvePlayEffect.
    prompts.push({
      id: promptId,
      deciderId: source.ownerId,
      kind: 'choose-card',
      options: [...options, '__none__'],
      min: 0,
      max: 1,
      reason: 'crop-swap',
      labelCardId: source.id,
    });
    log.push(`${source.id}: crop-rotation — choose adjacent swap (or None)`);
    return;
  }

  // Crusades: when opponent discards your invention, discard one of theirs in same era
  if (
    hasTag(source, 'retaliate:discard') &&
    hasTag(source, 'trigger:target:own-inventions') &&
    ev.type === 'discarded-from-play'
  ) {
    const victim = getCard(G, ev.cardId);
    if (!victim || victim.ownerId !== source.ownerId) return;
    if (ev.actorPlayerId === source.ownerId) return;
    if (hasTag(source, 'trigger:source:opponent') && ev.actorPlayerId === source.ownerId) return;
    const era =
      (ev as any).eraId ||
      locateCard(G, ev.cardId)?.era ||
      null;
    // Victim already left play — use event era if provided
    const scopeEra = era || eraForDay(Math.min(G.currentDay, 6));
    const enemyInventions = (G.timeline[scopeEra as EraId]?.stack || []).filter((id) => {
      const c = getCard(G, id);
      return c && c.cardType === 'invention' && c.ownerId === ev.actorPlayerId;
    });
    if (enemyInventions.length === 0) {
      log.push(`${source.id}: crusades fizzles (no enemy invention in ${scopeEra})`);
      return;
    }
    if (enemyInventions.length === 1) {
      discardFromPlay(G, enemyInventions[0], source.ownerId);
      log.push(`${source.id}: crusades discarded ${enemyInventions[0]}`);
      return;
    }
    prompts.push({
      id: `${source.id}:crusades-retaliate:${ev.cardId}`,
      deciderId: source.ownerId,
      kind: 'choose-card',
      options: enemyInventions,
      min: 1,
      max: 1,
      reason: 'retaliate:discard',
      labelCardId: source.id,
    });
    log.push(`${source.id}: crusades — choose enemy invention to discard`);
    return;
  }

  // International Diplomacy: when this card is moved by an opponent, may discard
  // any other Invention in Today (not itself).
  if (
    hasTag(source, 'react:move') &&
    hasTag(source, 'retaliate:discard') &&
    hasTag(source, 'trigger:target:self') &&
    ev.type === 'move' &&
    ev.cardId === source.id
  ) {
    if (hasTag(source, 'trigger:source:opponent') && ev.actorPlayerId === source.ownerId) {
      return;
    }
    if (ev.actorPlayerId === source.ownerId) return;
    const today =
      (G as any).scoringActiveEra ||
      eraForDay(Math.min(G.currentDay, 6));
    const options = candidateTargets(G, {
      kind: 'invention',
      eras: [today as EraId],
      excludeCardId: source.id,
    });
    if (options.length === 0) {
      log.push(`${source.id}: international-diplomacy no other Today inventions`);
      return;
    }
    prompts.push({
      id: `${source.id}:id-retaliate:${ev.cardId}:${Date.now()}`,
      deciderId: source.ownerId,
      kind: 'choose-card',
      options: ['__none__', ...options],
      min: 0,
      max: 1,
      reason: 'retaliate:discard',
      labelCardId: source.id,
    });
    log.push(`${source.id}: international-diplomacy — may discard another Today invention`);
    return;
  }

  // Media Scandal
  if (hasTag(source, 'discard:by:triggering-action-player')) {
    const n = tagNumber(source, 'discard:hand') ?? 3;
    const hand = G.players[ev.actorPlayerId].hand;
    if (hand.length <= n && hasTag(source, 'discard:whole-hand-if-fewer')) {
      G.players[ev.actorPlayerId].discard.push(...hand.splice(0, hand.length));
      log.push(`${source.id}: ${ev.actorPlayerId} discarded whole hand`);
    } else {
      // deterministic policy for M2: discard from the end of hand; refine to a prompt in M3 if desired
      const removed = hand.splice(Math.max(0, hand.length - n), n);
      G.players[ev.actorPlayerId].discard.push(...removed);
      log.push(`${source.id}: ${ev.actorPlayerId} discarded ${removed.length}`);
    }
  }
  // Television
  if (hasTag(source, 'skip-turn:target:triggering-player')) {
    getTurnFlags(G, ev.actorPlayerId).skipNextTurn = true;
    log.push(`${source.id}: ${ev.actorPlayerId} skips next turn`);
  }
  if (hasTag(source, 'draw:to:triggering-player')) {
    requestDraws(G, ev.actorPlayerId, tagNumber(source, 'draw') ?? 1);
  }
  // Waylay — move host to end of era, then fire move so International Diplomacy etc. can react
  if (hasTag(source, 'move:target:attached') && tagValue(source, 'move:destination') === 'end-of-era') {
    const host = findAttachedHost(G, source.id);
    const era = trigger.eraAnchor ?? (host ? locateCard(G, host)?.era ?? null : null);
    if (host && era && ev.cardId !== host) {
      // Only move when a *different* invention is played in the era (not the host's own attach)
      moveToEra(G, host, era, 'bottom');
      log.push(`${source.id}: moved ${host} to end of ${era}`);
      // Nested move event for host (Waylay actor = the player who played the triggering invention)
      const nested = fireEvent(G, {
        type: 'move',
        cardId: host,
        eraId: era,
        actorPlayerId: ev.actorPlayerId,
      });
      log.push(...nested.log);
      prompts.push(...nested.prompts);
    }
  }
  // Hunting Party
  if (hasTag(source, 'discard:triggering-invention')) {
    discardFromPlay(G, ev.cardId, source.ownerId);
    log.push(`${source.id}: discarded triggering invention ${ev.cardId}`);
    if (hasTag(source, 'discard:self')) {
      discardFromPlay(G, source.id, source.ownerId);
    }
  }
  // Taxes
  if (hasTag(source, 'draw:to:discarder')) {
    requestDraws(G, ev.actorPlayerId, tagNumber(source, 'draw') ?? 2);
    log.push(`${source.id}: discarder ${ev.actorPlayerId} draws`);
  }
}

export function fireEvent(G: TimestreamsState, ev: PlayEvent): { prompts: PlayerPrompt[]; log: string[] } {
  if (!G.firedTags) G.firedTags = [];
  G.firedTags.push(`event:${ev.type || 'unknown'}`);
  if (ev.cardId) G.firedTags.push(`card:${ev.cardId}`);
  const log: string[] = [];
  const prompts: PlayerPrompt[] = [];
  for (const trigger of getPendingTriggers(G)) {
    if (trigger.spent) continue;
    // support both exact event and 'era-scored' for delayed score triggers
    const matchesEvent = trigger.event === ev.type || (ev.type === 'era-scored' && trigger.event === 'delayed:era-scored');
    if (!matchesEvent) continue;
    // Waylay / crop: era filter — invention-played in same era as trigger
    if (trigger.eraAnchor && trigger.eraAnchor !== ev.eraId && ev.type !== 'move') continue;
    const source = getCard(G, trigger.sourceCardId);
    if (!source) continue;
    if (hasTag(source, 'trigger:target:self') && ev.cardId !== source.id) continue;
    if (hasTag(source, 'trigger:sixth-invention-in-era')) {
      const era = trigger.eraAnchor;
      const count = era ? G.timeline[era].stack.filter(id => getCard(G, id)?.cardType === 'invention').length : 0;
      if (count !== 6) continue;
    }
    applyTriggerEffect(G, trigger, source, ev, log, prompts);
    if (trigger.limit === 'once') trigger.spent = true;
  }

  // Run the react pipeline on the event (central hook for M3)
  const reactResult = applyReactsForEvent(G, ev);
  if (reactResult.log && reactResult.log.length) log.push(...reactResult.log);

  return { prompts, log };
}
