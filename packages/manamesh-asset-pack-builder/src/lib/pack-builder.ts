/**
 * Pack builder: takes raw files (images + optional manifests) and
 * produces a valid asset pack (with generated manifests if missing).
 */

import type { AssetPackManifest, BuiltPack, GameType } from './types';
import { createRootManifest, createSetManifest, makeCardEntry } from './manifest';
import { createZip, type ZipEntry } from './zip';

export interface DiscoveredSet {
  id: string;
  name: string;
  cards: Array<{ id: string; name?: string; file: string }>;
}

export interface ScanResult {
  game: GameType;
  sets: DiscoveredSet[];
  totalCards: number;
  hasManifests: boolean;
}

/**
 * Very lightweight scanner for typical scraper output layout.
 * Expects paths like: MKM/manifest.json or MKM/cards/xxx.jpg
 */
export function scanForSets(files: Map<string, File | { name: string }>): ScanResult {
  const setsMap = new Map<string, DiscoveredSet>();
  let hasManifests = false;
  let game: GameType = 'mtg';

  for (const [relPath] of files.entries()) {
    const lower = relPath.toLowerCase();

    // Detect set manifest
    const setManifestMatch = relPath.match(/^([^/]+)\/manifest\.json$/i);
    if (setManifestMatch) {
      hasManifests = true;
      const setId = setManifestMatch[1];
      if (!setsMap.has(setId)) {
        setsMap.set(setId, { id: setId, name: setId, cards: [] });
      }
      continue;
    }

    // Detect cards in set/cards/
    const cardMatch = relPath.match(/^([^/]+)\/cards\/(.+)$/i);
    if (cardMatch) {
      const setId = cardMatch[1];
      const fileName = cardMatch[2];
      if (!setsMap.has(setId)) {
        setsMap.set(setId, { id: setId, name: setId, cards: [] });
      }
      const set = setsMap.get(setId)!;
      // Derive a card id from filename (remove extension)
      const id = fileName.replace(/\.[^.]+$/, '');
      set.cards.push({ id, file: relPath });
    }

    // Infer game from root folder hints if present
    if (lower.includes('onepiece') || lower.includes('op-')) game = 'onepiece';
  }

  const sets = Array.from(setsMap.values()).filter((s) => s.cards.length > 0);
  const total = sets.reduce((sum, s) => sum + s.cards.length, 0);

  return { game, sets, totalCards: total, hasManifests };
}

/**
 * Build proper manifests (root + per set) and produce zip entries.
 * If manifests already existed in input we still regenerate clean ones for safety.
 */
export async function buildAssetPack(
  files: Map<string, File>,
  game: GameType,
  packName?: string
): Promise<{ manifest: AssetPackManifest; zipBlob: Blob; entries: ZipEntry[] }> {
  const scan = scanForSets(files);

  const setsForRoot: Array<{ id: string; name: string }> = [];

  const zipEntries: ZipEntry[] = [];

  // Copy over image files (and any existing other files we want to preserve)
  for (const [path, file] of files) {
    const buf = new Uint8Array(await file.arrayBuffer());
    // We will replace manifest files below
    if (!path.toLowerCase().endsWith('manifest.json')) {
      zipEntries.push({ path, data: buf });
    }
  }

  // Generate manifests
  for (const set of scan.sets) {
    const cardEntries = set.cards.map((c) => {
      const ext = c.file.split('.').pop() || 'jpg';
      return makeCardEntry(c.id, c.name || c.id, ext, set.id);
    });

    const setManifest = createSetManifest(game, set.id, set.name, cardEntries);
    const setManifestPath = `${set.id}/manifest.json`;

    zipEntries.push({
      path: setManifestPath,
      data: new TextEncoder().encode(JSON.stringify(setManifest, null, 2)),
    });

    setsForRoot.push({ id: set.id, name: set.name });
  }

  const rootManifest = createRootManifest(
    game,
    packName || `${game.toUpperCase()} Asset Pack`,
    setsForRoot
  );

  zipEntries.push({
    path: 'manifest.json',
    data: new TextEncoder().encode(JSON.stringify(rootManifest, null, 2)),
  });

  const zipBlob = await createZip(zipEntries);

  return {
    manifest: rootManifest,
    zipBlob,
    entries: zipEntries,
  };
}

export function summarizePack(manifest: AssetPackManifest): BuiltPack {
  const cards = manifest.cards?.length || 0;
  const sets = (manifest.sets || []).map((s) => s.path);
  return {
    manifest,
    cardCount: cards,
    sets,
  };
}
