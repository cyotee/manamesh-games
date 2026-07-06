// src/effects/executors/attach.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';
import { getAttachments, getPendingTriggers } from '../state';
import { effectiveScoreValue } from '../boardOps';

describe('attach executor', () => {
  it('Inflation attaches to a chosen invention in Today and modifies its value', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'host#0', ownerId: '1', scoreValue: 4 }));
    const infl = makeCard({
      id: 'modern-inflation#0', ownerId: '0', cardType: 'action',
      tags: ['play:attach', 'attach:scope:today', 'modify:score:attached', 'modify:amount:-1', 'play:extra-turn', 'extra-turn:optional', 'condition:today-modern-or-future'],
    });
    putInHand(G, '0', infl);
    const first = resolvePlayEffect(G, '0', 'modern-inflation#0');
    expect(first.prompts.map(p => p.id)).toContain('modern-inflation#0:attach-host');
    resolvePlayEffect(G, '0', 'modern-inflation#0', { 'modern-inflation#0:attach-host': 'host#0' });
    expect(getAttachments(G)['host#0']).toContain('modern-inflation#0');
    expect(effectiveScoreValue(G, 'host#0')).toBe(3);
  });

  it('Waylay registers an era-anchored ongoing trigger on attach', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 3 }); // Today = renaissance
    putInEra(G, 'renaissance', makeCard({ id: 'host#0', ownerId: '1' }));
    const waylay = makeCard({
      id: 'medieval-waylay#0', ownerId: '0', cardType: 'action',
      tags: ['react:invention-played', 'play:attach', 'ongoing:trigger:invention-played', 'trigger:scope:attached-era', 'trigger:persists:after-today-advances', 'move:target:attached', 'move:destination:end-of-era'],
    });
    putInHand(G, '0', waylay);
    resolvePlayEffect(G, '0', 'medieval-waylay#0', { 'medieval-waylay#0:attach-host': 'host#0' });
    const trig = getPendingTriggers(G)[0];
    expect(trig).toMatchObject({
      sourceCardId: 'medieval-waylay#0', event: 'invention-played', eraAnchor: 'renaissance', limit: 'ongoing', spent: false,
    });
  });
});
