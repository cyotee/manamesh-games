import type { TimestreamsState, EraId, ScoringStep, ScoringWalk } from "./types";
import { ERA_ORDER } from "./types";
import { scoringSlotCardIds, eraAllCardIds } from "./timeline";
import { homeEraTurnOrder } from "./homeEra";
import { effectiveScoreValue, discardFromPlay } from "./effects/boardOps";
import { getCard, getPendingTriggers } from "./effects/state";
import { hasTag, tagNumber, tagValue, tagsWithPrefix, isOptionalFor } from "./effects/tags";
import { resolveCardScoreEffectsFull } from "./effects/executors/score";
import { fireEvent } from "./effects/triggers";
import { locateCard, erasForScope, candidateTargets } from "./effects/targets";
import type { PlayerPrompt } from "./effects/types";
import { pushActivityLog } from "./crypto";

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
      if (
        hasTag(card, "score:choice") &&
        ((card.tags || []).some((t) => t.startsWith("option-a:")) ||
          (card.tags || []).some((t) => t.startsWith("option-b:")))
      ) {
        prompts.push({
          id: `${card.id}:score-choice`,
          deciderId: card.ownerId,
          kind: "choose-option",
          options: ["option-a", "option-b"],
          min: 1,
          max: 1,
          reason: "score:choice",
        });
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

/** Running totals used during the walk (never G.scores until finalize). */
function walkScores(G: TimestreamsState): Record<string, number> {
  const walk = G.scoringWalk;
  if (walk?.provisionalScores) return walk.provisionalScores;
  if (!G.scores) {
    G.scores = emptyProvisionalScores(G);
  }
  return G.scores;
}

/** Interactive prompts for a single card only (not whole board). */
export function collectInteractivePromptsForCard(
  G: TimestreamsState,
  cardId: string,
): PlayerPrompt[] {
  const card = getCard(G, cardId);
  if (!card?.tags?.length) return [];
  // Temporarily filter collect to one card by cloning style — reuse logic:
  const all = collectScoreInteractivePrompts(G);
  return all.filter(
    (p) =>
      p.id.startsWith(`${cardId}:`) ||
      p.id.includes(`:${cardId}:`) ||
      p.id.startsWith(cardId),
  );
}

function emptyAcks(G: TimestreamsState): Record<string, boolean> {
  const acks: Record<string, boolean> = {};
  for (const pid of G.playerOrder) acks[pid] = false;
  return acks;
}

function applyScoreForStep(
  G: TimestreamsState,
  step: ScoringStep,
  choices: Record<string, string | string[]>,
): string {
  const scores = walkScores(G);
  if (!G.scoredThisScoring) G.scoredThisScoring = [];
  if (!(G as any).scoreValueOverrides) (G as any).scoreValueOverrides = {};

  G.scoringActiveEra = step.eraId;
  const c = getCard(G, step.cardId);
  const owner = c?.ownerId || cardOwner(step.cardId, G);
  const name = c?.name || step.cardId;
  const eraLabel = step.eraId;
  const before = owner ? scores[owner] ?? 0 : 0;

  if (step.kind === "slot") {
    const overrides = (G as any).scoreValueOverrides as Record<string, number>;
    if (overrides[step.cardId] !== undefined && c) {
      c.scoreValue = overrides[step.cardId];
    }
    const base = effectiveScoreValue(G, step.cardId);
    if (owner && scores[owner] !== undefined) {
      scores[owner] += base;
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
    }
    for (const sid of full.suppressIds) {
      if (!(G as any).suppressScoreEffects) (G as any).suppressScoreEffects = [];
      (G as any).suppressScoreEffects.push(sid);
    }
    for (const sid of full.stealIds) {
      const stolen = getCard(G, sid);
      if (!stolen) continue;
      const loc = locateCard(G, sid);
      if (loc?.zone !== "actions" && loc) {
        G.timeline[loc.era].stack.splice(loc.index, 1);
      }
      if (owner && G.players[owner]) {
        if (!G.players[owner].scorePile) G.players[owner].scorePile = [];
        G.players[owner].scorePile.push(stolen);
      }
      if (!G.scoredThisScoring.includes(sid)) G.scoredThisScoring.push(sid);
    }
    for (const did of full.discardIds) {
      if (G.scoredThisScoring.includes(did)) continue;
      discardFromPlay(G, did, owner || c.ownerId || "0");
    }
    for (const [pid, n] of Object.entries(full.other)) {
      if (scores[pid] !== undefined) scores[pid] += n;
    }
    const extra = full.extra;
    if (hasTag(c, "score:to:all-players")) {
      for (const pid of G.playerOrder) scores[pid] = (scores[pid] ?? 0) + extra;
    } else if (owner && scores[owner] !== undefined) {
      scores[owner] += extra;
    }
    for (const line of full.log) pushActivityLog(G, line, "info");
  }

  if (!G.scoredThisScoring.includes(step.cardId)) {
    G.scoredThisScoring.push(step.cardId);
  }

  // Consume a slot; recompute capacity (e.g. Quantum Computing ± slots mid-era)
  const walk = G.scoringWalk;
  if (walk && step.kind === "slot" && walk.activeEraId === step.eraId) {
    walk.slotsUsedInEra += 1;
    walk.eraSlotTotal = computeScoringSlotsForEra(
      G,
      step.eraId,
      G.scoreChoices || {},
    );
    walk.remainingSlots = Math.max(0, walk.eraSlotTotal - walk.slotsUsedInEra);
  }

  const after = owner ? scores[owner] ?? 0 : 0;
  const delta = after - before;
  const slotTxt =
    step.kind === "era-action"
      ? "era action"
      : `slot ${step.slotIndex + 1}`;
  const deltaTxt =
    owner != null
      ? `P${owner} ${delta >= 0 ? "+" : ""}${delta} (running ${after}; totals finalize after all cards)`
      : "no owner";
  return `${eraLabel} · ${slotTxt} · ${name} · ${deltaTxt}`;
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

  // Delayed triggers for this era → provisional totals only
  const scores = walkScores(G);
  for (const trigger of getPendingTriggers(G)) {
    if (trigger.spent) continue;
    if (
      (trigger.event === "era-scored" || trigger.event === "delayed:era-scored") &&
      (trigger.eraAnchor === null || trigger.eraAnchor === finishedEra)
    ) {
      const source = getCard(G, trigger.sourceCardId);
      if (!source) continue;
      const stillInPlay = !!locateCard(G, trigger.sourceCardId);
      const needsInPlay =
        hasTag(source, "delayed:condition:still-in-play") ||
        (source.tags || []).some((t) => t.includes("still-in-play"));
      if (needsInPlay && !stillInPlay) {
        if (trigger.limit === "once") trigger.spent = true;
        continue;
      }
      if (hasTag(source, "score:bonus-points") || hasTag(source, "score:delayed")) {
        const amt =
          tagNumber(source, "bonus-points:amount") ||
          effectiveScoreValue(G, source.id) ||
          0;
        const o = source.ownerId;
        if (o && scores[o] !== undefined) scores[o] += amt;
      }
      if (hasTag(source, "delayed:even-non-scoring") && stillInPlay) {
        const o = source.ownerId;
        if (o && scores[o] !== undefined) {
          scores[o] += effectiveScoreValue(G, source.id);
        }
      }
      if (trigger.limit === "once") trigger.spent = true;
    }
  }

  // Cleanup era stack: scored → score pile, rest → discard
  const era = G.timeline[finishedEra];
  if (era) {
    const before = [...era.stack];
    era.stack = [];
    for (const cid of before) {
      if (G.scoredThisScoring?.includes(cid)) {
        const owner = cardOwner(cid, G);
        if (owner && G.players[owner]) {
          const card = getCard(G, cid);
          if (card && !G.players[owner].scorePile.some((x) => x.id === cid)) {
            G.players[owner].scorePile.push(card);
          }
        }
      } else {
        const card = getCard(G, cid);
        if (card && G.players[card.ownerId]) {
          G.players[card.ownerId].discard.push(card);
        }
      }
    }
    for (const actId of [...(era.actions ?? [])]) {
      const card = getCard(G, actId);
      if (card && G.players[card.ownerId]) {
        if (!G.players[card.ownerId].discard.some((x) => x.id === actId)) {
          G.players[card.ownerId].discard.push(card);
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
  pushActivityLog(G, `Finished processing ${finishedEra} (totals still provisional)`, "system");
}

/**
 * Wonky rule: each scoring slot scores the topmost *unscored* invention.
 * Later score effects (moves/swaps/discards) can change who fills remaining slots,
 * so we re-pick after every dual-ack instead of freezing a step list at start.
 */
function discoverNextStep(G: TimestreamsState): ScoringStep | null {
  const walk = G.scoringWalk!;
  const scored = G.scoredThisScoring ?? [];

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
      walk.eraSlotTotal = computeScoringSlotsForEra(
        G,
        eraId,
        G.scoreChoices || {},
      );
      walk.slotsUsedInEra = 0;
      walk.remainingSlots = walk.eraSlotTotal;
      walk.eraActionsPhase = false;
      G.scoringActiveEra = eraId;
    }

    // Invention slots (Wonky)
    if (!walk.eraActionsPhase && walk.remainingSlots > 0) {
      let nextUnscored: string | null = null;
      for (const cid of era.stack) {
        if (!scored.includes(cid)) {
          nextUnscored = cid;
          break;
        }
      }
      if (nextUnscored) {
        return {
          eraId,
          slotIndex: walk.slotsUsedInEra,
          cardId: nextUnscored,
          kind: "slot",
        };
      }
      // No more unscored inventions for remaining slots
      walk.eraActionsPhase = true;
    }

    // Era-level actions (Slow Time, Fast Time, …)
    for (const actId of era.actions ?? []) {
      if (!scored.includes(actId)) {
        walk.eraActionsPhase = true;
        return {
          eraId,
          slotIndex: -1,
          cardId: actId,
          kind: "era-action",
        };
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

  // Commit provisional → official totals only after every card is processed
  const provisional =
    G.scoringWalk?.provisionalScores ?? emptyProvisionalScores(G);
  G.scores = { ...provisional };

  const order = homeEraTurnOrder(G);
  let bestPid: string | null = null;
  let bestScore = -1;
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
    G.scoringWalk.lastSummary = `Final totals committed — winner P${G.winner}`;
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

  walk.currentCardId = step.cardId;
  walk.acks = emptyAcks(G);
  G.scoringActiveEra = step.eraId;

  const choicePrompts = collectInteractivePromptsForCard(G, step.cardId);
  const pending = choicePrompts.filter((p) => G.scoreChoices?.[p.id] === undefined);
  if (pending.length > 0) {
    walk.stepPhase = "choice";
    G.pendingPrompts = pending as any;
    const slotTxt =
      step.kind === "era-action"
        ? "era action"
        : `slot ${step.slotIndex + 1}`;
    walk.lastSummary = `Choices for ${getCard(G, step.cardId)?.name || step.cardId} (${step.eraId} · ${slotTxt})`;
    return false;
  }

  const summary = applyScoreForStep(G, step, G.scoreChoices || {});
  walk.lastSummary = summary;
  walk.stepPhase = "ack";
  G.pendingPrompts = [];
  pushActivityLog(G, summary, "info");
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
  G.scoredThisScoring = [];
  // Official totals stay zero until the walk finishes
  G.scores = emptyProvisionalScores(G);

  if (G.config?.rulesEnabled === false) {
    resolveScoringSimple(G);
    return true;
  }

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
  if (!walk || walk.stepPhase !== "choice") {
    return submitScoreChoiceLegacy(G, playerId, promptId, value);
  }

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

  if ((G.pendingPrompts?.length ?? 0) > 0) return false;

  const step = walk.steps[walk.stepIndex];
  if (!step) return "INVALID_MOVE";
  const summary = applyScoreForStep(G, step, G.scoreChoices);
  walk.lastSummary = summary;
  walk.stepPhase = "ack";
  walk.acks = emptyAcks(G);
  pushActivityLog(G, summary, "info");
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
  if (walk.stepPhase !== "ack") return "INVALID_MOVE";
  if (!G.playerOrder.includes(playerId)) return "INVALID_MOVE";

  walk.acks[playerId] = true;
  if (!G.playerOrder.every((pid) => walk.acks[pid])) {
    return false;
  }

  const step = walk.steps[walk.stepIndex];
  if (step && !walk.processedCardIds.includes(step.cardId)) {
    walk.processedCardIds.push(step.cardId);
  }
  walk.stepIndex += 1;
  walk.acks = emptyAcks(G);
  walk.currentCardId = null;

  // Re-discover next card from live board (Wonky) — do not use a frozen list
  return enterCurrentStep(G);
}

/**
 * Effective scoring-slot count for an era.
 * Base is `config.scoringSlots` (default 6), adjusted by cards in that era's
 * stack: Slow Time (`score:add-scoring-slots:2`), Fast Time (remove), optional
 * `play:add-scoring-slots`, and resolved score:choice slot options.
 *
 * Used by scoring and the board so "Slots: n / N" matches what scores.
 */
export function computeScoringSlotsForEra(
  G: TimestreamsState,
  eraId: string,
  choices: Record<string, string | string[]> = {},
): number {
  const base = G.config?.scoringSlots ?? 6;
  if (G.config?.rulesEnabled === false) return base;

  let delta = 0;
  const era = G.timeline[eraId as keyof typeof G.timeline];
  if (!era) return base;

  const mergedChoices: Record<string, string | string[]> = {
    ...(G.scoreChoices || {}),
    ...choices,
  };

  // Slot modifiers come from era-level actions (Slow/Fast Time) and any
  // inventions with slot choice tags — never require being "in a scoring slot".
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

    // Quantum Computing style runtime slot choices (once answered)
    const choiceKey = `${cid}:score-choice`;
    const ch = mergedChoices[choiceKey];
    const chStr = Array.isArray(ch) ? ch[0] : ch;
    if (chStr === "option-a" || chStr === "a") {
      if (
        hasTag(c, "option-a:add-scoring-slots:1") ||
        (c.tags || []).some((t) => t.startsWith("option-a:add-scoring-slots"))
      ) {
        delta += tagNumber(c, "option-a:add-scoring-slots") || 1;
      }
    }
    if (chStr === "option-b" || chStr === "b") {
      if (
        hasTag(c, "option-b:remove-scoring-slots:1") ||
        (c.tags || []).some((t) => t.startsWith("option-b:remove-scoring-slots"))
      ) {
        delta -= tagNumber(c, "option-b:remove-scoring-slots") || 1;
      }
    }
  }

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
    const add = tagNumber(c, "score:add-scoring-slots") ?? tagNumber(c, "play:add-scoring-slots");
    if (add) notes.push(`+${add} ${c.name || "card"}`);
    const rem = tagNumber(c, "score:remove-scoring-slots");
    if (rem) notes.push(`−${rem} ${c.name || "card"}`);
  }
  return notes;
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
 * Full rules scoring. Optional `choices` keys (see resolveCardScoreEffectsFull):
 *   `${cardId}:score-target`, `:score-choice`, `:score-guess-secret`, `:score-guess-answer`,
 *   `:score-move-target`, `:score-move-era`, `:score-discard`
 */
export function resolveScoring(
  G: TimestreamsState,
  choices: Record<string, string | string[]> = {},
): void {
  if (G.config?.rulesEnabled === false) {
    resolveScoringSimple(G);
    return;
  }

  const scores: Record<string, number> = {};
  for (const pid of G.playerOrder) scores[pid] = 0;

  G.scoredThisScoring = [];
  if (!(G as any).scoreValueOverrides) (G as any).scoreValueOverrides = {};
  (G as any).scoringPhase = "slots";

  function applyOther(other: Record<string, number>) {
    for (const [pid, n] of Object.entries(other)) {
      if (scores[pid] !== undefined) scores[pid] += n;
    }
  }

  // Always chronological era order (Object.keys order is not guaranteed).
  for (const eraId of ERA_ORDER) {
    const era = G.timeline[eraId];
    if (!era) continue;
    G.scoringActiveEra = eraId;
    const computedSlots = computeScoringSlotsForEra(G, eraId, choices);
    let remainingSlots = computedSlots;

    while (remainingSlots > 0) {
      const stack = era.stack;
      let nextUnscored: string | null = null;
      for (const cid of stack) {
        if (!G.scoredThisScoring.includes(cid)) {
          nextUnscored = cid;
          break;
        }
      }
      if (!nextUnscored) break;

      // Apply any pending set-value overrides before reading printed value
      const overrides = (G as any).scoreValueOverrides as Record<string, number>;
      if (overrides[nextUnscored] !== undefined) {
        const card = getCard(G, nextUnscored);
        if (card) card.scoreValue = overrides[nextUnscored];
      }

      const owner = cardOwner(nextUnscored, G);
      if (owner && scores[owner] !== undefined) {
        scores[owner] += effectiveScoreValue(G, nextUnscored);
      }

      const c = getCard(G, nextUnscored);
      if (c) {
        const full = resolveCardScoreEffectsFull(
          G,
          c,
          eraId,
          computedSlots - remainingSlots,
          choices,
        );

        // set-values apply to later / concurrent scoring
        for (const [tid, val] of Object.entries(full.setValues)) {
          overrides[tid] = val;
          const tc = getCard(G, tid);
          if (tc) tc.scoreValue = val;
        }

        // suppress targets: mark so their later score tags zero out
        for (const sid of full.suppressIds) {
          if (!G.scoredThisScoring.includes(sid)) {
            // store suppress flag via card tag or set on G
            if (!(G as any).suppressScoreEffects) (G as any).suppressScoreEffects = [];
            (G as any).suppressScoreEffects.push(sid);
          }
        }

        // steal: remove from play into stealer's score pile (even non-scoring)
        for (const sid of full.stealIds) {
          const stolen = getCard(G, sid);
          if (!stolen) continue;
          const loc = locateCard(G, sid);
          if (loc) {
            G.timeline[loc.era].stack.splice(loc.index, 1);
          }
          if (owner && G.players[owner]) {
            if (!G.players[owner].scorePile) G.players[owner].scorePile = [];
            G.players[owner].scorePile.push(stolen);
          }
          if (!G.scoredThisScoring.includes(sid)) {
            G.scoredThisScoring.push(sid);
          }
        }

        // discards (after this card's score; may remove later cards from slots)
        for (const did of full.discardIds) {
          if (G.scoredThisScoring.includes(did)) continue;
          discardFromPlay(G, did, owner || c.ownerId || "0");
        }

        applyOther(full.other);

        const extra = full.extra;
        if (hasTag(c, "score:to:all-players")) {
          for (const pid of Object.keys(scores)) {
            scores[pid] += extra;
          }
        } else if (owner) {
          scores[owner] += extra;
        }
      }

      G.scoredThisScoring.push(nextUnscored);
      remainingSlots--;
    }

    // Era-level actions (Slow Time, Multiplicity, …): score effects only —
    // they do not occupy slots and do not get slot point awards.
    for (const actId of era.actions ?? []) {
      if (G.scoredThisScoring.includes(actId)) continue;
      const c = getCard(G, actId);
      if (!c) continue;
      const owner = cardOwner(actId, G);
      const full = resolveCardScoreEffectsFull(
        G,
        c,
        eraId,
        -1, // not a scoring-slot index
        choices,
      );
      applyOther(full.other);
      const extra = full.extra;
      if (hasTag(c, "score:to:all-players")) {
        for (const pid of Object.keys(scores)) scores[pid] += extra;
      } else if (owner && scores[owner] !== undefined) {
        scores[owner] += extra;
      }
      G.scoredThisScoring.push(actId);
    }

    (G as any).scoringPhase = "delayed";
    fireEvent(G, {
      type: "era-scored" as any,
      cardId: "",
      eraId: eraId as any,
      actorPlayerId: "",
    });

    const allTriggersAtDelayed = getPendingTriggers(G);
    for (const trigger of allTriggersAtDelayed) {
      if (trigger.spent) continue;
      if (
        (trigger.event === "era-scored" || trigger.event === "delayed:era-scored") &&
        (trigger.eraAnchor === null || trigger.eraAnchor === eraId)
      ) {
        const source = getCard(G, trigger.sourceCardId);
        if (source) {
          // Delayed: still-in-play check
          const stillInPlay = !!locateCard(G, trigger.sourceCardId);
          const needsInPlay =
            hasTag(source, "delayed:condition:still-in-play") ||
            (source.tags || []).some((t) => t.includes("still-in-play"));
          if (needsInPlay && !stillInPlay) {
            if (trigger.limit === "once") trigger.spent = true;
            continue;
          }
          if (hasTag(source, "score:bonus-points") || hasTag(source, "score:delayed")) {
            const amt = tagNumber(source, "bonus-points:amount") || effectiveScoreValue(G, source.id) || 0;
            const o = source.ownerId;
            if (o && scores[o] !== undefined) {
              scores[o] += amt;
            }
          }
          // score delayed card's own printed value if even-non-scoring and still present
          if (hasTag(source, "delayed:even-non-scoring") && stillInPlay) {
            const o = source.ownerId;
            if (o && scores[o] !== undefined) {
              scores[o] += effectiveScoreValue(G, source.id);
            }
          }
          if (trigger.limit === "once") trigger.spent = true;
        }
      }
    }

    (G as any).scoringPhase = "cleanup";

    const before = [...era.stack];
    era.stack = [];
    for (const cid of before) {
      if (G.scoredThisScoring.includes(cid)) {
        const owner = cardOwner(cid, G);
        if (owner && G.players[owner]) {
          const card = getCard(G, cid);
          if (card && !G.players[owner].scorePile.some((x) => x.id === cid)) {
            if (!G.players[owner].scorePile) G.players[owner].scorePile = [];
            G.players[owner].scorePile.push(card);
          }
        }
      } else {
        const card = getCard(G, cid);
        if (card && G.players[card.ownerId]) {
          G.players[card.ownerId].discard.push(card);
        }
      }
    }
  }

  G.scores = scores;
  (G as any).scoringPhase = "done";
  G.scoringActiveEra = null;

  const order = homeEraTurnOrder(G);
  let bestPid: string | null = null;
  let bestScore = -1;
  for (const pid of order) {
    const s = scores[pid] ?? 0;
    if (s > bestScore || (s === bestScore && bestPid === null)) {
      bestScore = s;
      bestPid = pid;
    }
  }
  G.winner = bestPid ?? G.playerOrder[0] ?? null;
  G.phase = "gameOver";
}
