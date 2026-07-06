import type { TimestreamsState } from '../types';
import { requireCard } from './state';
import { tagsWithPrefix, hasTag, tagValue } from './tags';
import { merge, OK, type ChoiceMap, type EffectResult, type Executor, type ExecCtx } from './types';
import { drawExecutor } from './executors/draw';

/** Executor registry: [applies?, executor]. Extended by later tasks. */
const EXECUTORS: Array<[applies: (ctx: ExecCtx) => boolean, run: Executor]> = [
  [({ card }) => tagValue(card, 'play:draw') !== undefined || tagValue(card, 'opponents-draw') !== undefined, drawExecutor],
];

export function resolvePlayEffect(
  G: TimestreamsState, playerId: string, cardId: string, choices: ChoiceMap = {},
): EffectResult {
  const card = requireCard(G, cardId) ?? G.players[playerId]?.hand.find(c => c.id === cardId);
  const ctx: ExecCtx = { G, playerId, card, choices };
  const results: EffectResult[] = [];
  for (const [applies, run] of EXECUTORS) {
    if (applies(ctx)) results.push(run(ctx));
  }
  return results.length ? merge(...results) : OK;
}

export { EXECUTORS };
