/**
 * Deck Resolver Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enrichedToOnePieceCard, resolveDeckList } from './deckResolver';
import type { ResolvedDeck } from './deckResolver';
import type { EnrichedCard } from '@manamesh/frontend/src/deck/types';
import type { DeckList } from '@manamesh/frontend/src/deck/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnriched(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    id: 'OP01-001',
    name: 'Monkey D. Luffy',
    front: 'cards/OP01-001/front.png',
    colors: ['red'],
    cardType: 'leader',
    cost: 5,
    power: 6000,
    counter: null,
    rarity: 'L',
    set: 'OP01',
    effectText: 'Rush',
    traits: ['Straw Hat Crew', 'Supernovas'],
    life: 4,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enrichedToOnePieceCard
// ---------------------------------------------------------------------------

describe('enrichedToOnePieceCard', () => {
  it('converts a leader card', () => {
    const card = enrichedToOnePieceCard(makeEnriched());
    expect(card.id).toBe('OP01-001');
    expect(card.name).toBe('Monkey D. Luffy');
    expect(card.cardType).toBe('leader');
    expect(card.color).toEqual(['red']);
    expect(card.cost).toBe(5);
    expect(card.power).toBe(6000);
    expect(card.counter).toBeUndefined();
    expect(card.rarity).toBe('L');
    expect(card.set).toBe('OP01');
    expect(card.effectText).toBe('Rush');
    expect(card.life).toBe(4);
    expect(card.attributes).toEqual(['Straw Hat Crew', 'Supernovas']);
    expect(card.cardNumber).toBe('001');
  });

  it('converts a character card with counter', () => {
    const card = enrichedToOnePieceCard(
      makeEnriched({
        id: 'OP01-010',
        cardType: 'character',
        cost: 2,
        power: 3000,
        counter: 1000,
        rarity: 'C',
        life: null,
      }),
    );
    expect(card.cardType).toBe('character');
    expect(card.counter).toBe(1000);
    expect(card.life).toBeUndefined();
    expect(card.cardNumber).toBe('010');
  });

  it('maps multi-color cards', () => {
    const card = enrichedToOnePieceCard(
      makeEnriched({ colors: ['red', 'green'] }),
    );
    expect(card.color).toEqual(['red', 'green']);
  });

  it('falls back to red when colors are empty', () => {
    const card = enrichedToOnePieceCard(makeEnriched({ colors: [] }));
    expect(card.color).toEqual(['red']);
  });

  it('filters invalid colors', () => {
    const card = enrichedToOnePieceCard(
      makeEnriched({ colors: ['red', 'orange', 'blue'] }),
    );
    expect(card.color).toEqual(['red', 'blue']);
  });

  it('maps rarity strings', () => {
    for (const r of ['C', 'UC', 'R', 'SR', 'SEC', 'L', 'SP'] as const) {
      const card = enrichedToOnePieceCard(makeEnriched({ rarity: r }));
      expect(card.rarity).toBe(r);
    }
  });

  it('defaults unknown rarity to C', () => {
    const card = enrichedToOnePieceCard(makeEnriched({ rarity: 'PROMO' }));
    expect(card.rarity).toBe('C');
  });

  it('maps card types', () => {
    for (const t of ['character', 'leader', 'event', 'stage'] as const) {
      const card = enrichedToOnePieceCard(makeEnriched({ cardType: t }));
      expect(card.cardType).toBe(t);
    }
  });

  it('defaults unknown card type to character', () => {
    const card = enrichedToOnePieceCard(makeEnriched({ cardType: 'unknown' }));
    expect(card.cardType).toBe('character');
  });

  it('converts null cost/power/counter/life to undefined', () => {
    const card = enrichedToOnePieceCard(
      makeEnriched({ cost: null, power: null, counter: null, life: null }),
    );
    expect(card.cost).toBeUndefined();
    expect(card.power).toBeUndefined();
    expect(card.counter).toBeUndefined();
    expect(card.life).toBeUndefined();
  });

  it('uses instanceId override when provided', () => {
    const card = enrichedToOnePieceCard(makeEnriched(), 'OP01-001#2');
    expect(card.id).toBe('OP01-001#2');
    expect(card.name).toBe('Monkey D. Luffy');
  });

  it('omits traits when empty', () => {
    const card = enrichedToOnePieceCard(makeEnriched({ traits: [] }));
    expect(card.attributes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveDeckList
// ---------------------------------------------------------------------------

describe('resolveDeckList', () => {
  // Mock the loader modules
  vi.mock('../../../assets/loader/loader', () => ({
    getLoadedPack: vi.fn(),
    getAllLoadedPacks: vi.fn().mockReturnValue([]),
  }));

  vi.mock('../../../assets/loader/local-loader', () => ({
    reloadLocalPack: vi.fn(),
    getAllLocalPacks: vi.fn().mockReturnValue([]),
  }));

  vi.mock('../../../assets/loader/cache', () => ({
    getAllPackMetadata: vi.fn().mockResolvedValue([]),
  }));

  let mockGetLoadedPack: ReturnType<typeof vi.fn>;
  let mockReloadLocalPack: ReturnType<typeof vi.fn>;
  let mockGetAllLoadedPacks: ReturnType<typeof vi.fn>;
  let mockGetAllLocalPacks: ReturnType<typeof vi.fn>;
  let mockGetAllPackMetadata: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const loader = await import('../../../assets/loader/loader');
    const localLoader = await import('../../../assets/loader/local-loader');
    const cache = await import('../../../assets/loader/cache');
    mockGetLoadedPack = loader.getLoadedPack as ReturnType<typeof vi.fn>;
    mockReloadLocalPack = localLoader.reloadLocalPack as ReturnType<typeof vi.fn>;
    mockGetAllLoadedPacks = (loader as Record<string, unknown>).getAllLoadedPacks as ReturnType<typeof vi.fn>;
    mockGetAllLocalPacks = (localLoader as Record<string, unknown>).getAllLocalPacks as ReturnType<typeof vi.fn>;
    mockGetAllPackMetadata = (cache as Record<string, unknown>).getAllPackMetadata as ReturnType<typeof vi.fn>;
  });

  const mockPack = {
    id: 'test-pack',
    manifest: { name: 'Test Pack', game: 'onepiece', version: '1.0', sets: [] },
    cards: [
      {
        id: 'OP01-001',
        name: 'Luffy Leader',
        front: 'cards/OP01-001/front.png',
        metadata: {
          cardType: 'leader',
          colors: ['Red'],
          cost: 0,
          power: 5000,
          rarity: 'L',
          set: 'OP01',
          life: 4,
          traits: ['Straw Hat Crew'],
        },
      },
      {
        id: 'OP01-010',
        name: 'Nami',
        front: 'cards/OP01-010/front.png',
        metadata: {
          cardType: 'character',
          colors: ['Red'],
          cost: 1,
          power: 2000,
          counter: 1000,
          rarity: 'C',
          set: 'OP01',
          traits: ['Straw Hat Crew'],
        },
      },
      {
        id: 'OP01-020',
        name: 'Zoro',
        front: 'cards/OP01-020/front.png',
        metadata: {
          cardType: 'character',
          colors: ['Red'],
          cost: 3,
          power: 4000,
          counter: 1000,
          rarity: 'R',
          set: 'OP01',
          traits: ['Straw Hat Crew'],
        },
      },
    ],
    source: { type: 'local' as const, packId: 'test-pack' },
    loadedAt: Date.now(),
  };

  const mockDeckList: DeckList = {
    id: 'deck-1',
    name: 'Test Deck',
    game: 'onepiece',
    packId: 'test-pack',
    leaderId: 'OP01-001',
    cards: {
      'OP01-010': 4,
      'OP01-020': 2,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('resolves a deck from memory-cached pack', async () => {
    mockGetLoadedPack.mockReturnValue(mockPack);

    const result = await resolveDeckList(mockDeckList);
    expect(result).not.toBeNull();
    expect(result!.cards.length).toBe(7); // 1 leader + 4 Nami + 2 Zoro

    // Leader first
    expect(result!.cards[0].cardType).toBe('leader');
    expect(result!.cards[0].name).toBe('Luffy Leader');
    expect(result!.cards[0].id).toBe('OP01-001');

    // cardPackMap tracks base card IDs
    expect(result!.cardPackMap.get('OP01-001')).toBe('test-pack');
    expect(result!.cardPackMap.get('OP01-010')).toBe('test-pack');
    expect(result!.cardPackMap.get('OP01-020')).toBe('test-pack');
  });

  it('generates unique IDs for multiple copies', async () => {
    mockGetLoadedPack.mockReturnValue(mockPack);

    const result = await resolveDeckList(mockDeckList);
    const namiIds = result!.cards.filter((c) => c.name === 'Nami').map((c) => c.id);
    expect(namiIds).toEqual([
      'OP01-010#0',
      'OP01-010#1',
      'OP01-010#2',
      'OP01-010#3',
    ]);

    const zoroIds = result!.cards.filter((c) => c.name === 'Zoro').map((c) => c.id);
    expect(zoroIds).toEqual(['OP01-020#0', 'OP01-020#1']);
  });

  it('falls back to reloadLocalPack when not in memory', async () => {
    mockGetLoadedPack.mockReturnValue(undefined);
    mockReloadLocalPack.mockResolvedValue(mockPack);

    const result = await resolveDeckList(mockDeckList);
    expect(result).not.toBeNull();
    expect(mockReloadLocalPack).toHaveBeenCalledWith('test-pack');
  });

  it('returns null when pack is not found', async () => {
    mockGetLoadedPack.mockReturnValue(undefined);
    mockReloadLocalPack.mockResolvedValue(null);

    const result = await resolveDeckList(mockDeckList);
    expect(result).toBeNull();
  });

  it('returns null when leader is not in pack', async () => {
    mockGetLoadedPack.mockReturnValue(mockPack);

    const badDeck = { ...mockDeckList, leaderId: 'OP99-999' };
    const result = await resolveDeckList(badDeck);
    expect(result).toBeNull();
  });

  it('skips missing cards with warning', async () => {
    mockGetLoadedPack.mockReturnValue(mockPack);

    const deckWithMissing: DeckList = {
      ...mockDeckList,
      cards: { 'OP01-010': 2, 'MISSING-001': 1 },
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await resolveDeckList(deckWithMissing);
    expect(result).not.toBeNull();
    expect(result!.cards.length).toBe(3); // 1 leader + 2 Nami (missing card skipped)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('MISSING-001'),
    );
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Multi-pack deck resolution (packId === 'multi')
  // -------------------------------------------------------------------------

  const mockPack2 = {
    id: 'pack-2',
    manifest: { name: 'Pack 2', game: 'onepiece', version: '1.0', sets: [] },
    cards: [
      {
        id: 'OP02-001',
        name: 'Ace',
        front: 'cards/OP02-001/front.png',
        metadata: {
          cardType: 'character',
          colors: ['Red'],
          cost: 4,
          power: 5000,
          counter: 1000,
          rarity: 'SR',
          set: 'OP02',
          traits: ['Whitebeard Pirates'],
        },
      },
    ],
    source: { type: 'local' as const, packId: 'pack-2' },
    loadedAt: Date.now(),
  };

  it('resolves multi-pack deck from all loaded packs', async () => {
    mockGetAllLoadedPacks.mockReturnValue([mockPack, mockPack2]);
    mockGetAllLocalPacks.mockReturnValue([]);

    const multiDeck: DeckList = {
      ...mockDeckList,
      packId: 'multi',
      cards: { 'OP01-010': 2, 'OP02-001': 1 },
    };

    const result = await resolveDeckList(multiDeck);
    expect(result).not.toBeNull();
    expect(result!.cards.length).toBe(4); // 1 leader + 2 Nami + 1 Ace

    const ace = result!.cards.find((c) => c.name === 'Ace');
    expect(ace).toBeDefined();
    expect(ace!.id).toBe('OP02-001');

    // cardPackMap tracks which pack each card came from
    expect(result!.cardPackMap.get('OP01-001')).toBe('test-pack');
    expect(result!.cardPackMap.get('OP02-001')).toBe('pack-2');
  });

  it('resolves multi-pack deck with local packs as fallback', async () => {
    mockGetAllLoadedPacks.mockReturnValue([]);
    mockGetAllLocalPacks.mockReturnValue([mockPack, mockPack2]);

    const multiDeck: DeckList = {
      ...mockDeckList,
      packId: 'multi',
      cards: { 'OP01-010': 1, 'OP02-001': 2 },
    };

    const result = await resolveDeckList(multiDeck);
    expect(result).not.toBeNull();
    expect(result!.cards.length).toBe(4); // 1 leader + 1 Nami + 2 Ace
  });

  it('deduplicates packs across memory and local caches', async () => {
    // Same pack in both caches — should only appear once
    mockGetAllLoadedPacks.mockReturnValue([mockPack]);
    mockGetAllLocalPacks.mockReturnValue([mockPack]);

    const multiDeck: DeckList = {
      ...mockDeckList,
      packId: 'multi',
      cards: { 'OP01-010': 2 },
    };

    const result = await resolveDeckList(multiDeck);
    expect(result).not.toBeNull();
    expect(result!.cards.length).toBe(3); // 1 leader + 2 Nami
  });

  it('returns null for multi-pack when no packs loaded', async () => {
    mockGetAllLoadedPacks.mockReturnValue([]);
    mockGetAllLocalPacks.mockReturnValue([]);
    mockGetAllPackMetadata.mockResolvedValue([]);

    const multiDeck: DeckList = {
      ...mockDeckList,
      packId: 'multi',
    };

    const result = await resolveDeckList(multiDeck);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Player-tagged instance IDs (cross-player uniqueness)
  // -------------------------------------------------------------------------

  it('tags instance IDs with playerTag when provided', async () => {
    mockGetLoadedPack.mockReturnValue(mockPack);

    const result = await resolveDeckList(mockDeckList, '0');
    expect(result).not.toBeNull();

    // Leader gets #p0 suffix
    expect(result!.cards[0].id).toBe('OP01-001#p0');

    // Multi-copy cards get #p0.N suffix
    const namiIds = result!.cards.filter((c) => c.name === 'Nami').map((c) => c.id);
    expect(namiIds).toEqual([
      'OP01-010#p0.0',
      'OP01-010#p0.1',
      'OP01-010#p0.2',
      'OP01-010#p0.3',
    ]);

    // Double-copy cards also tagged
    const zoroIds = result!.cards.filter((c) => c.name === 'Zoro').map((c) => c.id);
    expect(zoroIds).toEqual(['OP01-020#p0.0', 'OP01-020#p0.1']);
  });

  it('produces unique IDs across different playerTags', async () => {
    mockGetLoadedPack.mockReturnValue(mockPack);

    const p0 = await resolveDeckList(mockDeckList, '0');
    const p1 = await resolveDeckList(mockDeckList, '1');
    expect(p0).not.toBeNull();
    expect(p1).not.toBeNull();

    // All IDs from player 0 and player 1 should be disjoint
    const p0Ids = new Set(p0!.cards.map((c) => c.id));
    const p1Ids = new Set(p1!.cards.map((c) => c.id));
    for (const id of p0Ids) {
      expect(p1Ids.has(id)).toBe(false);
    }
  });

  it('uses legacy format when playerTag is omitted', async () => {
    mockGetLoadedPack.mockReturnValue(mockPack);

    const result = await resolveDeckList(mockDeckList);
    expect(result).not.toBeNull();

    // Leader: bare ID
    expect(result!.cards[0].id).toBe('OP01-001');

    // Multi-copy: #N suffix (no player prefix)
    const namiIds = result!.cards.filter((c) => c.name === 'Nami').map((c) => c.id);
    expect(namiIds).toEqual(['OP01-010#0', 'OP01-010#1', 'OP01-010#2', 'OP01-010#3']);
  });

  it('reloads packs from IndexedDB when memory caches are empty', async () => {
    mockGetAllLoadedPacks.mockReturnValue([]);
    mockGetAllLocalPacks.mockReturnValue([]);
    // IndexedDB has stored metadata
    mockGetAllPackMetadata.mockResolvedValue([
      { id: 'test-pack', name: 'Test Pack' },
      { id: 'pack-2', name: 'Pack 2' },
    ]);
    // reloadLocalPack returns the packs
    mockReloadLocalPack.mockImplementation((id: string) => {
      if (id === 'test-pack') return Promise.resolve(mockPack);
      if (id === 'pack-2') return Promise.resolve(mockPack2);
      return Promise.resolve(null);
    });

    const multiDeck: DeckList = {
      ...mockDeckList,
      packId: 'multi',
      cards: { 'OP01-010': 1, 'OP02-001': 1 },
    };

    const result = await resolveDeckList(multiDeck);
    expect(result).not.toBeNull();
    expect(result!.cards.length).toBe(3); // 1 leader + 1 Nami + 1 Ace
    expect(mockReloadLocalPack).toHaveBeenCalledWith('test-pack');
    expect(mockReloadLocalPack).toHaveBeenCalledWith('pack-2');
  });
});
