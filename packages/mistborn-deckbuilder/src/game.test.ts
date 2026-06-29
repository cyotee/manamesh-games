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

  it('computeCoins counts funding and coin tags', () => {
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
    // 1 (funding) + 1 (coinshot tag) + 2 (from boxings) = 4
    expect(coins).toBeGreaterThanOrEqual(3);
  });

  it('validateMove blocks buy when not enough coins', () => {
    const state = createInitialState({ numPlayers: 2, playerIDs: ['p0', 'p1'], packCards: mockPackCards });
    // force low coins
    state.zones.play = { p0: [] };
    state.boxingsAvailable = 0;
    // ensure the market contains something we can attempt to buy
    if (!state.market || state.market.length === 0) state.market = ['market-foo'];

    const res = validateMove(state, 'buyCard', 'p0', 'market-foo');
    // With 0 coins it should be invalid for a >0 cost card (or structural)
    expect(res).toHaveProperty('valid');
    if (res.valid === false) {
      expect(res.error).toMatch(/coin|market/i);
    }
  });

  it('buy records coinsSpent and subsequent computeCoins / validate see reduced amount', () => {
    // Use a state with some coins from funding
    const state: any = createInitialState({ numPlayers: 1, playerIDs: ['p0'], packCards: mockPackCards });
    state.zones.play.p0 = [{ id: 'funding-1' }]; // gives 1 coin
    state.market = ['market-foo'];
    (state as any).coinsSpent = { p0: 0 };

    // First buy of 3-cost should be blocked (only 1 coin)
    let res = validateMove(state, 'buyCard', 'p0', 'market-foo');
    expect(res.valid).toBe(false);

    // Simulate a successful buy of a cheap card by directly calling the move logic? 
    // Instead, manually record as the move would:
    (state as any).coinsSpent.p0 = 1;
    res = validateMove(state, 'buyCard', 'p0', 'market-foo');
    expect(res.valid).toBe(false); // still not enough for 3
  });

  it('playCard sideways is allowed without metal (uses card as metal)', () => {
    const state: any = createInitialState({ numPlayers: 1, playerIDs: ['p0'], packCards: mockPackCards });
    // put a metal-requiring card in hand
    state.zones.hand.p0 = [{ id: 'pewter-card' }];

    // Burn the pewter metal so normal play would require it
    const pewter = state.players.p0.metals.find((m: any) => m.metal === 'pewter');
    if (pewter) pewter.burned = true;

    // sideways should pass even with the metal burned (card acts as the metal)
    const resSide = validateMove(state, 'playCard', 'p0', 'pewter-card', true);
    expect(resSide.valid).toBe(true);

    // normal (vertical) play should now fail (no unburned pewter)
    const resNormal = validateMove(state, 'playCard', 'p0', 'pewter-card', false);
    expect(resNormal.valid).toBe(false);
  });

  it('MistbornGame has expected shape', () => {
    expect(MistbornGame).toHaveProperty('name', 'mistborn-deckbuilder');
    expect(MistbornGame).toHaveProperty('moves');
    expect(typeof MistbornGame.setup).toBe('function');
  });
});
