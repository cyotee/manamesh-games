# Mistborn: The Deck Building Game — Product Requirements Document

**Package:** `@manamesh/mistborn-deckbuilder` (proposed)  
**Status:** Draft — Decisions incorporated (Phase 1 planning ready)  
**Source rules:** [`RULES.md`](./RULES.md) (transcribed from `Mistborn_The_Deck_Building_Game_Manual.pdf`)

## Clarifications & Decisions (from requirements review)

The following decisions were captured via direct clarification:

- **Rules-free boundary (Phase 1):** Strict *structural* enforcement only — turns (current player only), zone legality, market always exactly 6 cards, visibility rules. **Zero** Mistborn game rules (burn limits, costs, targeting, combat assignment, etc.). Players remain responsible for legality.
- **Crypto:** Full mental-poker (key exchange → commutative encryption → shuffle + proofs) from the beginning, matching the OnePiece pattern. Includes setup phases before play.
- **Solo/Co-op:** Full visual Lord Ruler board elements (Dominance track, health dial, deck) are present and rendered. LR resolution actions (drawing Adversaries/Edicts, placing Adversaries) are **not** interactive or automated in Phase 1.
- **Non-card state modeling:** Scalars + rich UI components for Training position, metal burn/flare state, mission cube positions, health, Target, etc. (no first-class token entities in zones for M1).
- **Upkeep helpers:** Provide a small set of convenience moves even in Phase 1: “Draw 5”, “Cleanup + Draw”, “Refill Market”.
- **Card data:** As complete as possible from the start. Include full structured data we will need for Phase 2 rules enforcement: ID, name, cost, metals (primary + additional), cardType, defense, pairing, effect text, structured tags/keywords (pull, soothe, cloud, savant, off-turn, etc.), and any other fields visible in the manual. Use ~12-25 representative cards initially.
- **Card IDs:** Simple sequential + name-based (e.g. 'market-001', 'vin-iron-training'). Manually transcribed from manual/scans into JSON.
- **Packaging:** Implementation lives as a standalone workspace package (`packages/mistborn-deckbuilder/`) like `onepiece` or `timestreams`.
- **UI interaction model:** Mixed with strong buttons — drag for core movements (cards between zones, cubes), but prominent action buttons for complex operations (Burn specific metal on this card, Buy this market card, Rotate for sideways, Declare/assign combat).
- **Combat in rules-free:** System auto-sums available combat from played cards + effects. Player only decides targets/assignment manually.
- **Implementation priority:** Market + core player card zones (hand/play/discard/deck) first, then training/metals, missions, combat/target, LR visuals.
- **Metal state modeling:** Explicit `Metal` enum + `MetalState[]` (with `burned`, `flared`, optional `attachedToCardId`) per player.
- **Setup:** Guided but mostly automatic — simple character choice UI, automatic or simple selection for the 3 missions, starting health/boxing/Target bonuses applied automatically per the rules.
- **Main play phase structure:** Freeform actions allowed repeatedly in the main phase until the player explicitly ends the phase or turn (matches “in any order, any number of times”).
- **Image / asset strategy:** Reference crops + manual metadata — manually crop representative individual cards from the provided sheet scans into `assets/`. Use those plus a JSON manifest.
- **M1 scope (playable end-to-end):** Complete one full game cycle including crypto setup, multiple turns exercising all core actions, market refills, deck reshuffles, and reaching a win condition (players can manually declare victory).
- **Lord Ruler deck in co-op visuals:** Shared visible LR deck zone (face-down with count). A “Draw LR card” action reveals the top publicly so players can manually apply the effect.
- **Undo / history:** Full replay / scrubber — record complete game history (leveraging proof chain) and allow reviewing/scrubbing the game state.
- **Manamesh integration:** Custom rendering needs — expect to use detailed `ZoneLayoutConfig` and/or Phaser for the complex shared board (tracks, dials, multi-zone player areas) + rich per-player layouts.
- **Card effects representation:** Full printed effectText + rich structured tags/keywords only (e.g. ['pull', 'savant:+2combat', 'offturn:cloud-3']). No complex ability objects in Phase 1.
- **Metal state modeling:** Explicit `MetalState` interface per metal: { metal, burned, flared, attachedTo?: cardId }. Exactly 8 per player in state.
- **Mission points:** Effects grant points into a pool. Separate 'SpendMissionPoints(missionId, amount)' action to advance cubes manually.
- **Upkeep helpers:** Expanded set including combat declaration/assignment and metal refresh (in addition to Draw5, CleanupAndDraw, RefillMarket, EndTurn).
- **Character & mission data:** Full structure — characters with signature metal + level abilities + atium effect (text + tags); missions with per-step rewards, first-player bonuses, top reward.
- **Structural validation (Phase 1):** Block moves that violate structural rules (wrong zones, insufficient 'coins' for buy, etc.). Show warnings (not blocks) for game-rule violations (e.g. exceeding burn limit).
- **Replay + LR deck:** Record all moves for full replay/scrubber. LR deck is a shared visible zone; 'Draw LR Card' reveals top publicly for manual resolution by players.

