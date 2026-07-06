import type { TimestreamsState, EraId } from '../types';
import { getCard, requireCard, getAttachments } from './state';
import { hasTag, tagNumber } from './tags';
import { locateCard } from './targets';

export function effectiveScoreValue(G: TimestreamsState, cardId: string): number {
  const card = requireCard(G, cardId);
  let value = card.scoreValue ?? 0;
  for (const attId of getAttachments(G)[cardId] ?? []) {
    const att = getCard(G, attId);
    if (att && hasTag(att, 'modify:score:attached')) {
      value += tagNumber(att, 'modify:amount') ?? 0;
    }
  }
  return value;
}

function protectionBlocks(
  G: TimestreamsState, cardId: string, actorPlayerId: string, protectTag: 'protect:move' | 'protect:discard',
): string | null {
  const card = requireCard(G, cardId);
  // The card's own protection.
  if (hasTag(card, 'protect:self') && hasTag(card, protectTag)) {
    const opponentOnly = hasTag(card, 'protect:source:opponent');
    if (!opponentOnly || actorPlayerId !== card.ownerId) return protectTag;
  }
  // Protection granted by attachments (Hibernation).
  for (const attId of getAttachments(G)[cardId] ?? []) {
    const att = getCard(G, attId);
    if (att && hasTag(att, 'protect:target:attached') && hasTag(att, protectTag)) return protectTag;
  }
  return null;
}

export function isMoveBlocked(G: TimestreamsState, cardId: string, actorPlayerId: string): string | null {
  return protectionBlocks(G, cardId, actorPlayerId, 'protect:move');
}

export function isDiscardBlocked(G: TimestreamsState, cardId: string, actorPlayerId: string): string | null {
  return protectionBlocks(G, cardId, actorPlayerId, 'protect:discard');
}

function removeFromStack(G: TimestreamsState, cardId: string): EraId | null {
  const loc = locateCard(G, cardId);
  if (!loc) return null;
  G.timeline[loc.era].stack.splice(loc.index, 1);
  return loc.era;
}

export function moveWithinEra(G: TimestreamsState, cardId: string, toIndex: number): boolean {
  const loc = locateCard(G, cardId);
  if (!loc) return false;
  const stack = G.timeline[loc.era].stack;
  stack.splice(loc.index, 1);
  stack.splice(Math.max(0, Math.min(toIndex, stack.length)), 0, cardId);
  return true;
}

export function moveToEra(
  G: TimestreamsState, cardId: string, toEra: EraId, position: 'top' | 'bottom' | number,
): boolean {
  if (removeFromStack(G, cardId) === null) return false;
  const stack = G.timeline[toEra].stack;
  const index = position === 'top' ? 0 : position === 'bottom' ? stack.length : position;
  stack.splice(Math.max(0, Math.min(index, stack.length)), 0, cardId);
  return true;
}

export function attachTo(G: TimestreamsState, actionCardId: string, hostCardId: string): void {
  const attachments = getAttachments(G);
  if (!attachments[hostCardId]) attachments[hostCardId] = [];
  attachments[hostCardId].push(actionCardId);
}

export function discardFromPlay(G: TimestreamsState, cardId: string, actorPlayerId: string): boolean {
  if (removeFromStack(G, cardId) === null) return false;
  const attachments = getAttachments(G);
  const attached = attachments[cardId] ?? [];
  delete attachments[cardId];
  for (const id of [cardId, ...attached]) {
    const card = requireCard(G, id);
    G.players[card.ownerId]?.discard.push(card);
  }
  return true;
}
