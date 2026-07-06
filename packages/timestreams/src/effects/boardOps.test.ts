// src/effects/boardOps.test.ts
import { describe, it, expect } from 'vitest';
import { effectiveScoreValue, isMoveBlocked, isDiscardBlocked, moveWithinEra, moveToEra, discardFromPlay, attachTo } from './boardOps';
import { makeCard, makeState, putInEra } from './testFixtures';
import { registerCard } from './state';

describe('board ops', () => {
  it('effectiveScoreValue applies attach modifiers (PRD 3.9)', () => {
    const G = makeState({ players: ['0'] });
    putInEra(G, 'modern', makeCard({ id: 'modern-dot-com#0', ownerId: '0', scoreValue: 4 }));
    const inflation = makeCard({
      id: 'modern-inflation#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'modify:score:attached', 'modify:amount:-1'],
    });
    registerCard(G, inflation);
    attachTo(G, 'modern-inflation#0', 'modern-dot-com#0');
    expect(effectiveScoreValue(G, 'modern-dot-com#0')).toBe(3);
  });

  it('protect:self + protect:move blocks moves; protect:source:opponent only blocks opponents', () => {
    const G = makeState({ players: ['0', '1'] });
    putInEra(G, 'stone',
      makeCard({ id: 'stone-age-damascus-steel#0', ownerId: '0', tags: ['protect:self', 'protect:move', 'protect:source:opponent'] }),
      makeCard({ id: 'stone-age-anarchy#0', ownerId: '0', tags: ['protect:self', 'protect:move', 'protect:discard', 'protect:value-change'] }),
    );
    expect(isMoveBlocked(G, 'stone-age-damascus-steel#0', '1')).toBe('protect:move');
    expect(isMoveBlocked(G, 'stone-age-damascus-steel#0', '0')).toBeNull(); // owner may move it
    expect(isMoveBlocked(G, 'stone-age-anarchy#0', '0')).toBe('protect:move'); // unqualified blocks everyone
    expect(isDiscardBlocked(G, 'stone-age-anarchy#0', '1')).toBe('protect:discard');
  });

  it('Hibernation on host blocks host moves/discards (protect:target:attached)', () => {
    const G = makeState({ players: ['0', '1'] });
    putInEra(G, 'stone', makeCard({ id: 'stone-age-cloth#0', ownerId: '0' }));
    const hib = makeCard({
      id: 'stone-age-hibernation#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'protect:target:attached', 'protect:move', 'protect:discard', 'duration:rest-of-game'],
    });
    registerCard(G, hib);
    attachTo(G, 'stone-age-hibernation#0', 'stone-age-cloth#0');
    expect(isMoveBlocked(G, 'stone-age-cloth#0', '1')).toBe('protect:move');
    expect(isDiscardBlocked(G, 'stone-age-cloth#0', '1')).toBe('protect:discard');
  });

  it('moveWithinEra and moveToEra reposition; blocked moves return false', () => {
    const G = makeState({ players: ['0'] });
    putInEra(G, 'modern',
      makeCard({ id: 'a#0', ownerId: '0' }), makeCard({ id: 'b#0', ownerId: '0' }), makeCard({ id: 'c#0', ownerId: '0' }),
    );
    expect(moveWithinEra(G, 'c#0', 0)).toBe(true);
    expect(G.timeline.modern.stack).toEqual(['c#0', 'a#0', 'b#0']);
    expect(moveToEra(G, 'a#0', 'future', 'top')).toBe(true);
    expect(G.timeline.future.stack).toEqual(['a#0']);
    expect(G.timeline.modern.stack).toEqual(['c#0', 'b#0']);
  });

  it('discardFromPlay sends card and its attachments to owner discards', () => {
    const G = makeState({ players: ['0', '1'] });
    putInEra(G, 'modern', makeCard({ id: 'host#0', ownerId: '0' }));
    const att = makeCard({ id: 'att#0', ownerId: '1', cardType: 'action' });
    registerCard(G, att);
    attachTo(G, 'att#0', 'host#0');
    expect(discardFromPlay(G, 'host#0', '1')).toBe(true);
    expect(G.timeline.modern.stack).toEqual([]);
    expect(G.players['0'].discard.map(c => c.id)).toEqual(['host#0']);
    expect(G.players['1'].discard.map(c => c.id)).toEqual(['att#0']);
  });
});
