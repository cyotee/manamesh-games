import type { TimestreamsState, TimestreamsCard, ActiveModifier, PendingTrigger, TurnFlags } from '../types';

export function getCards(G: TimestreamsState): Record<string, TimestreamsCard> {
  if (!G.cards) G.cards = {};
  return G.cards;
}

export function registerCard(G: TimestreamsState, card: TimestreamsCard): void {
  getCards(G)[card.id] = card;
}

export function getCard(G: TimestreamsState, cardId: string): TimestreamsCard | undefined {
  return getCards(G)[cardId];
}

export function requireCard(G: TimestreamsState, cardId: string): TimestreamsCard {
  const card = getCard(G, cardId);
  if (!card) throw new Error(`unknown card: ${cardId}`);
  return card;
}

export function getAttachments(G: TimestreamsState): Record<string, string[]> {
  if (!G.attachments) G.attachments = {};
  return G.attachments;
}

export function getModifiers(G: TimestreamsState): ActiveModifier[] {
  if (!G.modifiers) G.modifiers = [];
  return G.modifiers;
}

export function getPendingTriggers(G: TimestreamsState): PendingTrigger[] {
  if (!G.pendingTriggers) G.pendingTriggers = [];
  return G.pendingTriggers;
}

export function getTurnFlags(G: TimestreamsState, playerId: string): TurnFlags {
  if (!G.turnFlags) G.turnFlags = {};
  if (!G.turnFlags[playerId]) {
    G.turnFlags[playerId] = {
      skipNextTurn: false, extraTurns: 0, noInventionThisTurn: false, allowNextInventionEra: null,
    };
  }
  return G.turnFlags[playerId];
}
