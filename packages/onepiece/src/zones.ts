/**
 * Zone Definitions for One Piece TCG
 *
 * Defines the 7 game zones where cards can exist:
 * - Main Deck: Hidden, encrypted, ordered — supports peek/shuffle/search
 * - Life Deck: Mixed visibility per-card — face-up/face-down/owner-known
 * - DON!! Deck: Public counter-like supply
 * - Trash: Public discard pile — supports search
 * - Hand: Owner-only — standard hand
 * - Play Area: Public — flexible slots for leader/characters/stage
 * - DON!! Area: Public — active DON!! cards
 */

import type { ZoneDefinition } from '@manamesh/frontend/src/game/modules/types';

export const ONEPIECE_ZONES: ZoneDefinition[] = [
  {
    id: 'mainDeck',
    name: 'Main Deck',
    visibility: 'hidden',
    shared: false,
    ordered: true,
    features: ['peek', 'shuffle', 'search', 'draw'],
  },
  {
    id: 'lifeDeck',
    name: 'Life Deck',
    visibility: 'private',
    shared: false,
    ordered: true,
    features: ['peek', 'reveal'],
  },
  {
    id: 'donDeck',
    name: 'DON!! Deck',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: ['draw'],
  },
  {
    id: 'trash',
    name: 'Trash',
    visibility: 'public',
    shared: false,
    ordered: true,
    features: ['search', 'reveal'],
  },
  {
    id: 'hand',
    name: 'Hand',
    visibility: 'owner-only',
    shared: false,
    ordered: false,
    features: ['play', 'reveal'],
  },
  {
    id: 'playArea',
    name: 'Play Area',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: ['tap', 'counter', 'reveal'],
  },
  {
    id: 'donArea',
    name: 'DON!! Area',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: ['tap'],
  },
];

/**
 * Get a zone definition by ID.
 */
export function getZoneById(id: string): ZoneDefinition | undefined {
  return ONEPIECE_ZONES.find((z) => z.id === id);
}

/**
 * Zone IDs as constants for type-safe references.
 */
export const ZONE_IDS = {
  MAIN_DECK: 'mainDeck',
  LIFE_DECK: 'lifeDeck',
  DON_DECK: 'donDeck',
  TRASH: 'trash',
  HAND: 'hand',
  PLAY_AREA: 'playArea',
  DON_AREA: 'donArea',
} as const;
