# Design: Medieval + Modern Deck Asset Packs for Timestreams

**Date:** 2026-07-04
**Status:** Approved

## Goal

Add the newly scanned Medieval and Modern Day decks to the Timestreams game by
building them into the existing asset-pack pipeline, matching the fully
processed `stone_age` and `future_tech` sets.

## Context

The Timestreams asset pipeline per deck is:

1. Raw scans in `packages/timestreams/assets/decks/<era>/` (card PNGs + deck
   list txt with quantities).
2. A pack set in `packages/timestreams/assets/packs/timestreams/<set>/` with
   `cards/`, `backs/`, and a `manifest.json` carrying curated per-card metadata.
3. Registration in `assets/packs/timestreams/manifest.json`.
4. `src/deckResolver.ts` `ERA_TO_SET` already maps `medieval → "medieval"` and
   `modern → "modern"`, so no code changes are required.

## Decisions

- **Set directories:** `medieval` and `modern` (matching `ERA_TO_SET`).
- **Card ids:** `medieval-<slug>`, `modern-<slug>` (existing convention, e.g.
  `stone-age-cloth`).
- **Guillotine quantity:** The deck list's `Guillotine - X10` is a typo;
  use quantity 1. Both decks then total exactly 38 cards.
- **Missing modern scans:** `Telecommunications` and `Recycling` were scanned
  and added (`Modern_Age-*.png` prefix) — all 24 modern cards have images.
- **Filename typos:** Pack copies of `Modern_Day-Chaaos_Theory.png` and
  `Modern_Day-Combinaation_Drug_Therapy.png` are renamed to corrected names;
  originals under `assets/decks/` are left untouched.
- **Metadata depth:** Full curation transcribed from each scan: `cardType`,
  `subtypes`, `addlCardText`, `hasPlayEffect`/`playEffectText`,
  `hasScoreEffect`/`scoreEffectText`, `hasReact`/`reactEffectText`,
  `flavorText`, `scoreValue`, semantic `tags` consistent with the existing
  stone_age/future_tech tag vocabulary, and `quantity` from the deck lists.
- **Out of scope:** `assets/ocr/decks/` intermediates (superseded by direct
  transcription) and the stale `assets/sample-packs/` placeholders.

## Deliverables

- `assets/packs/timestreams/medieval/` — 26 card fronts, `Medieval-Back.png`,
  `manifest.json` (38 cards total).
- `assets/packs/timestreams/modern/` — 24 card fronts, `Modern_Day-Back.png`,
  `manifest.json` (38 cards total).
- Updated `assets/packs/timestreams/manifest.json` listing both new sets.

## Verification

- Both manifests parse as JSON.
- Quantities sum to 38 per deck.
- Every `front`/`back` path in the manifests resolves to an existing file.
- Every deck-list entry has a matching manifest entry and vice versa.
- `vitest run` in `packages/timestreams` still passes.
