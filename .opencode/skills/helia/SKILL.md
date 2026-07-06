---
name: helia
description: Helia IPFS browser node, @helia/http gateway-only client, unixfs DAG ops, blockstore/datastore/routing, Bitswap/TrustlessGateway block brokers, CID generation with custom hashers, browser constraints. Triggers: "Helia", "@helia/unixfs", "IPFS browser", "createHelia", "createHeliaHTTP", "Bitswap", "TrustlessGateway", "ipfs-loader"
triggers:
  - Helia
  - "@helia/unixfs"
  - IPFS browser
  - createHelia
  - createHeliaHTTP
  - Bitswap
  - TrustlessGateway
  - ipfs-loader
---

# Helia — IPFS for JavaScript Environments

Helia is a JS/IPFS implementation that works in both Node.js and browsers. Unlike `ipfs-http-client` which proxies to a remote daemon, Helia runs a full IPFS node in-process.

## Two Implementations

### Full Node: `createHelia` (Node.js / browser)

Runs a complete IPFS node with libp2p, Bitswap, Kademlia DHT, and pubsub.

```typescript
import { createHelia } from "helia";
import { unixfs } from "@helia/unixfs";

const helia = await createHelia();
// helia.libp2p — the libp2p node (for peers/connections)
// helia.blockstore — the block store
// helia.datastore — the datastore
// helia.pins — the pin manager
// helia.routing — the routing system
const fs = unixfs(helia);
await fs.addFileBytes(Uint8Array.of(1, 2, 3), "/hello.txt");
```

### Gateway-Only: `createHeliaHTTP` (`@helia/http`)

Lightweight HTTP gateway-only client. No libp2p, no Bitswap. Falls back to public/gateway ipfs.io and cloudflare-ipfs.com gateways. **Use this in browsers when you don't need P2P upload.**

```typescript
import { createHeliaHTTP } from "@helia/http";
import { unixfs } from "@helia/unixfs";

const helia = await createHeliaHTTP();
// Same unixfs() API as full Helia
const fs = unixfs(helia);
const bytes = await fs.readFile("/ipfs/Qm...");
```

## Helia Interface

```typescript
interface Helia {
  // Core storage
  blockstore: Blockstore; // key-value block storage (CIDs → raw bytes)
  datastore: Datastore; // persistent key-value store (for IPNS, pins, etc.)
  pins: PinManager; // track which blocks are "pinned" (not GC'd)

  // Networking
  libp2p: Libp2pInstance; // the libp2p node (multiaddr listeners, peer connections)
  routing: Routing; // DHT + pubsub routing (or HTTP delegation in @helia/http)

  // Garbage collection
  gc(): AsyncGenerator<{ cid: CID }>; // yield pinned blocks during GC

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;

  // Events
  events: EventEmitter<HeliaEvents>;
}
```

## Key Properties

| Property     | Purpose                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ |
| `blockstore` | Raw block storage. `blockstore.put(cid, bytes)` / `blockstore.get(cid)`                    |
| `datastore`  | Higher-level persistent store for metadata (pins, IPNS records)                            |
| `pins`       | `pins.add(cid)`, `pins.rm(cid)`, `pins.isPinned(cid)`                                      |
| `libp2p`     | libp2p node — add peers manually: `libp2p.dial(multiaddr)`                                 |
| `routing`    | Find providers: `routing.findProviders(cid)` → yields `{ id: peerId, addrs: multiaddr[] }` |

## Supplemental Modules

All imported separately and composed with `helia`:

```typescript
import { unixfs }   } from '@helia/unixfs'   // file system operations (addFileBytes, readFile, cat, ls)
import { strings   } from '@helia/strings'   // UTF-8 text convenience (addFile, cat)
import { json      } from '@helia/json'       // JSON serialize/deserialize
import { dagCbor   } from '@helia/dag-cbor'   // CBOR IPLD ( DAG-CBOR)
import { dagJson   } from '@helia/dag-json'   // JSON IPLD ( DAG-JSON)
import { ipns      } from '@helia/ipns'       // IPNS (mutable naming)
import { car       } from '@helia/car'        // Content Addressed aRchives (export/import)
import { mfs       } from '@helia/mfs'        // Mutable File System (like unixfs but mutable paths)
```

