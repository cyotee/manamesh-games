import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialState,
  validateMove,
  computeCoins,
  setPackCardsForValidation,
  MistbornGame,
} from './game';
import type { MistbornState } from './types';

const mockPackCards = [
  { id: 'funding-1', name: 'Funding', metadata: { cardType: 'funding', cost: 0, tags: ['coin'], effectText: 'Gain 1 coin.' } },
  { id: 'coinshot', name: 'Coinshot', metadata: { cost: 2, tags: ['coin'], effectText: 'Gain coin.' } },
  { id: 'market-foo', name: 'Foo Card', metadata: { cost: 3, tags: [], effectText: '' } },
  { id: 'pewter-card', name: 'Pewter Card', metadata: { cost: 1, metal: 'pewter', tags: [], effectText: '' } },
];

describe('Mistborn rules engine (early)', () => {
  beforeEach(() => {
    setPackCardsForValidation(mockPackCards);
  });

  it('createInitialState produces players and market', () => {
    const state = createInitialState({ numPlayers: 2, playerIDs: ['p0', 'p1'], packCards: [] });
    expect(Object.keys(state.players)).toHaveLength(2);
    expect(state.market.length).toBeGreaterThan(0);
  });

  it('computeCoins counts funding and coin tags without double-count', () => {
    const state: MistbornState = {
      players: { p0: { trainingPosition: 0, burnLimit: 1 } as any },
      zones: {
        play: { p0: [
          { id: 'funding-1' },
          { id: 'coinshot' },
        ] },
      },
      market: [],
      marketDeckCount: 10,
      boxingsAvailable: 4,
    } as any;

    const coins = computeCoins(state, 'p0');
    // funding-1 (coin tag → 1, no extra funding) + coinshot (cost heuristic 2) + boxings (2) = 5
    expect(coins).toBe(5);
  });

  it('validateMove blocks buy when not enough coins', () => {
    const state = createInitialState({
      numPlayers: 2,
      playerIDs: ['p0', 'p1'],
      packCards: mockPackCards as any,
    });
    state.zones.play = { p0: [], p1: [] };
    state.boxingsAvailable = 0;
    state.coinsSpent = { p0: 0, p1: 0 };
    state.market = ['market-foo'];
    state.currentPlayer = 'p0';

    const res = validateMove(state, 'buyCard', 'p0', 'market-foo');
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/coin/i);
  });

  it('buy respects coinsSpent against cost', () => {
    const state = createInitialState({
      numPlayers: 1,
      playerIDs: ['p0'],
      packCards: mockPackCards as any,
    });
    state.boxingsAvailable = 0;
    state.zones.play = { p0: [{ id: 'funding-1' }] };
    state.market = ['market-foo'];
    state.coinsSpent = { p0: 0 };
    state.currentPlayer = 'p0';

    // funding-1 alone must be < 3 after Task 3 computeCoins semantics
    expect(computeCoins(state, 'p0')).toBeLessThan(3);

    let res = validateMove(state, 'buyCard', 'p0', 'market-foo');
    expect(res.valid).toBe(false);

    state.coinsSpent.p0 = 1;
    res = validateMove(state, 'buyCard', 'p0', 'market-foo');
    expect(res.valid).toBe(false);
  });

  it('playCard sideways allowed when required metal already burned', () => {
    const state = createInitialState({
      numPlayers: 1,
      playerIDs: ['p0'],
      packCards: mockPackCards as any,
    });
    state.currentPlayer = 'p0';
    state.zones.hand.p0 = [{ id: 'pewter-card' }];
    const pewter = state.players.p0.metals.find((m: any) => m.metal === 'pewter');
    pewter.burned = true;
    // burnLimit stays 1; one metal burned

    const resSide = validateMove(state, 'playCard', 'p0', 'pewter-card', true);
    expect(resSide.valid).toBe(true);

    const resNormal = validateMove(state, 'playCard', 'p0', 'pewter-card', false);
    expect(resNormal.valid).toBe(false);
    expect(resNormal.error).toMatch(/metal|burn/i);
  });

  it('MistbornGame has expected shape', () => {
    expect(MistbornGame).toHaveProperty('name', 'mistborn-deckbuilder');
    expect(MistbornGame).toHaveProperty('moves');
    expect(typeof MistbornGame.setup).toBe('function');
  });
});
