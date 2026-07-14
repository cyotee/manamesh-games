import type { TimestreamsState, EraId, ScoringStep, ScoringWalk } from "./types";
import { ERA_ORDER } from "./types";
import { scoringSlotCardIds, eraAllCardIds, eraForDay } from "./timeline";
import { homeEraTurnOrder } from "./homeEra";
import { effectiveScoreValue, discardFromPlay } from "./effects/boardOps";
import { getCard, getPendingTriggers } from "./effects/state";
import { hasTag, tagNumber, tagValue, isOptionalFor } from "./effects/tags";
import { resolveCardScoreEffectsFull } from "./effects/executors/score";
import { fireEvent } from "./effects/triggers";
import {
  locateCard,
  erasForScope,
  candidateTargets,
  cardAtOffset,
} from "./effects/targets";
import type { PlayerPrompt } from "./effects/types";
import { hasUsedFirstScore } from "./effects/conditions";
import { tryStealBonusPoints } from "./effects/react";
import {
  getEraFutureSlotPrompt,
  applyEraFutureSlotChoice,
  findEraCardForPlayer,
  playerWithHomeEra,
  getEraStoneCancelOffer,
  eraStoneCancelPrompt,
  scoreMutationCancelledByEraStone,
} from "./effects/eraAbilities";
import { registerCard } from "./effects/state";
import { pushActivityLog } from "./crypto";
import {
  computeScoringSlotsForEra,
  scoringSlotModifierNotes,
} from "./scoringSlots";
import { initManualScoring } from "./freeTools";

export { computeScoringSlotsForEra, scoringSlotModifierNotes } from "./scoringSlots";

export function cardOwner(cardId: string, G?: TimestreamsState): string {
  if (G) {
    const card = getCard(G, cardId);
    if (card?.ownerId) return card.ownerId;
  }
  const parts = cardId.split("-card-");
  return parts[0] || "";
}

/** Player to the left of `playerId` in `playerOrder` (guess:by:left-neighbor). */
export function leftNeighborId(G: TimestreamsState, playerId: string): string {
  const order = G.playerOrder;
  const i = order.indexOf(playerId);
  if (i < 0 || order.length < 2) return order.find((p) => p !== playerId) ?? playerId;
  return order[(i - 1 + order.length) % order.length];
}

/**
 * Register era-future only when already in the Future player's possession.
 * Do not invent a synthetic card — that hijacked every future scoring walk.
 */
function ensureEraFutureCard(G: TimestreamsState): void {
  const ownerId = playerWithHomeEra(G, "future");
  if (!ownerId) return;
  const card = findEraCardForPlayer(G, ownerId, "era-future");
  if (card) registerCard(G, card);
}

/**
 * Build interactive prompts that must be answered before final scoring.
 * Mysticism: owner picks secret 1–4, then left neighbor guesses.
 * Quantum Computing / Chaos: score:choice option or target when needed.
 * Virtual Reality / Telescope: score:swap two inventions.
 */
export function collectScoreInteractivePrompts(G: TimestreamsState): PlayerPrompt[] {
  const prompts: PlayerPrompt[] = [];
  if (G.config?.rulesEnabled === false) return prompts;

  for (const eraId of ERA_ORDER) {
    const era = G.timeline[eraId];
    if (!era) continue;
    for (const cid of eraAllCardIds(era)) {
      const card = getCard(G, cid);
      if (!card?.tags?.length) continue;

      // --- Mysticism-style number guess ---
      if (hasTag(card, "score:guess") || hasTag(card, "guess:range:1-4")) {
        // parse guess:range:1-4 → use 1..4
        let minN = 1;
        let maxN = 4;
        const rangeTag = (card.tags || []).find((t) => t.startsWith("guess:range:"));
        if (rangeTag) {
          const m = rangeTag.match(/guess:range:(\d+)-(\d+)/);
          if (m) {
            minN = parseInt(m[1], 10);
            maxN = parseInt(m[2], 10);
          }
        }
        const nums = Array.from({ length: maxN - minN + 1 }, (_, i) => String(minN + i));
        const owner = card.ownerId;
        prompts.push({
          id: `${card.id}:score-guess-secret`,
          deciderId: owner,
          kind: "choose-number",
          options: nums,
          min: 1,
          max: 1,
          reason: "score:guess-secret",
        });
        const guesser = hasTag(card, "guess:by:left-neighbor")
          ? leftNeighborId(G, owner)
          : owner;
        prompts.push({
          id: `${card.id}:score-guess-answer`,
          deciderId: guesser,
          kind: "choose-number",
          options: nums,
          min: 1,
          max: 1,
          reason: "score:guess",
        });
      }

      // --- score:choice (option-a / option-b, e.g. Quantum Computing) ---
      if (hasTag(card, "score:choice")) {
        const hasAB =
          (card.tags || []).some((t) => t.startsWith("option-a:")) ||
          (card.tags || []).some((t) => t.startsWith("option-b:"));
        if (hasAB) {
          prompts.push({
            id: `${card.id}:score-choice`,
            deciderId: card.ownerId,
            kind: "choose-option",
            options: ["option-a", "option-b"],
            min: 1,
            max: 1,
            reason: "score:choice",
          });
        } else if (
          (card.tags || []).some((t) => t.startsWith("score:add-scoring-slots"))
        ) {
          // Era-Future: yes/no add slots
          prompts.push({
            id: `${card.id}:score-choice`,
            deciderId: card.ownerId,
            kind: "choose-option",
            options: ["yes", "no"],
            min: 1,
            max: 1,
            reason: "era-future-slots",
            labelCardId: card.id,
          });
        }
      }

      // --- score:swap (Virtual Reality, Telescope): choose two inventions ---
      if (hasTag(card, "score:swap")) {
        const count = tagNumber(card, "swap:count") ?? 2;
        if (count >= 2) {
          const scope = tagValue(card, "swap:scope") ?? "today";
          const eras = erasForScope(G, scope, card.id);
          const exclude = hasTag(card, "target:exclude-self") ? card.id : undefined;
          const options = candidateTargets(G, {
            kind: "invention",
            eras,
            excludeCardId: exclude,
          });
          const optional = isOptionalFor(card, "swap");
          // Need at least 2 targets to offer a swap; optional with <2 just skips.
          if (options.length >= 2) {
            prompts.push({
              id: `${card.id}:score-swap-pair`,
              deciderId: card.ownerId,
              kind: "choose-card",
              options,
              min: optional ? 0 : 2,
              max: 2,
              reason: "score:swap",
            });
          }
        }
      }
    }
  }
  return prompts;
}

/**
 * Snapshot of scoring steps from the current board (for tests / estimates only).
 * Live scoring does **not** freeze this list — the walk re-picks each card with
 * the Wonky rule so moves/swaps/discards can change who fills remaining slots.
 */
export function buildScoringSteps(G: TimestreamsState): ScoringStep[] {
  const steps: ScoringStep[] = [];
  const choices = G.scoreChoices || {};
  for (const eraId of ERA_ORDER) {
    const era = G.timeline[eraId];
    if (!era) continue;
    const slots = computeScoringSlotsForEra(G, eraId, choices);
    const slotIds = scoringSlotCardIds(era, slots);
    slotIds.forEach((cardId, slotIndex) => {
      steps.push({ eraId, slotIndex, cardId, kind: "slot" });
    });
    for (const actId of era.actions ?? []) {
      steps.push({ eraId, slotIndex: -1, cardId: actId, kind: "era-action" });
    }
  }
  return steps;
}

function emptyProvisionalScores(G: TimestreamsState): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const pid of G.playerOrder) scores[pid] = 0;
  return scores;
}

function ensureBonusPoints(G: TimestreamsState): Record<string, number> {
  if (!G.bonusPoints) G.bonusPoints = emptyProvisionalScores(G);
  for (const pid of G.playerOrder) {
    if (G.bonusPoints[pid] === undefined) G.bonusPoints[pid] = 0;
  }
  return G.bonusPoints;
}

/** Cards whose scoring slot/action ability was applied in `eraId` this scoring. */
export function processedInEra(G: TimestreamsState, eraId: EraId): string[] {
  if (!G.scoringProcessedByEra) G.scoringProcessedByEra = {};
  if (!G.scoringProcessedByEra[eraId]) G.scoringProcessedByEra[eraId] = [];
  return G.scoringProcessedByEra[eraId]!;
}

function markProcessedInEra(
  G: TimestreamsState,
  eraId: EraId,
  cardId: string,
): void {
  const list = processedInEra(G, eraId);
  if (!list.includes(cardId)) list.push(cardId);
  if (!G.scoredThisScoring) G.scoredThisScoring = [];
  if (!G.scoredThisScoring.includes(cardId)) G.scoredThisScoring.push(cardId);
}

/** True if the card already sits in any player's score pile (steal or cleanup). */
export function isInAnyScorePile(
  G: TimestreamsState,
  cardId: string,
): boolean {
  return G.playerOrder.some((pid) =>
    (G.players[pid]?.scorePile || []).some((x) => x.id === cardId),
  );
}

/**
 * UI / walk highlight: card was processed for a slot in the era it currently
 * occupies (or is already piled). Moving to another era clears the "done" look
 * until that destination era processes it.
 */
export function isCardProcessedForUi(
  G: TimestreamsState,
  cardId: string,
  eraId?: EraId,
): boolean {
  if (isInAnyScorePile(G, cardId)) return true;
  const era =
    eraId ??
    (locateCard(G, cardId)?.era as EraId | undefined) ??
    null;
  if (!era) return false;
  return processedInEra(G, era).includes(cardId);
}

