// src/effects/resolvePlay.test.ts
import { describe, it, expect } from 'vitest';
import { resolvePlayEffect } from './resolvePlay';
import { makeCard, makeState, putInHand } from './testFixtures';

describe('resolvePlayEffect + draw executor', () => {
  it('play:draw:N requests N cooperative draws', () => {
    const G = makeState({ players: ['0', '1'] });
    G.encryptedDecks['0'] = [{}, {}, {}] as any; // 3 encrypted cards (opaque)
    const card = makeCard({ id: 'stone-age-fermented-fruit#0', ownerId: '0', tags: ['play:draw:2'] });
    putInHand(G, '0', card);
    const res = resolvePlayEffect(G, '0', 'stone-age-fermented-fruit#0');
    expect(res.ok).toBe(true);
    expect(res.prompts).toEqual([]);
    expect(G.pendingDecryptRequests.length).toBe(2);
    expect(res.log.some(l => l.includes('play:draw:2'))).toBe(true);
  });

  it('opponents-draw:1 requests draws for all other players', () => {
    const G = makeState({ players: ['0', '1', '2'] });
    G.encryptedDecks['1'] = [{}] as any;
    G.encryptedDecks['2'] = [{}] as any;
    const wg = makeCard({ id: 'modern-world-government#0', ownerId: '0', tags: ['play:draw:3', 'draw:to:self', 'opponents-draw:1'] });
    putInHand(G, '0', wg);
    resolvePlayEffect(G, '0', 'modern-world-government#0');
    const forOpponents = G.pendingDecryptRequests.filter(r => r.deckOwnerId !== '0');
    expect(forOpponents.length).toBe(2);
  });

  it('cards with no known play tags resolve ok with empty log', () => {
    const G = makeState({ players: ['0'] });
    const plain = makeCard({ id: 'stone-age-cloth#0', ownerId: '0', tags: ['react:move'] });
    putInHand(G, '0', plain);
    const res = resolvePlayEffect(G, '0', 'stone-age-cloth#0');
    expect(res).toEqual({ ok: true, prompts: [], log: [] });
  });
});
