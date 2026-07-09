// src/effects/triggers.test.ts
import { describe, it, expect } from 'vitest';
import { fireEvent, registerStaticTriggers } from './triggers';
import { resolvePlayEffect } from './resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from './testFixtures';
import { getPendingTriggers, getTurnFlags, registerCard } from './state';

describe('play-phase triggers', () => {
  it('Media Scandal punishes the next action played in Today, once', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    const ms = makeCard({
      id: 'modern-media-scandal#0', ownerId: '0',
      tags: ['play:delayed-trigger', 'trigger:next-action-in-today', 'trigger:limit:once', 'discard:hand:3', 'discard:by:triggering-action-player', 'discard:whole-hand-if-fewer'],
    });
    putInEra(G, 'modern', ms);
    resolvePlayEffect(G, '0', 'modern-media-scandal#0');
    expect(getPendingTriggers(G)).toHaveLength(1);

    // player 1 has only 2 cards -> whole hand discards, no prompt
    putInHand(G, '1', makeCard({ id: 'h1#0', ownerId: '1' }), makeCard({ id: 'h2#0', ownerId: '1' }));
    const out = fireEvent(G, { type: 'action-played', cardId: 'any-action#0', eraId: 'modern', actorPlayerId: '1' });
    expect(out.prompts).toEqual([]);
    expect(G.players['1'].hand).toEqual([]);
    expect(getPendingTriggers(G)[0].spent).toBe(true);

    // second action: trigger is spent, nothing happens
    putInHand(G, '1', makeCard({ id: 'h3#0', ownerId: '1' }));
    fireEvent(G, { type: 'action-played', cardId: 'other#0', eraId: 'modern', actorPlayerId: '1' });
    expect(G.players['1'].hand).toHaveLength(1);
  });

  it('Waylay moves its host to the end of the anchored era on invention-played there', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 3 });
    putInEra(G, 'renaissance', makeCard({ id: 'host#0', ownerId: '1' }), makeCard({ id: 'later#0', ownerId: '1' }));
    const waylay = makeCard({
      id: 'medieval-waylay#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'ongoing:trigger:invention-played', 'trigger:scope:attached-era', 'move:target:attached', 'move:destination:end-of-era'],
    });
    putInHand(G, '0', waylay);
    resolvePlayEffect(G, '0', 'medieval-waylay#0', { 'medieval-waylay#0:attach-host': 'host#0' });

    fireEvent(G, { type: 'invention-played', cardId: 'new#0', eraId: 'renaissance', actorPlayerId: '1' });
    expect(G.timeline.renaissance.stack[G.timeline.renaissance.stack.length - 1]).toBe('host#0');

    // events in other eras do not fire it
    const before = [...G.timeline.renaissance.stack];
    fireEvent(G, { type: 'invention-played', cardId: 'x#0', eraId: 'modern', actorPlayerId: '1' });
    expect(G.timeline.renaissance.stack).toEqual(before);
  });

  it('Taxes rewards its discarder', () => {
    const G = makeState({ players: ['0', '1'] });
    G.encryptedDecks['1'] = [{}, {}] as any;
    const taxes = makeCard({
      id: 'medieval-taxes#0', ownerId: '0', scoreValue: 6,
      tags: ['ongoing:trigger:discarded-from-play', 'trigger:target:self', 'draw:2', 'draw:to:discarder'],
    });
    putInEra(G, 'medieval', taxes);
    registerStaticTriggers(G, taxes);
    fireEvent(G, { type: 'discarded-from-play', cardId: 'medieval-taxes#0', eraId: 'medieval', actorPlayerId: '1' });
    // Sequential decrypt: one active request + remaining count of 2 for discarder
    expect(G.pendingDealRemaining?.['1']).toBe(2);
    expect(G.pendingDecryptRequests.length).toBe(1);
  });

  it('Television sets skip flag and draws for the next inventor', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    G.encryptedDecks['1'] = [{}] as any;
    const tv = makeCard({
      id: 'modern-television#0', ownerId: '0',
      tags: ['play:delayed-trigger', 'trigger:next-invention-played', 'trigger:limit:once', 'skip-turn:target:triggering-player', 'draw:1', 'draw:to:triggering-player'],
    });
    putInEra(G, 'modern', tv);
    resolvePlayEffect(G, '0', 'modern-television#0');
    fireEvent(G, { type: 'invention-played', cardId: 'inv#0', eraId: 'modern', actorPlayerId: '1' });
    expect(getTurnFlags(G, '1').skipNextTurn).toBe(true);
    expect(G.pendingDecryptRequests).toHaveLength(1);
  });
});
