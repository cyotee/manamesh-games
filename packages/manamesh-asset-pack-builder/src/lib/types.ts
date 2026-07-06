/**
 * Core types for ManaMesh asset packs.
 * Mirrored/adapted from the main frontend for standalone IPFS distribution.
 */

export type GameType = 'mtg' | 'onepiece' | 'lorcana' | string;

export interface CardManifestEntry {
  id: string;
  name: string;
  front: string;
  back?: string;
  metadata?: Record<string, unknown>;
}

export interface SetReference {
  name: string;
  path: string;
}

export interface AssetPackManifest {
  name: string;
  version: string;
  game: GameType;
  cards?: CardManifestEntry[];
  sets?: SetReference[];
}

export interface ScrapeProgress {
  phase: 'idle' | 'discovering' | 'fetching' | 'downloading' | 'manifests' | 'complete' | 'error';
  message: string;
  currentSet?: string;
  setsTotal?: number;
  setsDone?: number;
  cardsTotal?: number;
  cardsDone?: number;
  imagesDownloaded?: number;
  imagesFailed?: number;
}

export interface BuiltPack {
  manifest: AssetPackManifest;
  cardCount: number;
  sets: string[];
  sizeEstimate?: number;
}