---

## 1. Overview

Mistborn: The Deck Building Game is a competitive (2–4 player) deckbuilder based on Brandon Sanderson’s Mistborn novels. Players build personal decks by acquiring Market cards powered by Allomantic metals, advance on shared Mission tracks, manage health and combat via the Target mechanic, and progress personal Training tracks that unlock extra metal burns and character abilities. The game also supports solo and cooperative play against the Lord Ruler.

This PRD specifies a **two-phase implementation** on the ManaMesh platform:

1. **Phase 1 (Rules-Free Board & Card Management)**: A faithful digital tabletop / card management layer with **strict structural enforcement** (current-player turns, zone legality, market always exactly 6 cards, visibility) but **zero game-rule enforcement**. 
   - Play uses a **freeform main phase** (actions in any order, any number of times) until the player ends the phase/turn.
   - UI is **mixed**: drag for movement (cards, cubes), strong buttons for complex actions (Burn specific metal, Buy, Rotate for sideways metal use, Combat declaration/assignment).
   - Includes full mental-poker crypto setup phases (matching OnePiece).
   - Provides small upkeep helpers (“Draw 5”, “Cleanup + Draw”, “Refill Market”).
   - Players are responsible for following the actual Mistborn rules.

2. **Phase 2 (Rules Enforcement & Configuration)**: Add full game configuration (character selection, mission selection, player count bonuses), strict move validation, turn structure enforcement, resource accounting (coins, metals, combat pools), win condition detection, and guided prompts.

The implementation will follow the proven patterns from `@manamesh/onepiece` (per-player decks, deck plugin, zones, visibility, proof chain, crypto integration where valuable) and the GameModule contract in `@manamesh/frontend`. It will reuse the shared `DeckPlugin` heavily for card zone operations.

Target: **2–4 players** for competitive; 1–4 players for solo/co-op.

---

## 2. Goals

### Primary Goals (Phase 1)

