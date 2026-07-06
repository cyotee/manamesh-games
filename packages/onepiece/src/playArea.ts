/**
 * Play Area Slot System
 *
 * Manages the play area for One Piece TCG.
 * Each player has:
 * - 1 Leader slot (required)
 * - N Character slots (configurable, typically 5)
 * - 1 optional Stage slot
 *
 * DON!! cards can be attached to Leader and Character slots.
 */

import type { PlayAreaSlot, SlotType, OnePieceModuleConfig } from './types';

// =============================================================================
// Slot Creation
// =============================================================================

/**
 * Create the initial play area slots for a player.
 */
export function createPlayArea(config: OnePieceModuleConfig): PlayAreaSlot[] {
  const slots: PlayAreaSlot[] = [];
  let position = 0;

  // Leader slot (always exactly one)
  slots.push({
    slotType: 'leader',
    cardId: null,
    attachedDon: 0,
    position: position++,
  });

  // Character slots
  for (let i = 0; i < config.maxCharacterSlots; i++) {
    slots.push({
      slotType: 'character',
      cardId: null,
      attachedDon: 0,
      position: position++,
    });
  }

  // Stage slot (optional)
  if (config.allowStageCard) {
    slots.push({
      slotType: 'stage',
      cardId: null,
      attachedDon: 0,
      position: position++,
    });
  }

  return slots;
}

// =============================================================================
// Slot Queries
// =============================================================================

/**
 * Find the leader slot.
 */
export function getLeaderSlot(playArea: PlayAreaSlot[]): PlayAreaSlot | undefined {
  return playArea.find((s) => s.slotType === 'leader');
}

/**
 * Find all character slots.
 */
export function getCharacterSlots(playArea: PlayAreaSlot[]): PlayAreaSlot[] {
  return playArea.filter((s) => s.slotType === 'character');
}

/**
 * Find the stage slot.
 */
export function getStageSlot(playArea: PlayAreaSlot[]): PlayAreaSlot | undefined {
  return playArea.find((s) => s.slotType === 'stage');
}

/**
 * Find a slot by position.
 */
export function getSlotByPosition(
  playArea: PlayAreaSlot[],
  position: number,
): PlayAreaSlot | undefined {
  return playArea.find((s) => s.position === position);
}

/**
 * Find the slot containing a specific card.
 */
export function findSlotByCardId(
  playArea: PlayAreaSlot[],
  cardId: string,
): PlayAreaSlot | undefined {
  return playArea.find((s) => s.cardId === cardId);
}

/**
 * Find the first empty character slot.
 */
export function findEmptyCharacterSlot(
  playArea: PlayAreaSlot[],
): PlayAreaSlot | undefined {
  return playArea.find((s) => s.slotType === 'character' && s.cardId === null);
}

/**
 * Count occupied character slots.
 */
export function countOccupiedCharacterSlots(playArea: PlayAreaSlot[]): number {
  return playArea.filter((s) => s.slotType === 'character' && s.cardId !== null).length;
}

// =============================================================================
// Slot Operations
// =============================================================================

/**
 * Place a card into a specific slot.
 *
 * @returns true if placed successfully, false if slot is occupied or invalid.
 */
export function placeCardInSlot(
  playArea: PlayAreaSlot[],
  position: number,
  cardId: string,
): boolean {
  const slot = getSlotByPosition(playArea, position);
  if (!slot || slot.cardId !== null) {
    return false;
  }
  slot.cardId = cardId;
  return true;
}

/**
 * Remove a card from a slot.
 *
 * @returns The removed card ID, or null if the slot was empty.
 */
export function removeCardFromSlot(
  playArea: PlayAreaSlot[],
  position: number,
): string | null {
  const slot = getSlotByPosition(playArea, position);
  if (!slot || slot.cardId === null) {
    return null;
  }
  const cardId = slot.cardId;
  slot.cardId = null;
  slot.attachedDon = 0;
  return cardId;
}

/**
 * Attach DON!! cards to a slot.
 *
 * @returns true if DON was attached, false if slot is empty or invalid type.
 */
export function attachDon(
  playArea: PlayAreaSlot[],
  position: number,
  count: number,
): boolean {
  const slot = getSlotByPosition(playArea, position);
  if (!slot || slot.cardId === null) {
    return false;
  }
  // DON!! can only be attached to leader and character slots
  if (slot.slotType === 'stage') {
    return false;
  }
  slot.attachedDon += count;
  return true;
}

/**
 * Detach DON!! cards from a slot.
 *
 * @returns The number of DON actually detached (may be less than requested).
 */
export function detachDon(
  playArea: PlayAreaSlot[],
  position: number,
  count: number,
): number {
  const slot = getSlotByPosition(playArea, position);
  if (!slot || slot.cardId === null) {
    return 0;
  }
  const detached = Math.min(count, slot.attachedDon);
  slot.attachedDon -= detached;
  return detached;
}

/**
 * Get total DON!! attached across all slots.
 */
export function getTotalAttachedDon(playArea: PlayAreaSlot[]): number {
  return playArea.reduce((sum, slot) => sum + slot.attachedDon, 0);
}
