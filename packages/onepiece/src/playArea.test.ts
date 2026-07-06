/**
 * Play Area Slot System Tests
 *
 * Tests for the play area slot creation, card placement,
 * DON!! attachment/detachment, and slot queries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPlayArea,
  getLeaderSlot,
  getCharacterSlots,
  getStageSlot,
  getSlotByPosition,
  findSlotByCardId,
  findEmptyCharacterSlot,
  countOccupiedCharacterSlots,
  placeCardInSlot,
  removeCardFromSlot,
  attachDon,
  detachDon,
  getTotalAttachedDon,
} from './playArea';
import { DEFAULT_CONFIG } from './types';
import type { PlayAreaSlot, OnePieceModuleConfig } from './types';

// =============================================================================
// Play Area Creation Tests
// =============================================================================

describe('createPlayArea', () => {
  it('should create exactly one leader slot', () => {
    const playArea = createPlayArea(DEFAULT_CONFIG);
    const leaderSlots = playArea.filter((s) => s.slotType === 'leader');
    expect(leaderSlots).toHaveLength(1);
  });

  it('should create the configured number of character slots', () => {
    const playArea = createPlayArea(DEFAULT_CONFIG);
    const characterSlots = playArea.filter((s) => s.slotType === 'character');
    expect(characterSlots).toHaveLength(DEFAULT_CONFIG.maxCharacterSlots);
  });

  it('should create a stage slot when allowed', () => {
    const playArea = createPlayArea(DEFAULT_CONFIG);
    const stageSlots = playArea.filter((s) => s.slotType === 'stage');
    expect(stageSlots).toHaveLength(1);
  });

  it('should not create a stage slot when disallowed', () => {
    const config: OnePieceModuleConfig = { ...DEFAULT_CONFIG, allowStageCard: false };
    const playArea = createPlayArea(config);
    const stageSlots = playArea.filter((s) => s.slotType === 'stage');
    expect(stageSlots).toHaveLength(0);
  });

  it('should have total slots = 1 leader + N characters + 1 stage', () => {
    const playArea = createPlayArea(DEFAULT_CONFIG);
    // 1 leader + 5 characters + 1 stage = 7
    expect(playArea).toHaveLength(7);
  });

  it('should have all slots empty initially', () => {
    const playArea = createPlayArea(DEFAULT_CONFIG);
    for (const slot of playArea) {
      expect(slot.cardId).toBeNull();
      expect(slot.attachedDon).toBe(0);
    }
  });

  it('should assign sequential positions', () => {
    const playArea = createPlayArea(DEFAULT_CONFIG);
    for (let i = 0; i < playArea.length; i++) {
      expect(playArea[i].position).toBe(i);
    }
  });

  it('should respect custom character slot counts', () => {
    const config: OnePieceModuleConfig = { ...DEFAULT_CONFIG, maxCharacterSlots: 3 };
    const playArea = createPlayArea(config);
    const characterSlots = playArea.filter((s) => s.slotType === 'character');
    expect(characterSlots).toHaveLength(3);
  });
});

// =============================================================================
// Slot Query Tests
// =============================================================================

describe('Slot Queries', () => {
  let playArea: PlayAreaSlot[];

  beforeEach(() => {
    playArea = createPlayArea(DEFAULT_CONFIG);
  });

  describe('getLeaderSlot', () => {
    it('should return the leader slot', () => {
      const slot = getLeaderSlot(playArea);
      expect(slot).toBeDefined();
      expect(slot!.slotType).toBe('leader');
      expect(slot!.position).toBe(0);
    });
  });

  describe('getCharacterSlots', () => {
    it('should return all character slots', () => {
      const slots = getCharacterSlots(playArea);
      expect(slots).toHaveLength(5);
      for (const slot of slots) {
        expect(slot.slotType).toBe('character');
      }
    });
  });

  describe('getStageSlot', () => {
    it('should return the stage slot', () => {
      const slot = getStageSlot(playArea);
      expect(slot).toBeDefined();
      expect(slot!.slotType).toBe('stage');
    });

    it('should return undefined when no stage slot exists', () => {
      const config: OnePieceModuleConfig = { ...DEFAULT_CONFIG, allowStageCard: false };
      const noStageArea = createPlayArea(config);
      expect(getStageSlot(noStageArea)).toBeUndefined();
    });
  });

  describe('getSlotByPosition', () => {
    it('should find slot by position', () => {
      const slot = getSlotByPosition(playArea, 0);
      expect(slot).toBeDefined();
      expect(slot!.slotType).toBe('leader');
    });

    it('should return undefined for invalid position', () => {
      expect(getSlotByPosition(playArea, 999)).toBeUndefined();
    });
  });

  describe('findSlotByCardId', () => {
    it('should find a slot containing a specific card', () => {
      placeCardInSlot(playArea, 0, 'leader-001');
      const slot = findSlotByCardId(playArea, 'leader-001');
      expect(slot).toBeDefined();
      expect(slot!.position).toBe(0);
    });

    it('should return undefined when card not found', () => {
      expect(findSlotByCardId(playArea, 'nonexistent')).toBeUndefined();
    });
  });

  describe('findEmptyCharacterSlot', () => {
    it('should find the first empty character slot', () => {
      const slot = findEmptyCharacterSlot(playArea);
      expect(slot).toBeDefined();
      expect(slot!.slotType).toBe('character');
      expect(slot!.cardId).toBeNull();
    });

    it('should return undefined when all character slots are full', () => {
      const characterSlots = getCharacterSlots(playArea);
      for (const slot of characterSlots) {
        slot.cardId = `char-${slot.position}`;
      }
      expect(findEmptyCharacterSlot(playArea)).toBeUndefined();
    });
  });

  describe('countOccupiedCharacterSlots', () => {
    it('should return 0 when all empty', () => {
      expect(countOccupiedCharacterSlots(playArea)).toBe(0);
    });

    it('should count occupied character slots', () => {
      placeCardInSlot(playArea, 1, 'char-1');
      placeCardInSlot(playArea, 2, 'char-2');
      expect(countOccupiedCharacterSlots(playArea)).toBe(2);
    });
  });
});

// =============================================================================
// Slot Operation Tests
// =============================================================================

describe('Slot Operations', () => {
  let playArea: PlayAreaSlot[];

  beforeEach(() => {
    playArea = createPlayArea(DEFAULT_CONFIG);
  });

  describe('placeCardInSlot', () => {
    it('should place a card in an empty slot', () => {
      const result = placeCardInSlot(playArea, 0, 'leader-001');
      expect(result).toBe(true);
      expect(playArea[0].cardId).toBe('leader-001');
    });

    it('should fail when slot is already occupied', () => {
      placeCardInSlot(playArea, 0, 'leader-001');
      const result = placeCardInSlot(playArea, 0, 'leader-002');
      expect(result).toBe(false);
      expect(playArea[0].cardId).toBe('leader-001');
    });

    it('should fail for invalid position', () => {
      const result = placeCardInSlot(playArea, 999, 'card-1');
      expect(result).toBe(false);
    });
  });

  describe('removeCardFromSlot', () => {
    it('should remove a card and return its ID', () => {
      placeCardInSlot(playArea, 0, 'leader-001');
      const removed = removeCardFromSlot(playArea, 0);
      expect(removed).toBe('leader-001');
      expect(playArea[0].cardId).toBeNull();
    });

    it('should reset attached DON when removing a card', () => {
      placeCardInSlot(playArea, 1, 'char-1');
      attachDon(playArea, 1, 3);
      removeCardFromSlot(playArea, 1);
      expect(playArea[1].attachedDon).toBe(0);
    });

    it('should return null for empty slot', () => {
      expect(removeCardFromSlot(playArea, 0)).toBeNull();
    });

    it('should return null for invalid position', () => {
      expect(removeCardFromSlot(playArea, 999)).toBeNull();
    });
  });
});

// =============================================================================
// DON!! Attachment Tests
// =============================================================================

describe('DON!! Attachment', () => {
  let playArea: PlayAreaSlot[];

  beforeEach(() => {
    playArea = createPlayArea(DEFAULT_CONFIG);
    placeCardInSlot(playArea, 0, 'leader-001'); // Leader
    placeCardInSlot(playArea, 1, 'char-1');     // Character
  });

  describe('attachDon', () => {
    it('should attach DON to a leader slot', () => {
      const result = attachDon(playArea, 0, 2);
      expect(result).toBe(true);
      expect(playArea[0].attachedDon).toBe(2);
    });

    it('should attach DON to a character slot', () => {
      const result = attachDon(playArea, 1, 1);
      expect(result).toBe(true);
      expect(playArea[1].attachedDon).toBe(1);
    });

    it('should not attach DON to a stage slot', () => {
      const stagePos = playArea.find((s) => s.slotType === 'stage')!.position;
      placeCardInSlot(playArea, stagePos, 'stage-1');
      const result = attachDon(playArea, stagePos, 1);
      expect(result).toBe(false);
    });

    it('should not attach DON to an empty slot', () => {
      const result = attachDon(playArea, 2, 1); // Empty character slot
      expect(result).toBe(false);
    });

    it('should accumulate attached DON', () => {
      attachDon(playArea, 0, 2);
      attachDon(playArea, 0, 3);
      expect(playArea[0].attachedDon).toBe(5);
    });
  });

  describe('detachDon', () => {
    it('should detach DON from a slot', () => {
      attachDon(playArea, 0, 3);
      const detached = detachDon(playArea, 0, 2);
      expect(detached).toBe(2);
      expect(playArea[0].attachedDon).toBe(1);
    });

    it('should not detach more than available', () => {
      attachDon(playArea, 0, 2);
      const detached = detachDon(playArea, 0, 5);
      expect(detached).toBe(2);
      expect(playArea[0].attachedDon).toBe(0);
    });

    it('should return 0 for empty slot', () => {
      expect(detachDon(playArea, 2, 1)).toBe(0);
    });
  });

  describe('getTotalAttachedDon', () => {
    it('should sum DON across all slots', () => {
      attachDon(playArea, 0, 2); // Leader
      attachDon(playArea, 1, 1); // Character
      expect(getTotalAttachedDon(playArea)).toBe(3);
    });

    it('should return 0 when no DON attached', () => {
      expect(getTotalAttachedDon(playArea)).toBe(0);
    });
  });
});
