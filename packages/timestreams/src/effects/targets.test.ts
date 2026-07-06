// src/effects/targets.test.ts
import { describe, it, expect } from 'vitest';
import { locateCard, erasForScope, candidateTargets, cardAtOffset } from './targets';
import { makeCard, makeState, putInEra } from './testFixtures';

function setup() {
  const G = makeState({ players: ['0', '1'], currentDay: 5 }); // Today = modern
  putInEra(G, 'modern',
    makeCard({ id: 'modern-clean-power#0', ownerId: '0' }),
    makeCard({ id: 'modern-dot-com#0', ownerId: '1' }),
    makeCard({ id: 'stone-age-fire#0', ownerId: '0' }),
  );
  putInEra(G, 'medieval', makeCard({ id: 'medieval-poetry#0', ownerId: '1', subtypes: ['poetry', 'art'] }));
  return G;
}

describe('target resolution', () => {
  it('locates cards by era and index', () => {
    const G = setup();
    expect(locateCard(G, 'modern-dot-com#0')).toEqual({ era: 'modern', index: 1 });
    expect(locateCard(G, 'nope')).toBeNull();
  });

  it('resolves scopes relative to Today (day 5 = modern)', () => {
    const G = setup();
    expect(erasForScope(G, 'today')).toEqual(['modern']);
    expect(erasForScope(G, 'tomorrow')).toEqual(['future']);
    expect(erasForScope(G, 'yesterday')).toEqual(['industrial']);
    expect(erasForScope(G, 'same-era', 'medieval-poetry#0')).toEqual(['medieval']);
    expect(erasForScope(G, 'this-or-previous-era', 'modern-dot-com#0'))
      .toEqual(['stone', 'medieval', 'renaissance', 'industrial', 'modern']);
    expect(erasForScope(G, 'any-era').length).toBe(6);
  });

  it('filters candidates by kind, subtype, and exclude-self', () => {
    const G = setup();
    expect(candidateTargets(G, { kind: 'invention', eras: ['modern'] }))
      .toEqual(['modern-clean-power#0', 'modern-dot-com#0', 'stone-age-fire#0']);
    expect(candidateTargets(G, { kind: 'invention', eras: ['modern'], excludeCardId: 'modern-dot-com#0' }))
      .toEqual(['modern-clean-power#0', 'stone-age-fire#0']);
    expect(candidateTargets(G, { kind: 'any', eras: ['medieval'], subtypes: ['art'] }))
      .toEqual(['medieval-poetry#0']);
    expect(candidateTargets(G, { kind: 'any', eras: ['medieval'], subtypes: ['government'] })).toEqual([]);
  });

  it('cardAtOffset walks the stack (positive = below)', () => {
    const G = setup();
    expect(cardAtOffset(G, 'modern-clean-power#0', 1)).toBe('modern-dot-com#0');
    expect(cardAtOffset(G, 'modern-dot-com#0', -1)).toBe('modern-clean-power#0');
    expect(cardAtOffset(G, 'stone-age-fire#0', 1)).toBeNull();
  });
});
