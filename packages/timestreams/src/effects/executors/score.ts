import { hasTag, tagNumber, tagValue, isDeckMember, tagsWithPrefix, isOptionalFor } from '../tags';
import { effectiveScoreValue, discardFromPlay, moveToEra, isDiscardBlocked, isMoveBlocked } from '../boardOps';
import { getCard } from '../state';
import { erasForScope, candidateTargets, cardAtOffset, locateCard } from '../targets';
import { shouldCancelScoreEffects, isProtected } from '../react';
import { done, type Executor } from '../types';
import type { TimestreamsState, EraId } from '../../types';
import { ERA_ORDER } from '../../types';
import { eraForDay } from '../../timeline';
import { swapPositions } from './swap';

export type ScoreEffectResult = {
  extra: number;
  /** adjustments to other players' scores */
  other: Record<string, number>;
  log: string[];
  /** cards to discard from play after scoring this card */
  discardIds: string[];
  /** set printed overrides */
  setValues: Record<string, number>;
  /** steal card ids into owner's score pile immediately */
  stealIds: string[];
  /** suppress score effects on targets */
  suppressIds: string[];
};

function emptyResult(): ScoreEffectResult {
  return { extra: 0, other: {}, log: [], discardIds: [], setValues: {}, stealIds: [], suppressIds: [] };
}

function nextInventionId(G: TimestreamsState, cardId: string): string | null {
  return cardAtOffset(G, cardId, 1);
}

function deckOfCard(cardId: string): string {
  // stone-age-*, medieval-*, modern-*, future-tech-*
  if (cardId.startsWith('stone-age') || cardId.startsWith('stone')) return 'stone-age';
  if (cardId.startsWith('medieval')) return 'medieval';
  if (cardId.startsWith('modern')) return 'modern';
  if (cardId.startsWith('future')) return 'future-tech';
  return '';
}

function conditionTargetDeckOk(card: any, targetId: string): boolean {
  for (const t of card.tags ?? []) {
    if (t.startsWith('condition:target-deck:')) {
      const want = t.slice('condition:target-deck:'.length);
      const deck = deckOfCard(targetId);
      // condition true when target IS that deck
      return deck === want || deck.startsWith(want);
    }
  }
  return true;
}

/**
 * Resolve score tags for a single card. Optional choices map keys:
 *   `${card.id}:score-target`, `${card.id}:score-choice`, `${card.id}:score-guess-secret`,
 *   `${card.id}:score-guess-answer`
 */
export function resolveCardScoreEffects(
  G: any,
  card: any,
  eraId: string,
  slotIndex: number,
  choices: Record<string, string | string[]> = {},
): number {
  return resolveCardScoreEffectsFull(G, card, eraId, slotIndex, choices).extra;
}

