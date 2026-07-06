---
name: manamesh-assets
description: This skill should be used when the user asks about "asset loading", "IPFS", "Helia", "asset packs", "manifest schema", "IndexedDB cache", "card images", "gateway fallback", "zip packs", or needs to understand how ManaMesh loads and caches card game assets.
---

# ManaMesh Asset Loading System

## Conceptual Overview

ManaMesh loads card assets (images, metadata) from IPFS with automatic caching for offline play. Assets are **not embedded** in the app bundle — they're fetched on-demand and cached locally. The loading hierarchy is: **IndexedDB cache** → **Helia (browser IPFS)** → **HTTP gateways** → back to IndexedDB.

The system uses a **three-store IndexedDB architecture** to separate concerns and avoid data pollution:

1. Pack **metadata** store
2. Pack **card images** store
3. Pack **zip archives** store

## Asset Loading Flow

```
UI requests card image
       ↓
Check pack-level image cache (IndexedDB 'manamesh-card-images')
       ↓ cache miss
Fetch via fetcher (constructs full CID with path)
       ↓
ipfs-loader.loadAsset(cid):
  1. Check global asset cache (IndexedDB 'manamesh-asset-cache') — 100MB LRU
  2. If not cached: HELIA-FIRST or GATEWAY-FIRST based on config
  3. Helia path: createHelia() → unixfs.cat(cid) → Blob
  4. Gateway path: try configured gateways sequentially (ipfs.io, dweb.link, cloudflare-ipfs.com)
  5. On success: putInCache(cid, blob) → global cache
       ↓
Return blob → storeCardImage(packId, cardId, side) → pack-level image cache
       ↓
UI renders image
```

## Core Files

### IPFS Loader (`src/assets/ipfs-loader.ts`)

- `loadAsset(cid, options?)` — main fetch function with Helia/gateway fallback
- `loadAssetUrl(cid)` — returns object URL
- `preloadAssets(cids, options?)` — batch preload (BATCH_SIZE=5)
- `isAssetAvailable(cid)` — check cache
- `shutdownHelia()` — cleanup

### Global Cache (`src/assets/cache.ts`)

- Uses `idb-keyval` under the hood
- DB: `'manamesh-asset-cache'` / metadata DB: `'manamesh-asset-cache-meta'`
- `MAX_CACHE_SIZE_BYTES = 100 * 1024 * 1024` (100MB LRU)
- `getFromCache`, `putInCache`, `isInCache`, `removeFromCache`, `getCacheStats`, `clearCache`

### Pack-Level Loader (`src/assets/loader/loader.ts`)

- `loadPack(source)` — loads manifest, resolves nested manifests
- `getCardImageBlob(packId, cardId, side, options?)` — get card image
- `getCardImageUrl(...)` — get object URL (auto-revoked)
- `preloadPack(packId)` — batch preload all pack images
- Maintains `loadedPacks` map for fast in-memory lookups
- Falls back to 1x1 transparent PNG placeholder on failure

### Pack-Level Cache (`src/assets/loader/cache.ts`)

Three separate IndexedDB stores:

- **Pack metadata:** DB `'manamesh-asset-packs'` / store `'packs'`
  - `StoredPackMetadata`: id, name, game, version, source, cardCount, cachedCardIds, loadedAt
- **Card images:** DB `'manamesh-card-images'` / store `'images'`
  - Key: `makeCardImageKey(packId, cardId, side)` → `blob`
- **Zip archives:** DB `'manamesh-pack-zips'` / store `'zips'`
  - Stores full zip blob for offline reconstruction

### Fetcher (`src/assets/loader/fetcher.ts`)

Asset-pack-aware fetch wrapper:

- `fetchBlob(source, path, options?)` — handles ipfs/http sources
- `fetchJson(source, path)` — fetch + parse JSON manifest
- `fetchText` — fetch text file

### Config (`src/assets/config.ts`)

```typescript
DEFAULT_GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
];
// Default timeouts:
heliaInitTimeout: 5000;
heliaFetchTimeout: 10000;
gatewayTimeout: 15000;
preferGateway: true; // Helia has content-type issues sometimes
```

Persists to `localStorage` key `'manamesh-ipfs-config'`.

### Manifest Parser (`src/assets/manifest/parser.ts`)

- `parseManifest(json)` — parse and validate manifest
- `resolveNestedManifests(manifest, fetchJson)` — flatten nested sets
- `findCardById(pack, cardId)` — card lookup helper

### Manifest Validator (`src/assets/manifest/validator.ts`)

- `validateManifest(manifest)` → `ValidationError[]`
- `validateCardEntry(entry)` — checks id, name, front, back
- `checkDuplicateIds(cards)` — detects duplicate card IDs

