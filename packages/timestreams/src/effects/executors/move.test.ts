// src/effects/executors/move.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { addModifier } from '../modifiers';

describe('move executor', () => {
  it('self-move up N within Today (The Wheel), optional', () => {
    const G = makeState({ players: ['0'], currentDay: 1 });
    putInEra(G, 'stone',
      makeCard({ id: 'x#0', ownerId: '0' }), makeCard({ id: 'y#0', ownerId: '0' }),
      makeCard({ id: 'stone-age-the-wheel#0', ownerId: '0', tags: ['play:move', 'move:optional', 'move:target:self', 'move:amount:2', 'move:direction:up', 'move:scope:today'] }),
    );
    const res = resolvePlayEffect(G, '0', 'stone-age-the-wheel#0', { 'stone-age-the-wheel#0:move-card': 'stone-age-the-wheel#0' });
    expect(res.prompts).toEqual([]);
    expect(G.timeline.stone.stack).toEqual(['stone-age-the-wheel#0', 'x#0', 'y#0']);
  });

  it('Vortex: choose an invention in Yesterday, put at bottom of Today', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 2 }); // Today = medieval, Yesterday = stone
    putInEra(G, 'stone', makeCard({ id: 'stone-age-fire#0', ownerId: '1' }));
    putInEra(G, 'medieval', makeCard({ id: 'already#0', ownerId: '0' }));
    const vortex = makeCard({
      id: 'stone-age-vortex#0', ownerId: '0', cardType: 'action',
      tags: ['play:move', 'move-source:yesterday', 'move-destination:bottom-today'],
    });
    putInHand(G, '0', vortex);
    const first = resolvePlayEffect(G, '0', 'stone-age-vortex#0');
    expect(first.prompts[0].options).toEqual(['stone-age-fire#0']);
    resolvePlayEffect(G, '0', 'stone-age-vortex#0', { 'stone-age-vortex#0:move-card': 'stone-age-fire#0' });
    expect(G.timeline.stone.stack).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual(['already#0', 'stone-age-fire#0']);
  });

  it('Backwards Compatibility: deterministic bottom-yesterday -> top-today, no prompt', () => {
    const G = makeState({ players: ['0'], currentDay: 2 });
    putInEra(G, 'stone', makeCard({ id: 'a#0', ownerId: '0' }), makeCard({ id: 'b#0', ownerId: '0' }));
    const bc = makeCard({
      id: 'future-tech-backwards-compatibility#0', ownerId: '0', cardType: 'action',
      tags: ['play:move', 'move-source:bottom-yesterday', 'move-destination:top-today'],
    });
    putInHand(G, '0', bc);
    const res = resolvePlayEffect(G, '0', 'future-tech-backwards-compatibility#0');
    expect(res.prompts).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual(['b#0']);
  });

  it('era-crossing move fizzles when direction is prevented (Sundial)', () => {
    const G = makeState({ players: ['0'], currentDay: 2 });
    putInEra(G, 'stone', makeCard({ id: 'stuck#0', ownerId: '0' }));
    addModifier(G, { sourceCardId: 's#0', ownerId: '0', kind: 'prevent-move-future', duration: 'rest-of-today' });
    const music = makeCard({
      id: 'stone-age-music#0', ownerId: '0',
      tags: ['play:move', 'move:target:any-card', 'move-source:today', 'move-destination:tomorrow'],
    });
    putInEra(G, 'medieval', music); // played invention sits in Today
    // move-source:today for day 2 = medieval; place a movable card there
    putInEra(G, 'medieval', makeCard({ id: 'movable#0', ownerId: '0' }));
    const res = resolvePlayEffect(G, '0', 'stone-age-music#0', { 'stone-age-music#0:move-card': 'movable#0' });
    expect(res.log.join(' ')).toMatch(/fizzles/);
    expect(G.timeline.medieval.stack).toContain('movable#0');
  });
});
