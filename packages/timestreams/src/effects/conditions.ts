/**
 * Shared condition evaluator for score/bonus/react tags (gap-closure plan Phase 0/1).
 * Tag-driven only — no card names.
 */
import type { TimestreamsState, TimestreamsCard, EraId } from "../types";
import { hasTag, isDeckMember, type DeckId } from "./tags";
import { getCard, getAttachments } from "./state";
import { locateCard } from "./targets";
import { effectiveScoreValue } from "./boardOps";
import { computeScoringSlotsForEra } from "../scoringSlots";
import { scoringSlotCardIds } from "../timeline";

export interface ConditionContext {
  G: TimestreamsState;
  /** Card whose tags/conditions are being evaluated */
  card: TimestreamsCard;
  /** Era being scored / acted in */
  eraId: EraId | string;
  /** 0-based scoring slot index when known; -1 if not a slot */
  slotIndex: number;
  /** Optional peer card (branch next-invention, higher-value, etc.) */
  peerCardId?: string | null;
  /** Optional copy/bonus target for additional:condition */
  targetCardId?: string | null;
  choices?: Record<string, string | string[]>;
}

function deckOfCardId(cardId: string): DeckId | "" {
  if (cardId.startsWith("stone-age") || cardId.startsWith("stone")) return "stone-age";
  if (cardId.startsWith("medieval")) return "medieval";
  if (cardId.startsWith("modern")) return "modern";
  if (cardId.startsWith("future")) return "future-tech";
  return "";
}

/** True if this card has already completed a score-ability resolution this game. */
export function hasUsedFirstScore(G: TimestreamsState, cardId: string): boolean {
  const used = (G as any).firstScoreUsed as string[] | undefined;
  return !!used?.includes(cardId);
}

export function markFirstScoreUsed(G: TimestreamsState, cardId: string): void {
  if (!(G as any).firstScoreUsed) (G as any).firstScoreUsed = [];
  const list = (G as any).firstScoreUsed as string[];
  if (!list.includes(cardId)) list.push(cardId);
}

/**
 * Evaluate all condition:* tags on `card` as a conjunction.
 * Tags that are not condition:* are ignored.
 * Unknown condition tags fail closed (return false) so bonuses do not fire wrongly.
 */
export function evaluateConditions(ctx: ConditionContext): boolean {
  const { G, card, eraId, slotIndex } = ctx;
  const tags = card.tags ?? [];
  const conditionTags = tags.filter((t) => t.startsWith("condition:"));
  if (conditionTags.length === 0) return true;

  for (const t of conditionTags) {
    if (!evaluateOneCondition(t, ctx)) return false;
  }
  return true;
}

