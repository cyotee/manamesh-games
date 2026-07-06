# ManaMesh Asset Pack Builder

Browser-based (static SPA) tool for scraping card images and building ManaMesh-compatible asset packs. It is designed to be published to IPFS so users can run the entire scraper + builder with zero installation.

This is the client-side / IPFS version of the card image scraping functionality (the Python version lives in `packages/manamesh/tools/card-scraper`).

## Features

- Scrape card images directly in the browser (MTG via Scryfall public API)
- Build/repair asset packs from local image folders
- Generate correct root + per-set `manifest.json` files
- Write directly to your filesystem (File System Access API) or export as a single ZIP
- Fully static — works great when served from IPFS

## Prerequisites

- Node.js ≥ 20
- Yarn (this monorepo uses Yarn 4)

## Running Locally

### From the repository root (recommended)

```bash
# Install all workspace dependencies (only needed the first time)
yarn install

# Start the development server for this package
yarn workspace manamesh-asset-pack-builder dev
```

The app will be available at `http://localhost:5174` (or the next available port).

### From inside the package directory

```bash
cd packages/manamesh-asset-pack-builder
yarn install
yarn dev
```

Open the URL in a modern browser. For the best experience with direct filesystem writes, use a Chromium-based browser (Chrome, Edge, Brave, etc.).

## Using the Tool

### Scrape Images

1. Go to the **Scrape Images** tab.
2. Choose the game (currently MTG via Scryfall is fully supported).
3. Enter set codes, e.g. `LCI,MKM,WOE`.
4. (Strongly recommended) Click **Choose output folder**. This lets the app write images and manifests directly into a folder on your computer using the File System Access API.
5. Click **Start Scrape**.
6. Watch live progress. When finished you can also download everything as a ZIP as a portable backup.

Images are saved in the structure the ManaMesh frontend expects:
```
<SET-ID>/
  manifest.json
  cards/
    <card-id>.jpg
manifest.json   (root)
```

### Build / Package from Filesystem

1. Go to the **Build & Package from FS** tab.
2. Click **Select folder or directory** and pick a folder that contains card images (this can be output from the Python scraper, or your own organized images).
3. Click **Build / Repair Pack**. The tool will scan the images and generate the proper `manifest.json` files.
4. Choose how to export:
   - **Download as ZIP** — creates a single portable file.
   - **Write directly to folder** — writes the complete pack (with manifests) into a folder you choose.

The resulting pack can be loaded by the main ManaMesh frontend.

## Building for Static / IPFS Deployment

```bash
# From repo root
yarn workspace manamesh-asset-pack-builder build
```

The production files will be in `dist/`. Because the Vite config uses `base: './'`, the built app uses only relative paths and can be served from any sub-path or IPFS CID.

To test the static build locally:

```bash
yarn workspace manamesh-asset-pack-builder preview
```

To publish to IPFS:

```bash
ipfs add -r packages/manamesh-asset-pack-builder/dist/
```

Then open the CID via any IPFS gateway.

## Important Notes

- **Filesystem access**: Direct folder read/write requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API), which is only available in Chromium browsers. Other browsers fall back to file/directory upload + ZIP download.
- The scraper uses public APIs (mainly Scryfall). Large scrapes can be slow and memory-heavy in a browser tab.
- This tool complements, but does not replace, the Python `card-scraper` for bulk / production use.

## Development

The app is a standard Vite + React + TypeScript project.

Core logic is in `src/lib/`:
- `scraper.ts` — in-browser scraping
- `pack-builder.ts`, `manifest.ts` — pack scanning and manifest generation
- `fs-access.ts` — File System Access wrappers + fallbacks
- `zip.ts` — in-memory ZIP creation (fflate)

Run the dev server with the commands shown above.

## License

See the root of the repository.