export function resolveCardScoreEffectsFull(
  G: TimestreamsState,
  card: any,
  eraId: string,
  _slotIndex: number,
  choices: Record<string, string | string[]> = {},
): ScoreEffectResult {
  const out = emptyResult();
  if (!card || !card.tags) return out;
  if (!G.firedTags) G.firedTags = [];
  G.firedTags.push(`score:${card.id || 'unknown'}`);

  const choiceStr = (key: string) => {
    const v = choices[key];
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v[0] : v;
  };

  // --- bonus points ---
  const isBonusCopy = hasTag(card, 'bonus-points:copy');
  if (hasTag(card, 'score:bonus-points') || isBonusCopy) {
    let amt = 0;
    if (isBonusCopy) {
      const tgtSpec = tagValue(card, 'copy:target') || 'self';
      const valType = tagValue(card, 'copy:value') || 'current';
      const scope = tagValue(card, 'copy:scope') || 'today';
      let targetId: string | null = null;
      if (tgtSpec === 'self') targetId = card.id;
      else if (tgtSpec.startsWith('offset-above:')) {
        const off = parseInt(tgtSpec.split(':')[1] || '1', 10);
        targetId = cardAtOffset(G, card.id, -off);
      } else if (tgtSpec === 'any-card' || tgtSpec === 'invention') {
        const tscope = tagValue(card, 'target:scope') || scope;
        const eras = erasForScope(G, tscope, card.id);
        const cands = candidateTargets(G, { kind: 'invention', eras, excludeCardId: card.id });
        targetId = choiceStr(`${card.id}:score-target`) || cands[0] || null;
      }
      if (targetId) {
        const tcard = getCard(G, targetId);
        if (tcard) {
          amt = valType === 'current' ? effectiveScoreValue(G, targetId) : (tcard.scoreValue || 0);
        }
      }
      if (hasTag(card, 'bonus-points:additional')) {
        amt += tagNumber(card, 'bonus-points:additional') || 0;
      }
    } else {
      amt = tagNumber(card, 'bonus-points:amount') || 0;
      // condition:scored-in-era:future etc.
      if (hasTag(card, 'condition:scored-in-era:future') && eraId !== 'future') {
        amt = 0;
      }
      if (hasTag(card, 'condition:in-era:future') && eraId !== 'future') {
        amt = 0;
      }
      if (hasTag(card, 'condition:attached-to-first-invention-of-era')) {
        const loc = locateCard(G, card.id);
        // attachments: check if this card is attached to first invention
        const host = Object.entries(G.attachments || {}).find(([, list]) => list.includes(card.id))?.[0];
        if (host) {
          const hloc = locateCard(G, host);
          if (!hloc || hloc.index !== 0) amt = 0;
        } else if (!loc || loc.index !== 0) {
          // if scored as itself on first slot
          if (!loc || loc.index !== 0) amt = 0;
        }
      }
    }
    out.extra += amt;
    if (amt) out.log.push(`${card.id}: bonus ${amt}`);
  }

  // --- count ---
  if (hasTag(card, 'score:count')) {
    const per = tagNumber(card, 'score:per') || 1;
    const cscope = tagValue(card, 'count:scope') || 'today';
    const eras = erasForScope(G, cscope, card.id);
    let matches = 0;
    for (const e of eras) {
      for (const cid of G.timeline[e].stack) {
        const cc = getCard(G, cid);
        if (!cc) continue;
        if (hasTag(card, 'count:own-inventions') && cc.ownerId !== card.ownerId) continue;
        if (hasTag(card, 'count:cardtype:invention') && cc.cardType !== 'invention') continue;
        if (hasTag(card, 'count:owner:opponents') && cc.ownerId === card.ownerId) continue;
        for (const t of card.tags || []) {
          if (t.startsWith('count:target-deck:') && !isDeckMember(cid, t.slice('count:target-deck:'.length) as any)) {
            // skip if deck filter fails — only apply filter if any deck tags
          }
        }
        const deckFilters = (card.tags || []).filter((t: string) => t.startsWith('count:target-deck:'));
        if (deckFilters.length) {
          const ok = deckFilters.some((t: string) => isDeckMember(cid, t.slice('count:target-deck:'.length) as any));
          if (!ok) continue;
        }
        if (hasTag(card, 'count:condition:printed-value-under-3') && (cc.scoreValue ?? 0) >= 3) continue;
        matches++;
      }
    }
    if (!hasTag(card, 'count:include-self')) {
      // already counting stack; self may be included — fine
    }
    out.extra += per * matches;
    out.log.push(`${card.id}: count ${matches}*${per}`);
  }

  // --- set value ---
  if (hasTag(card, 'score:set-value') || hasTag(card, 'set-value:amount:0')) {
    const amt = tagNumber(card, 'set-value:amount') ?? 0;
    const scope = tagValue(card, 'target:scope') || 'current-era';
    const eras = erasForScope(G, scope, card.id);
    const cands = candidateTargets(G, { kind: 'invention', eras, excludeCardId: card.id });
    const tid = choiceStr(`${card.id}:score-target`) || cands[0];
    if (tid) {
      out.setValues[tid] = amt;
      out.log.push(`${card.id}: set ${tid} value to ${amt}`);
    }
  }

  // --- discard ---
  if (hasTag(card, 'score:discard')) {
    const scope = tagValue(card, 'discard:scope') || tagValue(card, 'target:scope') || 'current-era';
    let targetId: string | null = null;
    if (hasTag(card, 'discard:target:bottom-of-era')) {
      const eras = erasForScope(G, scope === 'current-era' ? 'current-era' : scope, card.id);
      const era = eras[0] || eraForDay(G.currentDay);
      const stack = G.timeline[era]?.stack ?? [];
      targetId = stack[stack.length - 1] || null;
    } else {
      const eras = erasForScope(G, scope, card.id);
      const cands = candidateTargets(G, { kind: 'invention', eras, excludeCardId: card.id });
      targetId = choiceStr(`${card.id}:score-target`) || cands[0] || null;
    }
    const optional = hasTag(card, 'discard:optional');
    if (targetId && (!optional || choiceStr(`${card.id}:score-discard`) !== 'no')) {
      out.discardIds.push(targetId);
      out.log.push(`${card.id}: score-discard ${targetId}`);
    }
  }

  // --- swap (Virtual Reality / Telescope): two inventions ---
  if (hasTag(card, 'score:swap')) {
    const optional = isOptionalFor(card, 'swap');
    const key = `${card.id}:score-swap-pair`;
    const raw = choices[key];
    const pair = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (pair.length >= 2) {
      const [aId, bId] = pair;
      let ok = true;
      for (const id of [aId, bId]) {
        const blocked = isMoveBlocked(G, id, card.ownerId);
        if (blocked) {
          out.log.push(`${card.id}: score-swap fizzles (${id} ${blocked})`);
          ok = false;
          break;
        }
      }
      if (ok && swapPositions(G, aId, bId)) {
        out.log.push(`${card.id}: score-swapped ${aId} <-> ${bId}`);
      } else if (ok) {
        out.log.push(`${card.id}: score-swap fizzles (locate failed)`);
      }
    } else if (!optional && pair.length === 0) {
      // Mandatory swap without a choice: try first two candidates (non-interactive fallback).
      const scope = tagValue(card, 'swap:scope') || 'today';
      const eras = erasForScope(G, scope, card.id);
      const exclude = hasTag(card, 'target:exclude-self') ? card.id : undefined;
      const cands = candidateTargets(G, { kind: 'invention', eras, excludeCardId: exclude });
      if (cands.length >= 2 && swapPositions(G, cands[0], cands[1])) {
        out.log.push(`${card.id}: score-swapped ${cands[0]} <-> ${cands[1]} (auto)`);
      }
    } else {
      out.log.push(`${card.id}: score-swap declined`);
    }
  }

  // --- move (pottery-style) ---
  if (hasTag(card, 'score:move')) {
    const optional = hasTag(card, 'move:optional');
    const scopeSrc = tagValue(card, 'move-source') || 'today';
    const destSpec = tagValue(card, 'move-destination') || 'any-future-era';
    const eras = erasForScope(G, scopeSrc, card.id);
    const cands = candidateTargets(G, { kind: 'any', eras, excludeCardId: card.id });
    const tid = choiceStr(`${card.id}:score-move-target`) || cands[0];
    if (tid && (!optional || choiceStr(`${card.id}:score-move`) !== 'no')) {
      let destEra: EraId | null = null;
      if (destSpec === 'any-future-era' || destSpec === 'top-future') {
        const today = eraForDay(Math.min(G.currentDay, ERA_ORDER.length));
        const i = ERA_ORDER.indexOf(today);
        destEra = ERA_ORDER[i + 1] || ERA_ORDER[ERA_ORDER.length - 1];
        const chosen = choiceStr(`${card.id}:score-move-era`) as EraId | undefined;
        if (chosen && ERA_ORDER.includes(chosen)) destEra = chosen;
      } else if (destSpec === 'top-next-era') {
        const loc = locateCard(G, tid);
        if (loc) {
          const i = ERA_ORDER.indexOf(loc.era);
          destEra = ERA_ORDER[i + 1] || null;
        }
      }
      if (destEra) {
        moveToEra(G, tid, destEra, 'bottom');
        out.log.push(`${card.id}: moved ${tid} to ${destEra}`);
        if (hasTag(card, 'score:delayed') || hasTag(card, 'delayed:trigger:after-destination-era-scored')) {
          // mark for delayed score after that era
          if (!G.pendingTriggers) G.pendingTriggers = [];
          G.pendingTriggers.push({
            sourceCardId: tid,
            ownerId: getCard(G, tid)?.ownerId || card.ownerId,
            event: 'era-scored',
            eraAnchor: destEra,
            limit: 'once',
            spent: false,
          } as any);
        }
      }
    }
  }

  // --- steal to score pile ---
  if (hasTag(card, 'steal:target-to:own-score-pile') || hasTag(card, 'steal:even-non-scoring')) {
    const scope = tagValue(card, 'target:scope') || 'today';
    const eras = erasForScope(G, scope, card.id);
    let cands = candidateTargets(G, { kind: 'invention', eras, excludeCardId: card.id });
    // subtype filters
    const subtypes = (card.tags || [])
      .filter((t: string) => t.startsWith('target:subtype:'))
      .map((t: string) => t.slice('target:subtype:'.length));
    if (subtypes.length) {
      cands = cands.filter((cid) => {
        const c = getCard(G, cid);
        return c && subtypes.some((s: string) => c.subtypes?.includes(s) || cid.includes(s));
      });
    }
    const tid = choiceStr(`${card.id}:score-target`) || cands[0];
    if (tid) {
      out.stealIds.push(tid);
      // also perform other score value
      if (hasTag(card, 'score:perform-other')) {
        out.extra += effectiveScoreValue(G, tid);
      }
      out.log.push(`${card.id}: steal ${tid}`);
    }
  }

  // --- perform-other (without steal) ---
  if (hasTag(card, 'score:perform-other') && !hasTag(card, 'steal:target-to:own-score-pile')) {
    const scope = tagValue(card, 'target:scope') || 'today';
    const eras = erasForScope(G, scope, card.id);
    const cands = candidateTargets(G, { kind: 'invention', eras, excludeCardId: card.id });
    const tid = choiceStr(`${card.id}:score-target`) || cands[0];
    if (tid) {
      if (hasTag(card, 'suppress:score-effects-on-target') || hasTag(card, 'score:choice')) {
        const choice = choiceStr(`${card.id}:score-choice`) || 'perform';
        if (choice === 'cancel' || choice === 'suppress') {
          out.suppressIds.push(tid);
          out.log.push(`${card.id}: suppress ${tid}`);
        } else {
          out.extra += effectiveScoreValue(G, tid);
          out.log.push(`${card.id}: perform-other ${tid}`);
        }
      } else {
        out.extra += effectiveScoreValue(G, tid);
      }
    }
  }

  // --- branch / if-true / if-false ---
  if (hasTag(card, 'score:branch') || (card.tags || []).some((t: string) => t.startsWith('if-true:') || t.startsWith('if-false:'))) {
    const nextId =
      hasTag(card, 'branch:target:next-invention') || hasTag(card, 'branch:target:next-scoring-invention')
        ? nextInventionId(G, card.id)
        : null;
    let useTrue = true;
    if (nextId) {
      // condition:target-deck:X means "if next IS deck X"
      const deckConds = (card.tags || []).filter((t: string) => t.startsWith('condition:target-deck:'));
      if (deckConds.length) {
        useTrue = deckConds.some((t: string) => conditionTargetDeckOk({ tags: [t] }, nextId));
      }
    } else if (hasTag(card, 'condition:first-score')) {
      useTrue = true;
    }

    const branchPrefix = useTrue ? 'if-true:' : 'if-false:';
    for (const t of card.tags || []) {
      if (!t.startsWith(branchPrefix)) continue;
      if (t.includes('bonus-points:printed-value:target') && nextId) {
        const n = getCard(G, nextId)?.scoreValue || 0;
        out.extra += n;
        out.log.push(`${card.id}: branch bonus printed ${n}`);
      } else if (t.includes('bonus-points:to:self')) {
        // amount already via printed-value or amount
      } else if (t.includes('bonus-points:amount:')) {
        const n = parseInt(t.split(':').pop() || '0', 10);
        if (!isNaN(n)) out.extra += n;
      } else if (t.includes('penalty:amount:')) {
        // tags use signed amounts (e.g. if-false:penalty:amount:-2)
        const n = parseInt(t.split(':').pop() || '0', 10);
        if (!isNaN(n) && nextId) {
          const owner = getCard(G, nextId)?.ownerId;
          if (owner) {
            const delta = n <= 0 ? n : -n;
            out.other[owner] = (out.other[owner] || 0) + delta;
          }
        }
      } else if (t.includes('penalty:printed-value:target') && nextId) {
        const n = getCard(G, nextId)?.scoreValue || 0;
        const owner = getCard(G, nextId)?.ownerId;
        if (owner) out.other[owner] = (out.other[owner] || 0) - Math.abs(n);
      } else if (t.includes('penalty:to:target-owner')) {
        // handled with amount/printed above
      } else if (t.includes('discard:target') && nextId) {
        out.discardIds.push(nextId);
        out.log.push(`${card.id}: branch discard ${nextId}`);
      }
    }
  }

  // --- guess (mysticism) ---
  if (hasTag(card, 'score:guess') || hasTag(card, 'guess:range:1-4')) {
    const secretKey = `${card.id}:score-guess-secret`;
    const guessKey = `${card.id}:score-guess-answer`;
    const secret = parseInt(choiceStr(secretKey) || '2', 10);
    const guess = parseInt(choiceStr(guessKey) || '0', 10);
    const correctPenalty = tagNumber(card, 'guess:correct:penalty') ?? 3;
    if (guess === secret) {
      out.extra -= Math.abs(correctPenalty);
      out.log.push(`${card.id}: guess correct penalty -${Math.abs(correctPenalty)}`);
    } else {
      out.extra += secret;
      out.log.push(`${card.id}: guess wrong bonus ${secret}`);
    }
  }

  // --- penalty next inventor ---
  if (hasTag(card, 'score:penalty:next-inventor')) {
    const amt = tagNumber(card, 'penalty:amount') || 0;
    const nextId = nextInventionId(G, card.id);
    if (nextId) {
      const owner = getCard(G, nextId)?.ownerId;
      if (owner) out.other[owner] = (out.other[owner] || 0) - Math.abs(amt);
    }
  }

  // --- generic penalty ---
  if (hasTag(card, 'score:penalty') && !hasTag(card, 'score:penalty:next-inventor')) {
    const amt = tagNumber(card, 'penalty:amount') || 0;
    out.extra -= Math.abs(amt);
  }

  // --- score:choice option-a / option-b (Quantum Computing style) ---
  if (hasTag(card, 'score:choice') && !hasTag(card, 'score:perform-other')) {
    const ch = choiceStr(`${card.id}:score-choice`) || 'option-a';
    // Slot changes applied in resolveScoring computeSlotsForEra; log only here.
    out.log.push(`${card.id}: score-choice ${ch}`);
  }

  // --- suppress / cancel ---
  const suppressList = ((G as any).suppressScoreEffects as string[] | undefined) || [];
  if (
    suppressList.includes(card.id) ||
    shouldCancelScoreEffects(G, card.id) ||
    isProtected(G, card.id, 'score-effects') ||
    hasTag(card, 'protect:score-effects')
  ) {
    out.extra = 0;
    out.log.push(`${card.id}: score effects cancelled/protected`);
  }

  // cancel:target-filter:unscored — only cancel effects on cards not yet scored
  if (hasTag(card, 'cancel:target-filter:unscored') && hasTag(card, 'score:choice')) {
    // handled via suppress choice path in perform-other
  }

  return out;
}

export const scoreExecutor: Executor = ({ G, playerId, card, choices }) => {
  return done([`${card.id}: score effect (resolved during scoring phase)`]);
};
