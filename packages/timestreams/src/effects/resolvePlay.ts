import type { TimestreamsState } from '../types';
import { requireCard } from './state';
import { tagsWithPrefix, hasTag, tagValue } from './tags';
import { merge, OK, type ChoiceMap, type EffectResult, type Executor, type ExecCtx } from './types';

/**
 * Resolves a play effect for the given card.
 * Dispatches to registered executors based on tags (play:draw, play:discard, etc.).
 * Returns merged EffectResult with prompts and logs.
 * Part of M2 play effects pipeline.
 */
import { drawExecutor } from './executors/draw';
import { discardExecutor } from './executors/discard';
import { moveExecutor } from './executors/move';
import { swapExecutor } from './executors/swap';
import { attachExecutor } from './executors/attach';
import { preventExecutor } from './executors/prevent';
import { recoverExecutor } from './executors/recover';
import { delayedTriggerExecutor } from './executors/delayedTrigger';
import { choiceExecutor } from './executors/choice';
import { turnExecutor } from './executors/turn';
import { searchDeckExecutor } from './executors/searchDeck';
import { peekExecutor } from './executors/peek';
import { copyExecutor } from './executors/copy';
import { playInventionFromHandExecutor } from './executors/playInventionFromHand';
import { mutualDiscardExecutor } from './executors/mutualDiscard';

/** Executor registry: [applies?, executor]. Extended by later tasks. */
const EXECUTORS: Array<[applies: (ctx: ExecCtx) => boolean, run: Executor]> = [
  [({ card }) => tagValue(card, 'play:draw') !== undefined || tagValue(card, 'opponents-draw') !== undefined, drawExecutor],
  [({ card }) => tagValue(card, 'play:discard') !== undefined, discardExecutor],
  [({ card }) => hasTag(card, 'play:move'), moveExecutor],
  [({ card }) => hasTag(card, 'play:swap'), swapExecutor],
  // Coronation: play invention first, then attach to it (skip generic attach when play-invention present)
  [({ card }) => hasTag(card, 'play:play-invention'), playInventionFromHandExecutor],
  [({ card }) => hasTag(card, 'play:attach') && !hasTag(card, 'play:play-invention'), attachExecutor],
  [({ card }) => hasTag(card, 'play:prevent'), preventExecutor],
  [({ card }) => hasTag(card, 'play:recover'), recoverExecutor],
  [({ card }) => hasTag(card, 'play:search-deck'), searchDeckExecutor],
  [({ card }) => hasTag(card, 'play:peek'), peekExecutor],
  [({ card }) => hasTag(card, 'play:copy') || hasTag(card, 'copy:play-ability'), copyExecutor],
  [({ card }) => (card.tags ?? []).some((t) => t.startsWith('mutual-discard:')), mutualDiscardExecutor],
  [({ card }) => hasTag(card, 'play:delayed-trigger'), delayedTriggerExecutor],
  [({ card }) => hasTag(card, 'play:extra-turn') || hasTag(card, 'play:skip-turn') || hasTag(card, 'play:allow-next-invention') || (hasTag(card, 'cost:discard-self') && hasTag(card, 'play:choice')), turnExecutor],
  [({ card }) => hasTag(card, 'play:choice') && !hasTag(card, 'cost:discard-self'), choiceExecutor],
];

export function resolvePlayEffect(
  G: TimestreamsState, playerId: string, cardId: string, choices: ChoiceMap = {},
): EffectResult {
  if (!G.firedTags) G.firedTags = [];
  G.firedTags.push(`play:${cardId}`);
  const card = requireCard(G, cardId) ?? G.players[playerId]?.hand.find(c => c.id === cardId);
  if (!card) return OK;
  const ctx: ExecCtx = { G, playerId, card, choices };
  const results: EffectResult[] = [];
  for (const [applies, run] of EXECUTORS) {
    if (applies(ctx)) results.push(run(ctx));
  }
  return results.length ? merge(...results) : OK;
}

export { EXECUTORS };

// Break circular deps for copy / play-invention nested resolution.
import { bindNestedResolver } from "./nestedResolve";
bindNestedResolver(resolvePlayEffect);
