import { hasTag, tagValue, isOptionalFor } from './tags';
import { locateCard, cardAtOffset } from './targets';
import { getCard } from './state';

// =============================================================================
// M3 React Pipeline
// Reacts are checked on mutations/events in this order (per PRD):
// 1. Static protect: checks (cancel or permit the mutation)
// 2. Redirect / replace reacts (may change the target or outcome)
// 3. Cancel reacts (fizzle the (possibly redirected) effect)
// 4. After-effect: retaliates
//
// checkReactFor* are the main entry points used by executors.
// applyReactsForEvent is the event hook.
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

  // Direct protect on the card (must be protect:self + protect:move|discard|…)
  if (hasTag(target, 'protect:self') && hasTag(target, protectTag)) {
    const sourceOnly = hasTag(target, 'protect:source:opponent');
    if (!sourceOnly || (actorPlayerId && actorPlayerId !== target.ownerId)) {
      return true;
    }
  }

  // Attached protectors (e.g. Hibernation move/discard; score suppress is separate)
  const attachments = G.attachments?.[targetCardId] || [];
  for (const attId of attachments) {
    const att = G.cards?.[attId];
    if (!att) continue;
    if (hasTag(att, 'protect:target:attached') && hasTag(att, protectTag)) {
      return true;
    }
  }

  // Note: protect:scope:same-era / protect:target:own-inventions on Cloth/Chainmail
  // describe protecting *other* cards via react/redirect — they must NOT self-protect
  // the reactor. Those paths go through checkReactForMove / cancel reactors.

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

/**
 * Auto redirect only for *mandatory* redirects (e.g. Cloth → self).
 * Thought Police has `redirect:optional` + `decider:owner` — those must prompt
 * the owner. Auto-picking "adjacent" was wrong: after Fire lands below TP,
 * adjacent is often Fire itself, so the discarder self-destructed.
 */
export function getRedirectTargetForDiscard(G: any, cardId: string, actorPlayerId?: string): string | null {
  const card = G.cards?.[cardId];
  if (!card) return null;

  const declaresRedirect =
    hasTag(card, 'react:redirect') ||
    hasTag(card, 'react:discard') ||
    hasTag(card, 'react:targeted');
  const targetTo = tagValue(card, 'redirect:target-to');
  if (!declaresRedirect || !targetTo) return null;

  // Optional redirects are handled by the discard executor via a prompt.
  if (hasTag(card, 'redirect:optional') || isOptionalFor(card, 'redirect')) {
    return null;
  }

  if (targetTo === 'self') return cardId;
  if (targetTo === 'adjacent') {
    const below = cardAtOffset(G, cardId, 1);
    if (below) return below;
    const above = cardAtOffset(G, cardId, -1);
    if (above) return above;
    return null;
  }
  return cardId;
}

/** True when the card may redirect a discard and the owner must choose. */
export function hasOptionalDiscardRedirect(card: any): boolean {
  if (!card) return false;
  const declares =
    hasTag(card, 'react:redirect') ||
    hasTag(card, 'react:discard') ||
    hasTag(card, 'react:targeted');
  if (!declares) return false;
  if (!tagValue(card, 'redirect:target-to')) return false;
  return hasTag(card, 'redirect:optional') || isOptionalFor(card, 'redirect');
}

/** Adjacent invention ids for Thought Police–style redirect choices. */
export function adjacentRedirectOptions(G: any, cardId: string): string[] {
  const opts: string[] = [];
  const below = cardAtOffset(G, cardId, 1);
  const above = cardAtOffset(G, cardId, -1);
  if (below) opts.push(below);
  if (above) opts.push(above);
  return opts;
}

