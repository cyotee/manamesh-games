/**
 * Zone Definitions for Timestreams
 *
 * Defines the 5 game zones where cards can exist:
 * - Deck: Hidden, ordered — supports shuffle/draw
 * - Hand: Owner-only — supports play/reveal
 * - Timeline: Public, shared, ordered — supports play
 * - Discard: Public, ordered — supports search
 * - Score Pile: Public — no features
 */

import type { ZoneDefinition } from '@manamesh/frontend/src/game/modules/types';

export const TIMESTREAMS_ZONES: ZoneDefinition[] = [
  {
    id: 'deck',
    name: 'Deck',
    visibility: 'hidden',
    shared: false,
    ordered: true,
    features: ['shuffle', 'draw'],
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
    id: 'timeline',
    name: 'Timeline',
    visibility: 'public',
    shared: true,
    ordered: true,
    features: ['play'],
  },
  {
    id: 'discard',
    name: 'Discard',
    visibility: 'public',
    shared: false,
    ordered: true,
    features: ['search'],
  },
  {
    id: 'scorePile',
    name: 'Score Pile',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: [],
  },
];

/**
 * Get a zone definition by ID.
 */
export function getZoneById(id: string): ZoneDefinition | undefined {
  return TIMESTREAMS_ZONES.find((z) => z.id === id);
}

/**
 * Zone IDs as constants for type-safe references.
 */
export const ZONE_IDS = {
  DECK: 'deck',
  HAND: 'hand',
  TIMELINE: 'timeline',
  DISCARD: 'discard',
  SCORE_PILE: 'scorePile',
} as const;