/** Final / display score = Σ printed values in score piles + bonus ledger. */
export function recomputeScoresFromPilesAndBonuses(
  G: TimestreamsState,
): Record<string, number> {
  const bonuses = ensureBonusPoints(G);
  const out = emptyProvisionalScores(G);
  for (const pid of G.playerOrder) {
    let pile = 0;
    for (const c of G.players[pid]?.scorePile || []) {
      pile += effectiveScoreValue(G, c.id);
    }
    out[pid] = pile + (bonuses[pid] ?? 0);
  }
  return out;
}

/** Per-player pile inventory (printed values) for scoring UI. */
export function scorePileInventory(G: TimestreamsState): Record<
  string,
  Array<{ cardId: string; name: string; printed: number }>
> {
  const out: Record<
    string,
    Array<{ cardId: string; name: string; printed: number }>
  > = {};
  for (const pid of G.playerOrder) {
    out[pid] = (G.players[pid]?.scorePile || []).map((c) => ({
      cardId: c.id,
      name: c.name || c.id,
      printed: effectiveScoreValue(G, c.id),
    }));
  }
  return out;
}

function syncProvisionalDisplay(G: TimestreamsState): void {
  const totals = recomputeScoresFromPilesAndBonuses(G);
  if (G.scoringWalk) {
    G.scoringWalk.provisionalScores = { ...totals };
    G.scoringWalk.bonusPoints = { ...ensureBonusPoints(G) };
  }
  // Keep G.scores as live display during scoring (finalize freezes winner)
  G.scores = { ...totals };
}

/**
 * Era-medieval (and similar) steal:bonus-points cards live in hand or as free
 * assets keyed by id. Prefer cards registered in G.cards owned by a player.
 */
function findBonusStealSources(G: TimestreamsState): { id: string; ownerId: string }[] {
  const out: { id: string; ownerId: string }[] = [];
  const seen = new Set<string>();
  for (const pid of G.playerOrder) {
    for (const c of G.players[pid]?.hand ?? []) {
      if (hasTag(c, "steal:bonus-points") && !seen.has(c.id)) {
        seen.add(c.id);
        out.push({ id: c.id, ownerId: c.ownerId || pid });
      }
    }
  }
  if (G.cards) {
    for (const c of Object.values(G.cards)) {
      if (!c || seen.has(c.id)) continue;
      if (hasTag(c, "steal:bonus-points")) {
        seen.add(c.id);
        out.push({ id: c.id, ownerId: c.ownerId || "0" });
      }
    }
  }
  return out;
}

function addBonus(
  G: TimestreamsState,
  pid: string,
  amount: number,
  meta?: { sourceCardId?: string; sourceName?: string; note?: string },
): void {
  if (!amount) return;

  // Positive bonuses may be stolen once-per-game by era-medieval (PRD).
  if (amount > 0) {
    for (const src of findBonusStealSources(G)) {
      if (src.ownerId === pid) continue; // don't steal from self
      const r = tryStealBonusPoints(G, src.id, pid, amount);
      if (r.stolen > 0) {
        const b = ensureBonusPoints(G);
        b[src.ownerId] = (b[src.ownerId] ?? 0) + r.stolen;
        // suppress original: do not credit pid
        if (!G.bonusLedger) G.bonusLedger = [];
        G.bonusLedger.push({
          playerId: src.ownerId,
          amount: r.stolen,
          sourceCardId: src.id,
          sourceName: meta?.sourceName,
          note: `stolen from P${pid} (${meta?.note || "bonus"})`,
        });
        logScore(
          G,
          `  · era steal: P${src.ownerId} takes +${r.stolen} bonus from P${pid} via ${src.id}`,
        );
        return;
      }
    }
  }

  const b = ensureBonusPoints(G);
  b[pid] = (b[pid] ?? 0) + amount;
  if (!G.bonusLedger) G.bonusLedger = [];
  G.bonusLedger.push({
    playerId: pid,
    amount,
    sourceCardId: meta?.sourceCardId,
    sourceName: meta?.sourceName,
    note: meta?.note,
  });
}

function pushToScorePile(
  G: TimestreamsState,
  playerId: string,
  cardId: string,
): void {
  const card = getCard(G, cardId);
  if (!card || !G.players[playerId]) return;
  if (!G.players[playerId].scorePile) G.players[playerId].scorePile = [];
  // Printed value banks once — never double-pile the same card.
  if (G.players[playerId].scorePile.some((x) => x.id === cardId)) return;
  if (isInAnyScorePile(G, cardId)) return;
  G.players[playerId].scorePile.push(card);
}

/** Drop leftover answers for this card so its own slot gets fresh prompts. */
function clearScoreChoicesForCard(G: TimestreamsState, cardId: string): void {
  if (!G.scoreChoices) return;
  for (const k of Object.keys(G.scoreChoices)) {
    if (k === `${cardId}:score-target` || k.startsWith(`${cardId}:`)) {
      delete G.scoreChoices[k];
    }
  }
}

/**
 * Build perform-other / steal target options (Nanotech, Alphabet, Chaos).
 */
function performOtherTargetOptions(
  G: TimestreamsState,
  card: NonNullable<ReturnType<typeof getCard>>,
): string[] {
  const scope = tagValue(card, "target:scope") || "today";
  const eras = erasForScope(G, scope, card.id);
  let options = candidateTargets(G, {
    kind: "invention",
    eras,
    excludeCardId: hasTag(card, "target:exclude-self") ? card.id : undefined,
  });
  const subtypes = (card.tags || [])
    .filter((t) => t.startsWith("target:subtype:"))
    .map((t) => t.slice("target:subtype:".length));
  if (subtypes.length) {
    options = options.filter((cid) => {
      const c = getCard(G, cid);
      return (
        !!c &&
        subtypes.some(
          (s) => c.subtypes?.includes(s) || cid.includes(s),
        )
      );
    });
  }
  return options;
}

/**
 * Recursively collect prompts for a perform-other / steal-perform chain.
 * Tag-driven only: any depth of Nanotech→Nanotech→QC / Pottery works the same.
 *
 * Cycle policy (two Nanotechs in one era):
 * - Targets already on the perform chain remain choosable so NT1 can target NT0
 *   and both can be stolen into the score pile.
 * - Re-entering a card already on the chain does NOT re-prompt its perform-other
 *   (closes the loop without infinite NT0↔NT1 prompts).
 */
function collectPerformChainPrompts(
  G: TimestreamsState,
  performerId: string,
  /** Cards already on the perform chain (cycle detection). */
  chain: Set<string>,
  /** Who answers nested ability choices (outer performer's owner, unless target-owner). */
  defaultDeciderId: string,
  forceDeciderTargetOwner: boolean,
  depth: number,
): PlayerPrompt[] {
  if (depth > 8) return [];
  const card = getCard(G, performerId);
  if (!card || !hasTag(card, "score:perform-other")) return [];
  const choices = G.scoreChoices || {};
  const prompts: PlayerPrompt[] = [];

  // Do not filter chain members: nested Nanotech must be able to target the
  // outer Nanotech (or another earlier link) so a two-NT loop can steal both.
  const options = performOtherTargetOptions(G, card);
  const targetKey = `${performerId}:score-target`;
  if (options.length > 0 && choices[targetKey] === undefined) {
    const optional =
      isOptionalFor(card, "perform") || hasTag(card, "perform:optional");
    prompts.push({
      id: targetKey,
      deciderId: defaultDeciderId,
      kind: "choose-card",
      options,
      min: optional ? 0 : 1,
      max: 1,
      reason: hasTag(card, "steal:target-to:own-score-pile")
        ? "score:steal-perform"
        : "score:perform-other",
      labelCardId: performerId,
    });
    return prompts;
  }

  const raw = choices[targetKey];
  const tid = Array.isArray(raw) ? raw[0] : raw;
  if (!tid || typeof tid !== "string" || tid === "") {
    // Optional perform declined / no target
    return prompts;
  }

  // Chaos: perform vs suppress after target
  if (
    hasTag(card, "score:choice") &&
    hasTag(card, "suppress:score-effects-on-target")
  ) {
    const chKey = `${performerId}:score-choice`;
    if (choices[chKey] === undefined) {
      prompts.push({
        id: chKey,
        deciderId: defaultDeciderId,
        kind: "choose-option",
        options: ["perform", "suppress"],
        min: 1,
        max: 1,
        reason: "score:choice",
        labelCardId: performerId,
      });
      return prompts;
    }
    const ch = Array.isArray(choices[chKey])
      ? (choices[chKey] as string[])[0]
      : choices[chKey];
    if (ch === "suppress" || ch === "cancel") {
      return prompts;
    }
  }

  const target = getCard(G, tid);
  if (!target) return prompts;

  // Closing a perform cycle (e.g. NT0→NT1→NT0): steal still applies at resolve,
  // but do not re-open the outer card's perform-other prompts.
  if (chain.has(tid)) {
    return prompts;
  }

  const nestedDecider = forceDeciderTargetOwner
    ? target.ownerId || defaultDeciderId
    : defaultDeciderId;
  const nextChain = new Set(chain);
  nextChain.add(performerId);
  nextChain.add(tid);

  // Target's own score:choice (e.g. Quantum Computing) when not a perform card
  if (
    hasTag(target, "score:choice") &&
    !hasTag(target, "score:perform-other") &&
    !hasTag(target, "suppress:score-effects-on-target")
  ) {
    const chKey = `${tid}:score-choice`;
    if (choices[chKey] === undefined) {
      prompts.push({
        id: chKey,
        deciderId: nestedDecider,
        kind: "choose-option",
        options: ["option-a", "option-b"],
        min: 1,
        max: 1,
        reason: "score:choice",
        labelCardId: tid,
      });
      // Still need ability prompts after choice is answered; return only
      // the unresolved choice first so the UI stays single-front.
      return prompts;
    }
  }

  // Nested perform-other (Nanotech → Nanotech → …)
  if (hasTag(target, "score:perform-other")) {
    prompts.push(
      ...collectPerformChainPrompts(
        G,
        tid,
        nextChain,
        nestedDecider,
        forceDeciderTargetOwner || hasTag(target, "decider:target-owner"),
        depth + 1,
      ),
    );
    // If nested still needs answers, surface those before target abilities
    if (prompts.some((p) => choices[p.id] === undefined)) {
      return prompts;
    }
  }

  // Target's non-perform abilities (move, bonus-copy, penalty, …)
  const ability = collectScoreAbilityPrompts(G, tid);
  for (const p of ability) {
    p.deciderId = nestedDecider;
    prompts.push(p);
  }
  return prompts;
}