- Deliver a **playable digital game board** that visually represents the full Mistborn table (Market row, Mission tracks with colored cubes, per-player areas with Training tracks + metal token positions, character cards, ally rows, health dials, hand, play area, discard, deck, supplies for Atium/Boxings, Target standee, eliminated pile).
- Provide **robust card management** using the ManaMesh deck plugin: draw 5, play to table (vertical or sideways for metals), move between zones (hand ↔ play ↔ discard ↔ deck), buy (market card → player discard + refill), eliminate, shuffle on empty deck, market refill.
- Support **non-card state management** in a synchronized way using scalars + rich UI: advance training cubes, grant/spend mission points then advance cubes, adjust health, explicit MetalState (burned/flared/attached), spend Boxings for coins, pass/hold the Target, auto-sum + manual-assign combat.
- Full **P2P multiplayer** via boardgame.io + existing transport (join codes, libp2p, mDNS).
- Reuse existing Manamesh infrastructure (GameModule, deck plugin, visibility model, proof chain, asset loading, CryptoPlugin).
- Clean separation: pure logic/state in `src/`, UI in `src/board/`.
- **Custom rendering**: Use detailed `ZoneLayoutConfig` and/or Phaser for the complex shared tracks, dials, market, player areas, and token/cube visualization.
- **UI**: Mixed drag + strong buttons for core manual actions.
- Full replay/scrubber support.
- Reference crops + manual metadata from the provided sheet scans.
- Card data as complete as possible (full text + tags, character/mission data too).
- Structural validation blocks bad moves; warns on game-rule issues.

### Phase 2 Goals

- Game configuration UI/flow (choose characters, select 3 missions from 8, player count, solo/co-op toggle).
- Enforcement of core rules (burn limits from training position, coin costs, once-per-turn abilities, legal combat targeting with Defender/Target/Cloud logic, mission point spending, training advances, Ally defeat on defense threshold, etc.).
- Turn structure phases or strict move gating that mirrors the official turn order.
- Win condition detection and end-of-game flow (all three missions, last player alive, 4 Atium on Confrontation; solo/co-op Lord Ruler defeat or deck-out loss).
- Helpful on-screen prompts that explain actions and surface decisions (similar to planned Timestreams M2/M3).
- Full support for solo and cooperative Lord Ruler mode (interactive Adversary placement + shield damage, Edict resolution, Dominance advancement, market clears, collective damage). Phase 1 only shows the visual LR board.

### Non-Goals (at least initially)

- Full high-fidelity individual card art extraction and asset-pack creation in Phase 1 (use sheet photos + text overlays or cropped placeholders; proper asset packs in follow-up).
- Complete card effect implementation in Phase 1 (metal requirements, primary/secondary abilities, Savant, off-turn, Ally ongoing, character abilities). Cards are “dumb” objects that players activate manually.
- On-chain settlement or token backing (off-chain P2P only, like current Timestreams).
- 5+ player support.
- Advanced AI or solo bot in Phase 1.

---

## 3. Game Model (Digest of RULES.md)

### Core Physical / Logical Elements

**Per-player private or owner-known state:**
- Personal 10-card starting deck (4 character Training cards + 6 Funding) that grows via purchases.
- Hand (5 cards), face-up Discard, Play area.
- Training Track + cube position (controls burn limit + unlocks + Atium).
- 8 physical metal tokens (one of each: Pewter/Tin, Bronze/Copper, Zinc/Brass, Iron/Steel) that move on/off the track when Burned/Flared/Refreshed.
- Health dial (start 36 + bonuses, max 40).
- Character card (unlocked abilities appear progressively).
- Allies played horizontally above the character (stay until defeated).

**Shared board elements:**
- Market: face-up row of exactly 6 cards (refill immediately on buy or elimination).
- Market deck (face-down).
- Boxing tokens (buy for 2 coins; spend for 1 coin later — unlimited).
- Atium tokens (gained from track/Missions; single-use wild metal + special powers).
- 3 active Mission cards (chosen at setup). Each has a track; players place colored cubes. Cubes start on the right-side image (not “on track”).
- Eliminated pile (public, shared).
- Target standee (3–4 player games only; starts with last player clockwise).

**Turn flow (high level, for enforcement later):**
1. Advance 1 on Training track.
2. Main actions in any order (play cards, burn metals, use cards as metals, refresh, activate ally/char effects, spend mission points, buy, etc.).
3. Combat phase: assign damage (Allies first, then Target holder in multi-player).
4. Cleanup + draw 5.

**Win conditions (competitive):**
- Reach top of all 3 Missions.
- Be the last player with health > 0.
- Play 4 Atium on the Confrontation card.

