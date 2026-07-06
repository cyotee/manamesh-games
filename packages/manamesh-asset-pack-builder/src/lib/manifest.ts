/**
 * Manifest generation and basic validation for asset packs.
 * Designed to produce output compatible with the ManaMesh frontend asset loader.
 */

import type { AssetPackManifest, CardManifestEntry, GameType, SetReference } from './types';

export function createRootManifest(
  game: GameType,
  displayName: string,
  sets: Array<{ id: string; name: string }>,
  version = '1.0.0'
): AssetPackManifest {
  return {
    name: `${displayName} - Complete`,
    version,
    game,
    sets: sets.map((s) => ({ name: s.name, path: s.id } as SetReference)),
  };
}

export function createSetManifest(
  game: GameType,
  _setId: string,
  setName: string,
  cards: CardManifestEntry[],
  version = '1.0.0'
): AssetPackManifest {
  return {
    name: `${game.toUpperCase()} - ${setName}`,
    version,
    game,
    cards,
  };
}

export function validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const m = manifest as Partial<AssetPackManifest>;

  if (!m.name) errors.push('Missing "name"');
  if (!m.version) errors.push('Missing "version"');
  if (!m.game) errors.push('Missing "game"');

  if (m.sets && !Array.isArray(m.sets)) {
    errors.push('"sets" must be an array');
  }
  if (m.cards && !Array.isArray(m.cards)) {
    errors.push('"cards" must be an array');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate the recommended card entry for a downloaded image.
 * Path is relative to the set folder: e.g. "cards/OP01-001.jpg"
 */
export function makeCardEntry(
  id: string,
  name: string,
  ext = 'jpg',
  _setId?: string
): CardManifestEntry {
  const fileName = id;
  return {
    id,
    name,
    front: `cards/${fileName}.${ext}`,
  };
}
