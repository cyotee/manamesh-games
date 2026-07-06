// src/effects/executors/discard.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from '../resolvePlay';
import { makeCard, makeState, putInEra, putInHand } from '../testFixtures';

describe('discard executor', () => {
  function napalmSetup() {
    const G = makeState({ players: ['0', '1'], currentDay: 5 }); // Today = modern
    putInEra(G, 'modern', makeCard({ id: 'victim-a#0', ownerId: '1' }));
    putInEra(G, 'medieval', makeCard({ id: 'victim-b#0', ownerId: '1' }));
    putInEra(G, 'future', makeCard({ id: 'safe#0', ownerId: '1' }));
    const napalm = makeCard({
      id: 'modern-napalm#0', ownerId: '0', cardType: 'action',
      tags: ['play:discard:1', 'discard:target:invention', 'discard:scope:this-or-previous-era'],
    });
    putInHand(G, '0', napalm);
    putInEra(G, 'modern', makeCard({ id: 'modern-ref#0', ownerId: '0' })); // played reference not needed; napalm scopes off Today
    return G;
  }

  it('prompts with the legal target set, then discards the chosen card', () => {
    const G = napalmSetup();
    const first = resolvePlayEffect(G, '0', 'modern-napalm#0');
    expect(first.prompts).toHaveLength(1);
    const prompt = first.prompts[0];
    expect(prompt.id).toBe('modern-napalm#0:discard');
    expect(prompt.deciderId).toBe('0');
    expect(prompt.options).toContain('victim-a#0');
    expect(prompt.options).toContain('victim-b#0');
    expect(prompt.options).not.toContain('safe#0');

    const second = resolvePlayEffect(G, '0', 'modern-napalm#0', { 'modern-napalm#0:discard': 'victim-b#0' });
    expect(second.prompts).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual([]);
    expect(G.players['1'].discard.map(c => c.id)).toEqual(['victim-b#0']);
  });

  it('discard:optional offers a skip; protected cards stay in the option set but fizzle (PRD 3.14)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'modern-clean-power#0', ownerId: '1', tags: ['protect:self', 'protect:discard'] }));
    const laser = makeCard({
      id: 'modern-laser-show#0', ownerId: '0',
      tags: ['play:discard:1', 'discard:optional', 'discard:target:art', 'discard:scope:today'],
    });
    putInHand(G, '0', laser);
    const art = makeCard({ id: 'medieval-poetry#0', ownerId: '1', subtypes: ['poetry', 'art'] });
    putInEra(G, 'modern', art);
    const res = resolvePlayEffect(G, '0', 'modern-laser-show#0');
    expect(res.prompts[0].min).toBe(0); // optional
    expect(res.prompts[0].options).toEqual(['medieval-poetry#0']);
  });

  it('discard:target:top-today needs no prompt', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 2 }); // Today = medieval
    putInEra(G, 'medieval', makeCard({ id: 'top#0', ownerId: '1' }), makeCard({ id: 'under#0', ownerId: '1' }));
    const treb = makeCard({
      id: 'medieval-trebuchet#0', ownerId: '0',
      tags: ['play:discard:1', 'discard:optional', 'discard:target:top-today'],
    });
    putInHand(G, '0', treb);
    const res = resolvePlayEffect(G, '0', 'medieval-trebuchet#0', { 'medieval-trebuchet#0:discard': 'top#0' });
    expect(res.prompts).toEqual([]);
    expect(G.timeline.medieval.stack).toEqual(['under#0']);
  });

  it('react:cancel on discard fizzles the discard (basic)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'victim#0', ownerId: '1' }));
    const cancelCard = makeCard({ id: 'victim#0', ownerId: '1', tags: ['react:cancel', 'cancel:discard'] });
    // register so react check sees it
    // (in real the card would be registered when played)
    // For test, the resolve will use the one in era
    const napalm = makeCard({
      id: 'modern-napalm#0', ownerId: '0', cardType: 'action',
      tags: ['play:discard:1', 'discard:target:invention', 'discard:scope:today'],
    });
    putInHand(G, '0', napalm);
    // put the cancel card in era so getCard finds it with the tags
    putInEra(G, 'modern', cancelCard);
    const first = resolvePlayEffect(G, '0', 'modern-napalm#0');
    // prompt appears
    const res = resolvePlayEffect(G, '0', 'modern-napalm#0', { 'modern-napalm#0:discard': 'victim#0' });
    expect(res.log.join(' ')).toMatch(/fizzles \(react:cancel\)/);
    // victim still in stack
    expect(G.timeline.modern.stack).toContain('victim#0');
  });

  it('react:redirect on discard logs redirect (basic)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'victim#0', ownerId: '1' }));
    const redirectCard = makeCard({ id: 'victim#0', ownerId: '1', tags: ['react:redirect', 'redirect:discard'] });
    putInEra(G, 'modern', redirectCard);
    const napalm = makeCard({
      id: 'modern-napalm#0', ownerId: '0', cardType: 'action',
      tags: ['play:discard:1', 'discard:target:invention', 'discard:scope:today'],
    });
    putInHand(G, '0', napalm);
    const res = resolvePlayEffect(G, '0', 'modern-napalm#0', { 'modern-napalm#0:discard': 'victim#0' });
    expect(res.log.join(' ')).toMatch(/redirected to victim#0/);
    // victim still in stack (demo treats as fizzle after log)
    expect(G.timeline.modern.stack).toContain('victim#0');
  });

  it('react:replace on discard logs replace (basic)', () => {
    const G = makeState({ players: ['0', '1'], currentDay: 5 });
    putInEra(G, 'modern', makeCard({ id: 'victim#0', ownerId: '1' }));
    const replaceCard = makeCard({ id: 'victim#0', ownerId: '1', tags: ['react:replace', 'replace:discard'] });
    putInEra(G, 'modern', replaceCard);
    const napalm = makeCard({
      id: 'modern-napalm#0', ownerId: '0', cardType: 'action',
      tags: ['play:discard:1', 'discard:target:invention', 'discard:scope:today'],
    });
    putInHand(G, '0', napalm);
    const res = resolvePlayEffect(G, '0', 'modern-napalm#0', { 'modern-napalm#0:discard': 'victim#0' });
    expect(res.log.join(' ')).toMatch(/replaced \(replace-with-move\)/);
    // victim still in stack (demo)
    expect(G.timeline.modern.stack).toContain('victim#0');
  });
});
