/**
 * Idempotency helpers for play-effect resolution.
 *
 * Play cards are often re-resolved after each prompt answer (or via accidental
 * double-submit). Side effects (move, draw, discard, swap, …) must run once
 * per physical play of a card instance.
 */
import type { TimestreamsState } from "../types";

function ensureFired(G: TimestreamsState): string[] {
  if (!G.firedTags) G.firedTags = [];
  return G.firedTags;
}

/** Stable key for a one-shot side effect of a played card. */
export function playOnceKey(cardId: string, effectKey: string): string {
  return `play-once:${cardId}:${effectKey}`;
}

export function hasPlayOnce(
  G: TimestreamsState,
  cardId: string,
  effectKey: string,
): boolean {
  return ensureFired(G).includes(playOnceKey(cardId, effectKey));
}

/**
 * Run `apply` at most once for (cardId, effectKey). Returns log lines from
 * apply, or [] if already applied (silent — callers should not re-log).
 */
export function playOnce(
  G: TimestreamsState,
  cardId: string,
  effectKey: string,
  apply: () => string[],
): string[] {
  const key = playOnceKey(cardId, effectKey);
  const fired = ensureFired(G);
  if (fired.includes(key)) return [];
  fired.push(key);
  return apply();
}

/** Mark this card's play effects fully finished (no further re-resolve). */
export function markPlayEffectsComplete(
  G: TimestreamsState,
  cardId: string,
): void {
  if (!G.playEffectsComplete) G.playEffectsComplete = {};
  G.playEffectsComplete[cardId] = true;
}

export function isPlayEffectsComplete(
  G: TimestreamsState,
  cardId: string,
): boolean {
  return !!G.playEffectsComplete?.[cardId];
}

/**
 * Clear once-gates for a card about to be freshly played from hand.
 * (New physical play may re-use the same instance id only if returned to hand.)
 */
export function resetPlayEffectGates(
  G: TimestreamsState,
  cardId: string,
): void {
  if (G.firedTags?.length) {
    const prefixes = [
      `play-once:${cardId}:`,
      `play-draw:${cardId}:`,
      `play-move-declined:${cardId}`,
    ];
    G.firedTags = G.firedTags.filter(
      (t) => !prefixes.some((p) => t === p || t.startsWith(p)),
    );
  }
  if (G.playEffectsComplete) delete G.playEffectsComplete[cardId];
}
