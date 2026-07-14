/**
 * Scoring-slot capacity for an era.
 *
 * Model:
 * - Base config.scoringSlots
 * - Static modifiers from cards currently on the era (Slow/Fast Time, etc.)
 * - A plain running counter per era (`scoringSlotBonusByEra`) that is
 *   **incremented each time** a resolved score effect says ±slots
 *   (e.g. option-a:add-scoring-slots). No per-card registry: once the effect
 *   fires, the counter changes and the card is irrelevant.
 */
import type { TimestreamsState, EraId, TimestreamsCard } from "./types";
import { eraAllCardIds } from "./timeline";
import { getCard } from "./effects/state";
import { hasTag, tagNumber, tagsWithPrefix } from "./effects/tags";

/**
 * Parse ±slot delta from a score:choice answer (tag-driven, not card-name-driven).
 */
export function slotDeltaFromScoreChoice(
  card: { tags?: string[] },
  choice: string,
): number {
  if (!card?.tags?.length) return 0;
  if (hasTag(card as TimestreamsCard, "suppress:score-effects-on-target")) {
    return 0;
  }
  const ch = choice === "a" ? "option-a" : choice === "b" ? "option-b" : choice;
  let delta = 0;
  if (ch === "option-a") {
    if (
      hasTag(card as TimestreamsCard, "option-a:add-scoring-slots:1") ||
      (card.tags || []).some((t) => t.startsWith("option-a:add-scoring-slots"))
    ) {
      delta +=
        tagNumber(card as TimestreamsCard, "option-a:add-scoring-slots") || 1;
    }
    if (
      (card.tags || []).some((t) => t.startsWith("option-a:remove-scoring-slots"))
    ) {
      delta -=
        tagNumber(card as TimestreamsCard, "option-a:remove-scoring-slots") || 1;
    }
  }
  if (ch === "option-b") {
    if (
      hasTag(card as TimestreamsCard, "option-b:remove-scoring-slots:1") ||
      (card.tags || []).some((t) => t.startsWith("option-b:remove-scoring-slots"))
    ) {
      delta -=
        tagNumber(card as TimestreamsCard, "option-b:remove-scoring-slots") || 1;
    }
    if (
      (card.tags || []).some((t) => t.startsWith("option-b:add-scoring-slots"))
    ) {
      delta +=
        tagNumber(card as TimestreamsCard, "option-b:add-scoring-slots") || 1;
    }
  }
  return delta;
}

/**
 * Increment/decrement the era's scoring-slot counter.
 * Call once when a score effect that changes slots **resolves**.
 * Stacks freely; no coupling to source card identity after this returns.
 */
export function adjustEraScoringSlots(
  G: TimestreamsState,
  eraId: EraId,
  delta: number,
  note?: string,
): { delta: number; note: string; total: number } | null {
  if (!delta) return null;
  if (!G.scoringSlotBonusByEra) G.scoringSlotBonusByEra = {};
  G.scoringSlotBonusByEra[eraId] =
    (G.scoringSlotBonusByEra[eraId] || 0) + delta;
  const total = G.scoringSlotBonusByEra[eraId]!;
  const sign = delta > 0 ? "+" : "";
  return {
    delta,
    total,
    note:
      note ||
      `${sign}${delta} scoring slot(s) in ${eraId} (effect total ${total >= 0 ? "+" : ""}${total})`,
  };
}

/**
 * @deprecated Use adjustEraScoringSlots. Kept as a thin wrapper for call sites
 * that still pass a card/choice pair (parses tags, then increments counter).
 */
export function recordScoreChoiceSlotDelta(
  G: TimestreamsState,
  eraId: EraId,
  card: { id: string; tags?: string[]; name?: string },
  choice: string,
): { delta: number; note: string } | null {
  const delta = slotDeltaFromScoreChoice(card, choice);
  if (!delta) return null;
  const name = card.name || card.id;
  const rec = adjustEraScoringSlots(
    G,
    eraId,
    delta,
    `${delta > 0 ? "+" : ""}${delta} scoring slot(s) in ${eraId} (${name} ${choice})`,
  );
  return rec ? { delta: rec.delta, note: rec.note } : null;
}

/**
 * Effective scoring-slot **capacity** for an era.
 * base + on-board static modifiers + running effect counter.
 * Does **not** re-read scoreChoices or track source cards.
 */
export function computeScoringSlotsForEra(
  G: TimestreamsState,
  eraId: string,
  _choices: Record<string, string | string[]> = {},
): number {
  const base = G.config?.scoringSlots ?? 6;
  if (G.config?.rulesEnabled === false) {
    // Prefer manual capacity when set (free:score-slot-cap).
    const manual = G.manualSlotCap?.[eraId as EraId];
    return Math.max(1, manual ?? base);
  }

  let delta = 0;
  const era = G.timeline[eraId as keyof typeof G.timeline];
  if (!era) return base;

  // Static modifiers on cards still on this era (Slow Time, Fast Time, …)
  for (const cid of eraAllCardIds(era)) {
    const c = getCard(G, cid);
    if (!c) continue;

    if (tagsWithPrefix(c, "score:add-scoring-slots").length > 0) {
      delta += tagNumber(c, "score:add-scoring-slots") || 0;
    }
    if (tagsWithPrefix(c, "score:remove-scoring-slots").length > 0) {
      delta -= tagNumber(c, "score:remove-scoring-slots") || 0;
    }
    if (tagsWithPrefix(c, "play:add-scoring-slots").length > 0) {
      delta += tagNumber(c, "play:add-scoring-slots") || 0;
    }
  }

  // Running counter from resolved score effects (each application stacks)
  delta += G.scoringSlotBonusByEra?.[eraId as EraId] || 0;

  return Math.max(1, base + delta);
}

/** Human-readable slot modifiers on an era (for UI badges). */
export function scoringSlotModifierNotes(
  G: TimestreamsState,
  eraId: string,
): string[] {
  const notes: string[] = [];
  const era = G.timeline[eraId as keyof typeof G.timeline];
  if (!era) return notes;
  for (const cid of eraAllCardIds(era)) {
    const c = getCard(G, cid);
    if (!c) continue;
    const add =
      tagNumber(c, "score:add-scoring-slots") ??
      tagNumber(c, "play:add-scoring-slots");
    if (add) notes.push(`+${add} ${c.name || "card"}`);
    const rem = tagNumber(c, "score:remove-scoring-slots");
    if (rem) notes.push(`−${rem} ${c.name || "card"}`);
  }
  const effectTotal = G.scoringSlotBonusByEra?.[eraId as EraId] || 0;
  if (effectTotal) {
    const sign = effectTotal > 0 ? "+" : "";
    notes.push(`${sign}${effectTotal} from score effects`);
  }
  return notes;
}
