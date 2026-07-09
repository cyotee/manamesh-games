import { ERA_ORDER, type EraId, type EraState } from "./types";

export function createTimeline(): Record<EraId, EraState> {
  const t = {} as Record<EraId, EraState>;
  for (const id of ERA_ORDER) t[id] = { id, stack: [], actions: [] };
  return t;
}

export function eraForDay(day: number): EraId {
  if (day < 1 || day > ERA_ORDER.length) {
    throw new RangeError(`day out of range: ${day}`);
  }
  return ERA_ORDER[day - 1];
}

export function dayForEra(era: EraId): number {
  return ERA_ORDER.indexOf(era) + 1;
}

export function appendToEra(
  timeline: Record<EraId, EraState>, era: EraId, cardId: string,
): void {
  timeline[era].stack.push(cardId);
}

/** Place an action onto an era (not into invention scoring slots). */
export function appendActionToEra(
  timeline: Record<EraId, EraState>, era: EraId, cardId: string,
): void {
  if (!timeline[era].actions) timeline[era].actions = [];
  timeline[era].actions!.push(cardId);
}

/** All cards associated with an era (inventions + era-level actions). */
export function eraAllCardIds(era: EraState): string[] {
  return [...(era.actions ?? []), ...era.stack];
}

export function scoringSlotCardIds(era: EraState, scoringSlots: number): string[] {
  return era.stack.slice(0, scoringSlots);
}

export function isLastDay(day: number): boolean {
  return day === ERA_ORDER.length;
}