/**
 * Interactive prompts for scoring one card (and nested perform-other abilities).
 * Order: own prompts first, then after perform-target is chosen, the target's
 * ability prompts with decider = target owner when `decider:target-owner`.
 */
export function collectInteractivePromptsForCard(
  G: TimestreamsState,
  cardId: string,
): PlayerPrompt[] {
  const card = getCard(G, cardId);
  if (!card?.tags?.length) return [];
  const prompts: PlayerPrompt[] = [];
  const choices = G.scoreChoices || {};

  // Guess / swap / option-a/b for this card only (not nested targets yet)
  const all = collectScoreInteractivePrompts(G);
  for (const p of all) {
    if (
      p.id.startsWith(`${cardId}:`) &&
      p.reason !== "score:perform-other" &&
      // score:choice on perform+suppress cards handled inside perform chain
      !(
        p.reason === "score:choice" &&
        hasTag(card, "score:perform-other") &&
        hasTag(card, "suppress:score-effects-on-target")
      )
    ) {
      // QC-style score:choice when this card itself is being scored
      if (
        p.reason === "score:choice" &&
        hasTag(card, "score:perform-other") &&
        !hasTag(card, "suppress:score-effects-on-target")
      ) {
        continue;
      }
      prompts.push(p);
    }
  }

  // --- score:perform-other (+ Nanotech steal) — recursive chain ---
  if (hasTag(card, "score:perform-other")) {
    const forceOwner = hasTag(card, "decider:target-owner");
    prompts.push(
      ...collectPerformChainPrompts(
        G,
        cardId,
        new Set([cardId]),
        card.ownerId,
        forceOwner,
        0,
      ),
    );
  }

  // Own score abilities: move, bonus-copy target, etc.
  prompts.push(...collectScoreAbilityPrompts(G, cardId));

  const seen = new Set<string>();
  return prompts.filter((p) => {
    if (seen.has(p.id)) return false;
    // Already answered
    if (choices[p.id] !== undefined) return false;
    seen.add(p.id);
    return true;
  });
}

/**
 * Prompts for a card's score *ability* (move, bonus-copy, …), not perform-other.
 */
export function collectScoreAbilityPrompts(
  G: TimestreamsState,
  cardId: string,
): PlayerPrompt[] {
  const card = getCard(G, cardId);
  if (!card?.tags?.length) return [];
  const prompts: PlayerPrompt[] = [];
  const choices = G.scoreChoices || {};

  // --- Genetic Modification / Mass Marketing style: copy another card's value ---
  if (
    hasTag(card, "bonus-points:copy") ||
    (hasTag(card, "score:bonus-points") && hasTag(card, "bonus-points:copy"))
  ) {
    const tgtSpec = tagValue(card, "copy:target") || "self";
    if (tgtSpec === "any-card" || tgtSpec === "invention") {
      const tscope =
        tagValue(card, "target:scope") ||
        tagValue(card, "copy:scope") ||
        "today";
      let eras = erasForScope(G, tscope, card.id);
      // Fallback when card was moved / era empty: still allow choosing
      if (!eras.length && G.scoringActiveEra) {
        eras = [G.scoringActiveEra as EraId];
      }
      if (!eras.length) {
        eras = [...ERA_ORDER];
      }
      const kind = tgtSpec === "invention" ? "invention" : "any";
      const options = candidateTargets(G, {
        kind,
        eras,
        excludeCardId: hasTag(card, "target:exclude-self")
          ? card.id
          : undefined,
      });
      const tKey = `${cardId}:score-target`;
      if (options.length > 0 && choices[tKey] === undefined) {
        prompts.push({
          id: tKey,
          deciderId: card.ownerId,
          kind: "choose-card",
          options,
          min: 1,
          max: 1,
          reason: "score:bonus-copy",
          labelCardId: cardId,
        });
        return prompts;
      }
    }
  }

  if (hasTag(card, "score:move")) {
    // Space Travel: first-score already used → no move prompts on re-score
    const firstScoreDone =
      hasTag(card, "condition:first-score") && hasUsedFirstScore(G, cardId);
    if (!firstScoreDone) {
    // Fixed offset targets (Shipbuilding) / self (Space Travel) need no target prompt
    const fixedOffset =
      hasTag(card, "move:target:offset-below:1") ||
      (card.tags || []).some((t) => t.startsWith("move:target:offset-below:"));
    const selfMove = tagValue(card, "move:target") === "self";
    const optional =
      hasTag(card, "move:optional") || isOptionalFor(card, "move");
    const destSpec = tagValue(card, "move-destination") || "any-future-era";
    const scoreToday =
      (G.scoringActiveEra as EraId | null | undefined) ||
      eraForDay(Math.min(G.currentDay, ERA_ORDER.length));

    if (optional) {
      const yesNoKey = `${cardId}:score-move`;
      if (choices[yesNoKey] === undefined) {
        prompts.push({
          id: yesNoKey,
          deciderId: card.ownerId,
          kind: "choose-option",
          options: ["yes", "no"],
          min: 1,
          max: 1,
          reason: "score:move-optional",
          labelCardId: cardId,
        });
        return prompts;
      }
      const yn = choices[yesNoKey];
      const ans = Array.isArray(yn) ? yn[0] : yn;
      if (ans === "no" || ans === "skip") return prompts;
    }

    if (!fixedOffset && !selfMove) {
      const scopeSrc = tagValue(card, "move-source") || "today";
      const eras = erasForScope(G, scopeSrc, card.id);
      const mt = tagValue(card, "move:target") || "any-card";
      const kind =
        mt === "invention" || mt === "any-invention" ? "invention" : "any";
      const options = candidateTargets(G, {
        kind,
        eras,
        excludeCardId: hasTag(card, "target:exclude-self")
          ? card.id
          : undefined,
      });
      const tKey = `${cardId}:score-move-target`;
      if (options.length > 0 && choices[tKey] === undefined) {
        prompts.push({
          id: tKey,
          deciderId: card.ownerId,
          kind: "choose-card",
          options,
          min: 1,
          max: 1,
          reason: "score:move-target",
          labelCardId: cardId,
        });
        return prompts;
      }
    }

    // top-future (Cybertechnology): fixed destination — no era picker
    // top-next-era (Space Travel): fixed dest from self — no era picker
    if (destSpec === "any-future-era") {
      const i = ERA_ORDER.indexOf(scoreToday);
      const futureEras = ERA_ORDER.slice(i + 1);
      const eKey = `${cardId}:score-move-era`;
      if (futureEras.length >= 1 && choices[eKey] === undefined) {
        prompts.push({
          id: eKey,
          deciderId: card.ownerId,
          kind: "choose-option",
          options: [...futureEras],
          min: 1,
          max: 1,
          reason: "score:move-era",
          labelCardId: cardId,
        });
      }
    }
    } // end !firstScoreDone
  }

  // --- Cave Paintings: optional art penalty target ---
  if (
    hasTag(card, "score:penalty") &&
    !hasTag(card, "score:penalty:next-inventor") &&
    (hasTag(card, "penalty:target:art") || hasTag(card, "penalty:to:target-owner"))
  ) {
    const optional =
      hasTag(card, "penalty:optional") || isOptionalFor(card, "penalty");
    const scope = tagValue(card, "target:scope") || "today";
    const eras = erasForScope(G, scope, card.id);
    let options = candidateTargets(G, {
      kind: "invention",
      eras,
      excludeCardId: hasTag(card, "target:exclude-self")
        ? card.id
        : undefined,
    });
    if (hasTag(card, "penalty:target:art")) {
      options = options.filter((cid) => {
        const c = getCard(G, cid);
        return !!c && (c.subtypes || []).includes("art");
      });
    }
    const pKey = `${cardId}:score-penalty-target`;
    if (options.length > 0 && choices[pKey] === undefined) {
      prompts.push({
        id: pKey,
        deciderId: card.ownerId,
        kind: "choose-card",
        options,
        min: optional ? 0 : 1,
        max: 1,
        reason: "score:penalty-target",
        labelCardId: cardId,
      });
    }
  }

  // --- score:discard optional yes/no (Guillotine, LN, …) ---
  if (hasTag(card, "score:discard")) {
    const optional = hasTag(card, "discard:optional");
    if (optional) {
      const dKey = `${cardId}:score-discard`;
      if (choices[dKey] === undefined) {
        prompts.push({
          id: dKey,
          deciderId: card.ownerId,
          kind: "choose-option",
          options: ["yes", "no"],
          min: 1,
          max: 1,
          reason: "score:discard-optional",
          labelCardId: cardId,
        });
        return prompts;
      }
    }
    // After yes (or mandatory): era-stone cancel for each predicted stone target
    const declined =
      optional &&
      (choices[`${cardId}:score-discard`] === "no" ||
        choices[`${cardId}:score-discard`] === "skip");
    if (!declined) {
      const targets = predictScoreDiscardTargets(G, card);
      for (const tid of targets) {
        const offer = getEraStoneCancelOffer(G, tid, "discard", cardId);
        if (offer && choices[offer.promptId] === undefined) {
          prompts.push(eraStoneCancelPrompt(offer));
          return prompts; // one at a time
        }
      }
    }
  }

  // --- score:move era-stone cancel when target is a stone invention ---
  if (hasTag(card, "score:move")) {
    const optional = hasTag(card, "move:optional") || isOptionalFor(card, "move");
    const declined =
      optional &&
      (choices[`${cardId}:score-move`] === "no" ||
        choices[`${cardId}:score-move`] === "skip");
    if (!declined) {
      const tid = predictScoreMoveTarget(G, card, choices);
      if (tid) {
        const offer = getEraStoneCancelOffer(G, tid, "move", cardId);
        if (offer && choices[offer.promptId] === undefined) {
          prompts.push(eraStoneCancelPrompt(offer));
        }
      }
    }
  }

  return prompts;
}

