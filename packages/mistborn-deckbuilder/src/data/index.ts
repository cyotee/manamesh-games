/**
 * Data layer for Mistborn.
 * Phase 1: complete as possible (full effectText + structured tags).
 *
 * Card data transcribed/derived from the official manual scans.
 * Use simple sequential + name-based IDs.
 */

import type { MistbornCard, CharacterData, MissionData } from '../types';

// Load complete data (as complete as possible from manual)
import cardsData from './cards.json' assert { type: 'json' };
import charactersData from './characters.json' assert { type: 'json' };

export const SAMPLE_CARDS: MistbornCard[] = cardsData as MistbornCard[];
export const CHARACTERS = charactersData as Record<string, CharacterData>;

// Mission data stub (expand later)
export const MISSIONS: Record<string, any> = {};

/**
 * Resolve image path for a card based on cropped assets in assets/cards/
 * Convention from user-cropped files.
 */
function resolveImagePath(card: MistbornCard): string | undefined {
  if (card.imagePath) return card.imagePath;

  const name = card.name;
  const safe = name.replace(/\s+/g, '_');

  if (card.cardType === 'action' || card.cardType === 'ally' || card.cardType === 'confrontation') {
    return `market_cards/Market_Card-${safe}.png`;
  }
  if (card.cardType === 'funding') {
    return 'funding_card/Funding_Card_Front.png';
  }
  if (card.cardType === 'character-starter') {
    if (card.metal) {
      const m = Array.isArray(card.metal) ? card.metal[0] : card.metal;
      const cap = m.charAt(0).toUpperCase() + m.slice(1);
      return `metal_training_cards/Metal_Training_Card-${cap}.png`;
    }
    // fallback to character card if we know
    return `character_cards/Chartacter_Card-${name}.png`;
  }
  if (card.cardType === 'lord-ruler') {
    // Lxx based on id or something
    return `lord_ruler_challenge_cards/Lord_Ruler_Challenge_Card-${card.id}.png`;
  }
  return undefined;
}

const cardsWithImages = SAMPLE_CARDS.map(card => ({
  ...card,
  imagePath: resolveImagePath(card),
  imageCid: resolveImagePath(card), // for CoreCard compatibility in dev
}));

// Simple loaders
export function getCardById(id: string): MistbornCard | undefined {
  return cardsWithImages.find((c) => c.id === id);
}

export function getAllCards(): MistbornCard[] {
  return cardsWithImages;
}

export function getCharacter(id: string): CharacterData | undefined {
  return CHARACTERS[id];
}

export function getMission(id: string): any {
  return MISSIONS[id];
}

// Board and other assets (relative to assets/)
export const PLAYER_TRAINING_TRACK_PATH = 'board/Player Training Track.png';

export function getCardImagePath(card: MistbornCard): string | undefined {
  return card.imagePath || card.imageCid;
}

export const MISTBORN_PACK_ROOT = 'packs/mistborn';

/**
 * Get the asset pack source info for the Mistborn core assets.
 * This can be used with useAssetPack({ type: 'local-directory', ... }) or similar.
 */
export const MISTBORN_ASSET_PACK = {
  name: 'Mistborn - Core Assets',
  root: MISTBORN_PACK_ROOT,
  game: 'mistborn' as const,
};

/** Helper to build a path to a specific set's card image */
export function getPackCardImage(set: string, filename: string): string {
  return `${MISTBORN_PACK_ROOT}/${set}/cards/${filename}`;
}

// For convenience in UI components (relative to package assets/)
// In Vite/Manamesh frontend: use new URL or the asset system.
export function getLocalAssetUrl(relativePath: string): string {
  return `/assets/${relativePath}`;
}

export const ASSET_CARDS_BASE = 'cards/';