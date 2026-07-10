/**
 * Local hand layout helpers (reorder / group / sort).
 * Pure functions over instance ids — does not touch game G.
 */

export type SortKey = "custom" | "name" | "type" | "score";
export type SortDir = "asc" | "desc";

export interface HandLayoutCard {
  id: string;
  name?: string;
  cardType?: string;
  scoreValue?: number | null;
}

export interface HandGroup {
  /** Group key (base id or name). */
  key: string;
  /** Instance ids in layout order within the group. */
  cardIds: string[];
  /** First card used for display / play. */
  representativeId: string;
}

export interface HandLayoutPrefs {
  group: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
}

export const DEFAULT_HAND_PREFS: HandLayoutPrefs = {
  group: false,
  sortKey: "custom",
  sortDir: "asc",
};

/** Base card identity for grouping (strip #instance suffix). */
export function groupKeyForCard(card: HandLayoutCard): string {
  const base = (card.id || "").split("#")[0];
  if (base) return base;
  return card.name || card.id || "";
}

export function cardsByIdMap(
  hand: HandLayoutCard[],
): Map<string, HandLayoutCard> {
  const m = new Map<string, HandLayoutCard>();
  for (const c of hand) m.set(c.id, c);
  return m;
}

/**
 * Keep order membership in sync with the live hand:
 * drop missing ids, append new ids at the end (preserve relative order of survivors).
 */
export function repairHandOrder(
  order: string[],
  handIds: string[],
): string[] {
  const live = new Set(handIds);
  const next = order.filter((id) => live.has(id));
  const seen = new Set(next);
  for (const id of handIds) {
    if (!seen.has(id)) {
      next.push(id);
      seen.add(id);
    }
  }
  return next;
}

/**
 * Stable contiguity pass: same group key become adjacent.
 * Order of first occurrence of each key is preserved; within a key, relative order preserved.
 */
export function ensureContiguousGroups(
  order: string[],
  cardsById: Map<string, HandLayoutCard>,
): string[] {
  const keyOrder: string[] = [];
  const buckets = new Map<string, string[]>();
  for (const id of order) {
    const card = cardsById.get(id) || { id };
    const k = groupKeyForCard(card);
    if (!buckets.has(k)) {
      buckets.set(k, []);
      keyOrder.push(k);
    }
    buckets.get(k)!.push(id);
  }
  const out: string[] = [];
  for (const k of keyOrder) {
    out.push(...(buckets.get(k) || []));
  }
  return out;
}

/** Build display groups from an ordered id list (same key may appear as one group if contiguous). */
export function buildGroups(
  order: string[],
  cardsById: Map<string, HandLayoutCard>,
): HandGroup[] {
  const contiguous = ensureContiguousGroups(order, cardsById);
  const groups: HandGroup[] = [];
  let current: HandGroup | null = null;
  for (const id of contiguous) {
    const card = cardsById.get(id) || { id };
    const k = groupKeyForCard(card);
    if (!current || current.key !== k) {
      current = { key: k, cardIds: [id], representativeId: id };
      groups.push(current);
    } else {
      current.cardIds.push(id);
    }
  }
  return groups;
}

export function flattenGroups(groups: HandGroup[]): string[] {
  return groups.flatMap((g) => g.cardIds);
}

function missingLastCompare(
  aMissing: boolean,
  bMissing: boolean,
): number | null {
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return null;
}

function typeRank(t?: string): number | null {
  if (!t) return null;
  if (t === "invention") return 0;
  if (t === "action") return 1;
  return 2;
}

/**
 * Multi-key sort: primary criterion, then group key, then id.
 * Missing primary values always sort last (both asc and desc).
 */
export function sortHandIds(
  order: string[],
  cardsById: Map<string, HandLayoutCard>,
  key: Exclude<SortKey, "custom">,
  dir: SortDir,
): string[] {
  const mult = dir === "desc" ? -1 : 1;
  const decorated = order.map((id, index) => {
    const card = cardsById.get(id) || { id };
    return { id, card, index };
  });

  decorated.sort((a, b) => {
    let primary = 0;
    if (key === "name") {
      const an = (a.card.name || a.id || "").toLowerCase();
      const bn = (b.card.name || b.id || "").toLowerCase();
      const miss =
        missingLastCompare(!an, !bn) ??
        missingLastCompare(an === "", bn === "");
      if (miss !== null && miss !== 0) return miss;
      primary = an.localeCompare(bn) * mult;
    } else if (key === "type") {
      const ar = typeRank(a.card.cardType);
      const br = typeRank(b.card.cardType);
      const miss = missingLastCompare(ar === null, br === null);
      if (miss !== null && miss !== 0) return miss;
      primary = ((ar ?? 99) - (br ?? 99)) * mult;
    } else if (key === "score") {
      const as =
        typeof a.card.scoreValue === "number" ? a.card.scoreValue : null;
      const bs =
        typeof b.card.scoreValue === "number" ? b.card.scoreValue : null;
      const miss = missingLastCompare(as === null, bs === null);
      if (miss !== null && miss !== 0) return miss;
      primary = ((as as number) - (bs as number)) * mult;
    }
    if (primary !== 0) return primary;

    const gk = groupKeyForCard(a.card).localeCompare(groupKeyForCard(b.card));
    if (gk !== 0) return gk;
    const idc = a.id.localeCompare(b.id);
    if (idc !== 0) return idc;
    return a.index - b.index;
  });

  // After sort, ensure same group key are contiguous (stable within key)
  return ensureContiguousGroups(
    decorated.map((d) => d.id),
    cardsById,
  );
}

/** Move item at fromIndex to toIndex in a copy of the array. */
export function reorderIds(
  order: string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= order.length ||
    toIndex >= order.length ||
    fromIndex === toIndex
  ) {
    return [...order];
  }
  const next = [...order];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

/** Reorder groups then flatten to instance id list. */
export function reorderGroups(
  groups: HandGroup[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= groups.length ||
    toIndex >= groups.length ||
    fromIndex === toIndex
  ) {
    return flattenGroups(groups);
  }
  const next = [...groups];
  const [g] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, g);
  return flattenGroups(next);
}

export function handPrefsStorageKey(playerId: string | null | undefined): string {
  return `timestreams.handPrefs.${playerId ?? "anon"}`;
}

export function loadHandPrefs(
  playerId: string | null | undefined,
): HandLayoutPrefs {
  if (typeof localStorage === "undefined") return { ...DEFAULT_HAND_PREFS };
  try {
    const raw = localStorage.getItem(handPrefsStorageKey(playerId));
    if (!raw) return { ...DEFAULT_HAND_PREFS };
    const parsed = JSON.parse(raw) as Partial<HandLayoutPrefs>;
    return {
      group: !!parsed.group,
      sortKey:
        parsed.sortKey === "name" ||
        parsed.sortKey === "type" ||
        parsed.sortKey === "score" ||
        parsed.sortKey === "custom"
          ? parsed.sortKey
          : "custom",
      sortDir: parsed.sortDir === "desc" ? "desc" : "asc",
    };
  } catch {
    return { ...DEFAULT_HAND_PREFS };
  }
}

export function saveHandPrefs(
  playerId: string | null | undefined,
  prefs: HandLayoutPrefs,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(handPrefsStorageKey(playerId), JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}
