/**
 * Late-bound nested resolvePlayEffect to break circular imports between
 * resolvePlay and executors that re-enter the pipeline (copy, play-invention).
 */
import type { TimestreamsState } from "../types";
import type { ChoiceMap, EffectResult } from "./types";

export type NestedResolver = (
  G: TimestreamsState,
  playerId: string,
  cardId: string,
  choices?: ChoiceMap,
) => EffectResult;

let nested: NestedResolver | null = null;

export function bindNestedResolver(fn: NestedResolver): void {
  nested = fn;
}

export function resolveNested(
  G: TimestreamsState,
  playerId: string,
  cardId: string,
  choices: ChoiceMap = {},
): EffectResult {
  if (!nested) {
    return { ok: true, prompts: [], log: [`nested-resolve unbound for ${cardId}`] };
  }
  return nested(G, playerId, cardId, choices);
}
