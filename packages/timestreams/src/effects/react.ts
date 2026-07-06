import { hasTag } from './tags';

// Basic M3 react / protect utilities.
// For now focused on score effects (protect:score-effects, suppress:score-effects-on-target).
// Will expand to full react pipeline (cancel, redirect, replace, retaliate) later.

export function isScoreEffectsSuppressed(G: any, cardId: string): boolean {
  const card = G.cards?.[cardId];
  if (!card) return false;
  if (hasTag(card, 'protect:score-effects') || hasTag(card, 'suppress:score-effects-on-target')) {
    return true;
  }
  // TODO: check attached protectors, source-specific, etc.
  return false;
}

export function shouldCancelScoreEffects(G: any, cardId: string, sourceCardId?: string): boolean {
  const card = G.cards?.[cardId];
  if (!card) return false;

  // direct protect on the card
  if (isScoreEffectsSuppressed(G, cardId)) return true;

  // simplistic react:cancel on the card itself or a protector
  if (hasTag(card, 'react:cancel') && hasTag(card, 'cancel:score-effects')) {
    return true;
  }

  // TODO: full pipeline with pending triggers, redirects, source checks, etc.
  return false;
}

export function shouldCancelDiscard(G: any, cardId: string): boolean {
  const card = G.cards?.[cardId];
  if (!card) return false;

  if (hasTag(card, 'protect:discard') || hasTag(card, 'react:cancel') && hasTag(card, 'cancel:discard')) {
    return true;
  }

  // TODO: attached, source-specific, etc.
  return false;
}

// Placeholder for future full react application during events.
export function applyReactsForEvent(G: any, event: any): void {
  // TODO: implement cancel/redirect/replace/retaliate pipeline
  // using pendingTriggers, protect checks, etc.
}
