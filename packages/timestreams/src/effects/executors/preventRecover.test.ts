// src/effects/executors/preventRecover.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInHand } from '../testFixtures';
import { isActionPlayPrevented, isMoveDirectionPrevented } from '../modifiers';

describe('prevent executor', () => {
  it('Smoke Signals registers rest-of-today action prevention', () => {
    const G = makeState({ players: ['0'] });
    const ss = makeCard({
      id: 'stone-age-smoke-signals#0', ownerId: '0',
      tags: ['play:prevent', 'prevent:play:action', 'duration:rest-of-today'],
    });
    putInHand(G, '0', ss);
    resolvePlayEffect(G, '0', 'stone-age-smoke-signals#0');
    expect(isActionPlayPrevented(G)).toBe(true);
  });

  it('Sundial prevents forward moves', () => {
    const G = makeState({ players: ['0'] });
    const sd = makeCard({
      id: 'stone-age-sundial#0', ownerId: '0',
      tags: ['play:prevent', 'prevent:move:future', 'duration:rest-of-today'],
    });
    putInHand(G, '0', sd);
    resolvePlayEffect(G, '0', 'stone-age-sundial#0');
    expect(isMoveDirectionPrevented(G, 'stone', 'medieval')).toBe(true);
    expect(isMoveDirectionPrevented(G, 'medieval', 'stone')).toBe(false);
  });
});

describe('recover executor', () => {
  it('Water Wheel: pay a hand card to recover any discard card to hand', () => {
    const G = makeState({ players: ['0'] });
    const ww = makeCard({
      id: 'medieval-water-wheel#0', ownerId: '0',
      tags: ['play:recover', 'recover:optional', 'recover:from-discard:1', 'recover:to-hand', 'cost:discard-from-hand:1'],
    });
    putInHand(G, '0', ww);
    putInHand(G, '0', makeCard({ id: 'payment#0', ownerId: '0' }));
    G.players['0'].discard.push(makeCard({ id: 'buried#0', ownerId: '0' }));
    // Sequential: recover pick first (optional may skip — cost only after confirm)
    const first = resolvePlayEffect(G, '0', 'medieval-water-wheel#0');
    expect(first.prompts.map(p => p.id)).toEqual(['medieval-water-wheel#0:recover']);
    const second = resolvePlayEffect(G, '0', 'medieval-water-wheel#0', {
      'medieval-water-wheel#0:recover': 'buried#0',
    });
    expect(second.prompts.map(p => p.id)).toEqual(['medieval-water-wheel#0:recover-cost']);
    resolvePlayEffect(G, '0', 'medieval-water-wheel#0', {
      'medieval-water-wheel#0:recover': 'buried#0',
      'medieval-water-wheel#0:recover-cost': 'payment#0',
    });
    expect(G.players['0'].hand.map(c => c.id)).toContain('buried#0');
    expect(G.players['0'].hand.map(c => c.id)).not.toContain('payment#0');
    expect(G.players['0'].discard.map(c => c.id)).toEqual(['payment#0']);
  });

  it('Thermodynamics: top of discard, no prompt needed', () => {
    const G = makeState({ players: ['0'] });
    const td = makeCard({
      id: 'modern-thermodynamics#0', ownerId: '0',
      tags: ['play:recover', 'recover:from-discard:1', 'recover:target:top-of-discard', 'recover:to-hand'],
    });
    putInHand(G, '0', td);
    G.players['0'].discard.push(makeCard({ id: 'older#0', ownerId: '0' }), makeCard({ id: 'newest#0', ownerId: '0' }));
    const res = resolvePlayEffect(G, '0', 'modern-thermodynamics#0');
    expect(res.prompts).toEqual([]);
    expect(G.players['0'].hand.map(c => c.id)).toContain('newest#0');
  });
});