/** Predict discard targets for score:discard (for era-stone prompts). */
function predictScoreDiscardTargets(
  G: TimestreamsState,
  card: NonNullable<ReturnType<typeof getCard>>,
): string[] {
  if (hasTag(card, "discard:target:bottom-of-era")) {
    const scope = tagValue(card, "discard:scope") || "current-era";
    const eras = erasForScope(G, scope === "current-era" ? "current-era" : scope, card.id);
    const era = eras[0] || (G.scoringActiveEra as EraId) || "stone";
    const stack = G.timeline[era]?.stack ?? [];
    const bottom = stack[stack.length - 1];
    return bottom ? [bottom] : [];
  }
  const offsetTag = (card.tags || []).find((t) =>
    t.startsWith("discard:target:offset-below:"),
  );
  if (offsetTag || hasTag(card, "discard:target:offset-below:1")) {
    const off = offsetTag
      ? parseInt(offsetTag.split(":").pop() || "1", 10)
      : 1;
    const tid = cardAtOffset(G, card.id, Number.isNaN(off) ? 1 : off);
    return tid ? [tid] : [];
  }
  return [];
}

function predictScoreMoveTarget(
  G: TimestreamsState,
  card: NonNullable<ReturnType<typeof getCard>>,
  choices: Record<string, string | string[]>,
): string | null {
  const mt = tagValue(card, "move:target") || "any-card";
  if (mt === "self") return card.id;
  const offsetBelow = (card.tags || []).find((t) =>
    t.startsWith("move:target:offset-below:"),
  );
  if (offsetBelow || hasTag(card, "move:target:offset-below:1")) {
    const off = offsetBelow
      ? parseInt(offsetBelow.split(":").pop() || "1", 10)
      : 1;
    return cardAtOffset(G, card.id, Number.isNaN(off) ? 1 : off);
  }
  const raw = choices[`${card.id}:score-move-target`];
  if (raw !== undefined) {
    return Array.isArray(raw) ? raw[0] : raw;
  }
  return null;
}

function emptyAcks(G: TimestreamsState): Record<string, boolean> {
  const acks: Record<string, boolean> = {};
  for (const pid of G.playerOrder) acks[pid] = false;
  return acks;
}

/** Human-readable card name for activity log. */
function cardLabel(G: TimestreamsState, cardId: string): string {
  const c = getCard(G, cardId);
  if (c?.name) return c.name;
  // strip instance suffix for id-only fallback
  const base = cardId.split("#")[0] || cardId;
  return base;
}

function logScore(G: TimestreamsState, message: string): void {
  pushActivityLog(G, message, "score");
}

function formatChoiceValue(
  G: TimestreamsState,
  value: string | string[],
): string {
  const parts = Array.isArray(value) ? value : value === "" ? ["(skip)"] : [value];
  return parts
    .map((v) => {
      if (v === "option-a") return "option A";
      if (v === "option-b") return "option B";
      if (v === "yes" || v === "no" || v === "perform" || v === "suppress") return v;
      // Card ids → names when possible
      if (getCard(G, v) || v.includes("#")) return cardLabel(G, v);
      return v;
    })
    .join(", ");
}

function applyScoreForStep(
  G: TimestreamsState,
  step: ScoringStep,
  choices: Record<string, string | string[]>,
): string {
  if (!(G as any).scoreValueOverrides) (G as any).scoreValueOverrides = {};
  ensureBonusPoints(G);

  G.scoringActiveEra = step.eraId;
  const c = getCard(G, step.cardId);
  const owner = c?.ownerId || cardOwner(step.cardId, G);
  const name = c?.name || step.cardId;
  const eraLabel = step.eraId;
  const before = owner ? (G.scores?.[owner] ?? 0) : 0;
  const printed = c ? effectiveScoreValue(G, c.id) : 0;
  const slotTxt =
    step.kind === "era-action"
      ? "era action"
      : `slot ${step.slotIndex + 1}`;

  // Idempotent: never re-run ability / re-consume a slot for the same card in
  // this era (duplicate submitScoreChoice / concurrent acks were double-applying
  // and inflating slotsUsedInEra so remaining open slots were skipped).
  const already = processedInEra(G, step.eraId).includes(step.cardId);
  if (already) {
    logScore(
      G,
      `⏭ Skip ${name} · already processed in ${eraLabel} (no double bonus/slot)`,
    );
    syncProvisionalDisplay(G);
    return `${eraLabel} · ${slotTxt} · ${name} · skipped (already processed)`;
  }

  logScore(
    G,
    `▶ Process ${name} · ${eraLabel} · ${slotTxt}` +
      (owner != null ? ` · owner P${owner}` : "") +
      (step.kind === "slot" ? ` · printed ${printed}` : ""),
  );

  // Mark processed BEFORE effects so a re-entrant apply cannot double-fire.
  markProcessedInEra(G, step.eraId, step.cardId);

  // Slot process: mark scored + run ability. Printed value is NOT banked until
  // the card is in a score pile (era cleanup or steal).
  if (step.kind === "slot") {
    const overrides = (G as any).scoreValueOverrides as Record<string, number>;
    if (overrides[step.cardId] !== undefined && c) {
      c.scoreValue = overrides[step.cardId];
    }
  }

  if (c) {
    const full = resolveCardScoreEffectsFull(
      G,
      c,
      step.eraId,
      step.slotIndex,
      choices,
    );
    const overrides = (G as any).scoreValueOverrides as Record<string, number>;
    for (const [tid, val] of Object.entries(full.setValues)) {
      overrides[tid] = val;
      const tc = getCard(G, tid);
      if (tc) tc.scoreValue = val;
      logScore(
        G,
        `  · set printed value of ${cardLabel(G, tid)} → ${val}`,
      );
    }
    for (const sid of full.suppressIds) {
      if (!(G as any).suppressScoreEffects) (G as any).suppressScoreEffects = [];
      (G as any).suppressScoreEffects.push(sid);
      logScore(G, `  · suppress score effects on ${cardLabel(G, sid)}`);
    }
    // Steal: after ability (nested) — remove to stealer (owner of the card being processed).
    // De-dupe; steal the current step card last so a Nanotech cycle (NT0→NT1→NT0)
    // does not remove the active card mid-loop before other steals apply.
    const stealOrder = [...new Set(full.stealIds)].sort((a, b) => {
      if (a === step.cardId) return 1;
      if (b === step.cardId) return -1;
      return 0;
    });
    for (const sid of stealOrder) {
      const stolen = getCard(G, sid);
      if (!stolen) continue;
      if (isInAnyScorePile(G, sid)) {
        markProcessedInEra(G, step.eraId, sid);
        continue;
      }
      const loc = locateCard(G, sid);
      if (loc) {
        if (loc.zone === "actions") {
          const actions = G.timeline[loc.era].actions ?? [];
          const ix = actions.indexOf(sid);
          if (ix >= 0) actions.splice(ix, 1);
        } else {
          G.timeline[loc.era].stack.splice(loc.index, 1);
        }
      }
      const stealer = owner || c.ownerId;
      if (stealer) pushToScorePile(G, stealer, sid);
      logScore(
        G,
        `  · steal ${cardLabel(G, sid)} → P${stealer} score pile` +
          (stolen ? ` (printed ${effectiveScoreValue(G, sid)})` : ""),
      );
      // Stolen cards leave the board — mark processed in source era so they
      // cannot be picked as an open slot elsewhere this scoring.
      if (loc) markProcessedInEra(G, loc.era, sid);
      else markProcessedInEra(G, step.eraId, sid);
    }
    for (const did of full.discardIds) {
      // Do not discard cards already claimed to a pile
      if (isInAnyScorePile(G, did)) continue;
      if (
        scoreMutationCancelledByEraStone(
          G,
          did,
          "discard",
          c.id,
          choices,
        )
      ) {
        logScore(
          G,
          `  · discard of ${cardLabel(G, did)} cancelled (era-stone once-per-game)`,
        );
        continue;
      }
      discardFromPlay(G, did, owner || c.ownerId || "0");
      logScore(G, `  · discard ${cardLabel(G, did)} from play`);
    }
    // Ability bonuses / penalties → bonus ledger (not pile)
    for (const [pid, n] of Object.entries(full.other)) {
      if (!n) continue;
      addBonus(G, pid, n, {
        sourceCardId: c.id,
        sourceName: name,
        note: "targeted score effect",
      });
      logScore(
        G,
        `  · bonus ${n >= 0 ? "+" : ""}${n} → P${pid} (from ${name})`,
      );
    }
    const extra = full.extra;
    if (hasTag(c, "score:to:all-players")) {
      if (extra) {
        for (const pid of G.playerOrder) {
          addBonus(G, pid, extra, {
            sourceCardId: c.id,
            sourceName: name,
            note: "score:to:all-players",
          });
        }
        logScore(
          G,
          `  · bonus ${extra >= 0 ? "+" : ""}${extra} → all players (from ${name})`,
        );
      }
    } else if (owner && extra) {
      addBonus(G, owner, extra, {
        sourceCardId: c.id,
        sourceName: name,
        note: "ability bonus",
      });
      logScore(
        G,
        `  · bonus ${extra >= 0 ? "+" : ""}${extra} → P${owner} (from ${name})`,
      );
    }
    // Nested / tag-level detail lines (moves, performs, counts, …)
    for (const line of full.log) {
      logScore(G, `  · ${humanizeEffectLog(G, line)}`);
    }
  }

  const walk = G.scoringWalk;
  if (walk && step.kind === "slot" && walk.activeEraId === step.eraId) {
    // Count this slot once (card already marked processed above).
    walk.slotsUsedInEra += 1;
    walk.eraSlotTotal = computeScoringSlotsForEra(
      G,
      step.eraId,
      G.scoreChoices || {},
    );
    walk.remainingSlots = Math.max(0, walk.eraSlotTotal - walk.slotsUsedInEra);
    logScore(
      G,
      `  · slots in ${eraLabel}: ${walk.slotsUsedInEra}/${walk.eraSlotTotal}` +
        (walk.remainingSlots > 0
          ? ` (${walk.remainingSlots} remaining)`
          : " (full)"),
    );
  }

  syncProvisionalDisplay(G);
  const after = owner ? (G.scores?.[owner] ?? 0) : 0;
  const delta = after - before;
  const deltaTxt =
    owner != null
      ? `P${owner} display ${delta >= 0 ? "+" : ""}${delta} (now ${after}; pile+bonus)`
      : "no owner";
  const summary = `${eraLabel} · ${slotTxt} · ${name} · ${deltaTxt}`;
  logScore(G, `✓ Done ${name} · ${deltaTxt}`);
  return summary;
}

