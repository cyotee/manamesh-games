# Mistborn Deck Builder - Rules-Free Testing Instructions

This document covers how to test the rules-free (Phase 1) version of the Mistborn Deck Builder module for Manamesh. This version focuses on board visualization, card management, asset loading (from bundled assets, local filesystem, or IPFS), and manual interactions without any rules enforcement.

**Important**: This is the rules-free testable version. All "rules" (e.g., legal burns, coin costs, targeting) are handled manually by the tester. The board provides structure and visuals only.

## Prerequisites
- The monorepo is set up (run `yarn install` from the root if not already done).
- Node.js >= 20.
- For IPFS testing: IPFS CLI or gateway access, or a local IPFS node.
- For full P2P testing: modern browser supporting WebRTC.

## Quick Standalone Demo (Recommended for Fast Testing)
This is the easiest way to manually test without any server or P2P setup. It uses a self-contained React demo with local state.

1. From the repo root:
   ```
   yarn workspace @manamesh/frontend dev
   ```
   The app starts at http://localhost:5173 (or similar).

2. In the browser:
   - Go to the game selector.
   - Click the **"🚀 Quick Test Mistborn (Rules-Free Demo)"** button.
   - This launches directly into the Mistborn board in demo mode.

3. In the demo board:
   - **Asset Source Switching** (top bar):
     - Default: Bundled/local assets (works for Vercel deploys).
     - Click "Load from IPFS CID" to enter a CID (e.g., from `ipfs add -r assets/packs/mistborn`).
     - "Use bundled/local" resets to default.
   - **Market**: Click cards to "buy" (adds to current player's hand, auto-refills market).
   - **Missions**: Click a mission to simulate spending a point (advances training).
   - **Per-Player Areas**:
     - Training Track with movable cube (click "Advance Training" or the cube area).
     - Health display + Target Holder indicator.
     - Hand: Click to play a card (normal or sideways for metals). Right-click to eliminate.
     - Play Area: Click cards to toggle sideways (metal use simulation).
     - Discard: View eliminated cards.
     - Quick actions: Cleanup + Draw, Simulate Combat, Pass Target.
   - **Player Switching**: Use "Switch to P1/P2" buttons to simulate turns.
   - **Reset Demo**: Resets state for a fresh test.
   - **Combat/Target Simulation**: Use buttons to simulate damage. Pass the Target between players.

4. Tips for manual testing:
   - Simulate full turns: Buy → Play cards → Burn metals (advance track) → Cleanup/Draw → Combat.
   - Test different starters: The demo seeds from the pack's "starters" set (metal-training + characters + funding).
   - No enforcement: You can "cheat" (e.g., over-burn metals) to explore board behavior.
   - Multiple players: Switch players to test shared elements (market, target, missions).

This mode requires **no backend** and is ideal for quick iteration or Vercel deploys (assets are bundled).

## Full Integration Testing (with boardgame.io Client)
Use this for P2P or local multiplayer simulation with real state management (still rules-free).

1. Start the dev server as above.

2. In the game selector:
   - Select "Mistborn Deck Builder (Rules-Free)".
   - Choose "Local" or "Online" (P2P) mode.

3. For Local:
   - The game starts with the Mistborn board.
   - Use the client's controls for player switching if needed.
   - Interactions fall back to demo-style if no full moves are wired yet.

4. For Online (P2P):
   - Host creates a game.
   - Join via join code (WebRTC P2P, no server required for gameplay).
   - State syncs via boardgame.io (hands, market, training, etc.).
   - Use the source switcher in the board to load assets from IPFS if desired.

5. Initial State:
   - Decks are seeded from the asset pack (starters from metal-training/character/funding sets; market from market set).
   - Use the pack's metadata for visuals and basic info.

## Asset Pack Loading (IPFS, Local, Bundled)
Assets are organized in `assets/packs/mistborn/` with per-set manifests (market, metal-training, etc.).

- **Bundled (default for Vercel)**: Included in the frontend build. Use `DEFAULT_MISTBORN_PACK_SOURCE`.
- **Local Filesystem**: In the demo board, use the source switcher or pass a custom `packSource` prop:
  ```ts
  const source = { type: 'local-directory', baseUrl: '/path/to/your/mistborn-pack' };
  <MistbornBoard packSource={source} />
  ```
  Or use Manamesh's `loadLocalDirectory` for dynamic loading.
- **IPFS**:
  1. Publish the pack: `ipfs add -r --wrap-with-directory assets/packs/mistborn`
  2. Note the CID.
  3. In the board: Click "Load from IPFS CID" and enter it (uses `ipfs` or `ipfs-zip` source).
  4. Or programmatically:
     ```ts
     const source = { type: 'ipfs', cid: 'your-cid-here' };
     const pack = useAssetPack(source);
     ```
  - The loader resolves nested sets and caches images.
  - Falls back gracefully if CID is invalid.

All cards include enriched metadata (cost, metal, tags, effectText) from the manifests.

## Running Tests
- Unit tests: `yarn workspace @manamesh/mistborn-deckbuilder test`
- The demo board itself serves as the primary "test" for rules-free behavior (no enforcement logic yet).
- For integration: Launch via the main app as described and manually verify state (e.g., cards move between zones, training advances, market refills).

## Common Issues & Tips
- **Assets not loading**: Ensure `getLocalAssetUrl` resolves correctly. For custom deploys, adjust `baseUrl`.
- **No cards in demo**: The pack must load successfully. Check console for errors. Use "Reset Demo".
- **P2P not connecting**: Use the main app's P2P lobby. Join codes work cross-browser.
- **Rules-free nature**: Expect no validation (e.g., you can "buy" without coins). This is intentional for Phase 1 testing.
- **IPFS slowness**: Use a local IPFS node or gateway for faster testing.
- **Vercel Deploy**:
  1. Build the frontend: `yarn workspace @manamesh/frontend build`
  2. Assets are bundled (from `assets/packs/mistborn`).
  3. Deploy to Vercel (use the quick test or game selector).
  4. For IPFS assets on Vercel: Switch source in the board UI.
- **Debugging**: Open browser console. State is logged in moves. Use React DevTools for demo state.

## Next Steps After Testing
Once the rules-free version is validated:
- Deploy to Vercel for shared testing.
- Publish pack to IPFS for production.
- Proceed to rules engine (enforcement, phases, full moves, win conditions).
- Add co-op (Lord Ruler) visuals.

For questions or to contribute, refer to PRD.md and RULES.md in this package.

This version is tagged as `mistborn-rules-free-v0.1.0` for reference.
