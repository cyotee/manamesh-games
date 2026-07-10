import { hasTag, tagNumber, tagValue, isDeckMember, tagsWithPrefix, isOptionalFor } from '../tags';
import { effectiveScoreValue, discardFromPlay, moveToEra, isDiscardBlocked, isMoveBlocked } from '../boardOps';
import { getCard } from '../state';
import { erasForScope, candidateTargets, cardAtOffset, locateCard } from '../targets';
import { shouldCancelScoreEffects, isProtected } from '../react';
import { done, type Executor } from '../types';
import type { TimestreamsState, EraId } from '../../types';
import { ERA_ORDER } from '../../types';
import { eraForDay, scoringSlotCardIds } from '../../timeline';
import {
  computeScoringSlotsForEra,
  slotDeltaFromScoreChoice,
  adjustEraScoringSlots,
} from '../../scoringSlots';
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

function mergeNestedScore(out: ScoreEffectResult, nested: ScoreEffectResult): void {
  out.extra += nested.extra;
  for (const [pid, n] of Object.entries(nested.other)) {
    out.other[pid] = (out.other[pid] || 0) + n;
  }
  out.discardIds.push(...nested.discardIds);
  Object.assign(out.setValues, nested.setValues);
  out.stealIds.push(...nested.stealIds);
  out.suppressIds.push(...nested.suppressIds);
  out.log.push(...nested.log);
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
  /** Nesting depth for perform-other (Nanotech chains). */
  _depth = 0,
  /**
   * Cards whose perform-other is already active on this chain.
   * Targeting one closes the loop (steal still applies; ability not re-run).
   */
  performChain: Set<string> = new Set(),
): ScoreEffectResult {
  const out = emptyResult();
  if (!card || !card.tags) return out;
  if (_depth > 8) {
    out.log.push(`${card.id}: perform-other depth cap`);
    return out;
  }
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
        const kind = tgtSpec === 'invention' ? 'invention' : 'any';
        const cands = candidateTargets(G, {
          kind,
          eras,
          excludeCardId: hasTag(card, 'target:exclude-self') ? card.id : card.id,
        });
        targetId = choiceStr(`${card.id}:score-target`) || null;
        // never auto-pick when multiple options
        if (!targetId && cands.length === 1) targetId = cands[0];
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
  // Irrigation/Yoke: score:to:all-players + count:own-inventions means EACH
  // player scores per *their* matching inventions — not one count broadcast.
  if (hasTag(card, 'score:count')) {
    const per = tagNumber(card, 'score:per') || 1;
    const cscope = tagValue(card, 'count:scope') || 'today';
    const eras = erasForScope(G, cscope, card.id);
    const onlyInScoringSlot = hasTag(card, 'count:in-scoring-slot');
    const ownInventions = hasTag(card, 'count:own-inventions');
    const perPlayerOwn =
      ownInventions && hasTag(card, 'score:to:all-players');

    const countForOwner = (ownerFilter: string | null): number => {
      let matches = 0;
      for (const e of eras) {
        const eraState = G.timeline[e];
        if (!eraState) continue;
        let candidates = eraState.stack;
        if (onlyInScoringSlot) {
          const cap = computeScoringSlotsForEra(G, e, choices);
          candidates = scoringSlotCardIds(eraState, cap);
        }
        for (const cid of candidates) {
          const cc = getCard(G, cid);
          if (!cc) continue;
          if (ownInventions && ownerFilter != null && cc.ownerId !== ownerFilter) {
            continue;
          }
          if (hasTag(card, 'count:cardtype:invention') && cc.cardType !== 'invention') {
            continue;
          }
          if (
            hasTag(card, 'count:owner:opponents') &&
            cc.ownerId === card.ownerId
          ) {
            continue;
          }
          const deckFilters = (card.tags || []).filter((t: string) =>
            t.startsWith('count:target-deck:'),
          );
          if (deckFilters.length) {
            const ok = deckFilters.some((t: string) =>
              isDeckMember(cid, t.slice('count:target-deck:'.length) as any),
            );
            if (!ok) continue;
          }
          if (
            hasTag(card, 'count:condition:printed-value-under-3') &&
            (cc.scoreValue ?? 0) >= 3
          ) {
            continue;
          }
          // Default: inventions only for own-invention counts
          if (ownInventions && cc.cardType && cc.cardType !== 'invention') {
            continue;
          }
          matches++;
        }
      }
      return matches;
    };

    if (perPlayerOwn) {
      for (const pid of G.playerOrder) {
        const matches = countForOwner(pid);
        const pts = per * matches;
        if (pts) {
          out.other[pid] = (out.other[pid] || 0) + pts;
        }
        out.log.push(`${card.id}: count for P${pid} ${matches}*${per}`);
      }
      // extra stays 0 — do not broadcast a single total via score:to:all-players
    } else {
      const matches = countForOwner(ownInventions ? card.ownerId : null);
      out.extra += per * matches;
      out.log.push(`${card.id}: count ${matches}*${per}`);
    }
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

  // --- move (pottery / shipbuilding style) ---
  if (hasTag(card, 'score:move')) {
    const optional = hasTag(card, 'move:optional') || isOptionalFor(card, 'move');
    const destSpec = tagValue(card, 'move-destination') || 'any-future-era';
    // Scoring "today" is the era being walked when present
    const scoreToday =
      (G.scoringActiveEra as EraId | null | undefined) ||
      eraForDay(Math.min(G.currentDay, ERA_ORDER.length));

    // Resolve move target
    let tid: string | null = null;
    const offsetBelow = (card.tags || []).find((t: string) =>
      t.startsWith('move:target:offset-below:'),
    );
    if (offsetBelow || hasTag(card, 'move:target:offset-below:1')) {
      const off = offsetBelow
        ? parseInt(offsetBelow.split(':').pop() || '1', 10)
        : 1;
      tid = cardAtOffset(G, card.id, Number.isNaN(off) ? 1 : off);
    } else {
      const scopeSrc = tagValue(card, 'move-source') || 'today';
      const eras = erasForScope(G, scopeSrc, card.id);
      const mt = tagValue(card, 'move:target') || 'any-card';
      const kind =
        mt === 'invention' || mt === 'any-invention' ? 'invention' : 'any';
      const cands = candidateTargets(G, {
        kind,
        eras,
        excludeCardId: hasTag(card, 'target:exclude-self') ? card.id : undefined,
      });
      tid = choiceStr(`${card.id}:score-move-target`) || null;
      // Only auto-pick when a single legal target (avoid silent wrong pick)
      if (!tid && cands.length === 1 && !optional) tid = cands[0];
    }

    const declined =
      optional &&
      (choiceStr(`${card.id}:score-move`) === 'no' ||
        choiceStr(`${card.id}:score-move`) === 'skip');
    if (tid && !declined) {
      let destEra: EraId | null = null;
      let destPos: 'top' | 'bottom' | number = 'bottom';

      if (destSpec === 'bottom-today' || destSpec === 'bottom-of-today') {
        destEra = scoreToday;
        destPos = 'bottom';
      } else if (destSpec === 'top-today' || destSpec === 'top-of-today') {
        destEra = scoreToday;
        destPos = 'top';
      } else if (destSpec === 'top-future') {
        // Cybertechnology: always top of Future Tech era (not "any future" / bottom)
        destEra = 'future';
        destPos = 'top';
      } else if (destSpec === 'any-future-era') {
        const i = ERA_ORDER.indexOf(scoreToday);
        const futureEras = ERA_ORDER.slice(i + 1);
        const chosen = choiceStr(`${card.id}:score-move-era`) as EraId | undefined;
        if (chosen && futureEras.includes(chosen as EraId)) {
          destEra = chosen as EraId;
        } else if (futureEras.length === 1) {
          destEra = futureEras[0];
        } else if (futureEras.length > 1 && chosen && ERA_ORDER.includes(chosen)) {
          destEra = chosen;
        } else if (futureEras.length > 0 && !optional) {
          destEra = null;
        }
        destPos = 'bottom';
      } else if (destSpec === 'top-next-era') {
        const loc = locateCard(G, tid);
        if (loc) {
          const i = ERA_ORDER.indexOf(loc.era);
          destEra = ERA_ORDER[i + 1] || null;
        }
        destPos = 'top';
      }

      if (destEra) {
        moveToEra(G, tid, destEra, destPos);
        out.log.push(`${card.id}: moved ${tid} to ${destEra} (${destPos})`);
        if (
          hasTag(card, 'score:delayed') ||
          hasTag(card, 'delayed:trigger:after-destination-era-scored')
        ) {
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
      } else if (tid) {
        out.log.push(`${card.id}: score-move ${tid} needs destination era`);
      }
    }
  }

  // --- perform-other (+ optional steal) ---
  // Alphabet/Chaos: ability only (no steal tags).
  // Nanotech: process target ability fully, THEN steal:target-to:own-score-pile.
  // Bare steal without perform is not used by current packs but still supported after.
  if (hasTag(card, 'score:perform-other')) {
    const willSteal = hasTag(card, 'steal:target-to:own-score-pile');
    const scope = tagValue(card, 'target:scope') || 'today';
    const eras = erasForScope(G, scope, card.id);
    let cands = candidateTargets(G, {
      kind: 'invention',
      eras,
      excludeCardId:
        hasTag(card, 'target:exclude-self') || willSteal ? card.id : undefined,
    });
    const subtypes = (card.tags || [])
      .filter((t: string) => t.startsWith('target:subtype:'))
      .map((t: string) => t.slice('target:subtype:'.length));
    if (subtypes.length) {
      cands = cands.filter((cid) => {
        const c = getCard(G, cid);
        return (
          c &&
          subtypes.some(
            (s: string) => c.subtypes?.includes(s) || cid.includes(s),
          )
        );
      });
    }

    const tid = choiceStr(`${card.id}:score-target`) || null;
    const optionalPerform =
      isOptionalFor(card, 'perform') || hasTag(card, 'perform:optional');
    const targetId =
      tid && cands.includes(tid)
        ? tid
        : cands.length === 1 && !optionalPerform
          ? cands[0]
          : null;

    if (targetId) {
      // NT0→NT1→NT0: allow the cycle target for steal, but do not re-run ability.
      const isCycle = performChain.has(targetId);
      if (isCycle) {
        out.log.push(
          `${card.id}: perform-other ${targetId} closes chain (no re-perform)`,
        );
      } else if (hasTag(card, 'suppress:score-effects-on-target') || hasTag(card, 'score:choice')) {
        // Chaos Theory: perform ability OR suppress target's future score effects
        const choice = choiceStr(`${card.id}:score-choice`) || 'perform';
        if (choice === 'cancel' || choice === 'suppress') {
          out.suppressIds.push(targetId);
          out.log.push(`${card.id}: suppress ${targetId}`);
        } else {
          const targetCard = getCard(G, targetId);
          if (targetCard) {
            const nextChain = new Set(performChain);
            nextChain.add(card.id);
            mergeNestedScore(out, resolveCardScoreEffectsFull(
              G, targetCard, eraId, _slotIndex, choices, _depth + 1, nextChain,
            ));
            out.log.push(`${card.id}: perform-other ability of ${targetId} (as self)`);
          }
        }
      } else {
        // Alphabet / Nanotech: run target's score ability (bonuses, moves, nested perform…)
        const targetCard = getCard(G, targetId);
        if (targetCard) {
          const nextChain = new Set(performChain);
          nextChain.add(card.id);
          mergeNestedScore(out, resolveCardScoreEffectsFull(
            G, targetCard, eraId, _slotIndex, choices, _depth + 1, nextChain,
          ));
          out.log.push(`${card.id}: perform-other ability of ${targetId}`);
        }
      }

      // Steal only when tagged — after ability fully resolved (or cycle close)
      if (willSteal) {
        out.stealIds.push(targetId);
        out.log.push(`${card.id}: steal ${targetId} → score pile`);
      }
    } else if (cands.length === 0) {
      out.log.push(`${card.id}: perform-other fizzles (no targets)`);
    } else {
      out.log.push(`${card.id}: perform-other skipped (no target chosen)`);
    }
  } else if (
    hasTag(card, 'steal:target-to:own-score-pile') ||
    hasTag(card, 'steal:even-non-scoring')
  ) {
    // Steal without perform (no current pack card; keep shape)
    const scope = tagValue(card, 'target:scope') || 'today';
    const eras = erasForScope(G, scope, card.id);
    let cands = candidateTargets(G, {
      kind: 'invention',
      eras,
      excludeCardId: card.id,
    });
    const subtypes = (card.tags || [])
      .filter((t: string) => t.startsWith('target:subtype:'))
      .map((t: string) => t.slice('target:subtype:'.length));
    if (subtypes.length) {
      cands = cands.filter((cid) => {
        const c = getCard(G, cid);
        return (
          c &&
          subtypes.some(
            (s: string) => c.subtypes?.includes(s) || cid.includes(s),
          )
        );
      });
    }
    const tid = choiceStr(`${card.id}:score-target`) || cands[0];
    if (tid) {
      out.stealIds.push(tid);
      out.log.push(`${card.id}: steal ${tid}`);
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

  // --- generic / targeted penalty (Cave Paintings: optional art in today) ---
  if (hasTag(card, 'score:penalty') && !hasTag(card, 'score:penalty:next-inventor')) {
    const amt = Math.abs(tagNumber(card, 'penalty:amount') || 0);
    const optional = hasTag(card, 'penalty:optional') || isOptionalFor(card, 'penalty');
    const toOwner = hasTag(card, 'penalty:to:target-owner');
    const artOnly = hasTag(card, 'penalty:target:art');
    const scope = tagValue(card, 'target:scope') || 'today';
    const eras = erasForScope(G, scope, card.id);
    let cands = candidateTargets(G, {
      kind: 'invention',
      eras,
      excludeCardId: hasTag(card, 'target:exclude-self') ? card.id : undefined,
    });
    if (artOnly) {
      cands = cands.filter((cid) => {
        const c = getCard(G, cid);
        return !!c && (c.subtypes || []).includes('art');
      });
    }
    const tid = choiceStr(`${card.id}:score-penalty-target`) || null;
    if (optional && (tid === '' || tid === 'none' || tid === undefined || tid === null)) {
      // declined or no choice yet — no penalty
      if (tid === undefined && cands.length === 0) {
        /* no targets */
      } else if (tid === undefined) {
        out.log.push(`${card.id}: penalty awaiting target choice`);
      } else {
        out.log.push(`${card.id}: penalty declined`);
      }
    } else if (tid && cands.includes(tid) && toOwner) {
      const victim = getCard(G, tid)?.ownerId;
      if (victim) {
        out.other[victim] = (out.other[victim] || 0) - amt;
        out.log.push(`${card.id}: penalty -${amt} to owner of ${tid}`);
      }
    } else if (!optional && !toOwner) {
      out.extra -= amt;
      out.log.push(`${card.id}: self penalty -${amt}`);
    } else if (!optional && toOwner && cands.length === 1) {
      const victim = getCard(G, cands[0])?.ownerId;
      if (victim) out.other[victim] = (out.other[victim] || 0) - amt;
    }
  }

  // --- score:choice option-a / option-b (slot ±N via tags) ---
  // Each resolution **increments the era counter**. No per-card "already applied"
  // lock — two Quantum Computings (or any two effects) stack; re-processing adds again.
  if (hasTag(card, 'score:choice') && !hasTag(card, 'score:perform-other')) {
    const ch = choiceStr(`${card.id}:score-choice`);
    if (ch) {
      out.log.push(`${card.id}: score-choice ${ch}`);
      const delta = slotDeltaFromScoreChoice(card, ch);
      if (delta) {
        const adj = adjustEraScoringSlots(
          G,
          eraId as EraId,
          delta,
          `${delta > 0 ? '+' : ''}${delta} scoring slot(s) in ${eraId}`,
        );
        if (adj) out.log.push(`${card.id}: ${adj.note}`);
      }
    } else {
      out.log.push(`${card.id}: score-choice not answered (no slot change)`);
    }
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
