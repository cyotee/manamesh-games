// src/effects/tags.test.ts
import { describe, it, expect } from 'vitest';
import { hasTag, tagValue, tagNumber, tagsWithPrefix, isOptionalFor, baseCardId, isDeckMember } from './tags';
import { makeCard } from './testFixtures';

describe('tag utilities', () => {
  const card = makeCard({
    id: 'medieval-telescope#0',
    tags: ['score:swap', 'swap:target:invention', 'swap:count:2', 'swap:scope:next-era', 'target:exclude-self', 'modify:amount:+1'],
  });

  it('hasTag exact match only', () => {
    expect(hasTag(card, 'score:swap')).toBe(true);
    expect(hasTag(card, 'score')).toBe(false);
  });

  it('tagValue returns remainder after prefix', () => {
    expect(tagValue(card, 'swap:target')).toBe('invention');
    expect(tagValue(card, 'swap:scope')).toBe('next-era');
    expect(tagValue(card, 'nope')).toBeUndefined();
  });

  it('tagNumber parses ints including signed', () => {
    expect(tagNumber(card, 'swap:count')).toBe(2);
    expect(tagNumber(card, 'modify:amount')).toBe(1);
    expect(tagNumber(makeCard({ tags: ['modify:amount:-1'] }), 'modify:amount')).toBe(-1);
  });

  it('tagsWithPrefix returns all remainders', () => {
    const multi = makeCard({ tags: ['target:subtype:nanotech', 'target:subtype:quantum-computing'] });
    expect(tagsWithPrefix(multi, 'target:subtype')).toEqual(['nanotech', 'quantum-computing']);
  });

  it('isOptionalFor implements PRD 3.4 default-mandatory', () => {
    expect(isOptionalFor(makeCard({ tags: ['play:move', 'move:optional'] }), 'move')).toBe(true);
    expect(isOptionalFor(makeCard({ tags: ['play:move'] }), 'move')).toBe(false);
  });

  it('deck membership strips instance suffix (PRD 2)', () => {
    expect(baseCardId('stone-age-cloth#2')).toBe('stone-age-cloth');
    expect(isDeckMember('modern-inflation#0', 'modern')).toBe(true);
    expect(isDeckMember('modern-inflation#0', 'medieval')).toBe(false);
    expect(isDeckMember('future-tech-androids', 'future-tech')).toBe(true);
  });
});
