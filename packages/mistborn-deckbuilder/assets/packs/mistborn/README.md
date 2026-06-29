# Mistborn Asset Pack

This is a ManaMesh-compatible asset pack built from the cropped card images.

## Structure

```
mistborn/
  manifest.json          # Root manifest (references all sets)
  market/
    manifest.json
    cards/
      Market_Card-*.png
  missions/
    ...
  lord-ruler/
    ...
  metal-training/
    ...
  character/
    ...
  funding/
    ...
```

## Usage

Load with the frontend asset system:

```ts
import { useAssetPack } from '@manamesh/frontend/src/hooks/useAssetPack';

const pack = useAssetPack({
  type: 'local-directory',
  // or IPFS, or zip
  baseUrl: '/assets/packs/mistborn'   // or the CID
});
```

Then for a card:

```ts
import { useCardImage } from '@manamesh/frontend/src/hooks/useCardImage';

const img = useCardImage(packId, 'Market_Card-Soar');  // id from manifest
```

The different logical decks (market, player starters via metal-training + character, missions, lord-ruler) are separate **sets**.

You only need to load the one root pack — all sets become available.

## Card IDs

Card `id`s in the manifests match the cropped filenames (without extension).

When building `MistbornCard` objects in game state, use matching `id`s so image lookup works.

## Generation

Generated from the individual PNGs you cropped using the standard manifest format.