**Solo/Co-op differences:** No Target. After each player turn, resolve top Lord Ruler card (Adversary placed in front of drawer with shields, or Edict that advances Dominance, heals LR for incomplete missions, clears market cards). Players deal combat to LR/Adversaries instead of each other.

### Key Card Concepts (for UI representation)

- **Action cards** (vertical): primary metal + effect, optional additional metals, metal vial on right (pairing), Savant (when used sideways), occasional off-turn abilities.
- **Ally cards** (horizontal): Defense value, associated metal (passive if you are burning it), possible additional/ongoing effects.
- **Funding cards**: Coin only, starting deck only.
- Using a card sideways = using it as one of its two metals (does not count against burn limit).

Metals, Atium, and certain abilities enable powerful secondary effects and Savants.

---

## 4. Architecture & Code Reuse

Follow the GameModule pattern exactly (see `@manamesh/frontend/src/game/modules/types.ts` and onepiece implementation).

### 4.1 Core Interfaces to Implement

- `GameModule<MistbornCard, MistbornState>`
- `CardSchema<MistbornCard>`
- `ZoneDefinition[]` (extensive use of the shared `DeckPlugin`)
- `initialState`, `validateMove` (structural only in M1 — turns, zones, visibility, market size, coin affordability for buy; game rules in M2), with warnings for rule violations, `getBoardgameIOGame`
- Optional `zoneLayout?: ZoneLayoutConfig` for custom positioning of tracks, missions, health, etc.

### 4.2 Heavy Reuse

- **Deck plugin** (`@manamesh/frontend/src/game/plugins/deck.ts`): `draw`, `moveCard`, `moveTop`, `shuffle`, `count`, etc. for all card zones. Define zones for `deck:<pid>`, `hand:<pid>`, `discard:<pid>`, `play:<pid>`, `market` (shared), `eliminated` (shared), possibly per-player ally areas.
- **Crypto / visibility** (full mental-poker like OnePiece):
  - Complete setup flow: key exchange → per-player commutative encryption of decks → commit-reveal shuffle + proofs.
  - Cooperative decryption on draws.
  - Market cards are always public.
  - Drawn cards become owner-known.
  - Full crypto setup phases are part of Phase 1 (before entering play).
- **Proof chain** for auditable log of moves.
- **Asset system**: `useAssetPack`, image loading hooks. Use provided scans + minimal metadata JSON for Phase 1.
- **boardgame.io** phases for setup vs play (M1 very loose; M2 structured).

### 4.3 Additional State Outside Pure Zones

Many elements are **not cards**:
- Training progress + unlocked abilities + current burn limit per player.
- Metal token locations (on track / burned on specific cards / flared).
- Mission cube positions (per player per mission).
- Health values + max.
- Coin economy this turn (aggregated from Funding, effects, Savants, Allies, Boxings spent).
- Combat pool declared at end of turn.
- Target holder.
- Current Market refill source.
- Lord Ruler state: shared visible deck (count + draw-to-reveal action for manual resolution), dominance track, health. No automated effects in Phase 1.

The state model will combine:
- `zones` (for everything that is cards) managed via deck plugin.
- Additional top-level fields for tracks, dials, metals, missions, economy, etc.

---

## 5. State Model (Sketch)

See `src/types.ts` (to be created).

