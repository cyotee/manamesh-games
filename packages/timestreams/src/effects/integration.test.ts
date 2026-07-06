// src/effects/integration.test.ts
import { describe, it, expect } from 'vitest';
import { playInvention, playAction, INVALID_MOVE } from '../play';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';

const ctxFor = (pid: string) => ({ currentPlayer: pid } as any);

describe('play integration', () => {
  it('gated card is INVALID_MOVE (government rule)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 });
    putInEra(G, 'stone', makeCard({ id: 'stone-age-anarchy#0', ownerId: '1', subtypes: ['government'] }));
    putInHand(G, '0', makeCard({
      id: 'medieval-monarchy#0', ownerId: '0', subtypes: ['monarchy', 'government'],
      tags: ['government', 'rule:one-government-per-era'],
    }));
    expect(playInvention(G, ctxFor('0'), '0', 'medieval-monarchy#0')).toBe(INVALID_MOVE);
  });

  it('play effect with prompt stashes pendingPrompts; re-submission resolves', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 1 });
    putInEra(G, 'stone', makeCard({ id: 'victim#0', ownerId: '1' }));
    putInHand(G, '0', makeCard({
      id: 'stone-age-fire#0', ownerId: '0',
      tags: ['play:discard:1', 'discard:target:today:any'],
    }));
    playInvention(G, ctxFor('0'), '0', 'stone-age-fire#0');
    expect(G.pendingPrompts?.length).toBe(1);

    // answer the prompt by re-invoking with choices (card already in play; effect re-resolves idempotently)
    playInvention(G, ctxFor('0'), '0', 'stone-age-fire#0', { 'stone-age-fire#0:discard': 'victim#0' });
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players['1'].discard.map(c => c.id)).toEqual(['victim#0']);
  });

  it('playing an action fires next-action traps (Media Scandal end-to-end)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ms = makeCard({
      id: 'modern-media-scandal#0', ownerId: '0',
      tags: ['play:delayed-trigger', 'trigger:next-action-in-today', 'trigger:limit:once', 'discard:hand:3', 'discard:by:triggering-action-player', 'discard:whole-hand-if-fewer'],
    });
    putInHand(G, '0', ms);
    playInvention(G, ctxFor('0'), '0', 'modern-media-scandal#0');

    putInHand(G, '1', makeCard({ id: 'a#0', ownerId: '1', cardType: 'action' }), makeCard({ id: 'b#0', ownerId: '1' }));
    playAction(G, ctxFor('1'), '1', 'a#0');
    expect(G.players['1'].hand).toEqual([]); // whole hand (had 1 left after playing)
  });
});
