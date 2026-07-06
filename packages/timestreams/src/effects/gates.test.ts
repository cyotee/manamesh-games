// src/effects/gates.test.ts
import { describe, it, expect } from 'vitest';
import { addModifier, clearRestOfToday, isActionPlayPrevented, isMoveDirectionPrevented } from './modifiers';
import { canPlayCard } from './gates';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';
import { getTurnFlags } from './state';

describe('modifiers', () => {
  it('rest-of-today modifiers clear; rest-of-game persist', () => {
    const G = makeState({ players: ['0'] });
    addModifier(G, { sourceCardId: 's#0', ownerId: '0', kind: 'prevent-action-play', duration: 'rest-of-today' });
    addModifier(G, { sourceCardId: 'h#0', ownerId: '0', kind: 'prevent-move-future', duration: 'rest-of-game' });
    expect(isActionPlayPrevented(G)).toBe(true);
    clearRestOfToday(G);
    expect(isActionPlayPrevented(G)).toBe(false);
    expect(isMoveDirectionPrevented(G, 'stone', 'future')).toBe(true);   // forward move
    expect(isMoveDirectionPrevented(G, 'future', 'stone')).toBe(false);  // backward not prevented by this modifier
  });
});

describe('canPlayCard gates', () => {
  it('requires:subtype searches Today and past per requires:scope', () => {
    const G = makeState({ players: ['0'], currentDay: 6 }); // Today = future
    const androids = makeCard({
      id: 'future-tech-androids#0', ownerId: '0',
      tags: ['play:requires-card', 'requires:subtype:nanotech', 'requires:scope:today-or-past'],
    });
    putInHand(G, '0', androids);
    expect(canPlayCard(G, '0', 'future-tech-androids#0').ok).toBe(false);
    putInEra(G, 'modern', makeCard({ id: 'future-tech-nanotech#0', ownerId: '0', subtypes: ['nanotech'] }));
    expect(canPlayCard(G, '0', 'future-tech-androids#0').ok).toBe(true);
  });

  it('requires:in-scoring-slot rejects matches past slot 6', () => {
    const G = makeState({ players: ['0'], currentDay: 5 }); // Today = modern
    const internet = makeCard({
      id: 'modern-the-internet#0', ownerId: '0',
      tags: ['play:requires-card', 'requires:subtype:telecommunications', 'requires:in-scoring-slot', 'requires:scope:today-or-past'],
    });
    putInHand(G, '0', internet);
    for (let i = 0; i < 6; i++) putInEra(G, 'modern', makeCard({ id: `filler-${i}#0`, ownerId: '0' }));
    putInEra(G, 'modern', makeCard({ id: 'modern-telecommunications#0', ownerId: '0', subtypes: ['telecommunications'] })); // slot 7
    expect(canPlayCard(G, '0', 'modern-the-internet#0').ok).toBe(false);
  });

  it('one government per era', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 }); // Today = stone
    putInEra(G, 'stone', makeCard({ id: 'stone-age-anarchy#0', ownerId: '1', subtypes: ['anarchy', 'government'] }));
    const monarchy = makeCard({
      id: 'medieval-monarchy#0', ownerId: '0', subtypes: ['monarchy', 'government'],
      tags: ['government', 'rule:one-government-per-era'],
    });
    putInHand(G, '0', monarchy);
    const res = canPlayCard(G, '0', 'medieval-monarchy#0');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('rule:one-government-per-era');
  });

  it('smoke-signals blocks actions; Androids turn blocks inventions', () => {
    const G = makeState({ players: ['0'] });
    putInHand(G, '0', makeCard({ id: 'modern-napalm#0', ownerId: '0', cardType: 'action', tags: ['play:discard:1'] }));
    addModifier(G, { sourceCardId: 's#0', ownerId: '0', kind: 'prevent-action-play', duration: 'rest-of-today' });
    expect(canPlayCard(G, '0', 'modern-napalm#0').reason).toBe('prevent:play:action');

    putInHand(G, '0', makeCard({ id: 'stone-age-fire#0', ownerId: '0', cardType: 'invention' }));
    getTurnFlags(G, '0').noInventionThisTurn = true;
    expect(canPlayCard(G, '0', 'stone-age-fire#0').reason).toBe('extra-turn:restriction:no-invention-play');
  });
});
