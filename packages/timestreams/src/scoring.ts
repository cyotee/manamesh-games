import type { TimestreamsState } from "./types";
import { scoringSlotCardIds } from "./timeline";
import { homeEraTurnOrder } from "./homeEra";
import { effectiveScoreValue } from "./effects/boardOps";

export function cardOwner(cardId: string): string {
  const parts = cardId.split("-card-");
  return parts[0] || "";
}

export function resolveScoring(G: TimestreamsState): void {
  const scores: Record<string, number> = {};
  for (const pid of G.playerOrder) scores[pid] = 0;

  // Initialize scored for this pass (M3 Wonky)
  if (!G.scoredThisScoring) G.scoredThisScoring = [];

  for (const eraId of Object.keys(G.timeline) as any) {
    const era = G.timeline[eraId];
    let slots = G.config.scoringSlots ?? 6;
    // Simple Wonky: take top unscored in stack up to slots
    const stack = [...era.stack];
    let scoredInEra = 0;
    for (const cid of stack) {
      if (scoredInEra >= slots) break;
      if (G.scoredThisScoring.includes(cid)) continue;
      const owner = cardOwner(cid);
      if (owner && scores[owner] !== undefined) {
        scores[owner] += effectiveScoreValue(G, cid);
      }
      G.scoredThisScoring.push(cid);
      scoredInEra++;
    }
  }

  G.scores = scores;

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
