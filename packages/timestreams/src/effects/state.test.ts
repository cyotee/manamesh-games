// src/effects/state.test.ts
import { describe, it, expect } from 'vitest';
import { getCards, registerCard, requireCard, getAttachments, getModifiers, getPendingTriggers, getTurnFlags } from './state';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';

describe('engine state accessors', () => {
  it('lazily initializes registry and registers cards', () => {
    const G = makeState({ players: ['0', '1'] });
    expect(getCards(G)).toEqual({});
    const card = makeCard({ id: 'stone-age-fire#0', name: 'Fire', ownerId: '0' });
    registerCard(G, card);
    expect(requireCard(G, 'stone-age-fire#0').name).toBe('Fire');
  });

  it('lazily initializes attachments, modifiers, triggers, turn flags', () => {
    const G = makeState({ players: ['0'] });
    expect(getAttachments(G)).toEqual({});
    expect(getModifiers(G)).toEqual([]);
    expect(getPendingTriggers(G)).toEqual([]);
    expect(getTurnFlags(G, '0')).toEqual({
      skipNextTurn: false, extraTurns: 0, noInventionThisTurn: false, allowNextInventionEra: null,
    });
  });

  it('fixture helpers place cards in eras and hands and register them', () => {
    const G = makeState({ players: ['0'], currentDay: 5 });
    const inv = makeCard({ id: 'modern-clean-power#0', ownerId: '0', tags: ['protect:self', 'protect:discard'] });
    putInEra(G, 'modern', inv);
    expect(G.timeline.modern.stack).toEqual(['modern-clean-power#0']);
    expect(requireCard(G, 'modern-clean-power#0').tags).toContain('protect:self');
    const held = makeCard({ id: 'modern-napalm#0', ownerId: '0', cardType: 'action' });
    putInHand(G, '0', held);
    expect(G.players['0'].hand.map(c => c.id)).toEqual(['modern-napalm#0']);
  });

  it('requireCard throws on unknown id', () => {
    const G = makeState({ players: ['0'] });
    expect(() => requireCard(G, 'nope')).toThrow(/unknown card/i);
  });
});
