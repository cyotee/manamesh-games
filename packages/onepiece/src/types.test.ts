/**
 * One Piece TCG Types Tests
 *
 * Tests for card schemas, type definitions, and configuration.
 */

import { describe, it, expect } from 'vitest';
import { onePieceCardSchema } from './game';
import { DEFAULT_CONFIG } from './types';
import type { OnePieceCard, OnePieceDonCard } from './types';

// =============================================================================
// Test Utilities
// =============================================================================

function createTestCard(overrides: Partial<OnePieceCard> = {}): OnePieceCard {
  return {
    id: 'OP01-001',
    name: 'Monkey D. Luffy',
    cardType: 'leader',
    cost: 0,
    power: 5000,
    counter: undefined,
    color: ['red'],
    attributes: ['Supernovas', 'Straw Hat Crew'],
    trigger: undefined,
    effectText: 'Activate: Main',
    set: 'OP01',
    cardNumber: '001',
    rarity: 'L',
    life: 5,
    ...overrides,
  };
}

function createTestDonCard(): OnePieceDonCard {
  return {
    id: 'don-0-0',
    name: 'DON!!',
    cardType: 'don',
  };
}

// =============================================================================
// Card Schema Tests
// =============================================================================

describe('OnePieceCard Schema', () => {
  describe('validate', () => {
    it('should validate a valid leader card', () => {
      const card = createTestCard();
      expect(onePieceCardSchema.validate(card)).toBe(true);
    });

    it('should validate a valid character card', () => {
      const card = createTestCard({
        id: 'OP01-004',
        name: 'Roronoa Zoro',
        cardType: 'character',
        cost: 3,
        power: 5000,
        counter: 1000,
        rarity: 'SR',
        life: undefined,
      });
      expect(onePieceCardSchema.validate(card)).toBe(true);
    });

    it('should validate a valid event card', () => {
      const card = createTestCard({
        id: 'OP01-026',
        name: 'Gum-Gum Red Hawk',
        cardType: 'event',
        cost: 2,
        power: undefined,
        trigger: 'On Play',
        rarity: 'C',
        life: undefined,
      });
      expect(onePieceCardSchema.validate(card)).toBe(true);
    });

    it('should validate a valid stage card', () => {
      const card = createTestCard({
        id: 'OP01-047',
        name: 'Thousand Sunny',
        cardType: 'stage',
        cost: 2,
        power: undefined,
        rarity: 'R',
        life: undefined,
      });
      expect(onePieceCardSchema.validate(card)).toBe(true);
    });

    it('should reject null', () => {
      expect(onePieceCardSchema.validate(null)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(onePieceCardSchema.validate('string')).toBe(false);
      expect(onePieceCardSchema.validate(42)).toBe(false);
    });

    it('should reject objects missing required fields', () => {
      expect(onePieceCardSchema.validate({ id: '1' })).toBe(false);
      expect(onePieceCardSchema.validate({ id: '1', name: 'X' })).toBe(false);
    });

    it('should reject invalid card types', () => {
      const card = { ...createTestCard(), cardType: 'don' };
      expect(onePieceCardSchema.validate(card)).toBe(false);
    });
  });

  describe('create', () => {
    it('should create a card with all provided fields', () => {
      const card = onePieceCardSchema.create({
        id: 'OP01-001',
        name: 'Luffy',
        cardType: 'leader',
        cost: 0,
        power: 5000,
        color: ['red'],
        set: 'OP01',
        cardNumber: '001',
        rarity: 'L',
        life: 5,
      } as Partial<OnePieceCard> & { id: string; name: string });
      expect(card.id).toBe('OP01-001');
      expect(card.cardType).toBe('leader');
      expect(card.life).toBe(5);
    });

    it('should apply default values when fields are missing', () => {
      const card = onePieceCardSchema.create({
        id: 'test-001',
        name: 'Test Card',
      });
      expect(card.cardType).toBe('character');
      expect(card.color).toEqual(['red']);
      expect(card.set).toBe('OP01');
      expect(card.rarity).toBe('C');
    });
  });

  describe('getAssetKey', () => {
    it('should return set-cardNumber format', () => {
      const card = createTestCard();
      expect(onePieceCardSchema.getAssetKey(card)).toBe('OP01-001');
    });

    it('should handle different sets', () => {
      const card = createTestCard({ set: 'OP02', cardNumber: '120' });
      expect(onePieceCardSchema.getAssetKey(card)).toBe('OP02-120');
    });
  });
});

// =============================================================================
// OnePieceCard Type Tests
// =============================================================================

describe('OnePieceCard', () => {
  it('should support multi-color cards', () => {
    const card = createTestCard({ color: ['red', 'green'] });
    expect(card.color).toEqual(['red', 'green']);
    expect(card.color.length).toBe(2);
  });

  it('should support all color values', () => {
    const colors: OnePieceCard['color'] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];
    const card = createTestCard({ color: colors });
    expect(card.color).toHaveLength(6);
  });

  it('should support all rarity values', () => {
    const rarities: OnePieceCard['rarity'][] = ['C', 'UC', 'R', 'SR', 'SEC', 'L', 'SP'];
    for (const rarity of rarities) {
      const card = createTestCard({ rarity });
      expect(card.rarity).toBe(rarity);
    }
  });

  it('should support all card types', () => {
    const types: OnePieceCard['cardType'][] = ['character', 'leader', 'event', 'stage'];
    for (const cardType of types) {
      const card = createTestCard({ cardType });
      expect(card.cardType).toBe(cardType);
    }
  });
});

// =============================================================================
// OnePieceDonCard Tests
// =============================================================================

describe('OnePieceDonCard', () => {
  it('should have cardType don', () => {
    const don = createTestDonCard();
    expect(don.cardType).toBe('don');
    expect(don.name).toBe('DON!!');
  });

  it('should be a valid CoreCard', () => {
    const don = createTestDonCard();
    expect(don.id).toBeDefined();
    expect(don.name).toBeDefined();
  });
});

// =============================================================================
// Default Config Tests
// =============================================================================

describe('DEFAULT_CONFIG', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_CONFIG.startingLife).toBe(5);
    expect(DEFAULT_CONFIG.startingDon).toBe(10);
    expect(DEFAULT_CONFIG.startingHand).toBe(5);
    expect(DEFAULT_CONFIG.maxCharacterSlots).toBe(5);
    expect(DEFAULT_CONFIG.allowStageCard).toBe(true);
    expect(DEFAULT_CONFIG.deckEncryption).toBe('mental-poker');
    expect(DEFAULT_CONFIG.proofChainEnabled).toBe(true);
  });
});
