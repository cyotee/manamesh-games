// src/effects/executors/swap.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { playAction, submitPlayChoice } from '../../play';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

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

  it('Shell Game via playAction: single pick does not swap; pair does', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 });
    G.phase = 'play';
    putInEra(
      G,
      'stone',
      makeCard({ id: 'a#0', ownerId: '0', name: 'Fire' }),
      makeCard({ id: 'b#0', ownerId: '1', name: 'Pottery' }),
      makeCard({ id: 'c#0', ownerId: '0', name: 'Wheel' }),
    );
    const sg = makeCard({
      id: 'stone-age-shell-game#0',
      ownerId: '0',
      cardType: 'action',
      tags: ['play:swap', 'swap:target:invention', 'swap:count:2', 'swap:scope:today'],
    });
    putInHand(G, '0', sg);

    playAction(G, ctxFor('0'), '0', sg.id);
    expect(G.pendingPrompts?.[0]).toMatchObject({ min: 2, max: 2, reason: 'swap:count:2' });

    // Answer with a valid pair via submitPlayChoice (hardened path)
    submitPlayChoice(G, '0', `${sg.id}:swap-pair`, ['a#0', 'c#0']);
    expect(G.timeline.stone.stack).toEqual(['c#0', 'b#0', 'a#0']);
    expect(G.pendingPrompts ?? []).toEqual([]);

    // Re-submit after complete is a no-op (does not re-swap back)
    playAction(G, ctxFor('0'), '0', sg.id, {
      [`${sg.id}:swap-pair`]: ['a#0', 'c#0'],
    });
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

  it('Time Jump prompts for two inventions across eras and swaps them', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 6 });
    G.phase = 'play';
    putInEra(G, 'stone', makeCard({ id: 'stone-fire#0', ownerId: '1', name: 'Fire' }));
    putInEra(G, 'future', makeCard({ id: 'future-nano#0', ownerId: '0', name: 'Nanotech' }));
    const tj = makeCard({
      id: 'future-tech-time-jump#0',
      ownerId: '0',
      cardType: 'action',
      tags: [
        'play:swap',
        'swap:target:invention',
        'swap:count:2',
        'swap:scope:different-eras',
      ],
    });
    putInHand(G, '0', tj);

    playAction(G, ctxFor('0'), '0', tj.id);
    expect(G.pendingPrompts?.[0]).toMatchObject({
      id: `${tj.id}:swap-pair`,
      min: 2,
      max: 2,
      reason: 'swap:different-eras',
    });
    expect(G.pendingPrompts![0].options).toEqual(
      expect.arrayContaining(['stone-fire#0', 'future-nano#0']),
    );

    playAction(G, ctxFor('0'), '0', tj.id, {
      [`${tj.id}:swap-pair`]: ['stone-fire#0', 'future-nano#0'],
    });
    expect(G.timeline.stone.stack).toEqual(['future-nano#0']);
    expect(G.timeline.future.stack).toEqual(['stone-fire#0']);
    expect(G.pendingPrompts ?? []).toEqual([]);
  });

  it('Time Jump fizzles when both picks are in the same era', () => {
    const G = makeState({ players: ['0'], currentDay: 6 });
    putInEra(
      G,
      'future',
      makeCard({ id: 'a#0', ownerId: '0' }),
      makeCard({ id: 'b#0', ownerId: '0' }),
    );
    putInEra(G, 'stone', makeCard({ id: 'c#0', ownerId: '0' }));
    const tj = makeCard({
      id: 'future-tech-time-jump#0',
      ownerId: '0',
      cardType: 'action',
      tags: [
        'play:swap',
        'swap:target:invention',
        'swap:count:2',
        'swap:scope:different-eras',
      ],
    });
    putInHand(G, '0', tj);
    const res = resolvePlayEffect(G, '0', tj.id, {
      [`${tj.id}:swap-pair`]: ['a#0', 'b#0'],
    });
    expect(res.log.join(' ')).toMatch(/different eras/);
    expect(G.timeline.future.stack).toEqual(['a#0', 'b#0']);
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
