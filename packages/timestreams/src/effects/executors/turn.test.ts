// src/effects/executors/turn.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { getTurnFlags } from '../state';

describe('turn executor', () => {
  it('Inflation extra turn only when Today is modern or future', () => {
    const early = makeState({ players: ['0'], currentDay: 2 });
    const inflEarly = makeCard({ id: 'modern-inflation#0', ownerId: '0', cardType: 'action', tags: ['play:extra-turn', 'extra-turn:optional', 'condition:today-modern-or-future'] });
    putInHand(early, '0', inflEarly);
    const resEarly = resolvePlayEffect(early, '0', 'modern-inflation#0');
    expect(resEarly.prompts).toEqual([]); // condition failed: no prompt, no flag
    expect(getTurnFlags(early, '0').extraTurns).toBe(0);

    const late = makeState({ players: ['0'], currentDay: 5 });
    const inflLate = makeCard({ id: 'modern-inflation#1', ownerId: '0', cardType: 'action', tags: ['play:extra-turn', 'extra-turn:optional', 'condition:today-modern-or-future'] });
    putInHand(late, '0', inflLate);
    const p = resolvePlayEffect(late, '0', 'modern-inflation#1');
    expect(p.prompts[0]).toMatchObject({ id: 'modern-inflation#1:extra-turn', kind: 'confirm' });
    resolvePlayEffect(late, '0', 'modern-inflation#1', { 'modern-inflation#1:extra-turn': 'yes' });
    expect(getTurnFlags(late, '0').extraTurns).toBe(1);
  });

  it('Androids extra turn carries the no-invention restriction', () => {
    const G = makeState({ players: ['0'], currentDay: 6 });
    const a = makeCard({ id: 'future-tech-androids#0', ownerId: '0', tags: ['play:extra-turn', 'extra-turn:optional', 'extra-turn:restriction:no-invention-play'] });
    putInHand(G, '0', a);
    resolvePlayEffect(G, '0', 'future-tech-androids#0', { 'future-tech-androids#0:extra-turn': 'yes' });
    expect(getTurnFlags(G, '0').extraTurns).toBe(1);
    expect(getTurnFlags(G, '0').noInventionThisTurn).toBe(true);
  });

  it('Philosophy skips own next turn; Navigation allows era override', () => {
    const G = makeState({ players: ['0'], currentDay: 2 });
    const ph = makeCard({ id: 'medieval-philosophy#0', ownerId: '0', tags: ['play:skip-turn', 'skip:target:self', 'rule:not-passing'] });
    const nav = makeCard({ id: 'medieval-navigation#0', ownerId: '0', tags: ['play:allow-next-invention', 'allow:scope:yesterday-or-tomorrow'] });
    putInHand(G, '0', ph, nav);
    resolvePlayEffect(G, '0', 'medieval-philosophy#0');
    resolvePlayEffect(G, '0', 'medieval-navigation#0');
    expect(getTurnFlags(G, '0').skipNextTurn).toBe(true);
    expect(getTurnFlags(G, '0').allowNextInventionEra).toBe('yesterday-or-tomorrow');
  });

  it('Semiconductor pay-self: opponents choose discards (whole hand if fewer)', () => {
    const G = makeState({ players: ['0', '1', '2'], currentDay: 5 });
    const semi = makeCard({
      id: 'modern-semiconductor#0', ownerId: '0',
      tags: ['play:choice', 'cost:discard-self', 'discard:opponents-hand:2', 'discard:whole-hand-if-fewer'],
    });
    putInEra(G, 'modern', semi);
    putInHand(G, '1', makeCard({ id: 'x#0', ownerId: '1' }), makeCard({ id: 'y#0', ownerId: '1' }), makeCard({ id: 'z#0', ownerId: '1' }));
    putInHand(G, '2', makeCard({ id: 'w#0', ownerId: '2' }));
    // First answer: pay self → prompt P1 to pick 2 cards
    const p1 = resolvePlayEffect(G, '0', 'modern-semiconductor#0', {
      'modern-semiconductor#0:pay-self': 'yes',
    });
    expect(G.timeline.modern.stack).toEqual([]);
    expect(p1.prompts[0]?.deciderId).toBe('1');
    expect(p1.prompts[0]?.min).toBe(2);
    // P1 picks; P2 has 1 card → whole hand auto
    resolvePlayEffect(G, '0', 'modern-semiconductor#0', {
      'modern-semiconductor#0:pay-self': 'yes',
      'modern-semiconductor#0:opp-discard-1': ['x#0', 'y#0'],
    });
    expect(G.players['1'].hand.map((c) => c.id)).toEqual(['z#0']);
    expect(G.players['2'].hand).toHaveLength(0);
  });
});