### Zip Loader (`src/assets/loader/zip-loader.ts`)

Handles IPFS zip sources:

- Downloads zip from IPFS
- Extracts via `zip-extractor.ts`
- Caches images and zip blob
- Stores zip for offline reconstruction

### Local Loader (`src/assets/loader/local-loader.ts`)

Handles user-uploaded packs (zip or directory):

- In-memory local packs map
- Reloads from IndexedDB zip storage across page reloads

## Asset Pack Manifest Schema

```typescript
interface AssetPackManifest {
  name: string; // required, display name
  version: string; // required, semantic version
  game: GameType | string; // required, game identifier
  cards?: CardManifestEntry[]; // optional card list
  sets?: SetReference[]; // optional nested manifests
}

interface CardManifestEntry {
  id: string; // required, unique within pack
  name: string; // required
  front: string; // required, relative path to front image
  back?: string; // optional, relative path to back image
  metadata?: Record<string, unknown>; // optional game-specific data
}

interface SetReference {
  name: string; // required
  path: string; // required, relative path to nested manifest.json
}
```

**Validation rules:**

- `manifest.name`, `manifest.version`, `manifest.game` must be non-empty strings
- Each card needs `id`, `name`, `front` (all required strings)
- `back` is optional string
- `metadata` is optional object
- Duplicate card IDs flagged as `DUPLICATE_ID` error

## Pack Source Types

```typescript
type AssetPackSource =
  | { type: 'ipfs'; cid: string }                    // single CID root
  | { type: 'ipfs-zip'; cid: string }               // CID of a zip archive
  | { type: 'http'; baseUrl: string }               // HTTP base URL
  | { type: 'p2p'; ... }                            // reconstruct from peer
  | { type: 'local' };                              // user-uploaded
```

## Pre-configured Packs (`src/assets/packs/standard-cards.ts`)

- `STANDARD_CARDS_CID` — IPFS CID for standard playing cards zip
- Pre-registers a known asset pack for the app

## Asset Pack Management UI

- `AssetPackManagement.tsx` — UI for adding/removing/managing packs
- `useAssetPack` hook — manage asset pack loading state
- `useCardImage` hook — resolve card images (IPFS/gateway/asset pack)

## Important Constraints / Gotchas

- **Helia content-type issues:** `preferGateway: true` is default because Helia sometimes returns wrong content-type headers.
- **Cache size estimates:** Pack-level size reporting uses rough estimates (~50KB/image). Accurate sizes are not maintained.
- **Very large packs:** Zip extraction stores all images in memory before writing to IndexedDB — be careful with large packs and browser memory/IDB quotas.
- **Object URL revocation:** UI must call `URL.revokeObjectURL()` when done with URLs from `getCardImageUrl`.
- **Gateway localhost exclusion:** Built-in gateway list excludes localhost addresses.
- **Zip pack extraction:** When loading an `ipfs-zip` source, the entire zip is downloaded before extraction — no streaming.

## Key Files

```
packages/frontend/src/assets/ipfs-loader.ts             # Core IPFS fetch with fallback
packages/frontend/src/assets/cache.ts                   # Global LRU cache (100MB)
packages/frontend/src/assets/config.ts                   # Gateway config, timeouts
packages/frontend/src/assets/index.ts                    # Re-exports
packages/frontend/src/assets/loader/loader.ts           # Pack loader orchestrator
packages/frontend/src/assets/loader/cache.ts            # Pack-level IndexedDB stores
packages/frontend/src/assets/loader/fetcher.ts          # Asset-pack-aware fetch
packages/frontend/src/assets/loader/types.ts            # Loader types
packages/frontend/src/assets/loader/zip-loader.ts       # Zip extraction
packages/frontend/src/assets/loader/zip-extractor.ts     # Zip entry extraction
packages/frontend/src/assets/loader/local-loader.ts      # User-uploaded packs
packages/frontend/src/assets/loader/cid.ts              # CID helpers
packages/frontend/src/assets/manifest/types.ts           # AssetPackManifest schema
packages/frontend/src/assets/manifest/parser.ts          # Manifest parsing
packages/frontend/src/assets/manifest/validator.ts       # Manifest validation
packages/frontend/src/assets/packs/standard-cards.ts    # Pre-configured standard cards
packages/frontend/src/hooks/useAssetPack.ts             # Asset pack hook
packages/frontend/src/hooks/useCardImage.ts             # Card image resolution hook
packages/frontend/src/components/AssetPackManagement.tsx # Pack management UI
```

## See Also

- `skill:manamesh-p2p` — P2P asset transfer pipeline
- `skill:manamesh-game-modules` — How games use card images
