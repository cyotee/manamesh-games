import { hasTag, tagValue } from './tags';

// =============================================================================
// M3 React Pipeline (in progress)
// Reacts are checked on mutations/events in this order (per PRD):
// 1. Static protect: checks (cancel or permit the mutation)
// 2. Redirect / replace reacts (may change the target or outcome)
// 3. Cancel reacts (fizzle the (possibly redirected) effect)
// 4. After-effect: retaliates
// =============================================================================

export interface ReactDecision {
  cancelled: boolean;
  redirectTo?: string | null;
  replaceWith?: string | null;   // e.g. 'move' instead of discard
  retaliate?: boolean;
  log?: string;
}

/** Check static protects for a target card (used for move, discard, score-effects, etc.) */
export function isProtected(
  G: any,
  targetCardId: string,
  mutationType: 'move' | 'discard' | 'score-effects' | 'value-change' | 'targeted',
  actorPlayerId?: string
): boolean {
  const target = G.cards?.[targetCardId];
  if (!target) return false;

  const protectTag = `protect:${mutationType === 'score-effects' ? 'score-effects' : mutationType}`;

  // Direct protect on the card
  if (hasTag(target, 'protect:self') && hasTag(target, protectTag)) {
    const sourceOnly = hasTag(target, 'protect:source:opponent');
    if (!sourceOnly || (actorPlayerId && actorPlayerId !== target.ownerId)) {
      return true;
    }
  }

  // Attached protectors (e.g. Hibernation)
  const attachments = G.attachments?.[targetCardId] || [];
  for (const attId of attachments) {
    const att = G.cards?.[attId];
    if (att && hasTag(att, 'protect:target:attached') && hasTag(att, protectTag)) {
      return true;
    }
  }

  // Scope-based protects (e.g. Chainmail, same-era)
  // TODO: full scope checks (same-era, own-inventions, etc.)

  return false;
}

export function shouldCancelScoreEffects(G: any, cardId: string, sourceCardId?: string): boolean {
  if (isProtected(G, cardId, 'score-effects')) return true;

  const card = G.cards?.[cardId];
  if (!card) return false;

  if (hasTag(card, 'react:cancel') && hasTag(card, 'cancel:score-effects')) {
    return true;
  }
  return false;
}

export function shouldCancelDiscard(G: any, cardId: string, actorPlayerId?: string): boolean {
  if (isProtected(G, cardId, 'discard', actorPlayerId)) return true;

  const card = G.cards?.[cardId];
  if (!card) return false;

  if (hasTag(card, 'react:cancel') && hasTag(card, 'cancel:discard')) {
    return true;
  }
  // cancel:all-effects-of-source would be checked on the source side
  return false;
}

export function getRedirectTargetForDiscard(G: any, cardId: string, actorPlayerId?: string): string | null {
  const card = G.cards?.[cardId];
  if (!card) return null;

  if (hasTag(card, 'react:redirect') && hasTag(card, 'redirect:discard')) {
    const targetTo = tagValue(card, 'redirect:target-to');
    if (targetTo === 'self') return cardId;
    if (targetTo === 'adjacent') {
      // TODO: real adjacent lookup using locateCard
      return cardId; // placeholder
    }
    // decider:owner etc. would require prompting the owner
    return cardId;
  }
  return null;
}

export function getReplaceOutcomeForDiscard(G: any, cardId: string): string | null {
  const card = G.cards?.[cardId];
  if (!card) return null;

  if (hasTag(card, 'react:replace') && hasTag(card, 'replace:discard')) {
    if (hasTag(card, 'replace:discard-with-move')) {
      return 'move';
    }
    return 'replace-with-move';
  }
  return null;
}

export function getRetaliateOutcomeForDiscard(G: any, cardId: string, actorPlayerId: string): any {
  const card = G.cards?.[cardId];
  if (!card) return null;

  if (hasTag(card, 'retaliate:discard')) {
    return { type: 'discard', from: actorPlayerId, amount: 1 };
  }
  return null;
}

export function shouldCancelMove(G: any, cardId: string, actorPlayerId?: string): boolean {
  if (isProtected(G, cardId, 'move', actorPlayerId)) return true;

  const card = G.cards?.[cardId];
  if (!card) return false;

  if (hasTag(card, 'react:cancel') && hasTag(card, 'cancel:move')) {
    return true;
  }
  return false;
}

export function checkReactForMove(
  G: any,
  targetCardId: string,
  actorPlayerId: string
): ReactDecision {
  const decision: ReactDecision = { cancelled: false };

  if (shouldCancelMove(G, targetCardId, actorPlayerId)) {
    decision.cancelled = true;
    decision.log = 'react:cancel';
  }

  // TODO: add redirect/replace support for moves (Thought Police etc.)
  return decision;
}

// ---------------------------------------------------------------------------
// Central react decision for a discard mutation
// ---------------------------------------------------------------------------
export function checkReactForDiscard(
  G: any,
  targetCardId: string,
  actorPlayerId: string,
  sourceCardId?: string
): ReactDecision {
  const decision: ReactDecision = { cancelled: false };

  if (shouldCancelDiscard(G, targetCardId, actorPlayerId)) {
    decision.cancelled = true;
    decision.log = 'react:cancel';
    return decision;
  }

  // cancel:all-effects-of-source (Big Rock, Herbalism style)
  if (sourceCardId) {
    const target = G.cards?.[targetCardId];
    const source = G.cards?.[sourceCardId];
    if (target && source) {
      // If target (or its protectors) has cancel:all-effects-of-source for this source
      if (hasTag(target, 'react:cancel') && hasTag(target, 'cancel:all-effects-of-source')) {
        // simplistic: assume it matches the source
        decision.cancelled = true;
        decision.log = 'cancel:all-effects-of-source';
        return decision;
      }
    }
  }

  const redirect = getRedirectTargetForDiscard(G, targetCardId, actorPlayerId);
  if (redirect) {
    decision.redirectTo = redirect;
  }

  const replace = getReplaceOutcomeForDiscard(G, targetCardId);
  if (replace) {
    decision.replaceWith = replace;
  }

  const retaliate = getRetaliateOutcomeForDiscard(G, targetCardId, actorPlayerId);
  if (retaliate) {
    decision.retaliate = true;
  }

  return decision;
}

// ---------------------------------------------------------------------------
// Main entry point for the react pipeline on events (M3)
// Called from fireEvent for play events.
// ---------------------------------------------------------------------------
export function applyReactsForEvent(G: any, event: any): { cancelled?: boolean; redirected?: string; log: string[] } {
  const log: string[] = [];

  const targetId = event.cardId || event.targetCardId;
  if (!targetId) return { log };

  // Example: if a move or targeted event hits a protected card
  if (event.type === 'move' || event.type === 'targeted' || event.type === 'invention-played') {
    if (isProtected(G, targetId, event.type === 'move' ? 'move' : 'targeted', event.actorPlayerId)) {
      log.push(`react: protected ${targetId} from ${event.type}`);
      return { cancelled: true, log };
    }
  }

  // TODO: full lookup of reactors in the era / attached that have react:xxx for this event type,
  // then apply redirect/replace/cancel/retaliate per the PRD order.

  return { log };
}
