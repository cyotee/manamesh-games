import type { TimestreamsState } from "./types";
import { scoringSlotCardIds } from "./timeline";
import { homeEraTurnOrder } from "./homeEra";
import { effectiveScoreValue } from "./effects/boardOps";
import { getCard } from "./effects/state";
import { hasTag, tagNumber } from "./effects/tags";
import { resolveCardScoreEffects } from "./effects/executors/score";

export function cardOwner(cardId: string, G?: TimestreamsState): string {
  if (G) {
    const card = getCard(G, cardId);
    if (card?.ownerId) return card.ownerId;
  }
  const parts = cardId.split("-card-");
  return parts[0] || "";
}

export function resolveScoring(G: TimestreamsState, _choiceProvider?: any): void {
  const scores: Record<string, number> = {};
  for (const pid of G.playerOrder) scores[pid] = 0;

  // Initialize scored for this pass (M3 Wonky)
  G.scoredThisScoring = [];
  (G as any).scoringPhase = 'slots';

  function computeSlotsForEra(eraId: string): number {
    const base = G.config.scoringSlots ?? 6;
    let delta = 0;
    const era = G.timeline[eraId as any];
    if (!era) return base;
    for (const cid of era.stack) {
      const c = getCard(G, cid);
      if (!c) continue;
      if (hasTag(c, 'score:add-scoring-slots')) {
        delta += tagNumber(c, 'score:add-scoring-slots') || 0;
      }
      if (hasTag(c, 'score:remove-scoring-slots')) {
        delta -= tagNumber(c, 'score:remove-scoring-slots') || 0;
      }
      // Some play-time slot effects may also be present
      if (hasTag(c, 'play:add-scoring-slots')) {
        delta += tagNumber(c, 'play:add-scoring-slots') || 0;
      }
    }
    return Math.max(1, base + delta); // at least 1?
  }

  for (const eraId of Object.keys(G.timeline) as any) {
    const era = G.timeline[eraId];
    // TODO M3: compute dynamic slot count from effects / era cards (Slow/Fast Time etc.)
    const computedSlots = computeSlotsForEra(eraId);
    let remainingSlots = computedSlots;

    // Wonky rule: repeatedly find the current topmost unscored card
    while (remainingSlots > 0) {
      const stack = era.stack;  // re-read in case of movement (future)
      let nextUnscored: string | null = null;
      for (const cid of stack) {
        if (!G.scoredThisScoring.includes(cid)) {
          nextUnscored = cid;
          break;
        }
      }
      if (!nextUnscored) break;

      const owner = cardOwner(nextUnscored, G);
      if (owner && scores[owner] !== undefined) {
        scores[owner] += effectiveScoreValue(G, nextUnscored);
      }

      // Resolve score tags on this card (M3)
      const c = getCard(G, nextUnscored);
      if (c) {
        const extra = resolveCardScoreEffects(G, c, eraId, computedSlots - remainingSlots);
        if (owner) scores[owner] += extra;
      }

      G.scoredThisScoring.push(nextUnscored);
      remainingSlots--;
    }
  }

  G.scores = scores;

  (G as any).scoringPhase = 'delayed';
  // TODO: fire delayed triggers here per PRD

  (G as any).scoringPhase = 'cleanup';

  // Basic M3 cleanup: move scored slot cards to owners' score piles
  for (const cid of G.scoredThisScoring || []) {
    const owner = cardOwner(cid, G);
    if (owner && G.players[owner]) {
      const card = getCard(G, cid);
      if (card) {
        if (!G.players[owner].scorePile) G.players[owner].scorePile = [];
        G.players[owner].scorePile.push(card);
        // Optionally remove from timeline stack (per PRD, they stay until cleanup)
        // For now we leave them for visibility, but mark as collected logically
      }
    }
  }

  (G as any).scoringPhase = 'done';

  // Determine winner: highest score; ties -> first in homeEraTurnOrder (earliest era)
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
  // If still tie after order scan, fall back to first
  G.winner = bestPid ?? G.playerOrder[0] ?? null;
  G.phase = "gameOver";
}
