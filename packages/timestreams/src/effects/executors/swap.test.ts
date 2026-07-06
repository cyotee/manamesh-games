// src/effects/executors/swap.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';

describe('swap executor', () => {
  it('Shell Game swaps any two inventions in Today', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 });
    putInEra(G, 'stone',
      makeCard({ id: 'a#0', ownerId: '0' }), makeCard({ id: 'b#0', ownerId: '1' }), makeCard({ id: 'c#0', ownerId: '0' }),
    );
    const sg = makeCard({
      id: 'stone-age-shell-game#0', ownerId: '0', cardType: 'action',
      tags: ['play:swap', 'swap:target:invention', 'swap:count:2', 'swap:scope:today'],
    });
    putInHand(G, '0', sg);
    const first = resolvePlayEffect(G, '0', 'stone-age-shell-game#0');
    expect(first.prompts[0]).toMatchObject({ id: 'stone-age-shell-game#0:swap-pair', min: 2, max: 2 });
    resolvePlayEffect(G, '0', 'stone-age-shell-game#0', { 'stone-age-shell-game#0:swap-pair': ['a#0', 'c#0'] });
    expect(G.timeline.stone.stack).toEqual(['c#0', 'b#0', 'a#0']);
  });

  it('Organ Transplant swaps itself with a chosen invention in Today', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ot = makeCard({
      id: 'modern-organ-transplant#0', ownerId: '0',
      tags: ['play:swap', 'swap:optional', 'swap:target:self', 'swap:with:invention', 'swap:scope:today'],
    });
    putInEra(G, 'modern', makeCard({ id: 'other#0', ownerId: '1' }), ot);
    resolvePlayEffect(G, '0', 'modern-organ-transplant#0', { 'modern-organ-transplant#0:swap-with': 'other#0' });
    expect(G.timeline.modern.stack).toEqual(['modern-organ-transplant#0', 'other#0']);
  });

  it('swap fizzles if either side is move-protected', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ot = makeCard({
      id: 'modern-organ-transplant#0', ownerId: '0',
      tags: ['play:swap', 'swap:target:self', 'swap:with:invention', 'swap:scope:today'],
    });
    putInEra(G, 'modern',
      makeCard({ id: 'stone-age-anarchy#0', ownerId: '1', tags: ['protect:self', 'protect:move'] }), ot,
    );
    const res = resolvePlayEffect(G, '0', 'modern-organ-transplant#0', { 'modern-organ-transplant#0:swap-with': 'stone-age-anarchy#0' });
    expect(res.log.join(' ')).toMatch(/fizzles/);
    expect(G.timeline.modern.stack).toEqual(['stone-age-anarchy#0', 'modern-organ-transplant#0']);
  });
});