### Common Usage Patterns

```typescript
import { createHelia } from "helia";
import { unixfs } from "@helia/unixfs";
import { strings } from "@helia/strings";
import { json } from "@helia/json";
import { dagCbor } from "@helia/dag-cbor";

const helia = await createHelia();
const fs = unixfs(helia);
const str = strings(helia);
const j = json(helia);
const cbor = dagCbor(helia);

// Add bytes as a file
const cid = await fs.addFileBytes(Uint8Array.of(1, 2, 3), "/myfile.txt");

// Read file bytes
const bytes = await fs.readFile(cid);

// Add string as file
const cid2 = await str.addFile("hello world", "/msg.txt");
const text = await str.cat(cid2);

// JSON
const cid3 = await j.add({ foo: "bar" });
const obj = await j.get(cid3);

// DAG-CBOR ( IPLD)
// CBOR-encoded DAG node with CID links
const cid4 = await cbor.add({ myData: 42 });
```

## System Architecture

```
Application
    │
    ▼
┌─────────────────────────┐
│  Helia (Blockstore API) │
│  put(cid, bytes)        │
│  get(cid) → bytes      │
└──────────┬──────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
Bitswap       TrustlessGateway
(blockstore   (HTTP fallback
from libp2p   when Bitswap
peers)         fails)
    │             │
    ▼             ▼
 ┌───────────────────────┐
 │       libp2p          │
 │  DHT / PubSub / IPNI  │
 │  / Reframe            │
 └───────────────────────┘
           │
           ▼
     Network Peers
```

**BlockBrokers** handle where blocks come from. Helia ships with:

- `BitswapBlockBroker` — asks libp2p peers for blocks (P2P)
- `TrustlessGatewayBlockBroker` — fetches blocks from HTTP gateways (fallback)

The routing layer (`helia.routing`) delegates to:

- `libp2p` services in full Helia (Kademlia DHT, PubSub, IPNI, Reframe)
- HTTP delegation in `@helia/http`

## BlockBrokers in ManaMesh

See `skill:manamesh-assets` — ManaMesh uses a `HTTPFallbackBlockBroker` strategy: tries Bitswap first (P2P), falls back to HTTP gateways. This is configured in `packages/frontend/src/assets/ipfs-loader.ts`.

## Custom Hashers

Helia supports custom CID hashers (default: SHA-256). Create a hasher once, reuse across operations:

```typescript
import { createHelia } from "helia";
import { sha256 } from "multiformats/hashes/sha";
import { identity } from "multiformats/hashes/identity";
import { CID } from "multiformats/cid";

const customHasher = sha256;

// All CID creation defaults to sha256 unless specified
const cid = CID.create(1, "dag-pb", sha256.code, multihash);
```

## Helia Events

```typescript
type HeliaEvents =
  | "start" // node started
  | "stop" // node stopped
  | "error" // error occurred
  | "peer" // new peer connected (helia.libp2p)
  | "block" // block stored/fetched
  | "bitswap:wantlist" // bitswap wantlist changed
  | "bitswap:peers"; // bitswap peer connections changed
```

## HeliaHTTP (Gateway-Only)

`@helia/http` (`createHeliaHTTP`) is a lightweight alternative for browser environments:

```typescript
import { createHeliaHTTP } from '@helia/http'

const helia = await createHeliaHTTP({
  gateways: [
    'https://ipfs.io/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://dweb.link/ipfs/'
  ],
  routers: [
    {     // delegate to public HTTP gateways for provider records
      findProviders: async (cid, options) => [
        { id: 'Qm...', addrs: [/ip4/.../tcp/4001/p2p/Qm.../'] }
      ]
    }
  ]
})
```

Key differences from full Helia:

