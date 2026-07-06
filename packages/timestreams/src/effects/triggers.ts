import type { TimestreamsState, TimestreamsCard, EraId, PendingTrigger } from '../types';
import { requestDraws } from '../crypto';
import { getCard, getPendingTriggers, getTurnFlags, getAttachments } from './state';
import { hasTag, tagValue, tagNumber } from './tags';
import { locateCard } from './targets';
import { moveToEra, discardFromPlay } from './boardOps';
import { applyReactsForEvent } from './react';
import type { PlayerPrompt } from './types';

export interface PlayEvent {
  type: 'invention-played' | 'action-played' | 'discarded-from-play';
  cardId: string;
  eraId: EraId | null;
  actorPlayerId: string;
}

/** Register standing watchers carried by a card entering play (Taxes, Dot Com — Dot Com deferred to M3 value checks if desired, see coverage list). */
export function registerStaticTriggers(G: TimestreamsState, card: TimestreamsCard): void {
  if (hasTag(card, 'ongoing:trigger:discarded-from-play')) {
    getPendingTriggers(G).push({
      sourceCardId: card.id, ownerId: card.ownerId,
      event: 'discarded-from-play', eraAnchor: null, limit: 'ongoing', spent: false,
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
  G: TimestreamsState, trigger: PendingTrigger, source: TimestreamsCard, ev: PlayEvent, log: string[],
): void {
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
  // Waylay
  if (hasTag(source, 'move:target:attached') && tagValue(source, 'move:destination') === 'end-of-era') {
    const host = findAttachedHost(G, source.id);
    const era = trigger.eraAnchor ?? (host ? locateCard(G, host)?.era ?? null : null);
    if (host && era) {
      moveToEra(G, host, era, 'bottom');
      log.push(`${source.id}: moved ${host} to end of ${era}`);
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
  const log: string[] = [];
  for (const trigger of getPendingTriggers(G)) {
    if (trigger.spent) continue;
    // support both exact event and 'era-scored' for delayed score triggers
    const matchesEvent = trigger.event === ev.type || (ev.type === 'era-scored' && trigger.event === 'delayed:era-scored');
    if (!matchesEvent) continue;
    if (trigger.eraAnchor && trigger.eraAnchor !== ev.eraId) continue;
    const source = getCard(G, trigger.sourceCardId);
    if (!source) continue;
    if (hasTag(source, 'trigger:target:self') && ev.cardId !== source.id) continue;
    if (hasTag(source, 'trigger:sixth-invention-in-era')) {
      const era = trigger.eraAnchor;
      const count = era ? G.timeline[era].stack.filter(id => getCard(G, id)?.cardType === 'invention').length : 0;
      if (count !== 6) continue;
    }
    applyTriggerEffect(G, trigger, source, ev, log);
    if (trigger.limit === 'once') trigger.spent = true;
  }

  // Run the react pipeline on the event (central hook for M3)
  const reactResult = applyReactsForEvent(G, ev);
  if (reactResult.log && reactResult.log.length) log.push(...reactResult.log);

  return { prompts: [], log };
}
