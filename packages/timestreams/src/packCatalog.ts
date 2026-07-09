/**
 * Lightweight HTTP loader for the Timestreams scanned asset pack.
 * Fetches root + set manifests and rewrites image paths to absolute URLs
 * under a served base (e.g. /timestreams-pack/).
 */

import type { EraId } from "./types";

/** Minimal card entry shape from pack manifests (plus absolute image URLs). */
export interface PackCardEntry {
  id: string;
  name: string;
  front: string;
  back?: string;
  metadata?: Record<string, unknown>;
  quantity?: number;
}

/** Serializable per-era card lists for setupData / G.packCatalog. */
export type PackCatalog = Partial<Record<EraId, PackCardEntry[]>>;

export interface PackCatalogLoadResult {
  catalog: PackCatalog;
  packName: string;
  packVersion: string;
  baseUrl: string;
  /** Eras that have a non-empty set in the pack. */
  availableEras: EraId[];
  cardCount: number;
}

/** Era → set directory name under the pack root. */
export const ERA_TO_SET: Record<EraId, string> = {
  stone: "stone_age",
  medieval: "medieval",
  renaissance: "renaissance",
  industrial: "industrial",
  modern: "modern",
  future: "future_tech",
};

const SET_TO_ERA: Record<string, EraId> = {
  stone_age: "stone",
  medieval: "medieval",
  renaissance: "renaissance",
  industrial: "industrial",
  modern: "modern",
  future_tech: "future",
};

/**
 * Default base URL when Vite serves packages/timestreams/assets/packs/timestreams
 * at /timestreams-pack/.
 */
export const DEFAULT_PACK_BASE_URL = "/timestreams-pack";

interface RootManifest {
  name?: string;
  version?: string;
  sets?: Array<{ name?: string; path: string }>;
}

interface SetManifest {
  name?: string;
  cards?: PackCardEntry[];
}

function joinUrl(base: string, rel: string): string {
  const b = base.replace(/\/+$/, "");
  const r = rel.replace(/^\/+/, "");
  return `${b}/${r}`;
}

/**
 * Load the Timestreams pack catalog from HTTP.
 * Expects root manifest.json with `sets[]`, each set dir with its own manifest.json.
 */
export async function loadPackCatalogFromHttp(
  baseUrl: string = DEFAULT_PACK_BASE_URL,
  fetchFn: typeof fetch = fetch,
): Promise<PackCatalogLoadResult> {
  const rootUrl = joinUrl(baseUrl, "manifest.json");
  const rootRes = await fetchFn(rootUrl);
  if (!rootRes.ok) {
    throw new Error(`Failed to load pack root manifest: ${rootUrl} (${rootRes.status})`);
  }
  const root = (await rootRes.json()) as RootManifest;
  const sets = root.sets ?? [];

  const catalog: PackCatalog = {};
  let cardCount = 0;

  for (const setRef of sets) {
    const setPath = setRef.path;
    const era = SET_TO_ERA[setPath];
    if (!era) {
      // era/aids sets are not player decks — skip
      continue;
    }
    const setManifestUrl = joinUrl(baseUrl, `${setPath}/manifest.json`);
    const setRes = await fetchFn(setManifestUrl);
    if (!setRes.ok) {
      console.warn(`[packCatalog] skip set ${setPath}: ${setRes.status}`);
      continue;
    }
    const setManifest = (await setRes.json()) as SetManifest;
    const cards: PackCardEntry[] = (setManifest.cards ?? []).map((c) => {
      const front = c.front
        ? joinUrl(baseUrl, `${setPath}/${c.front}`)
        : c.front;
      const back = c.back
        ? joinUrl(baseUrl, `${setPath}/${c.back}`)
        : c.back;
      return {
        ...c,
        front: front || c.front,
        back: back || c.back,
      };
    });
    catalog[era] = cards;
    cardCount += cards.reduce((n, c) => n + (c.quantity ?? 1), 0);
  }

  const availableEras = (Object.keys(catalog) as EraId[]).filter(
    (e) => (catalog[e]?.length ?? 0) > 0,
  );

  return {
    catalog,
    packName: root.name || "Timestreams Pack",
    packVersion: root.version || "0",
    baseUrl,
    availableEras,
    cardCount,
  };
}