| Feature               | `createHelia`         | `createHeliaHTTP`        |
| --------------------- | --------------------- | ------------------------ |
| libp2p                | ✅ Full node          | ❌ None                  |
| Bitswap               | ✅ P2P block exchange | ❌ None                  |
| DHT                   | ✅ Kademlia           | ❌ None (HTTP delegated) |
| PubSub                | ✅                    | ❌                       |
| GC                    | ✅                    | ❌                       |
| HTTP Gateway fallback | ❌ (uses Bitswap)     | ✅                       |

## Browser Considerations

### What Works in Browsers

- `createHelia` in browsers via `js-libp2p` (WebSocket, WebTransport, WebRTC)
- `createHeliaHTTP` — gateway-only, no native networking
- **Wanted**: Bitswap over WebRTC (via `libp2p/webrtc-star`)

### What Doesn't Work / Caveats

- **Node.js-only transports** (e.g., circuit relay v1) don't work in browsers
- **Kademlia DHT** in browsers is limited — use `@helia/http` with HTTP routers for provider lookup
- **Helia in web workers** requires `postMessage` serialization of blocks
- **IndexedDB** used for blockstore in browsers (see `blockstore-ipns` adapter)
- `helia.gc()` requires pinning to protect blocks from garbage collection

## ManaMesh Usage

ManaMesh uses **gateway-only** (`@helia/http`) in the browser, with a custom `HTTPFallbackBlockBroker` strategy for block retrieval. See:

- `skill:manamesh-assets` — asset loading with IPFS, three-store IndexedDB cache
- `packages/frontend/src/assets/ipfs-loader.ts` — actual Helia/HeliaHTTP initialization
- `packages/frontend/src/assets/gateway-fallback.ts` — gateway fallback strategy

## CID Manipulation

```typescript
import { CID } from "multiformats/cid";

// Parse CID string
const cid = CID.parse("Qm...");

// CID v1 (with multicodec)
const cidV1 = CID.create(1, "dag-pb", sha256.code, digest);

// Convert v0 ↔ v1
cid.toV0();
cid.toV1();

// CID properties
cid.version; // 0 or 1
cid.codec; // 'dag-pb', 'dag-cbor', 'raw', etc.
cid.multihash; // the hash digest
cid.toString();
cid.toBaseEncodedString(); // base58btc (v0 style)
```

## Constraints / Gotchas

1. **Helia v3+ is ESM-only** — use `import`, not `require()`. Node.js `package.json` must have `"type": "module"` or use `.mjs` extension.
2. **Browser blockstore defaults to in-memory** — persisted blockstore requires `blockstore-ipns` or `blockstore-fs` adapter. In browsers, blocks may be fetched repeatedly if not cached.
3. **GC requires pinning** — without `helia.pins.add(cid)`, `helia.gc()` will sweep blocks you want to keep.
4. **`@helia/http` has no Bitswap** — it cannot serve blocks to other peers, only fetch from gateways.
5. **CID timing** — CID creation is deterministic (content-addressed), no timestamps in the CID itself.
6. **Multihash table** — Helia supports multiple hash algorithms via `multiformats/hashes/`. Default is SHA-256 (code `0x12`).
7. **libp2p version mismatch** — Helia bundles its own libp2p. Don't double-bundle libp2p in the same app.

## Key Files

| File                                               | Purpose                                        |
| -------------------------------------------------- | ---------------------------------------------- |
| `packages/frontend/src/assets/ipfs-loader.ts`      | Helia/HTTP initialization, block broker config |
| `packages/frontend/src/assets/gateway-fallback.ts` | Gateway fallback strategy                      |
| `packages/frontend/src/assets/asset-cache.ts`      | IndexedDB asset cache                          |
| `packages/frontend/src/assets/types.ts`            | Asset loader types                             |
| `packages/frontend/package.json`                   | `@helia/unixfs`, `@helia/http` dependencies    |

## Cross-References

- `skill:manamesh-assets` — how ManaMesh uses Helia for card images and asset packs
- `skill:libp2p` — libp2p is bundled inside full Helia; for NAT traversal, DHT, discovery
