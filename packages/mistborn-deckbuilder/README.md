# Mistborn Deck Builder (Manamesh Module)

Rules-free Phase 1 implementation for testing.

## Quick Test (no server needed)

In the main frontend app:
- Run `yarn workspace @manamesh/frontend dev`
- Click "🚀 Quick Test Mistborn (Rules-Free Demo)" button
- Or select the game from the selector.

The board runs in standalone demo mode with local state:
- Click market cards to buy (adds to current hand)
- Click hand cards to play them
- Click played cards to toggle sideways (metal use)
- Use buttons for cleanup, advance training, simulate combat
- Switch players, reset demo

All data and images come from the enriched asset pack.

## Deploy to Vercel

The demo is fully client-side.

1. Build the frontend: `yarn workspace @manamesh/frontend build`
2. Deploy the dist/ to Vercel.
3. The mistborn board will be available via the quick test button or game selector.

**Asset notes**: Images are referenced under /assets/. Make sure your Vite config or Vercel build copies the assets from the mistborn package (or configure `assetsInclude` / public dir).

## Usage in full game

When launched through the normal P2P flow, the board receives G/ctx/moves and can use real state.

The module supports passing `packCards` in initial state for enriched data.

## Current Focus
- Rules-free (players enforce rules)
- Asset pack with full metadata
- Training track + cubes
- Market, hand, play, discard, missions, health simulation

See PRD.md and RULES.md for details.