```ts
export interface MistbornCard extends CoreCard {
  // Game-specific — as complete as possible from the start for future rules enforcement
  // ID scheme: simple sequential + name-based (e.g. 'market-001', 'vin-iron-training')
  cost: number;
  metal?: Metal | Metal[];                 // primary requirement(s)
  additionalMetals?: Array<Metal | Metal[]>; // for cards with multiple extra costs
  pairing?: [Metal, Metal];                // vial on right side for using as metal
  cardType: 'action' | 'ally' | 'funding' | 'character-starter' | 'confrontation';
  defense?: number;                        // allies only
  effectText?: string;                     // full printed text
  tags?: string[];                         // structured keywords only (no objects): 'pull', 'soothe', 'cloud', 'savant:+2combat', 'offturn:cloud-3', 'defender', etc.
  // Future: structured ability objects for Phase 2
}

export type Metal = 'pewter' | 'tin' | 'bronze' | 'copper' | 'zinc' | 'brass' | 'iron' | 'steel' | 'atium';

export interface PlayerBoardState {
  playerId: string;
  character: string;                 // e.g. "Vin", "Kelsier"
  trainingPosition: number;          // 0-based steps advanced
  burnLimit: number;                 // 1–4 derived from track
  unlockedLevels: number;            // character abilities
  health: number;
  metals: MetalState[];              // array of 8: {metal, burned, flared, attachedTo?: cardId}
  missionPoints: number;             // pool granted by effects
  missionCubes: Record<string, number>; // missionId -> position (or special start)
  hasTarget: boolean;
  // coinsThisTurn calculated on demand or tracked
}

export interface MistbornState {
  players: Record<string, PlayerBoardState>;
  playerOrder: string[];
  currentPlayer: string;

  // Card zones (powered by DeckPlugin)
  zones: Record<string, Record<string, MistbornCard[]>>;

  // Shared
  market: string[];                  // 6 card ids currently visible (order matters)
  marketDeckCount: number;
  boxingsAvailable: number;          // or use a zone for tokens
  atiumAvailable: number;
  eliminated: MistbornCard[];
  selectedMissions: string[];        // 3 mission ids

  targetHolder?: string;             // playerId or null (removed when 2 players left)

  // Co-op only
  isCoop: boolean;
  lordRuler?: {
    health: number;
    dominance: number;
    deckCount: number;
    adversaries: Record<string, AdversaryState>; // keyed by player they are in front of
  };

  phase: 'setup' | 'play' | 'combat' | 'scoring' | 'gameOver' | ...;
  winner?: string | 'lord-ruler-defeated' | null;

  // Crypto / audit (reuse patterns)
  crypto?: CryptoPluginState;
  cardVisibility: Record<string, any>;
  proofChain: any[];
}
```

**Zones (initial proposal):**
- `deck:<pid>` (hidden/owner-known, ordered)
- `hand:<pid>` (owner-only)
- `play:<pid>` (public; supports orientation/rotation)
- `discard:<pid>` (public, ordered)
- `allies:<pid>` (public; horizontal display)
- `market` (shared, public, fixed 6)
- `eliminated` (shared, public)

Additional non-card “zones” or visual elements (Training track, Mission tracks, metal supply, health dials, boxings, atium, Target) will be rendered from top-level state.

---

## 6. Milestones

### Milestone 1 — Rules-Free Game Board + Card Management (Core Deliverable)

- Full visual table layout (shared top area + 2–4 player areas around it).
- All major card operations via deck plugin + explicit moves: draw 5, play card (normal or sideways), return to hand/discard, buy from market (moves card + auto-refill or manual button), shuffle on empty, eliminate.
- Manual but synchronized controls for:
  - Advance training (button or drag cube)
  - Burn / Flare / Return metals (move tokens or toggle state + visual placement on cards)
  - Use card as metal (rotate 90° in play)
  - Move mission cubes / assign points
  - Adjust health
  - Buy & spend Boxings
  - Pass Target
  - Declare combat amount + assign to allies / target
