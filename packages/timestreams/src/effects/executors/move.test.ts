// src/effects/executors/move.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { addModifier } from '../modifiers';
import { playAction } from '../../play';

describe('move executor', () => {
  const WHEEL_TAGS = [
    'play:move', 'move:optional', 'move:target:self',
    'move:amount:2', 'move:direction:up', 'move:scope:today',
  ];

  it('optional self-move prompts before applying (Air Cars / The Wheel)', () => {
    const G = makeState({ players: ['0'], currentDay: 1 });
    putInEra(G, 'stone',
      makeCard({ id: 'x#0', ownerId: '0' }), makeCard({ id: 'y#0', ownerId: '0' }),
      makeCard({ id: 'future-tech-air-cars#0', ownerId: '0', tags: WHEEL_TAGS }),
    );
    const first = resolvePlayEffect(G, '0', 'future-tech-air-cars#0');
    expect(first.prompts).toHaveLength(1);
    expect(first.prompts[0]).toMatchObject({
      id: 'future-tech-air-cars#0:move-card',
      kind: 'choose-option',
      options: ['move', 'stay'],
      reason: 'play:move',
    });
    // Still at bottom until player confirms
    expect(G.timeline.stone.stack).toEqual(['x#0', 'y#0', 'future-tech-air-cars#0']);
  });

  it('optional self-move: stay leaves card where played', () => {
    const G = makeState({ players: ['0'], currentDay: 1 });
    putInEra(G, 'stone',
      makeCard({ id: 'x#0', ownerId: '0' }), makeCard({ id: 'y#0', ownerId: '0' }),
      makeCard({ id: 'future-tech-air-cars#0', ownerId: '0', tags: WHEEL_TAGS }),
    );
    const res = resolvePlayEffect(G, '0', 'future-tech-air-cars#0', {
      'future-tech-air-cars#0:move-card': 'stay',
    });
    expect(res.prompts).toEqual([]);
    expect(res.log.join(' ')).toMatch(/declined/);
    expect(G.timeline.stone.stack).toEqual(['x#0', 'y#0', 'future-tech-air-cars#0']);
  });

  it('self-move up N within Today (The Wheel), optional — accept moves up 2', () => {
    const G = makeState({ players: ['0'], currentDay: 1 });
    putInEra(G, 'stone',
      makeCard({ id: 'x#0', ownerId: '0' }), makeCard({ id: 'y#0', ownerId: '0' }),
      makeCard({ id: 'stone-age-the-wheel#0', ownerId: '0', tags: WHEEL_TAGS }),
    );
    const res = resolvePlayEffect(G, '0', 'stone-age-the-wheel#0', {
      'stone-age-the-wheel#0:move-card': 'move',
    });
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
    expect(res.log.join(' ')).toMatch(/moved b#0 to top of medieval/);
    expect(G.timeline.stone.stack).toEqual(['a#0']);
    expect(G.timeline.medieval.stack).toEqual(['b#0']);
  });

  it('Backwards Compatibility via playAction moves bottom of yesterday automatically', () => {
    const G = makeState({ players: ['0'], currentDay: 3 }); // today = renaissance, yesterday = medieval
    G.phase = 'play';
    putInEra(
      G,
      'medieval',
      makeCard({ id: 'top#0', ownerId: '0', name: 'Top' }),
      makeCard({ id: 'bottom#0', ownerId: '0', name: 'Bottom' }),
    );
    putInEra(G, 'renaissance', makeCard({ id: 'already#0', ownerId: '0' }));
    const bc = makeCard({
      id: 'future-tech-backwards-compatibility#0',
      ownerId: '0',
      cardType: 'action',
      tags: ['play:move', 'move-source:bottom-yesterday', 'move-destination:top-today'],
    });
    putInHand(G, '0', bc);
    playAction(G, { currentPlayer: '0' } as any, '0', bc.id);
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual(['top#0']);
    expect(G.timeline.renaissance.stack).toEqual(['bottom#0', 'already#0']);
    expect(
      G.activityLog?.some(
        (e) => /moved (bottom#0|Bottom)/.test(e.message),
      ),
    ).toBe(true);
  });

  it('Backwards Compatibility fizzles with clear log when yesterday is empty', () => {
    const G = makeState({ players: ['0'], currentDay: 1 }); // no yesterday
    G.phase = 'play';
    const bc = makeCard({
      id: 'future-tech-backwards-compatibility#0',
      ownerId: '0',
      cardType: 'action',
      tags: ['play:move', 'move-source:bottom-yesterday', 'move-destination:top-today'],
    });
    putInHand(G, '0', bc);
    const res = resolvePlayEffect(G, '0', bc.id);
    expect(res.prompts).toEqual([]);
    expect(res.log.join(' ')).toMatch(/fizzles/);
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

  it('react:cancel on move fizzles the move (basic)', () => {
    const G = makeState({ players: ['0'], currentDay: 2 });
    const movable = makeCard({ id: 'movable#0', ownerId: '0', tags: ['react:cancel', 'cancel:move'] });
    putInEra(G, 'medieval', movable);
    const music = makeCard({
      id: 'stone-age-music#0', ownerId: '0',
      tags: ['play:move', 'move:target:any-card', 'move-source:today', 'move-destination:tomorrow'],
    });
    putInEra(G, 'medieval', music);
    const res = resolvePlayEffect(G, '0', 'stone-age-music#0', { 'stone-age-music#0:move-card': 'movable#0' });
    expect(res.log.join(' ')).toMatch(/fizzles \(react:cancel\)/);
    expect(G.timeline.medieval.stack).toContain('movable#0');
  });
});
