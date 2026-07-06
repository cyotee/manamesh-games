import { hasTag, tagNumber, tagValue } from '../tags';
import { done, type Executor } from '../types';

// Basic score effect resolver for a single card during scoring (M3 skeleton)
// For now, returns additional points from the card's score tags.
// Full per-shape executors (with prompts, scopes etc) can be added later.
export function resolveCardScoreEffects(G: any, card: any, eraId: string, slotIndex: number): number {
  if (!card || !card.tags) return 0;
  let extra = 0;

  // bonus-points:amount:N + condition if present (simple for now)
  if (hasTag(card, 'score:bonus-points')) {
    const amt = tagNumber(card, 'bonus-points:amount') || 0;
    // TODO: evaluate condition:*
    extra += amt;
  }

  // count: per:N (simplistic, real would filter by count: tags)
  if (hasTag(card, 'score:count')) {
    const per = tagNumber(card, 'score:per') || 1;
    // simplistic +per
    extra += per;
  }

  // penalty:amount:N (negative)
  if (hasTag(card, 'score:penalty')) {
    const amt = tagNumber(card, 'penalty:amount') || 0;
    extra -= amt;
  }

  return extra;
}

export const scoreExecutor: Executor = ({ G, playerId, card, choices }) => {
  // For play-time score? Some are score: but triggered in play? For now stub.
  // Real score execution happens in resolveScoring per card.
  return done([`${card.id}: score effect (resolved during scoring phase)`]);
};