- Basic turn passing + “end main phase / go to combat / end turn” flow.
- Market always shows exactly 6 (refill action or automatic on buy/elim in UI).
- 2–4 player competitive mode fully playable end-to-end via manual enforcement.
- Setup: Guided but mostly automatic (character choice UI + auto bonuses, simple mission selection). Full character abilities + mission rewards data.
- Full mental-poker crypto phases (key exchange, encrypt, shuffle) as part of initial game cycle.
- Board uses mixed drag + strong action buttons + custom rendering (ZoneLayout + possible Phaser).
- Expanded upkeep helpers: Draw5, CleanupAndDraw, RefillMarket, EndTurn + combat declaration/assignment + metal refresh.
- Card metadata as complete as possible (full effectText + structured tags only; no ability objects yet). Full character + mission data structures too. Use ~12-25 cards initially.
- Full replay/scrubber support via proof chain + history. Record all moves.
- Combat: auto-sum from played cards; player assigns via UI.
- Mission points: effects grant to pool; separate spend/advance action.
- Structural validation: block invalid zone/coin moves; warn (don't block) on burn limits etc.
- Vitest coverage for zone operations, initial state, basic move application.
- Exit criteria: 2–4 players can connect P2P, complete a **full game cycle** including crypto setup (key exchange → encrypt → shuffle), guided setup (characters + missions + full data), multiple freeform turns (with expanded helpers), card play/buy, explicit MetalState burn+attach, mission point grant+spend, auto-sum combat assignment, market refills, deck reshuffles, and reaching a win condition. Players may manually declare victory. Full replay/scrubber + structural validation active. Visual LR board + shared deck with manual reveal present (no auto effects).

### Milestone 2 — Rules Enforcement & Configuration

- `MistbornConfig`: characters per seat, selected missions, isCoop, playerCount.
- Strict `validateMove` + boardgame.io phases that enforce:
  - Burn limits from training position
  - Legal metal usage (tokens + sideways cards)
  - Coin total calculation from played cards + effects + boxings
  - Combat must be assigned correctly (Allies first, Target holder, Defenders, Cloud reactions)
  - Ally defeat thresholds
  - Mission point assignment rules
  - One-time vs permanent rewards applied automatically when thresholds crossed
  - Turn order and cleanup/draw
- Automatic win detection and end game.
- Configuration screen before match start.
- Full Lord Ruler mode (post-turn card draw from LR deck, Adversary placement & shield damage, Edict resolution, Dominance, healing for incomplete missions, market clears).
- On-screen prompts and move legality feedback.
- Proper handling of off-turn abilities (Cloud, etc.) as special moves.
- Expanded tests: scripted games, edge cases (Flaring, multiple metals, Target passing, Defender protection, co-op collective damage).

### Milestone 3 (Future)

- Real card data + effects implementation (or data-driven ability engine).
- High-quality extracted/individual card images + proper asset pack.
- Advanced UI (fan hands, nice metal token components, dial graphics, history log).
- Better solo experience / automation helpers.
- Integration into main registry + lobby.

---

## 7. Board & UI Requirements (Phase 1)

The board must make the game instantly recognizable from the physical product.

**Shared area (top/center):**
- 6-card Market row with costs visible, easy “buy” action.
- 3 Mission cards laid out horizontally, with track graphics and colored cubes that can be dragged or advanced via + buttons per player.
- Supply piles: Atium, Boxings.
- Eliminated pile (viewable).
- Lord Ruler dominance card + dial (co-op only, collapsible).

**Per-player areas:**
- Character card (large, with ability boxes that light up when unlocked).
- Training track (horizontal or arc) with  metal token “parking” spots above it. Cube position. Burn limit indicator.
- Health dial (graphic or numeric + buttons).
- Ally row (horizontal cards above or beside character).
- Play area (cards can be oriented vertical or horizontal; metals placed on them visually).
- Hand (fan or row; owner only).
- Deck (face down count + draw button) and Discard (face up, top card visible).
- Personal metal token display when not burned.

**Global / turn UI:**
- Current player highlight + turn structure stepper.
- Action toolbar: “Draw 5”, “Buy from Market”, “Refill Market”, “End Turn”, etc.
- Combat declaration panel (slider or buttons for damage, target selection).
- Crypto transparency panel (if crypto active).
- Target standee indicator (who holds it).

Use React for the board (like Poker or planned Timestreams). Leverage Phaser only if complex token physics or fancy layout is desired later.

---

## 8. File Layout (Mirror Timestreams / OnePiece)

```
packages/mistborn-deckbuilder/
  PRD.md
  RULES.md
  reference/Mistborn_The_Deck_Building_Game_Manual.pdf
  assets/                    # existing scans + extracted crops later
  package.json               # @manamesh/mistborn-deckbuilder
  tsconfig.json
  vitest.config.ts
  src/
    index.ts
    types.ts
    zones.ts
    metals.ts                # metal helpers, burn/flare/refresh logic + MetalState
    missions.ts              # track helpers + reward data
    training.ts
    combat.ts                # targeting helpers (M2) + assignment
    characters.ts            # full character data
    data/
      cards.json             # complete card defs (12-25 + schema)
      characters.json
      missions.json
    visibility.ts            # (adapted)
    proofChain.ts            # (adapted)
    crypto.ts                # full mental-poker setup (like onepiece)
    game.ts                  # MistbornGame + MistbornModule
    board/
      MistbornBoard.tsx
      components/
        TrainingTrack.tsx
        MissionTrack.tsx
        Market.tsx
        MetalToken.tsx
        HealthDial.tsx
        ...
    # tests alongside
```

`package.json` should follow the onepiece pattern as a standalone workspace (workspace deps on `@manamesh/boardgameio-crypto`, `@manamesh/frontend`, `boardgame.io`). The package will be registered in the main frontend game registry later.

Register the module in the main frontend registry once complete.

---

## 9. Testing Strategy

- Unit tests for pure helpers (metal state transitions, mission advancement, coin aggregation, target logic, shuffle/draw via plugin).
- Integration tests that drive a full (scripted) game through setup → several turns → win condition using the boardgame.io test utilities.
- Manual P2P playtests (2p, 3p, 4p, co-op).
- Phase 1 tests focus on “does the board let me do the physical action correctly and keep state in sync”, including expanded helpers, MetalState, mission points pool, structural validation, and full replay recording.
- Phase 2 adds negative tests for illegal moves.

---

## 10. Asset & Data Strategy

- **Phase 1**: Use reference crops from the high-resolution sheet scans + the individual PNGs in `assets/`.
  - Manually crop representative individual cards (and board elements like training track, dials, tokens).
  - Card data JSON is **as complete as possible** from the start: ID, name, cost, metals (primary + additional), pairing, cardType, defense, full effectText, structured tags/keywords only (e.g. 'pull', 'savant:+2combat', 'offturn:cloud-3', 'defender'). Include full character abilities + mission reward structures too.
  - Effects represented as text + tags (no complex ability objects in Phase 1). This data model should need only additions when moving to Phase 2.
- Later: proper per-card image extraction + asset pack manifest (card_face, token, playmat, etc.) with `idFormat: 'custom'` or set/collector style.
- All card data should be data-driven so adding the full 82 market + starters + LR cards is straightforward.

---

## 11. Open Questions & Future Work

- Detailed interaction design for attaching burned metals (MetalState) to specific cards (with mixed drag+buttons UI).
- Exact number of representative cards to crop and fully transcribe for initial M1 (balance coverage vs effort) — aim for good coverage of each metal pair.
- How much of Lord Ruler resolution (Adversary shields, step-by-step Edicts) to make interactive in late M1 vs keep fully manual.
- Whether to surface combat source breakdown in the auto-sum UI.
- Priority order for adding visual polish (nice dials, token graphics, track animations) vs core logic.

---

**Next after review**: Implement Phase 1 following the file structure and GameModule contract. Start with complete card/character/mission schema + data files, MetalState, zones, crypto setup flow, guided setup, freeform main phase with mixed UI + expanded helpers, structural validation + warnings, custom board layout, full replay recording, and a complete game cycle.

This PRD will be updated as design decisions are made during implementation.