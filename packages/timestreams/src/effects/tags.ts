import type { TimestreamsCard } from '../types';

export function hasTag(card: TimestreamsCard, tag: string): boolean {
  return card.tags?.includes(tag) ?? false;
}

export function tagsWithPrefix(card: TimestreamsCard, prefix: string): string[] {
  const p = `${prefix}:`;
  return (card.tags ?? []).filter(t => t.startsWith(p)).map(t => t.slice(p.length));
}

export function tagValue(card: TimestreamsCard, prefix: string): string | undefined {
  return tagsWithPrefix(card, prefix)[0];
}

export function tagNumber(card: TimestreamsCard, prefix: string): number | undefined {
  const v = tagValue(card, prefix);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

export function isOptionalFor(card: TimestreamsCard, family: string): boolean {
  return hasTag(card, `${family}:optional`);
}

export function baseCardId(instanceId: string): string {
  const hash = instanceId.indexOf('#');
  return hash === -1 ? instanceId : instanceId.slice(0, hash);
}

export type DeckId = 'stone-age' | 'medieval' | 'modern' | 'future-tech';

export function isDeckMember(cardId: string, deck: DeckId): boolean {
  return baseCardId(cardId).startsWith(`${deck}-`);
}