export function getReplaceOutcomeForDiscard(G: any, cardId: string): string | null {
  const card = G.cards?.[cardId];
  if (!card) return null;

  // Actual card (CDT) uses react:discard + replace:discard-with-move (no generic react:replace / replace:discard)
  const declaresReplace = hasTag(card, 'react:replace') || hasTag(card, 'react:discard');
  const hasReplaceDiscard = hasTag(card, 'replace:discard') || hasTag(card, 'replace:discard-with-move');
  if (declaresReplace && hasReplaceDiscard) {
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

/**
 * Cloth-style protectors in the same era that claim a mandatory redirect when
 * another of the owner's inventions would leave the era.
 * PRD §3.13: defending owner chooses among multiple Cloths.
 */
export function findClothMoveRedirectClaimants(
  G: any,
  targetCardId: string,
): string[] {
  const target = getCard(G, targetCardId);
  const loc = locateCard(G, targetCardId);
  if (!target || !loc) return [];
  // Cloth only protects *other* inventions (target:exclude-self)
  const claimants: string[] = [];
  for (const cid of G.timeline?.[loc.era]?.stack ?? []) {
    if (cid === targetCardId) continue;
    const c = getCard(G, cid);
    if (!c) continue;
    if (!hasTag(c, 'react:move')) continue;
    if (!hasTag(c, 'protect:target:own-inventions')) continue;
    if (c.ownerId !== target.ownerId) continue;
    if (hasTag(c, 'protect:scope:same-era') || hasTag(c, 'trigger:move-out-of-era')) {
      // same-era already by stack scan
    }
    const to = tagValue(c, 'redirect:target-to');
    if (to !== 'self' && !hasTag(c, 'redirect:target-to:self')) continue;
    // Optional redirects are separate (Thought Police)
    if (hasTag(c, 'redirect:optional') || isOptionalFor(c, 'redirect')) continue;
    claimants.push(cid);
  }
  return claimants;
}

/**
 * Resolve Cloth redirect for an out-of-era move.
 * @param chosenClothId when multiple Cloths, owner-selected id
 */
export function applyClothMoveRedirect(
  G: any,
  targetCardId: string,
  actorPlayerId: string,
  chosenClothId?: string | null,
): ReactDecision {
  const claimants = findClothMoveRedirectClaimants(G, targetCardId);
  if (claimants.length === 0) return { cancelled: false };

  let clothId: string | undefined;
  if (chosenClothId && claimants.includes(chosenClothId)) {
    clothId = chosenClothId;
  } else if (claimants.length === 1) {
    clothId = claimants[0];
  } else {
    // Multiple claimants and no choice yet — caller must prompt
    return {
      cancelled: false,
      log: 'react:multi-cloth-needs-choice',
      redirectTo: null,
    };
  }

  const cloth = getCard(G, clothId!);
  if (!cloth) return { cancelled: false };

  // Redirect effect onto Cloth
  if (isProtected(G, clothId!, 'move', actorPlayerId)) {
    return {
      cancelled: true,
      redirectTo: clothId,
      log: hasTag(cloth, 'redirect:on-immovable:fizzle')
        ? 'react:redirect-on-immovable-fizzle'
        : 'react:redirect-fizzle',
    };
  }
  return {
    cancelled: false,
    redirectTo: clothId,
    log: `react:cloth-redirect:${targetCardId}->${clothId}`,
  };
}

export function checkReactForMove(
  G: any,
  targetCardId: string,
  actorPlayerId: string,
  opts?: { chosenClothId?: string; outOfEra?: boolean },
): ReactDecision {
  const decision: ReactDecision = { cancelled: false };

  if (shouldCancelMove(G, targetCardId, actorPlayerId)) {
    decision.cancelled = true;
    decision.log = 'react:cancel';
    return decision;
  }

  // Cloth protectors: only for out-of-era moves of a peer invention
  if (opts?.outOfEra !== false) {
    const cloths = findClothMoveRedirectClaimants(G, targetCardId);
    if (cloths.length > 0) {
      // When outOfEra is explicitly false, skip; when undefined, only apply if caller wants
      if (opts?.outOfEra === true) {
        return applyClothMoveRedirect(
          G,
          targetCardId,
          actorPlayerId,
          opts?.chosenClothId,
        );
      }
    }
  }

  // Basic redirect support for moves (e.g. Cloth self, Thought Police adjacent)
  // Use tagValue(prefix) — tags are redirect:target-to:self, not exact redirect:target-to
  const card = G.cards?.[targetCardId];
  const targetTo = card ? tagValue(card, 'redirect:target-to') : undefined;
  if (card && hasTag(card, 'react:move') && targetTo) {
    // redirect:decider:owner — owner may choose; default self when no choice provided
    if (targetTo === 'self' || hasTag(card, 'redirect:target-filter:any')) {
      decision.redirectTo = targetCardId;
    } else if (targetTo === 'adjacent') {
      const below = cardAtOffset(G, targetCardId, 1);
      if (below) decision.redirectTo = below;
      else {
        const above = cardAtOffset(G, targetCardId, -1);
        if (above) decision.redirectTo = above;
      }
    }
    if (decision.redirectTo) {
      // re-check protect on new target; redirect:on-immovable:fizzle
      if (isProtected(G, decision.redirectTo, 'move', actorPlayerId)) {
        decision.cancelled = true;
        decision.log = hasTag(card, 'redirect:on-immovable:fizzle')
          ? 'react:redirect-on-immovable-fizzle'
          : 'react:redirect-fizzle';
      }
    } else if (hasTag(card, 'redirect:on-immovable:fizzle')) {
      decision.cancelled = true;
      decision.log = 'react:redirect-on-immovable-fizzle';
    }
  }

  return decision;
}

/**
 * limit:once-per-game — track whether a card's limited react/steal has been used.
 */
export function isOncePerGameSpent(G: any, cardId: string): boolean {
  const used = (G.oncePerGameUsed as string[] | undefined) || [];
  return used.includes(cardId);
}

export function markOncePerGameUsed(G: any, cardId: string): void {
  if (!G.oncePerGameUsed) G.oncePerGameUsed = [];
  if (!G.oncePerGameUsed.includes(cardId)) G.oncePerGameUsed.push(cardId);
}

/** Steal bonus points react (era-medieval): once per game when conditions match. */
export function tryStealBonusPoints(
  G: any,
  sourceCardId: string,
  bonusOwnerId: string,
  amount: number,
): { stolen: number; log: string } {
  const card = G.cards?.[sourceCardId];
  if (!card) return { stolen: 0, log: 'no card' };
  if (!hasTag(card, 'steal:bonus-points')) return { stolen: 0, log: 'no steal' };
  if (hasTag(card, 'limit:once-per-game') && isOncePerGameSpent(G, sourceCardId)) {
    return { stolen: 0, log: 'once-per-game spent' };
  }
  markOncePerGameUsed(G, sourceCardId);
  // suppress:original-bonus-points handled by caller returning stolen amount to reassign
  return { stolen: amount, log: `${sourceCardId}: stole ${amount} from ${bonusOwnerId}` };
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

  // Check redirect/replace first (per retarget pipeline; allows replace to transform even if protected tags present, e.g. CDT)
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

  // Cancel/protect only if no redirect/replace claimed the effect (static protect before cancel in comment, but react transforms take precedence for retarget/replace)
  const hasRedirectOrReplace = !!(decision.redirectTo || decision.replaceWith);
  if (!hasRedirectOrReplace) {
    if (shouldCancelDiscard(G, targetCardId, actorPlayerId)) {
      decision.cancelled = true;
      decision.log = 'react:cancel';
      return decision;
    }
  }

  // cancel:all-effects-of-source (Big Rock, Herbalism style) — applies to original unless redirected
  if (sourceCardId && !hasRedirectOrReplace) {
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

  // Full (basic) lookup of reactors in eras that have react: matching the event
  // (scans stacks for cards declaring react:<type> or react:targeted etc.)
  const reactors: string[] = [];
  const eras = Object.keys(G.timeline || {});
  for (const era of eras) {
    const stack = G.timeline[era]?.stack || [];
    for (const cid of stack) {
      const c = getCard(G, cid);
      if (!c) continue;
      const reactTag = `react:${event.type || ''}`;
      if (hasTag(c, reactTag) || hasTag(c, 'react:targeted') || hasTag(c, 'react:discard') || hasTag(c, 'react:move')) {
        if (!reactors.includes(cid)) reactors.push(cid);
      }
    }
  }
  if (reactors.length) {
    log.push(`react: potential reactors found: ${reactors.join(',')}`);
    // For now, log; full decision application per target would delegate to checkReact* in executors
    // Future: for each reactor apply getRedirect etc if applicable to event.
  }

  return { log };
}
