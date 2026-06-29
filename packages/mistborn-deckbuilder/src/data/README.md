# Assets & Data

Cropped individual card images and the player training board (provided by user) live in `assets/cards/` and `assets/board/`.

## Image Referencing

- `MistbornCard.imagePath` and `imageCid` point to paths like `market_cards/Market_Card-Soar.png`
- CharacterData has `imagePath`
- Use `getCardImagePath(card)` or `getLocalAssetUrl(...)` from this module
- Training board: `PLAYER_TRAINING_TRACK_PATH`

Paths are relative to `assets/`.

When integrating with Manamesh asset packs / Vite:
- Use `new URL(\`../../../assets/\${path}\`, import.meta.url).href`
- Or build an asset pack manifest that includes these files.

## Current Coverage (from cropped files)
- market_cards/ (~55 cards)
- character_cards/ (Vin, Kelsier, Marsh, Shan + back)
- metal_training_cards/ (8 starter training cards)
- mission_cards/ (8)
- funding_card/
- lord_ruler_challenge_cards/ (36)

Update `cards.json`, `characters.json` etc. with more complete metadata (costs, metals, full effectText, tags) as needed.