/** Make raw executor log lines easier to skim in the activity feed. */
function humanizeEffectLog(G: TimestreamsState, line: string): string {
  // "id: perform-other ability of tid" → use names
  let s = line;
  // Replace known card ids that appear as tokens
  const idMatches = s.match(/[a-zA-Z0-9._-]+#[0-9]+/g) || [];
  for (const id of idMatches) {
    s = s.split(id).join(cardLabel(G, id));
  }
  s = s
    .replace(/perform-other ability of /g, "perform ability of ")
    .replace(/score-choice /g, "score choice ")
    .replace(/moved (.+) to /g, "moved $1 → ")
    .replace(/: count for P/g, ": count for P")
    .replace(/: count /g, ": count ")
    .replace(/: bonus /g, ": ability bonus ");
  return s;
}

/**
 * Finish an era only when its slots and era-actions are fully processed.
 * Cards stay on the board (movable by later effects) until this runs.
 */
function completeEra(G: TimestreamsState, finishedEra: EraId): void {
  const walk = G.scoringWalk;
  if (!walk || walk.erasCompleted.includes(finishedEra)) return;

  G.scoringActiveEra = finishedEra;
  fireEvent(G, {
    type: "era-scored" as any,
    cardId: "",
    eraId: finishedEra as any,
    actorPlayerId: "",
  });

  // Delayed triggers (Pottery etc.)
  // sourceCardId = card that registered the delay (has delayed: tags)
  // targetCardId = moved card to re-score (optional; defaults to source for legacy)
  for (const trigger of getPendingTriggers(G)) {
    if (trigger.spent) continue;
    if (
      (trigger.event === "era-scored" ||
        trigger.event === "delayed:era-scored") &&
      (trigger.eraAnchor === null || trigger.eraAnchor === finishedEra)
    ) {
      const registrar = getCard(G, trigger.sourceCardId);
      if (!registrar) continue;
      const rescoreId = trigger.targetCardId || trigger.sourceCardId;
      const stillInPlay = !!locateCard(G, rescoreId);
      const needsInPlay =
        hasTag(registrar, "delayed:condition:still-in-play") ||
        (registrar.tags || []).some((t) => t.includes("still-in-play"));
      if (needsInPlay && !stillInPlay) {
        if (trigger.limit === "once") trigger.spent = true;
        continue;
      }

      const target = getCard(G, rescoreId);
      if (target && stillInPlay) {
        // Re-run score ability (in-addition-to-slot-scoring allows second run)
        const alreadyProcessed = processedInEra(G, finishedEra).includes(rescoreId);
        const inAddition =
          hasTag(registrar, "delayed:in-addition-to-slot-scoring") ||
          hasTag(registrar, "score:delayed");
        if (!alreadyProcessed || inAddition) {
          const full = resolveCardScoreEffectsFull(
            G,
            target,
            finishedEra,
            -1,
            G.scoreChoices || {},
          );
          for (const [pid, n] of Object.entries(full.other)) {
            if (n)
              addBonus(G, pid, n, {
                sourceCardId: target.id,
                sourceName: target.name,
                note: "delayed rescore ability",
              });
          }
          if (full.extra && target.ownerId) {
            addBonus(G, target.ownerId, full.extra, {
              sourceCardId: target.id,
              sourceName: target.name,
              note: "delayed rescore bonus",
            });
          }
          for (const line of full.log) {
            logScore(G, `  · delayed: ${line}`);
          }
          // Apply delayed discards/steals lightly
          for (const did of full.discardIds) {
            if (isInAnyScorePile(G, did)) continue;
            if (
              scoreMutationCancelledByEraStone(
                G,
                did,
                "discard",
                target.id,
                G.scoreChoices || {},
              )
            ) {
              logScore(
                G,
                `  · delayed discard of ${cardLabel(G, did)} cancelled (era-stone)`,
              );
              continue;
            }
            discardFromPlay(G, did, target.ownerId || "0");
          }
          for (const sid of full.stealIds) {
            if (!isInAnyScorePile(G, sid)) {
              const stealer = target.ownerId;
              if (stealer) pushToScorePile(G, stealer, sid);
            }
          }
          logScore(
            G,
            `  · delayed rescore of ${cardLabel(G, rescoreId)} after ${finishedEra}`,
          );
        }

        // Score even if not in a scoring slot — claim into inventor's pile
        if (
          (hasTag(registrar, "delayed:even-non-scoring") ||
            hasTag(registrar, "score:delayed")) &&
          stillInPlay &&
          !isInAnyScorePile(G, rescoreId)
        ) {
          const o = target.ownerId;
          if (o) {
            // Remove from stack if still there so cleanup doesn't double-handle
            const loc = locateCard(G, rescoreId);
            if (loc && loc.zone !== "actions") {
              G.timeline[loc.era].stack.splice(loc.index, 1);
            }
            pushToScorePile(G, o, rescoreId);
            logScore(
              G,
              `  · delayed bank ${cardLabel(G, rescoreId)} → P${o} pile`,
            );
          }
        }
      }
      if (trigger.limit === "once") trigger.spent = true;
    }
  }

  // Cleanup era stack: processed in THIS era → inventor score pile, rest → discard
  // (stolen cards already left the stack). Printed value banks once via pile.
  const era = G.timeline[finishedEra];
  const processedHere = processedInEra(G, finishedEra);
  logScore(G, `── Finish era ${finishedEra} (cleanup) ──`);
  if (era) {
    const before = [...era.stack];
    era.stack = [];
    for (const cid of before) {
      // Already in someone's pile (steal)? leave alone
      if (isInAnyScorePile(G, cid)) {
        logScore(
          G,
          `  · ${cardLabel(G, cid)} already in a score pile (skip)`,
        );
        continue;
      }

      if (processedHere.includes(cid)) {
        const owner = cardOwner(cid, G);
        if (owner) {
          pushToScorePile(G, owner, cid);
          logScore(
            G,
            `  · bank printed ${effectiveScoreValue(G, cid)} from ${cardLabel(G, cid)} → P${owner} pile`,
          );
        }
      } else {
        const card = getCard(G, cid);
        if (card && G.players[card.ownerId]) {
          G.players[card.ownerId].discard.push(card);
          logScore(
            G,
            `  · discard ${cardLabel(G, cid)} (not processed in ${finishedEra})`,
          );
        }
      }
    }
    for (const actId of [...(era.actions ?? [])]) {
      const card = getCard(G, actId);
      if (card && G.players[card.ownerId]) {
        if (!G.players[card.ownerId].discard.some((x) => x.id === actId)) {
          G.players[card.ownerId].discard.push(card);
          logScore(G, `  · discard era-action ${cardLabel(G, actId)}`);
        }
      }
    }
    era.actions = [];
  }

  walk.erasCompleted.push(finishedEra);
  walk.activeEraId = null;
  walk.remainingSlots = 0;
  walk.eraSlotTotal = 0;
  walk.slotsUsedInEra = 0;
  walk.eraActionsPhase = false;
  syncProvisionalDisplay(G);
  const totals = Object.entries(G.scores || {})
    .map(([p, s]) => `P${p}:${s}`)
    .join(", ");
  logScore(G, `── Era ${finishedEra} complete · running ${totals} ──`);
  pushActivityLog(
    G,
    `Finished processing ${finishedEra} (pile+bonus display updated)`,
    "system",
  );
}

/**
 * Re-sync walk slot totals from live board + scoreChoices (QC, Slow Time, …).
 * Call before deciding the next invention so mid-walk slot changes are visible.
 */
function resyncWalkSlots(G: TimestreamsState, eraId: EraId): void {
  const walk = G.scoringWalk;
  if (!walk || walk.activeEraId !== eraId) return;
  walk.eraSlotTotal = computeScoringSlotsForEra(
    G,
    eraId,
    G.scoreChoices || {},
  );
  walk.remainingSlots = Math.max(0, walk.eraSlotTotal - walk.slotsUsedInEra);
  // If capacity grew and inventions remain, leave/re-enter invention phase.
  if (walk.remainingSlots > 0) {
    const era = G.timeline[eraId];
    const processedHere = processedInEra(G, eraId);
    const hasUnprocessed = (era?.stack || []).some(
      (cid) => !processedHere.includes(cid) && !isInAnyScorePile(G, cid),
    );
    if (hasUnprocessed) walk.eraActionsPhase = false;
  }
}

/**
 * Wonky rule: each scoring slot processes the topmost invention that has not
 * yet been processed **in this era**. Cards moved from an earlier era into an
 * open slot here are eligible again (abilities re-run; printed value still
 * banks only once via the score pile).
 *
 * Slot capacity is re-synced every pick so Slow Time / QC changes mid-era
 * never strand an unprocessed invention while remainingSlots > 0.
 */
function discoverNextStep(G: TimestreamsState): ScoringStep | null {
  const walk = G.scoringWalk!;

  for (const eraId of ERA_ORDER) {
    if (walk.erasCompleted.includes(eraId)) continue;
    const era = G.timeline[eraId];
    if (!era) {
      completeEra(G, eraId);
      continue;
    }

    // Enter this era if needed
    if (walk.activeEraId !== eraId) {
      walk.activeEraId = eraId;
      walk.slotsUsedInEra = 0;
      walk.eraActionsPhase = false;
      G.scoringActiveEra = eraId;

      // Era-Future: optional +2 scoring slots before any future inventions score
      if (eraId === "future") {
        ensureEraFutureCard(G);
        const futPrompt = getEraFutureSlotPrompt(G);
        if (futPrompt) {
          // Pause on a synthetic step so the UI collects the yes/no choice first
          return {
            eraId,
            slotIndex: -2,
            cardId: futPrompt.labelCardId || "era-future",
            kind: "era-action",
          };
        }
        // Already answered (or no card) — apply slot change before resync
        for (const line of applyEraFutureSlotChoice(G, "future")) {
          logScore(G, `  · ${line}`);
        }
      }

      resyncWalkSlots(G, eraId);
    } else {
      resyncWalkSlots(G, eraId);
    }

    const processedHere = processedInEra(G, eraId);

    // Invention slots (Wonky) — prefer filling open slots before era-actions
    // when unprocessed inventions remain.
    if (walk.remainingSlots > 0) {
      let nextUnscored: string | null = null;
      for (const cid of era.stack) {
        if (isInAnyScorePile(G, cid)) continue;
        if (!processedHere.includes(cid)) {
          nextUnscored = cid;
          break;
        }
      }
      if (nextUnscored) {
        walk.eraActionsPhase = false;
        return {
          eraId,
          slotIndex: walk.slotsUsedInEra,
          cardId: nextUnscored,
          kind: "slot",
        };
      }
    }

    // Era-level actions (Slow Time, Fast Time, …) after inventions for current capacity
    for (const actId of era.actions ?? []) {
      if (!processedHere.includes(actId)) {
        walk.eraActionsPhase = true;
        return {
          eraId,
          slotIndex: -1,
          cardId: actId,
          kind: "era-action",
        };
      }
    }

    // After era-actions, capacity may have changed (if any path mutates tags) —
    // one more invention pass before completing.
    resyncWalkSlots(G, eraId);
    if (walk.remainingSlots > 0) {
      for (const cid of era.stack) {
        if (isInAnyScorePile(G, cid)) continue;
        if (!processedHere.includes(cid)) {
          walk.eraActionsPhase = false;
          return {
            eraId,
            slotIndex: walk.slotsUsedInEra,
            cardId: cid,
            kind: "slot",
          };
        }
      }
    }

    // Era fully processed → cleanup, then try next era
    completeEra(G, eraId);
  }

  return null;
}

function finalizeScoringWalk(G: TimestreamsState): void {
  // Complete any remaining empty eras
  if (G.scoringWalk) {
    for (const eraId of ERA_ORDER) {
      if (!G.scoringWalk.erasCompleted.includes(eraId)) {
        completeEra(G, eraId);
      }
    }
  }

  // Final: piles + bonus ledger
  G.scores = recomputeScoresFromPilesAndBonuses(G);

  const order = homeEraTurnOrder(G);
  let bestPid: string | null = null;
  let bestScore = -Infinity;
  for (const pid of order) {
    const s = G.scores[pid] ?? 0;
    if (s > bestScore || (s === bestScore && bestPid === null)) {
      bestScore = s;
      bestPid = pid;
    }
  }
  G.winner = bestPid ?? G.playerOrder[0] ?? null;
  G.phase = "gameOver";
  G.scoringActiveEra = null;
  G.pendingPrompts = [];
  if (G.scoringWalk) {
    G.scoringWalk.currentCardId = null;
    G.scoringWalk.provisionalScores = { ...G.scores };
    G.scoringWalk.lastSummary = `Final totals (piles+bonus) — winner P${G.winner}`;
  }
  pushActivityLog(
    G,
    `Scoring complete — winner P${G.winner} (${Object.entries(G.scores)
      .map(([p, s]) => `P${p}:${s}`)
      .join(", ")})`,
    "system",
  );
}

/**
 * Discover / process the next card: choices or apply + dual-ack.
 * Returns true if scoring finished.
 */
function enterCurrentStep(G: TimestreamsState): boolean {
  const walk = G.scoringWalk!;
  const step = discoverNextStep(G);
  if (!step) {
    finalizeScoringWalk(G);
    return true;
  }

  if (walk.stepIndex >= walk.steps.length) {
    walk.steps.push(step);
  } else {
    walk.steps[walk.stepIndex] = step;
  }

  // Fresh card step: drop leftover answers from a prior perform-other of this card
  // (e.g. Alphabet performed Pottery — Pottery's own slot must re-prompt).
  clearScoreChoicesForCard(G, step.cardId);

  walk.currentCardId = step.cardId;
  walk.acks = emptyAcks(G);
  G.scoringActiveEra = step.eraId;

  const name = cardLabel(G, step.cardId);
  const slotTxt =
    step.kind === "era-action"
      ? "era action"
      : `slot ${step.slotIndex + 1}`;
  logScore(
    G,
    `Next: ${name} (${step.eraId} · ${slotTxt}` +
      (walk.remainingSlots > 0 && step.kind === "slot"
        ? ` · ${walk.remainingSlots} slot(s) left after this capacity check`
        : "") +
      `)`,
  );

  let choicePrompts: PlayerPrompt[] = [];
  try {
    choicePrompts = collectInteractivePromptsForCard(G, step.cardId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logScore(G, `⚠ collect prompts failed for ${name}: ${msg}`);
  }
  const pending = choicePrompts.filter(
    (p) => G.scoreChoices?.[p.id] === undefined,
  );
  if (pending.length > 0) {
    walk.stepPhase = "choice";
    G.pendingPrompts = pending as any;
    walk.lastSummary = `Choices for ${name} (${step.eraId} · ${slotTxt})`;
    const reasons = pending
      .map((p) => p.reason || p.id)
      .filter(Boolean)
      .join(", ");
    logScore(
      G,
      `  ⏳ Waiting for choices on ${name}: ${reasons}`,
    );
    return false;
  }

  // No unresolved prompts → apply and wait for dual-ack. Never leave
  // stepPhase === "choice" with an empty queue (Next button disappears).
  G.pendingPrompts = [];
  walk.stepPhase = "ack";
  walk.acks = emptyAcks(G);
  try {
    const summary = applyScoreForStep(G, step, G.scoreChoices || {});
    walk.lastSummary = summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    walk.lastSummary = `Error applying ${name}: ${msg}`;
    logScore(G, `⚠ applyScoreForStep failed for ${name}: ${msg}`);
  }
  return false;
}

/**
 * Enter scoring: start iterative walk across all eras (or instant if rules off / empty).
 * Returns true if scoring finished (gameOver), false if waiting on walk/prompts.
 *
 * Totals stay provisional (`scoringWalk.provisionalScores`) until every card is
 * processed — then finalize commits them to `G.scores`.
 */
export function beginScoringPhase(G: TimestreamsState): boolean {
  G.phase = "scoring";
  if (!(G as any).scoreChoices) (G as any).scoreChoices = {};
  G.scoringProcessedByEra = {};
  G.scoredThisScoring = [];
  G.scoringSlotBonusByEra = {};
  G.bonusPoints = emptyProvisionalScores(G);
  G.bonusLedger = [];
  G.scores = emptyProvisionalScores(G);
  // Clear piles from any prior partial run (fresh scoring)
  for (const pid of G.playerOrder) {
    if (G.players[pid]) G.players[pid].scorePile = [];
  }

  if (G.config?.rulesEnabled === false) {
    // Manual scoring desk — players use free tools; no auto finalize.
    initManualScoring(G);
    return false; // stay in scoring phase
  }

  logScore(G, "════ Scoring phase started (Stone → Future) ════");

  G.scoringWalk = {
    steps: [],
    stepIndex: 0,
    stepPhase: "ack",
    acks: emptyAcks(G),
    processedCardIds: [],
    currentCardId: null,
    lastSummary: "",
    erasCompleted: [],
    provisionalScores: emptyProvisionalScores(G),
    bonusPoints: emptyProvisionalScores(G),
    activeEraId: null,
    eraSlotTotal: 0,
    remainingSlots: 0,
    slotsUsedInEra: 0,
    eraActionsPhase: false,
  };

  return enterCurrentStep(G);
}

/**
 * Answer the front score prompt for the current card's effect choices.
 * When choices for this step are done, applies the card and enters dual-ack.
 */
export function submitScoreChoice(
  G: TimestreamsState,
  playerId: string,
  promptId: string,
  value: string | string[],
): boolean | "INVALID_MOVE" {
  const walk = G.scoringWalk;
  // While an iterative walk is active, never fall through to batch legacy
  // resolveScoring (that re-scored the whole board and double-applied effects).
  if (walk) {
    if (walk.stepPhase !== "choice") return "INVALID_MOVE";
  } else {
    return submitScoreChoiceLegacy(G, playerId, promptId, value);
  }

  const queue = G.pendingPrompts ?? [];
  const front = queue[0];
  if (!front || front.id !== promptId) return "INVALID_MOVE";
  if (front.deciderId !== playerId) return "INVALID_MOVE";
  // Already answered this prompt (duplicate click / dual-seat double-submit)
  if (G.scoreChoices?.[promptId] !== undefined) return "INVALID_MOVE";

  const picks = Array.isArray(value) ? value : value === "" ? [] : [value];
  const min = front.min ?? 1;
  const max = front.max ?? 1;

  if (picks.length === 0) {
    if (min > 0) return "INVALID_MOVE";
  } else {
    if (picks.length < min || picks.length > max) return "INVALID_MOVE";
    if (max > 1 && picks.length !== max && min === 0) return "INVALID_MOVE";
    if (front.options.length) {
      for (const p of picks) {
        if (!front.options.includes(p)) return "INVALID_MOVE";
      }
    }
  }

  if (!G.scoreChoices) G.scoreChoices = {};
  G.scoreChoices[promptId] = max <= 1 ? (picks[0] ?? "") : picks;

  const choiceDisplay = formatChoiceValue(
    G,
    max <= 1 ? (picks[0] ?? "") : picks,
  );
  logScore(
    G,
    `  ↳ P${playerId} chose [${front.reason || promptId}]: ${choiceDisplay}`,
  );

  // When selecting a perform/steal target, wipe that target's prior answers so
  // nested abilities re-fire (e.g. Mass Marketing bonus-copy after it already
  // scored as its own slot earlier this era).
  //
  // Exception — closing a *perform-other cycle* only (NT0→NT1→NT0): if the
  // target is itself a perform-other card that already answered its own
  // score-target, do not clear (would re-open infinite prompts). Mass Marketing
  // / Pottery / etc. use score-target for ability targets, NOT perform-other,
  // so they must always be cleared and re-prompted.
  if (
    (front.reason === "score:perform-other" ||
      front.reason === "score:steal-perform") &&
    picks[0]
  ) {
    const targetId = picks[0];
    const targetCard = getCard(G, targetId);
    const closingPerformCycle =
      !!targetCard &&
      hasTag(targetCard, "score:perform-other") &&
      G.scoreChoices?.[`${targetId}:score-target`] !== undefined;
    if (!closingPerformCycle) {
      clearScoreChoicesForCard(G, targetId);
    }
    // re-store the parent target choice (cleared if parent id === pick — rare)
    G.scoreChoices[promptId] = max <= 1 ? (targetId ?? "") : picks;
  }

  // Re-collect for this card — nested ability prompts appear after perform-target
  const step = walk.steps[walk.stepIndex];
  if (!step) return "INVALID_MOVE";
  const remaining = collectInteractivePromptsForCard(G, step.cardId).filter(
    (p) => G.scoreChoices?.[p.id] === undefined,
  );
  if (remaining.length > 0) {
    G.pendingPrompts = remaining as any;
    walk.stepPhase = "choice";
    const name = cardLabel(G, step.cardId);
    walk.lastSummary = `Choices for ${name} (${step.eraId})`;
    logScore(
      G,
      `  ⏳ Next choices for ${name}: ${remaining.map((p) => p.reason || p.id).join(", ")}`,
    );
    return false;
  }

  G.pendingPrompts = [];
  // Flip to ack before apply so a concurrent second submit cannot re-enter.
  // Always leave the walk in a dual-ack-ready state — even if apply throws
  // (Nanotech self-steal cycles used to strand players with no Next button).
  walk.stepPhase = "ack";
  walk.acks = emptyAcks(G);
  try {
    const summary = applyScoreForStep(G, step, G.scoreChoices);
    walk.lastSummary = summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    walk.lastSummary = `Error applying ${step.cardId}: ${msg}`;
    logScore(G, `⚠ applyScoreForStep failed for ${step.cardId}: ${msg}`);
  }
  return false;
}

/** Legacy batch interactive scoring (no walk) for older tests. */
function submitScoreChoiceLegacy(
  G: TimestreamsState,
  playerId: string,
  promptId: string,
  value: string | string[],
): boolean | "INVALID_MOVE" {
  const queue = G.pendingPrompts ?? [];
  const front = queue[0];
  if (!front || front.id !== promptId) return "INVALID_MOVE";
  if (front.deciderId !== playerId) return "INVALID_MOVE";

  const picks = Array.isArray(value) ? value : value === "" ? [] : [value];
  const min = front.min ?? 1;
  const max = front.max ?? 1;

  if (picks.length === 0) {
    if (min > 0) return "INVALID_MOVE";
  } else {
    if (picks.length < min || picks.length > max) return "INVALID_MOVE";
    if (max > 1 && picks.length !== max && min === 0) return "INVALID_MOVE";
    if (front.options.length) {
      for (const p of picks) {
        if (!front.options.includes(p)) return "INVALID_MOVE";
      }
    }
  }

  if (!G.scoreChoices) G.scoreChoices = {};
  G.scoreChoices[promptId] = max <= 1 ? (picks[0] ?? "") : picks;
  G.pendingPrompts = queue.slice(1);

  if ((G.pendingPrompts?.length ?? 0) === 0) {
    resolveScoring(G, G.scoreChoices);
    G.pendingPrompts = [];
    return true;
  }
  return false;
}

/**
 * Both players must acknowledge the current scored card before advancing.
 * After dual-ack, the next card is re-discovered (Wonky) so board mutations
 * from this card can change remaining slots. Final totals commit only when
 * every era is done.
 */
export function ackScoreStep(
  G: TimestreamsState,
  playerId: string,
): boolean | "INVALID_MOVE" {
  const walk = G.scoringWalk;
  if (!walk || G.phase !== "scoring") return "INVALID_MOVE";
  // Coerce — boardgame.io / dual-seat sometimes pass numeric seat ids
  const pid = String(playerId);
  if (!G.playerOrder.map(String).includes(pid)) return "INVALID_MOVE";
  // Ensure ack map has keys for every seat (stale walks / partial saves)
  if (!walk.acks) walk.acks = emptyAcks(G);
  for (const p of G.playerOrder) {
    if (walk.acks[p] === undefined) walk.acks[p] = false;
  }

  // Lagging client still showing OK while the walk is already on a choice:
  // do NOT advance or force-apply — re-surface prompts for the current card.
  if (walk.stepPhase === "choice") {
    const step = walk.steps[walk.stepIndex];
    if (step) {
      // Prefer re-collecting prompts (handles empty pendingPrompts desync).
      let pending: PlayerPrompt[] = [];
      try {
        pending = collectInteractivePromptsForCard(G, step.cardId).filter(
          (p) => G.scoreChoices?.[p.id] === undefined,
        );
      } catch {
        pending = [];
      }
      if (pending.length > 0) {
        G.pendingPrompts = pending as any;
        walk.lastSummary = `Choices for ${cardLabel(G, step.cardId)} (${step.eraId})`;
        // Soft no-op: stale OK clicks must not skip the chooser
        return false;
      }
      // Truly no prompts — convert to ack and count this click
      G.pendingPrompts = [];
      walk.stepPhase = "ack";
      walk.acks = emptyAcks(G);
      if (!processedInEra(G, step.eraId).includes(step.cardId)) {
        try {
          walk.lastSummary = applyScoreForStep(G, step, G.scoreChoices || {});
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          walk.lastSummary = `Error applying ${step.cardId}: ${msg}`;
        }
      }
      // Fall through so this click also counts as this player's ack.
    } else {
      return false;
    }
  }

  if (walk.stepPhase !== "ack") return false; // soft: never INVALID on race
  // Already acked (duplicate concurrent click / lagging double-OK)
  // Check both coerced and raw keys (legacy walks)
  if (walk.acks[pid] || walk.acks[playerId]) return false;

  walk.acks[pid] = true;
  if (playerId !== pid) walk.acks[playerId] = true;
  if (!G.playerOrder.every((p) => walk.acks[p] || walk.acks[String(p)])) {
    return false;
  }

  const step = walk.steps[walk.stepIndex];
  // Guard: do not advance if this step still has unanswered choices
  if (step) {
    try {
      const still = collectInteractivePromptsForCard(G, step.cardId).filter(
        (p) => G.scoreChoices?.[p.id] === undefined,
      );
      if (still.length > 0) {
        // Someone raced into dual-ack while choices remain — reopen choice phase
        walk.acks = emptyAcks(G);
        walk.stepPhase = "choice";
        G.pendingPrompts = still as any;
        walk.lastSummary = `Choices for ${cardLabel(G, step.cardId)} (${step.eraId})`;
        logScore(
          G,
          `  ⏳ Re-opened choices (acks arrived early): ${still.map((p) => p.reason || p.id).join(", ")}`,
        );
        return false;
      }
    } catch {
      /* continue advance */
    }
  }

  if (step && !walk.processedCardIds.includes(step.cardId)) {
    walk.processedCardIds.push(step.cardId);
  }
  walk.stepIndex += 1;
  walk.acks = emptyAcks(G);
  walk.currentCardId = null;
  // Leave ack phase while discovering so concurrent acks cannot re-enter apply
  walk.stepPhase = "choice";

  // Re-discover next card from live board (Wonky) — do not use a frozen list
  return enterCurrentStep(G);
}

/**
 * Structural scoring only: sum scoreValue (or 1) for each scoring-slot card.
 * Used when rulesEnabled is false so a broken rules engine cannot block game end.
 */
function resolveScoringSimple(G: TimestreamsState): void {
  const scores: Record<string, number> = {};
  for (const pid of G.playerOrder) scores[pid] = 0;

  for (const eraId of Object.keys(G.timeline) as any) {
    const era = G.timeline[eraId];
    if (!era) continue;
    const slots = computeScoringSlotsForEra(G, eraId);
    const slotIds = scoringSlotCardIds(era, slots);
    for (const cid of slotIds) {
      const card = getCard(G, cid);
      const owner = card?.ownerId || cardOwner(cid, G);
      if (!owner || scores[owner] === undefined) continue;
      const value =
        typeof card?.scoreValue === "number" ? card.scoreValue : 1;
      scores[owner] += value;
    }
    // Collect scored inventions into score piles; discard the rest of the stack.
    const scored = new Set(slotIds);
    for (const cid of era.stack) {
      const card = getCard(G, cid);
      const owner = card?.ownerId || cardOwner(cid, G);
      if (scored.has(cid) && owner && G.players[owner]) {
        if (card) G.players[owner].scorePile.push(card);
      }
    }
    era.stack = [];
  }

  G.scores = scores;
  let best = -Infinity;
  let winner: string | null = null;
  for (const pid of G.playerOrder) {
    if (scores[pid] > best) {
      best = scores[pid];
      winner = pid;
    }
  }
  G.winner = winner;
  G.phase = "gameOver";
}

/**
 * Full rules scoring (batch). Hybrid model: abilities + bonus ledger + piles.
 * Optional `choices` keys (see resolveCardScoreEffectsFull).
 */
export function resolveScoring(
  G: TimestreamsState,
  choices: Record<string, string | string[]> = {},
): void {
  if (G.config?.rulesEnabled === false) {
    resolveScoringSimple(G);
    return;
  }

  G.scoringProcessedByEra = {};
  G.scoredThisScoring = [];
  G.scoringSlotBonusByEra = {};
  G.bonusPoints = emptyProvisionalScores(G);
  G.bonusLedger = [];
  if (!(G as any).scoreValueOverrides) (G as any).scoreValueOverrides = {};
  (G as any).scoringPhase = "slots";
  G.scoreChoices = { ...choices, ...(G.scoreChoices || {}) };
  for (const pid of G.playerOrder) {
    if (G.players[pid]) G.players[pid].scorePile = [];
  }

  function applyFullToBoard(
    c: NonNullable<ReturnType<typeof getCard>>,
    eraId: EraId,
    slotIndex: number,
  ) {
    const owner = c.ownerId || cardOwner(c.id, G);
    const full = resolveCardScoreEffectsFull(
      G,
      c,
      eraId,
      slotIndex,
      G.scoreChoices || {},
    );
    const overrides = (G as any).scoreValueOverrides as Record<string, number>;
    for (const [tid, val] of Object.entries(full.setValues)) {
      overrides[tid] = val;
      const tc = getCard(G, tid);
      if (tc) tc.scoreValue = val;
    }
    for (const sid of full.suppressIds) {
      if (!(G as any).suppressScoreEffects) (G as any).suppressScoreEffects = [];
      (G as any).suppressScoreEffects.push(sid);
    }
    const stealOrder = [...new Set(full.stealIds)].sort((a, b) => {
      if (a === c.id) return 1;
      if (b === c.id) return -1;
      return 0;
    });
    for (const sid of stealOrder) {
      const stolen = getCard(G, sid);
      if (!stolen) continue;
      if (isInAnyScorePile(G, sid)) {
        markProcessedInEra(G, eraId, sid);
        continue;
      }
      const loc = locateCard(G, sid);
      if (loc) {
        if (loc.zone === "actions") {
          const actions = G.timeline[loc.era].actions ?? [];
          const ix = actions.indexOf(sid);
          if (ix >= 0) actions.splice(ix, 1);
        } else {
          G.timeline[loc.era].stack.splice(loc.index, 1);
        }
      }
      if (owner) pushToScorePile(G, owner, sid);
      if (loc) markProcessedInEra(G, loc.era, sid);
      else markProcessedInEra(G, eraId, sid);
    }
    for (const did of full.discardIds) {
      if (isInAnyScorePile(G, did)) continue;
      if (
        scoreMutationCancelledByEraStone(
          G,
          did,
          "discard",
          c.id,
          G.scoreChoices || {},
        )
      ) {
        continue;
      }
      discardFromPlay(G, did, owner || "0");
    }
    for (const [pid, n] of Object.entries(full.other)) {
      addBonus(G, pid, n, {
        sourceCardId: c.id,
        sourceName: c.name,
        note: "targeted score effect",
      });
    }
    if (hasTag(c, "score:to:all-players")) {
      for (const pid of G.playerOrder) {
        addBonus(G, pid, full.extra, {
          sourceCardId: c.id,
          sourceName: c.name,
          note: "score:to:all-players",
        });
      }
    } else if (owner) {
      addBonus(G, owner, full.extra, {
        sourceCardId: c.id,
        sourceName: c.name,
        note: "ability bonus",
      });
    }
  }

  for (const eraId of ERA_ORDER) {
    const era = G.timeline[eraId];
    if (!era) continue;
    G.scoringActiveEra = eraId;
    // Era-Future: optional +2 slots before any inventions score in future
    if (eraId === "future") {
      ensureEraFutureCard(G);
      applyEraFutureSlotChoice(G, "future");
    }
    const computedSlots = computeScoringSlotsForEra(G, eraId, G.scoreChoices || {});
    let remainingSlots = computedSlots;
    let slotsUsed = 0;
    const processedHere = () => processedInEra(G, eraId);

    while (remainingSlots > 0) {
      let nextUnscored: string | null = null;
      for (const cid of era.stack) {
        if (isInAnyScorePile(G, cid)) continue;
        if (!processedHere().includes(cid)) {
          nextUnscored = cid;
          break;
        }
      }
      if (!nextUnscored) break;

      const overrides = (G as any).scoreValueOverrides as Record<string, number>;
      if (overrides[nextUnscored] !== undefined) {
        const card = getCard(G, nextUnscored);
        if (card) card.scoreValue = overrides[nextUnscored];
      }

      const c = getCard(G, nextUnscored);
      if (c) applyFullToBoard(c, eraId, slotsUsed);

      markProcessedInEra(G, eraId, nextUnscored);
      slotsUsed += 1;
      remainingSlots =
        computeScoringSlotsForEra(G, eraId, G.scoreChoices || {}) - slotsUsed;
    }

    for (const actId of era.actions ?? []) {
      if (processedHere().includes(actId)) continue;
      const c = getCard(G, actId);
      if (c) applyFullToBoard(c, eraId, -1);
      markProcessedInEra(G, eraId, actId);
    }

    (G as any).scoringPhase = "delayed";
    fireEvent(G, {
      type: "era-scored" as any,
      cardId: "",
      eraId: eraId as any,
      actorPlayerId: "",
    });

    for (const trigger of getPendingTriggers(G)) {
      if (trigger.spent) continue;
      if (
        (trigger.event === "era-scored" ||
          trigger.event === "delayed:era-scored") &&
        (trigger.eraAnchor === null || trigger.eraAnchor === eraId)
      ) {
        const registrar = getCard(G, trigger.sourceCardId);
        if (!registrar) continue;
        const rescoreId = trigger.targetCardId || trigger.sourceCardId;
        const stillInPlay = !!locateCard(G, rescoreId);
        const needsInPlay =
          hasTag(registrar, "delayed:condition:still-in-play") ||
          (registrar.tags || []).some((t) => t.includes("still-in-play"));
        if (needsInPlay && !stillInPlay) {
          if (trigger.limit === "once") trigger.spent = true;
          continue;
        }
        const target = getCard(G, rescoreId);
        if (target && stillInPlay) {
          const alreadyProcessed = processedHere().includes(rescoreId);
          const inAddition =
            hasTag(registrar, "delayed:in-addition-to-slot-scoring") ||
            hasTag(registrar, "score:delayed");
          if (!alreadyProcessed || inAddition) {
            const full = resolveCardScoreEffectsFull(
              G,
              target,
              eraId,
              -1,
              G.scoreChoices || {},
            );
            for (const [pid, n] of Object.entries(full.other)) {
              if (n)
                addBonus(G, pid, n, {
                  sourceCardId: target.id,
                  sourceName: target.name,
                  note: "delayed rescore ability",
                });
            }
            if (full.extra && target.ownerId) {
              addBonus(G, target.ownerId, full.extra, {
                sourceCardId: target.id,
                sourceName: target.name,
                note: "delayed rescore bonus",
              });
            }
          }
          if (
            (hasTag(registrar, "delayed:even-non-scoring") ||
              hasTag(registrar, "score:delayed")) &&
            !isInAnyScorePile(G, rescoreId)
          ) {
            const loc = locateCard(G, rescoreId);
            if (loc && loc.zone !== "actions") {
              G.timeline[loc.era].stack.splice(loc.index, 1);
            }
            if (target.ownerId) pushToScorePile(G, target.ownerId, rescoreId);
          }
        }
        if (trigger.limit === "once") trigger.spent = true;
      }
    }

    (G as any).scoringPhase = "cleanup";
    const processedList = processedHere();
    const before = [...era.stack];
    era.stack = [];
    for (const cid of before) {
      if (isInAnyScorePile(G, cid)) continue;
      if (processedList.includes(cid)) {
        const owner = cardOwner(cid, G);
        if (owner) pushToScorePile(G, owner, cid);
      } else {
        const card = getCard(G, cid);
        if (card && G.players[card.ownerId]) {
          G.players[card.ownerId].discard.push(card);
        }
      }
    }
    era.actions = [];
  }

  G.scores = recomputeScoresFromPilesAndBonuses(G);
  (G as any).scoringPhase = "done";
  G.scoringActiveEra = null;

  const order = homeEraTurnOrder(G);
  let bestPid: string | null = null;
  let bestScore = -Infinity;
  for (const pid of order) {
    const s = G.scores[pid] ?? 0;
    if (s > bestScore || (s === bestScore && bestPid === null)) {
      bestScore = s;
      bestPid = pid;
    }
  }
  G.winner = bestPid ?? G.playerOrder[0] ?? null;
  G.phase = "gameOver";
}
