// src/effects/executors/choice.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { describeChoiceOption } from './choice';

const SURGICAL = ['play:choice', 'target:choose:invention', 'target:scope:today', 'decider:target-owner',
  'option-a:discard:target', 'option-b:discard:hand:3', 'option-b:discard:by:target-owner', 'forced:option-a:if-hand-under-3'];

describe('choice executor', () => {
  it('Surgical Strike: target owner picks option-b and discards 3 from hand', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'victim#0', ownerId: '1' }));
    for (let i = 0; i < 4; i++) putInHand(G, '1', makeCard({ id: `h${i}#0`, ownerId: '1' }));
    const ss = makeCard({ id: 'modern-surgical-strike#0', ownerId: '0', cardType: 'action', tags: SURGICAL });
    putInHand(G, '0', ss);

    const p1 = resolvePlayEffect(G, '0', 'modern-surgical-strike#0');
    expect(p1.prompts[0]).toMatchObject({ id: 'modern-surgical-strike#0:choose-target', deciderId: '0' });

    const p2 = resolvePlayEffect(G, '0', 'modern-surgical-strike#0', { 'modern-surgical-strike#0:choose-target': 'victim#0' });
    expect(p2.prompts[0]).toMatchObject({ id: 'modern-surgical-strike#0:option', deciderId: '1', options: ['option-a', 'option-b'] });

    resolvePlayEffect(G, '0', 'modern-surgical-strike#0', {
      'modern-surgical-strike#0:choose-target': 'victim#0',
      'modern-surgical-strike#0:option': 'option-b',
      'modern-surgical-strike#0:option-b-hand': ['h0#0', 'h1#0', 'h2#0'],
    });
    expect(G.players['1'].hand).toHaveLength(1);
    expect(G.timeline.modern.stack).toContain('victim#0'); // invention survived
  });

  it('forced:option-a when hand under 3 — invention is discarded without an option prompt', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'victim#0', ownerId: '1' }));
    putInHand(G, '1', makeCard({ id: 'only#0', ownerId: '1' }));
    const ss = makeCard({ id: 'modern-surgical-strike#0', ownerId: '0', cardType: 'action', tags: SURGICAL });
    putInHand(G, '0', ss);
    const res = resolvePlayEffect(G, '0', 'modern-surgical-strike#0', { 'modern-surgical-strike#0:choose-target': 'victim#0' });
    expect(res.prompts).toEqual([]);
    expect(G.timeline.modern.stack).toEqual([]);
    expect(G.players['1'].discard.map(c => c.id)).toContain('victim#0');
  });

  it('Diplomacy: chosen opponent decides; option-b lets the acting player draw 2', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 2 });
    G.encryptedDecks['0'] = [{}, {}] as any;
    const dip = makeCard({
      id: 'medieval-diplomacy#0', ownerId: '0',
      tags: ['play:choice', 'target:choose:opponent', 'decider:chosen-opponent',
        'option-a:discard:hand:2', 'option-a:discard:by:chosen-opponent', 'option-b:draw:2', 'option-b:draw:to:self'],
    });
    putInEra(G, 'medieval', dip);
    resolvePlayEffect(G, '0', 'medieval-diplomacy#0', {
      'medieval-diplomacy#0:choose-opponent': '1',
      'medieval-diplomacy#0:option': 'option-b',
    });
    // Sequential: draw 2 queued for acting player
    expect(G.pendingDealRemaining?.['0']).toBe(2);
    expect(G.pendingDecryptRequests.length).toBe(1);
  });

  it('High-powered Laser: option-a draws 2', () => {
    const G = makeState({ players: ['0'], currentDay: 6 });
    G.encryptedDecks['0'] = [{}, {}, {}] as any;
    const laser = makeCard({
      id: 'future-tech-high-powered-laser#0',
      ownerId: '0',
      tags: [
        'play:choice',
        'decider:self',
        'option-a:draw:2',
        'option-b:discard:1',
        'option-b:discard:target:any-card',
        'option-b:discard:scope:today-or-tomorrow',
      ],
    });
    putInEra(G, 'future', laser);
    const first = resolvePlayEffect(G, '0', laser.id);
    expect(first.prompts[0]).toMatchObject({
      id: `${laser.id}:option`,
      options: ['option-a', 'option-b'],
      reason: 'play:choice',
    });
    resolvePlayEffect(G, '0', laser.id, { [`${laser.id}:option`]: 'option-a' });
    expect(G.pendingDealRemaining?.['0']).toBe(2);
  });

  it('High-powered Laser: option-b prompts discard in Today or Tomorrow', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 6 }); // Today = future
    putInEra(G, 'future', makeCard({ id: 'victim#0', ownerId: '1' }));
    const laser = makeCard({
      id: 'future-tech-high-powered-laser#0',
      ownerId: '0',
      tags: [
        'play:choice',
        'decider:self',
        'option-a:draw:2',
        'option-b:discard:1',
        'option-b:discard:target:any-card',
        'option-b:discard:scope:today-or-tomorrow',
      ],
    });
    putInEra(G, 'future', laser);

    const mid = resolvePlayEffect(G, '0', laser.id, {
      [`${laser.id}:option`]: 'option-b',
    });
    expect(mid.prompts[0]).toMatchObject({
      id: `${laser.id}:option-b-discard-target`,
      reason: 'play:choice-discard',
    });
    expect(mid.prompts[0].options).toContain('victim#0');

    resolvePlayEffect(G, '0', laser.id, {
      [`${laser.id}:option`]: 'option-b',
      [`${laser.id}:option-b-discard-target`]: 'victim#0',
    });
    expect(G.timeline.future.stack).not.toContain('victim#0');
    expect(G.players['1'].discard.map(c => c.id)).toContain('victim#0');
  });
});

describe('describeChoiceOption', () => {
  it('labels High-powered Laser branches from tags', () => {
    const laser = makeCard({
      id: 'laser',
      ownerId: '0',
      tags: [
        'option-a:draw:2',
        'option-b:discard:1',
        'option-b:discard:target:any-card',
        'option-b:discard:scope:today-or-tomorrow',
      ],
    });
    expect(describeChoiceOption(laser, 'option-a')).toMatch(/Draw 2 cards/i);
    expect(describeChoiceOption(laser, 'option-b')).toMatch(/Today or Tomorrow/i);
  });
});
