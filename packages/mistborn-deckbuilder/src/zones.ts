/**
 * Zone Definitions for Mistborn Deck Builder (Phase 1).
 *
 * Uses DeckPlugin for card management.
 * Focus: market (shared) + per-player zones.
 */

import type { ZoneDefinition } from './types';

export const MISTBORN_ZONES: ZoneDefinition[] = [
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
    id: 'play',
    name: 'Play Area',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: ['tap', 'reveal'], // tap used for sideways metal use
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
    id: 'allies',
    name: 'Allies',
    visibility: 'public',
    shared: false,
    ordered: false,
    features: ['reveal'],
  },
  {
    id: 'market',
    name: 'Market',
    visibility: 'public',
    shared: true,
    ordered: false, // row of 6
    features: ['reveal'],
    maxCards: 6,
  },
  {
    id: 'eliminated',
    name: 'Eliminated',
    visibility: 'public',
    shared: true,
    ordered: true,
    features: ['search'],
  },
  // LR deck for co-op visual mode (shared visible count + manual draw)
  {
    id: 'lordRulerDeck',
    name: 'Lord Ruler Deck',
    visibility: 'public',
    shared: true,
    ordered: true,
    features: [],
  },
];

export function getZoneById(id: string): ZoneDefinition | undefined {
  return MISTBORN_ZONES.find((z) => z.id === id);
}

export const ZONE_IDS = {
  DECK: 'deck',
  HAND: 'hand',
  PLAY: 'play',
  DISCARD: 'discard',
  ALLIES: 'allies',
  MARKET: 'market',
  ELIMINATED: 'eliminated',
  LORD_RULER_DECK: 'lordRulerDeck',
} as const;