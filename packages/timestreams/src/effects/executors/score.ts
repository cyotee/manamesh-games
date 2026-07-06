import { hasTag, tagNumber, tagValue, isDeckMember } from '../tags';
import { effectiveScoreValue } from '../boardOps';
import { getCard } from '../state';
import { erasForScope, candidateTargets, cardAtOffset, locateCard } from '../targets';
import { done, type Executor } from '../types';

// Basic score effect resolver for a single card during scoring (M3 skeleton)
// Returns additional points from the card's score tags.
// Handles common shapes: bonus-points (amount/copy), count, penalty, to:all-players (handled in caller).
export function resolveCardScoreEffects(G: any, card: any, eraId: string, slotIndex: number): number {
  if (!card || !card.tags) return 0;
  let extra = 0;

  const isBonusCopy = hasTag(card, 'bonus-points:copy');
  if (hasTag(card, 'score:bonus-points') || isBonusCopy) {
    let amt = 0;
    if (isBonusCopy) {
      // resolve copy
      const tgtSpec = tagValue(card, 'copy:target') || 'self';
      const valType = tagValue(card, 'copy:value') || 'current';
      const scope = tagValue(card, 'copy:scope') || 'today';
      let targetId: string | null = null;
      if (tgtSpec === 'self') {
        targetId = card.id;
      } else if (tgtSpec.startsWith('offset-above:')) {
        const off = parseInt(tgtSpec.split(':')[1] || '1', 10);
        targetId = cardAtOffset(G, card.id, -off);  // above = lower index
      } else if (tgtSpec === 'any-card') {
        const tscope = tagValue(card, 'target:scope') || scope;
        const eras = erasForScope(G, tscope, card.id);
        const cands = candidateTargets(G, { kind: 'invention', eras, excludeCardId: card.id });
        targetId = cands[0] || null;
      }
      if (targetId) {
        const tcard = getCard(G, targetId);
        if (tcard) {
          amt = (valType === 'current') ? effectiveScoreValue(G, targetId) : (tcard.scoreValue || 0);
        }
      }
      // additional
      if (hasTag(card, 'bonus-points:additional')) {
        const add = tagNumber(card, 'bonus-points:additional') || 0;
        // simplistic condition check
        if (!hasTag(card, 'additional:condition:target-deck:future-tech') || true) {
          amt += add;
        }
      }
    } else {
      amt = tagNumber(card, 'bonus-points:amount') || 0;
      // TODO: condition:*
    }
    extra += amt;
  }

  // count: per:N with filters (basic M3)
  if (hasTag(card, 'score:count')) {
    const per = tagNumber(card, 'score:per') || 1;
    // simplistic count of matching in scope
    const cscope = tagValue(card, 'count:scope') || 'today';
    const eras = erasForScope(G, cscope, card.id);
    let matches = 0;
    for (const e of eras) {
      for (const cid of G.timeline[e].stack) {
        const cc = getCard(G, cid);
        if (!cc) continue;
        if (hasTag(card, 'count:own-inventions') && cc.ownerId !== card.ownerId) continue;
        if (hasTag(card, 'count:target-deck:future-tech') && !isDeckMember(cid, 'future-tech')) continue;
        matches++;
      }
    }
    extra += per * Math.max(1, matches); // at least per if present
  }

  // penalty:amount:N (negative)
  if (hasTag(card, 'score:penalty')) {
    const amt = tagNumber(card, 'penalty:amount') || 0;
    extra -= amt;
  }

  // perform-other (basic support for M3)
  if (hasTag(card, 'score:perform-other')) {
    const filter = tagValue(card, 'perform:target-filter') || 'any';
    // simplistic resolution: find a target in scope and add its value
    const scope = tagValue(card, 'target:scope') || 'today';
    const eras = erasForScope(G, scope, card.id);
    const kind = filter === 'any' ? 'any' : 'invention';
    const cands = candidateTargets(G, { kind, eras, excludeCardId: card.id });
    if (cands.length > 0) {
      const tgt = cands[0];
      extra += effectiveScoreValue(G, tgt);
    }
  }

  // conditional branch (basic M3)
  if (hasTag(card, 'score:branch')) {
    const cond = tagValue(card, 'condition') || '';
    let useTrue = false;
    if (cond === 'first-score' || hasTag(card, 'condition:first-score')) {
      // simplistic: treat as true for demo (real would track per-card first-score)
      useTrue = true;
    } else if (hasTag(card, 'condition:target-deck:future-tech')) {
      // simplistic
      useTrue = true;
    }
    // look for if-true: or if-false: sub-tags that carry amounts
    const branchPrefix = useTrue ? 'if-true:' : 'if-false:';
    for (const t of card.tags || []) {
      if (t.startsWith(branchPrefix)) {
        // e.g. if-true:bonus-points:amount:2 or if-true:count:per:1
        if (t.includes('bonus-points:amount:')) {
          const n = parseInt(t.split(':').pop() || '0', 10);
          if (!isNaN(n)) extra += n;
        } else if (t.includes('count:per:')) {
          const n = parseInt(t.split(':').pop() || '0', 10);
          if (!isNaN(n)) extra += n;
        }
      }
    }
  }

  // basic protect/suppress for score effects (M3)
  if (hasTag(card, 'protect:score-effects') || hasTag(card, 'suppress:score-effects-on-target')) {
    // for the card itself having the protect, zero tag-based extras (printed value still applies via effective)
    extra = 0;
  }

  return extra;
}

export const scoreExecutor: Executor = ({ G, playerId, card, choices }) => {
  // For play-time score? Some are score: but triggered in play? For now stub.
  // Real score execution happens in resolveScoring per card.
  return done([`${card.id}: score effect (resolved during scoring phase)`]);
};