function evaluateOneCondition(tag: string, ctx: ConditionContext): boolean {
  const { G, card, eraId, slotIndex, peerCardId, targetCardId } = ctx;
  const rest = tag.slice("condition:".length);

  if (rest === "scored-in-era:future" || rest === "in-era:future") {
    return eraId === "future";
  }
  if (rest.startsWith("scored-in-era:")) {
    return eraId === rest.slice("scored-in-era:".length);
  }
  if (rest.startsWith("in-era:")) {
    return eraId === rest.slice("in-era:".length);
  }
  if (rest === "odd-scoring-slot") {
    // 1-based odd: first, third, … → 0-based even indices
    if (slotIndex < 0) return false;
    return slotIndex % 2 === 0;
  }
  if (rest === "in-last-scoring-slot") {
    if (slotIndex < 0) return false;
    const cap = computeScoringSlotsForEra(G, eraId as EraId, ctx.choices || {});
    return slotIndex === cap - 1;
  }
  if (rest === "in-scoring-slot") {
    // Used with subtype checks for peer presence in scoring slots — handled below
    // as a standalone: true when this card itself is in a scoring slot
    if (slotIndex >= 0) return true;
    const loc = locateCard(G, card.id);
    if (!loc) return false;
    const cap = computeScoringSlotsForEra(G, loc.era, ctx.choices || {});
    return loc.index >= 0 && loc.index < cap;
  }
  if (rest === "first-score") {
    return !hasUsedFirstScore(G, card.id);
  }
  if (rest === "attached-to-first-invention-of-era") {
    // Positional: evaluated at process time against live stack order (not invent-time).
    // "First invention" = stack index 0 in this era (oldest under append/push).
    // If earlier score effects reordered the stack, use the host's position now.
    const host = Object.entries(G.attachments || {}).find(([, list]) =>
      list.includes(card.id),
    )?.[0];
    if (host) {
      const hloc = locateCard(G, host);
      return !!hloc && hloc.era === eraId && hloc.index === 0;
    }
    const loc = locateCard(G, card.id);
    return !!loc && loc.era === eraId && loc.index === 0;
  }
  if (rest === "today-modern-or-future") {
    return eraId === "modern" || eraId === "future";
  }
  if (rest === "in-today") {
    // Presence conditions for extend cards are handled by targets.ts
    return true;
  }
  if (rest === "higher-value-invention") {
    // Only meaningful when a peer is provided (react path); skip otherwise
    if (!peerCardId) return true;
    const peerVal = effectiveScoreValue(G, peerCardId);
    const selfVal = effectiveScoreValue(G, card.id);
    return peerVal > selfVal;
  }
  if (rest.startsWith("target-deck:")) {
    // Branch peer conditions — skip when no peer (e.g. bonus path on same card)
    const want = rest.slice("target-deck:".length) as DeckId;
    const id = peerCardId || targetCardId;
    if (!id) return true;
    return isDeckMember(id, want) || deckOfCardId(id) === want;
  }
  if (rest.startsWith("subtype:")) {
    const subtype = rest.slice("subtype:".length);
    // With scope:same-era + in-scoring-slot: look for subtype in same era scoring slots
    const scopeSame =
      hasTag(card, "condition:scope:same-era") ||
      (card.tags || []).includes("condition:scope:same-era");
    const needSlot = hasTag(card, "condition:in-scoring-slot");
    const eras: EraId[] = scopeSame
      ? [eraId as EraId]
      : ([eraId] as EraId[]);
    for (const e of eras) {
      const eraState = G.timeline[e];
      if (!eraState) continue;
      let ids = eraState.stack;
      if (needSlot) {
        const cap = computeScoringSlotsForEra(G, e, ctx.choices || {});
        ids = scoringSlotCardIds(eraState, cap);
      }
      for (const cid of ids) {
        const c = getCard(G, cid);
        if (c?.subtypes?.includes(subtype)) return true;
      }
    }
    return false;
  }
  if (rest === "scope:same-era") {
    // Modifier for other conditions; alone always true when we have an era
    return true;
  }

  // Unknown condition — fail closed for bonus safety
  return false;
}

/**
 * Evaluate additional:condition:* tags that gate bonus-points:additional.
 * If no additional:condition tags, return true.
 */
export function evaluateAdditionalConditions(
  ctx: ConditionContext,
): boolean {
  const tags = ctx.card.tags ?? [];
  const extra = tags.filter((t) => t.startsWith("additional:condition:"));
  if (extra.length === 0) return true;
  for (const t of extra) {
    const cond = t.slice("additional:".length); // condition:target-deck:…
    if (!evaluateOneCondition(cond, ctx)) return false;
  }
  return true;
}

/** True when an attachment on cardId suppresses score *effects* (Hibernation). */
export function hasAttachmentScoreSuppress(
  G: TimestreamsState,
  cardId: string,
): boolean {
  for (const attId of getAttachments(G)[cardId] ?? []) {
    const att = getCard(G, attId);
    if (att && hasTag(att, "suppress:score-effects-on-target")) return true;
  }
  return false;
}

export function isTargetDeckMember(cardId: string, deck: string): boolean {
  return deckOfCardId(cardId) === deck || isDeckMember(cardId, deck as DeckId);
}
