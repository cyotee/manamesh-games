# Timestreams — Product Requirements Document

**Package:** `@manamesh/timestreams`
**Status:** Milestone 1 implementation in progress (Tasks 0–10 complete as of 2026-06-26; Tasks 11–15 + asset pack prep remaining). Full M1 (through Task 15) including real scanned asset packs (OCR + build + real cards instead of placeholders) is the committed priority.
**Source rules:** [`RULES.md`](./RULES.md) (transcribed from `Timestreams_Manual.pdf`)
**Last updated:** 2026-06-26 (asset pack tasks added for scanned decks/era/player aids)

---

## 1. Overview

Timestreams is a competitive, era-themed card game in which each player pilots a
faction deck tied to a historical era (Stone Age → Future Tech) and seeds a shared
six-era timeline with Inventions over six "days." After the timeline is fully
seeded, play resolves into a scoring phase and the player who shaped history most
effectively wins.

This document specifies a P2P, cryptographically-fair implementation of Timestreams
for the ManaMesh platform, built as a pluggable `GameModule` on top of
[boardgame.io](https://boardgame.io) and the shared crypto package, supporting
**2–4 players**.

It follows the architecture already proven by the `@manamesh/onepiece` and
`@manamesh/poker` modules: a rules-structured state manager whose deck operations
are made tamper-proof by mental-poker cryptography, rendered by a React board
component.

### Goals

- Faithful, P2P-playable Timestreams for 2–4 players.
- **Full cryptographic fairness** equivalent to the other ManaMesh games: no player
  (including a deck's owner) can learn or manipulate their shuffled deck order, and
  every draw is verifiable.
- Maximum reuse of existing crypto, module, and UI infrastructure.
- Players are guided by on-screen prompts that explain each action and any decision
  they must make (introduced in M2/M3).

### Non-goals

- 5–6 player support and the associated "discard two cards each age" rule
  (RULES.md Card Draw table footnote). The draw logic is data-driven so this is a
  later config change, not a redesign.
- On-chain settlement (poker's Solidity path). Timestreams is off-chain P2P only
  for now.
- Full 6-era deck coverage in the initial scanned asset pack (only Stone Age and
  Future Tech decks scanned initially; others to follow the same process).

**Real cards now in scope:** User-provided scans of two decks + era cards + player
aids enable full asset pack with real art, names, and OCR-extracted card text.
Placeholders will be replaced. Card effects execution remains M2/M3, but metadata
(text) is loaded for display immediately.

---

## Implementation Decisions & Constraints (2026-06-26)

These decisions were recorded during resumption of work after a prior agent session hit its usage limit. They are the source of truth for the remainder of Milestone 1.

### Primary Focus & Scope
- **Primary artifact:** Timestreams M1 (`PLAN_M1.md` + this PRD + `.superpowers/sdd/` tracking).
- **Priority on this branch:** Complete Timestreams M1 **fully** through Task 15 (lobby integration, board UI, full wiring, module README, and docs). Timestreams is treated as the current active milestone.
- **Workflow:** Hybrid — strict SDD (briefs, reports, ledger updates, path-limited commits) for major architectural tasks (especially Task 11 and later integration work); lighter/pragmatic updates for smaller tasks.

### Technical Constraints & Patterns (boardgame.io + test environment)
- Define `INVALID_MOVE` locally inside modules:
  ```ts
  const INVALID_MOVE = "INVALID_MOVE" as const;
  ```
  (Value-identical to `boardgame.io`'s constant for compatibility.)
- Use **type-only** imports for boardgame.io core types:
  ```ts
  import type { Game, Ctx } from "boardgame.io";
  ```
- **Do not import runtime values** from `boardgame.io/client` (e.g. `Client`) in test files that run under vitest + PnP (especially `game.test.ts`). Instead:
  - Test the exported `TimestreamsGame` object structure directly (`name`, `phases`, `setup`, etc.).
  - Use `TimestreamsGame.setup(...)` or direct function calls for game logic verification.
  - Full client bootstrapping can be exercised in integration or manual E2E.
- `loadDecks` logic is folded into the `setup` phase wiring in Task 11 (no separate task). Placeholder decks are created in `createCryptoInitialState` (Task 6).
- The `voided` phase + `voteAbortReveal` stub **must** be declared and wired in Task 11 (per PRD §5 and the gap note in PLAN_M1.md Self-Review).

### Additional Work Agreed
- The `sha256Hex(seedString)` commit-binding bug (fixed for Timestreams in Task 7 via `hashSeedCommit` + `TextEncoder`) **will be audited and fixed** in both `packages/poker` and `packages/onepiece` as part of this resumption (high value because poker uses on-chain settlement).
  - Quick audit (2026-06-26): `packages/onepiece/src/crypto.ts` already uses `new TextEncoder().encode(...)` for reveal verification and final seed derivation in current code. `packages/poker/src/crypto.ts` does not use the same `commitShuffleSeed`/`revealShuffleSeed` + `sha256Hex(seed)` pattern (it uses a different shuffle flow). Any remaining instances will be hardened to byte encoding.

### Commit & Process Discipline (hybrid)
- Major tasks continue to use path-limited commits for the pre-existing crypto package rename situation:
  `git add <specific timestreams paths> && git commit -m "..." -- <same paths>`
- Update `.superpowers/sdd/progress.md`, create task briefs/reports for architectural steps.
- Smaller follow-on fixes may use normal commits.

These decisions supersede any prior assumptions in the plan documents where they conflict.

---

## Asset Pack & Real Card Data (Post-Scan Tasks)

Scans have been provided in `packages/timestreams/assets/`:

- `decks/stone_age/` and `decks/future_tech/` (full card images + backs + Deck List.txt)
- `era_cards/` (6 era header/column cards)
- `player-aid-cards/` (Scoring and Turn aids)

These will replace all placeholder "Score 1 Point" cards and enable real artwork + text in the UI.

### Metadata Shape (Target Definition)

Before OCR and pack building, we use this well-defined shape for `CardManifestEntry.metadata`. This ensures the pack is directly consumable by the game module, deck resolver, and board.

**For deck cards (in `stone_age`, `future_tech`, etc. sets):**

```ts
interface TimestreamsDeckCardMetadata {
  cardType: 'invention' | 'action';

  /** Subtypes such as "art", "government" (Government = only one per era) */
  subtypes?: string[];

  /** Additional text that does not fit neatly into Play/Score/React (e.g. flavor or intro text). */
  addlCardText?: string;

  /** Optional flavor text to show when appropriate (e.g. in detailed views or card previews). */
  flavorText?: string;

  hasPlayEffect: boolean;
  playEffectText?: string;

  hasScoreEffect: boolean;
  scoreEffectText?: string;

  hasReact: boolean;
  reactEffectText?: string;

  scoreValue?: number;   // only for cards with scoring participation. Omit for Actions.

  tags?: string[];   // see detailed explanation below
}

/**
 * Tags usage (recommended convention):
 *
 * - Plain keywords for categorization/effect type: "move", "destroy", "draw"
 * - Namespaced for specific triggers: "react:move", "react:destroy"
 *
 * The tags field is intended for declarative behavior definition.
 * Game code should centralize evaluation of tags so that new cards
 * can be added primarily by authoring data rather than new code.
 *
 * Recommended style: Use separate, well-named tags for independent
 * aspects (triggers, targets, conditions). This keeps evaluation logic
 * simple and composable.
 *
 * Example:
 *   "tags": ["react:move", "react:opponent", "requires:stone-age-cloth"]
 *
 * Evaluation:
 *   if (hasReactTrigger(card, 'move') && card.tags?.includes('react:opponent')) {
 *     // offer react
 *   }
 */

/** Card text is composed using composeCardText() in this exact order: addlCardText, playEffectText, scoreEffectText, reactEffectText. Flavor text is kept separate (use when appropriate for display). */

/**
 * See RULES_ENGINE_PRD.md for the full specification of the engine that will interpret
 * tags + effect texts in M2 (play) and M3 (score + react).
 */
```

**For era cards (in `era` set):**

```ts
interface TimestreamsEraCardMetadata {
  assetType: 'era';
  era: EraId;          // 'stone' | 'medieval' | ...
  label: string;       // Human label e.g. "Stone Age"
}
```

**For player aid cards (in `aids` set):**

```ts
interface TimestreamsAidCardMetadata {
  assetType: 'playerAid';
  aidType: 'scoring' | 'turn';
  title: string;
  text: string;        // The full aid instructions / rules text
}
```

### Card Type & Ability Representation Strategy

The representation above is designed for easy runtime detection and future rule enforcement / player prompting:

- `cardType` + `subtypes` → basic classification.
- Boolean flags (`hasPlayEffect`, `hasScoreEffect`, `hasReact`) → very fast filtering in hand.
- Discrete effect text fields (playEffectText, scoreEffectText, reactEffectText) for logic and display.
- Full card text is composed on demand using composeCardText() (addlCardText first, followed by Play/Score/React sections).
- `scoreValue` (optional numeric) is only present for cards that score. It is omitted for Action cards and serves as a secondary validation signal.

**Recommended helper functions** (to be implemented in `src/types.ts` or `src/deck.ts`):

```ts
isPlayableInvention(card)   // invention && !hasReact
isPlayableAction(card)      // action && !hasReact
hasReactAbility(card)
isGovernment(card)          // subtypes.includes('government')
hasScoreAbility(card)
```

**How prompting will work (M2+):**

1. **Normal turn (your turn)**:
   - Filter hand → `isPlayableInvention` or `isPlayableAction`.
   - Present two groups of buttons.

2. **React opportunities**:
   - When an event occurs (card is about to be moved, player takes an action, etc.), the engine can call:
     ```ts
     const reactOptions = hand.filter(hasReactAbility);
     ```
   - For each option, inspect its `reactEffectText` (which contains both the trigger conditions and the effect) and prompt the player whether they want to apply the React. Flavor text can be shown separately when desired.

3. **Score phase**:
   - Collect all cards in scoring slots that `hasScoreAbility`.
   - Resolve their `scoreEffectText` in order.

4. **Government rule**:
   - Before allowing placement of a government, check the current era stack for any card where `isGovernment(c)`.

This design makes it trivial to write queries like:
- "Give me all React Actions in my hand"
- "Does this era already contain a Government?"
- "Which cards in my hand have a Play effect I should resolve?"
- "For this React card, what does its `reactEffectText` say the effect is?"

**Androids correction note**:
During metadata preparation / OCR validation, any card that has a non-zero `scoreValue` (or non-empty `scoreEffectText`) but `cardType === 'action'` should be automatically (or manually) flipped to `'invention'`.

**Pack manifest conventions**
- `game`: "timestreams" (will require adding to frontend `GameType` union)
- Root manifest lists `sets`.
- Each set manifest lists its `cards`.
- Card `id`: normalized kebab-case, era-prefixed for decks, e.g. `stone-age-fire`, `future-tech-androids`, `era-stone`, `aid-scoring`.
- `front`: relative path e.g. `cards/Stone Age - Fire.png` (preserve original filenames for images).
- `back`: for deck sets only, e.g. `cards/Stone Age - Back.png`. Era/aids can omit or use a shared back.
- Quantities (e.g. 3x Cloth) are **not** in the manifest — the manifest lists unique card designs. Quantities/ duplicates are handled at deck resolution time (see OnePiece pattern).
- The `name` in manifest entry comes from Deck List.txt + filename/OCR title.

This shape will be used to populate `TimestreamsCard` (with discrete effect fields + addlCardText + flavorText) and for image lookup via `getAssetKey`.

### Tasks

1. **OCR Pipeline**
   - OCR all PNGs (deck cards, backs if text, era cards, player aids) to extract:
     - Card name (primary title)
     - Card type (Invention / Action; Art / Government traits where present)
     - Full printed text (Play effects, Score effects, flavor if any)
   - Tools: Python + Tesseract / easyocr, or vision-capable tool. Cross-reference with `Deck List.txt` for counts and names.
   - Produce structured data matching the shapes above (per unique card).

2. **Build Asset Pack (ManaMesh Standard)**
   - Organize images into standard layout for the asset-pack-builder / loader:
     ```
     timestreams-assets/
       manifest.json                 # root (sets list)
       stone_age/
         manifest.json               # per-set cards + metadata
         cards/
           stone-age-cloth.png
           ...
         backs/
           stone-age-back.png
       future_tech/
         ...
       era/
         manifest.json
         cards/
           stone-age-era.png
           ...
       aids/
         manifest.json
         cards/
           scoring-aid.png
           turn-aid.png
     ```

   Example manifests (with TODOs for real OCR data) are in `assets/sample-packs/`. Copy/adapt the structure and populate real data after OCR.
   - Use `AssetPackManifest` with `game: "timestreams"`, `sets` for decks + era + aids.
   - For each card entry: populate `metadata` exactly matching the Timestreams*CardMetadata shapes defined above.
   - Card IDs: use normalized names from scans + deck lists (e.g. `stone-age-cloth`, `future-tech-nanotech`). Support per-era ownership in game state.
   - Include card backs per deck set (point `back` at the deck's Back.png).
   - Era cards and player aids exposed via asset loader (as `card_face`; future `playmat`/`icon` if we extend `AssetType`). Use dedicated sets for lookup.

3. **Update Card Model & Loading**
   - Extend `TimestreamsCard` (and schema) to carry real metadata from pack (map from the defined shapes):
     - `cardType`, `subtypes`, `addlCardText`, `flavorText`, `playEffectText`, `scoreEffectText`, `reactEffectText` + has* flags
   - Add a `resolveTimestreamsDeck` (or similar to OnePiece `resolveDeckList`) that takes DeckList + loaded pack(s) and produces typed `TimestreamsCard[]` + `cardPackMap`.
   - Replace / augment `createPlaceholderDeck` with real deck builders that load from a `LoadedAssetPack` (select set by home-era).
   - Update `timestreamsCardSchema.getAssetKey` and `create` to pull from pack entries.
   - Update `deck.ts` and crypto initial state / `loadDecks` to use pack-loaded cards (real names, ids, metadata, images) instead of generated placeholders.
   - Ensure `assetRequirements` in `TimestreamsModule` declares required types (`card_face`, `card_back`).

4. **Integration & Display**
   - Board component renders real images via `useCardImage` / asset pack for played cards, hands, timeline stacks.
   - Display card text (name + composed from addl/play/score/reactEffectText, plus flavorText when appropriate) on hover/preview (using metadata from pack).
   - Era column headers use the scanned era cards (load via special asset keys or direct from "era" set).
   - Player aids available as reference (renderable in UI or as separate view; load from "aids" set).
   - Support multi-pack (decks + era + aids) via `cardPackMap` pattern used elsewhere.
   - Update tests to use real (or mocked real) cards from pack where possible; keep placeholder path for unit isolation if needed.

5. **Build / Packaging**
   - Produce a distributable `timestreams-*.zip` asset pack (or IPFS-ready) using the asset-pack-builder tooling (extend if needed for `game: 'timestreams'` and custom metadata). Generate manifests strictly following the metadata shapes above.
   - Document in `packages/timestreams/assets/README.md` or pack README how to rebuild after more scans.
   - Wire into dev flow and lobby/asset management so Timestreams appears as a selectable pack (and can load era/aids assets).

**Exit criteria for this work:** A loaded asset pack provides real images + metadata strictly following the defined Timestreams*CardMetadata shapes (including addlCardText and flavorText) for the two scanned decks + era + aids. Game can deal real cards (names + art + composed text + flavor when appropriate) in crypto setup/play using pack data. Placeholders eliminated for supported eras. Board shows actual card faces and text from metadata. The pack is loadable via the standard asset system.

---

## 2. Game model (digest of RULES.md)

- **Shared timeline / board.** Six **eras** in fixed chronological order:
  `stone → medieval → renaissance → industrial → modern → future`. Each era holds an
  ordered stack of played Inventions. The first **`scoringSlots`** (default **6**)
  positions of an era are its scoring slots.
- **Days = eras.** The game runs six **days**; day _N_ activates era _N_ (day 1 =
  Stone Age … day 6 = Future Tech). Inventions are normally played into the
  **current era** only; only card effects may target another era (M2+).
- **Decks & hands.** Each player pilots one **faction deck** (their "home era,"
  chosen at setup). All six eras appear on the board regardless of player count.
  A player draws from their own deck into a **private hand**; played cards become
  **public** on the timeline.
- **Turn / day flow.** At each day's start every player draws per the Card Draw
  table. Then, starting with the day's first player (rotating in chronological order
  of players' assigned **home eras**), each player on their turn takes exactly one
  action: **play an Invention**
  into the current era, **play an Action** card, or **pass**. When all players pass
  in sequence, the day ends, hands are retained (no max hand size), and the next
  day begins.
- **Scoring.** After day 6, each era is scored in turn (Stone Age first). Within an
  era, only the first six cards score; each card's score effect resolves in slot
  order, complicated by the "Wonky, Unnecessarily Complicated Movement Rule"
  (RULES.md). Cards beyond the scoring slots are discarded.

### Card Draw table (data-driven)

| Players | Cards drawn at start of each day |
| ------- | -------------------------------- |
| 2       | 6                                |
| 3       | 5                                |
| 4       | 4                                |
| 5–6\*   | 4 (out of scope; \* discard two) |

---

## 3. Architecture & code reuse

The module mirrors the file layout and patterns of `packages/onepiece/src`, which is
the closest existing analog (per-player encrypted decks, cooperative decryption,
proof chain, `GameModule` interface, mental-poker setup phases).

### 3.1 Module contract — `@manamesh/frontend`

Implement the platform `GameModule` interface and supporting types from
`packages/manamesh/packages/frontend/src/game/modules/types.ts`:

- `GameModule<TCard, TState>`, `CoreCard`, `CardSchema`, `ZoneDefinition`,
  `GameConfig`, `MoveValidation`, `ZoneLayoutConfig`, `AssetType`/`CardIdFormat`.

Reference implementation to copy/adapt: `packages/onepiece/src/game.ts`
(`OnePieceModule` object — `id`, `cardSchema`, `zones`, `assetRequirements`,
`initialState`, `validateMove`, `getBoardgameIOGame`, `zoneLayout`).

### 3.2 Cryptography — `@manamesh/boardgameio-crypto`

Reuse the mental-poker stack verbatim where possible; adapt the One Piece
`crypto.ts` setup flow.

- **SRA commutative encryption / decryption** from
  `@manamesh/boardgameio-crypto/mental-poker`:
  `encrypt`, `decrypt`, `encryptDeck`, `reencryptDeck`, `decryptDeck`,
  `decryptToCardId`, `buildCardPointLookup`, `getCardPoint`, `generateKeyPair`,
  `verifyCommutative`; types `EncryptedCard`, `EncryptedDeck`, `CryptoKeyPair`,
  `DeckCommitment`.
- **Commitments** (deck-order commitment, commit-reveal): `createCommitment`,
  `verifyCommitment`, `computeCommitmentHash`, `hashDeck`, `generateNonce`,
  `serializeEncryptedDeck`.
- **Shuffle proofs**: `createShuffleProof`, `verifyShuffleProof`,
  `generatePermutation`, `applyPermutation`, `shuffleWithProof`,
  `commitPermutation`, `verifyPermutationCommitment`; type `Permutation`.
- **Setup-flow helpers** from `@manamesh/boardgameio-crypto`
  (`src/integration/setup-utils.ts`): `getCurrentSetupPlayer`,
  `advanceSetupPlayer`, `resetSetupPlayer`, `lookupCardIdFromPoint`,
  `deterministicShuffle`, `getLogicalMoveCount`.
- **Hashing/serialization** from the package index: `sha256Hex`,
  `stableStringify`.
- **boardgame.io plugin** from
  `@manamesh/boardgameio-crypto/plugin/crypto-plugin`: `CryptoPlugin`,
  `createPlayerCryptoContext`; types `CryptoPluginState`, `CryptoPlayerContext`.

Reference implementation to adapt: `packages/onepiece/src/crypto.ts`
(commit-reveal `ShuffleRngState`, `ensureShuffleRng`, `maybeFinalizeShuffleSeed`,
sequential per-player encrypt/shuffle driven by the setup-player helpers, and the
cooperative-decryption draw path).

### 3.3 Auditability — adapt from `onepiece`

- **Proof chain**: copy `packages/onepiece/src/proofChain.ts`
  (`createProof`, `signProof`, `appendProof`, `verifyProofChain`,
  `verifyProofSignatures`, `getLatestProofHash`) for an auditable log of every
  state transition.
- **Card visibility state machine**: copy/trim
  `packages/onepiece/src/visibility.ts`
  (`transitionCardVisibility`, `initializeCardVisibility`, `isValidTransition`,
  `getCardVisibility`, `isCardVisibleTo`). Timestreams needs only
  `encrypted → owner-known` (draw) and `→ public` (play to timeline); the
  opponent-known states are unused.

### 3.4 UI — `@manamesh/frontend`

Board component modeled on `packages/poker/src/components/PokerBoard.tsx`:

- `BoardProps<TimestreamsState>` from `boardgame.io/react`.
- Crypto status/auditing UI: `CryptoTransparencyPanel` from
  `@manamesh/frontend/src/components/CryptoTransparencyPanel`.
- Wallet-derived keys: `useGameKeys` from
  `@manamesh/frontend/src/blockchain/wallet`.
- Asset/image loading from real packs (after OCR + build tasks):
  `useAssetPack`, `useCardImage`, `useCardSettings` hooks from
  `@manamesh/frontend/src/hooks/*`. Real card art + text (name, effects) from
  manifest metadata. Fallbacks only for unsupported cards.

### 3.5 Lobby & home-era assignment

Follow the poker lobby pattern:

- `packages/manamesh/packages/frontend/src/p2p/discovery/matchmaking/poker/poker-lobby.ts`
  (`PokerMatchmakingConfig extends MatchmakingConfig`, `createPokerMatchmakingConfig`).
- `packages/manamesh/packages/frontend/src/pages/poker/PokerLobby.tsx` (lobby page
  component with per-game option props).

Add a `TimestreamsMatchmakingConfig` exposing a **home-era assignment mode** chosen
by the host when creating the lobby:

```ts
export interface TimestreamsMatchmakingConfig extends MatchmakingConfig {
  homeEraAssignment: "selectable" | "random";  // host-selected lobby option
  maxPlayers: number;                            // 2..4
}
```

- **`selectable`** — in the lobby UI, **each player claims their own** unclaimed era
  (faction-pick style); already-claimed eras are locked out, guaranteeing distinct
  home eras. No host privilege over other players' choices. A claim is **editable
  until that player marks themselves ready**; once all players are ready the
  assignment is locked.
- **`random`** — eras are assigned **cryptographically fairly**: players run a
  multi-party **commit-reveal** to produce a shared seed (reusing the same
  `ShuffleRngState` / `commitShuffleSeed` → `revealShuffleSeed` infrastructure used
  for the deck shuffle), then `deterministicShuffle` over the era pool assigns
  distinct home eras from that seed. No player or host can bias the result. This
  draw runs **in the in-game `setup` phase, after peers are connected** for the
  crypto handshake — the lobby only records the chosen mode, keeping all multi-party
  crypto in one place.

Either way the result is a bijection from players → distinct eras, recorded as
`TimestreamsPlayerState.homeEra`. This assignment also **determines turn order**:
the day-1 first player is the one with the earliest home era, and the first turn
rotates each day to the next player in home-era chronology (per RULES.md).

---

## 4. State model

Types live in `src/types.ts` (mirroring `onepiece/src/types.ts`). Sketch:

```ts
export const ERA_ORDER = [
  "stone", "medieval", "renaissance", "industrial", "modern", "future",
] as const;
export type EraId = (typeof ERA_ORDER)[number];

export interface TimestreamsCard extends CoreCard {
  cardType: "invention" | "action";
  // Deferred to M2 (depends on real card data):
  trait?: "art" | "government";
  playEffect?: string;
  scoreEffect?: string;  // M1 placeholder: all cards => "Score 1 Point"
}

export interface EraState {
  id: EraId;
  /** Ordered stack of played invention card IDs (index 0 = bottom/first). */
  stack: string[];
}

export interface TimestreamsPlayerState {
  homeEra: EraId;
  hand: TimestreamsCard[];        // owner-known
  discard: TimestreamsCard[];     // public
  scorePile: TimestreamsCard[];   // public (filled during scoring)
  hasPassedThisDay: boolean;
  // crypto progress flags (mirror OnePieceCryptoPlayerState)
  publicKey: string | null;
  hasEncrypted: boolean;
  hasShuffled: boolean;
}

export type TimestreamsPhase =
  | "setup" | "keyExchange" | "encrypt" | "shuffle"
  | "play" | "scoring" | "gameOver" | "voided";

export interface TimestreamsState {
  players: Record<string, TimestreamsPlayerState>;
  playerOrder: string[];
  config: TimestreamsConfig;
  phase: TimestreamsPhase;

  timeline: Record<EraId, EraState>;   // the shared board
  currentDay: number;                  // 1..6, indexes ERA_ORDER
  dayFirstPlayer: string;              // rotates by chronological deck order

  // crypto
  encryptedDecks: Record<string, EncryptedCard[]>;
  crypto: CryptoPluginState;
  shuffleRng: ShuffleRngState | null;
  pendingDecryptRequests: DecryptRequest[];
  setupPlayerIndex: number;

  // auditing & visibility
  cardVisibility: Record<string, CardVisibilityState>;
  proofChain: CryptographicProof[];

  // scoring
  scores: Record<string, number>;
  winner: string | null;
}

export interface TimestreamsConfig {
  scoringSlots: number;                 // default 6
  deckSize: number;                     // placeholder, default 36
  drawTable: Record<number, number>;    // { 2:6, 3:5, 4:4 }
  homeEraAssignment: "selectable" | "random";  // mirrors the lobby option
  deckEncryption: "mental-poker";
  proofChainEnabled: boolean;
}
```

### Zones (`src/zones.ts`)

`ZoneDefinition[]` mirroring `onepiece/src/zones.ts`:

| Zone        | visibility   | shared | ordered | features                       |
| ----------- | ------------ | ------ | ------- | ------------------------------ |
| `deck`      | `hidden`     | false  | true    | `shuffle`, `draw`              |
| `hand`      | `owner-only` | false  | false   | `play`, `reveal`               |
| `timeline`  | `public`     | true   | true    | `play`, `reorder`\* (M2)       |
| `discard`   | `public`     | false  | true    | `search`                       |
| `scorePile` | `public`     | false  | false   | —                              |

---

## 5. Phases & moves

boardgame.io `Game<TimestreamsState>` defined in `src/game.ts`, structured like
`OnePieceGame` (phase-gated moves, `client: false`, `activePlayers` per phase).

| Phase         | Purpose                                                       | Key moves (reused/adapted from onepiece)                          |
| ------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| `setup`       | Load decks & assign home eras (see §3.5)                       | `loadDeck`; `claimHomeEra` (selectable); `commitEraSeed`/`revealEraSeed` (random) |
| `keyExchange` | Exchange mental-poker public keys                             | `submitPublicKey`                                                  |
| `encrypt`     | Sequential per-player commutative encryption of every deck    | `encryptDeck`                                                      |
| `shuffle`     | Commit-reveal multi-party shuffle + shuffle proofs            | `commitShuffleSeed`, `revealShuffleSeed`, `shuffleEncryptedDeck`   |
| `play`        | Six days of seeding the timeline                              | `drawForDay`, `playInvention`, `playAction`, `pass`               |
| `scoring`     | Resolve era-by-era scoring                                    | `resolveScoring` (M1 placeholder; full rules M3)                  |
| `gameOver`    | Winner declared                                              | —                                                                 |
| `voided`      | Unrecoverable crypto failure                                 | `voteAbortReveal`                                                  |

### Milestone-1 enforcement ("rules-free" = structure only, no card effects)

- **Turn order:** derived from home-era chronology (§3.5) — only `ctx.currentPlayer`
  may act; one action per turn; first player rotates by era order each day.
- **Days/eras:** `playInvention` appends to the **current** era's stack only;
  targeting another era is rejected (a card-effect privilege deferred to M2).
- **Draw counts:** `drawForDay` deals exactly `drawTable[numPlayers]` via the
  cooperative-decryption draw path; it is the only draw point in a day.
- **Day end:** when every player has passed consecutively, advance `currentDay`,
  rotate `dayFirstPlayer`, reset pass flags, and trigger the next day's draw.
- **Action cards** are **inert in M1**: `playAction` moves the card to `discard`
  with no effect (effects arrive in M2).
- **Government / Art uniqueness** depends on card traits → **deferred to M2**.
- **Abandonment:** M1 ships a minimal `voided`-phase + `voteAbortReveal` stub (declared and wired in Task 11 per recorded decisions). Full key-release / threshold-escrow / stall recovery (as in onepiece/poker) is **deferred** to a later milestone. See "Implementation Decisions & Constraints" above for explicit Task 11 requirement.

---

## 6. Scoring

- **M1 (real cards via pack):** after day 6, `resolveScoring` awards **1 point per card a
  player owns that occupies a scoring slot** (first `scoringSlots` of each era).
  With asset pack, uses real card names + scoreEffect metadata from OCR/manifest
  (instead of uniform "Score 1 Point"). Placeholder scoring logic remains for M1;
  full per-card score effects in M3. This makes the game playable end-to-end with
  real art/text and exercises the full crypto + asset loading path.
- **M3 (full rules):** per-card score effects resolved in slot order, the "Wonky"
  re-entrant movement rule, collection of scored cards into each owner's
  `scorePile`, discard of non-scoring cards, and final tally. Implemented in
  `src/scoring.ts` with dedicated tests.

---

## 7. Milestones

### Milestone 1 — Board, hands, structured rules-free play + UI + Real Assets (Full M1 Priority)

**Current status (2026-06-26):** Tasks 0–10 complete (package scaffolding through placeholder scoring + home-era logic + play moves). Core crypto, state, and pure helpers are implemented and tested (38+ tests passing). 

**New parallel/prep track:** Asset pack preparation (OCR, pack build, real card integration) added as prerequisite to full UI/board and to replace placeholders throughout. Full M1 (0-15 + asset pack) remains priority. Tasks 11–15 + asset tasks now in flight.

**Committed priority:** Complete the **full** M1 scope through Task 15 (including frontend lobby + board UI + wiring + docs) before shifting focus.

- `src/types.ts`, `src/zones.ts`, `src/timeline.ts` (era/stack helpers). ✅
- `src/crypto.ts` — mental-poker setup adapted from `onepiece/src/crypto.ts`
  (keyExchange → encrypt → shuffle, cooperative-decryption draw + binding fix). ✅
- `src/visibility.ts`, `src/proofChain.ts` — copied/trimmed from onepiece. ✅
- `src/homeEra.ts`, `src/play.ts`, `src/scoring.ts` — home era assignment, play moves, day advancement, scoring (real metadata when pack loaded). ✅
- `src/game.ts` — `TimestreamsGame` + `TimestreamsModule`, structural enforcement
  (turn/day/draw/slot), real-card support from asset pack (Task 11)
- `src/board/TimestreamsBoard.tsx` — interactive six-era timeline grid, day &
  active-era indicator, current-player highlight, own hand, action buttons,
  `CryptoTransparencyPanel`. Prompt text stubbed. (Task 13)
- **Lobby (in `@manamesh/frontend`):** `TimestreamsMatchmakingConfig` +
  `createTimestreamsMatchmakingConfig` (mirroring the poker matchmaking module) with
  the `homeEraAssignment: "selectable" | "random"` option, and a `TimestreamsLobby`
  page (mirroring `PokerLobby.tsx`) that renders the era-claim UI in `selectable`
  mode and runs the commit-reveal assignment in `random` mode. (Task 14)
- `src/index.ts`, `package.json`, `vitest.config.ts`, `tsconfig.json`. (partial ✅)
- **Tests:** initial state, draw table, day/turn advancement, slot placement,
  crypto setup round-trip (with binding regression), real-card scoring via asset pack, plus scripted E2E (Task 12).
- **Exit criteria:** a 2–4 player game runs from setup through day 6 to scoring using
  real cards/images/text from the built asset pack (for supported eras), with verifiable
  shuffle/draw proofs and a passing Vitest suite. Full lobby + board integration + asset
  pack loading included per recorded priority. Placeholders only for unscanned eras.

See "Implementation Decisions & Constraints" for requirements on Task 11 (voided phase, import rules, etc.).

### Milestone 2 — Play rules

- Invention `playEffect` resolution; Action card effects; cross-era placement via
  effects; **Government** uniqueness and **Art** stacking rules; movement/destroy
  effects on the timeline.
- Implemented by the rules engine described in [RULES_ENGINE_PRD.md](./RULES_ENGINE_PRD.md).
- **User prompts:** explain each action as it happens and surface every decision a
  player must make.

### Milestone 3 — Scoring rules

- Full era-by-era scoring with per-card score effects and the "Wonky" re-entrant
  movement rule; `scorePile` collection; non-scoring discard; final winner.
- React system and full tag-driven effects (see [RULES_ENGINE_PRD.md](./RULES_ENGINE_PRD.md)).
- **User prompts:** narrate scoring resolution and any score-time decisions.

---

## 8. File layout

```
packages/timestreams/
  PRD.md                      # this document
  RULES.md                    # transcribed manual
  Timestreams_Manual.pdf
  package.json                # @manamesh/timestreams (mirror onepiece)
  tsconfig.json
  vitest.config.ts
  src/
    index.ts
    types.ts
    zones.ts
    timeline.ts               # era/stack helpers (+ .test.ts)
    visibility.ts             # from onepiece (+ .test.ts)
    proofChain.ts             # from onepiece (+ .test.ts)
    crypto.ts                 # mental-poker setup, adapted (+ .test.ts)
    game.ts                   # TimestreamsGame + TimestreamsModule (+ .test.ts)
    scoring.ts                # uses real cards from asset pack when available
    board/
      TimestreamsBoard.tsx
  assets/                     # scanned source (decks/, era_cards/, player-aid-cards/)
    # Built packs produced via asset-pack-builder (see Asset Pack section)
```

`package.json` mirrors `packages/onepiece/package.json`: `private`, ESM, deps on
`@manamesh/boardgameio-crypto` (`workspace:*`), `@manamesh/frontend` (`workspace:*`),
`boardgame.io`; `vitest` for tests.

---

## 9. Testing strategy

- **Vitest**, following the existing per-file `*.test.ts` convention in
  `onepiece/src`. Note the dual-root Yarn gotcha when running frontend-dependent
  tests (see project memory).
- Pure helpers (`timeline.ts`, `scoring.ts`) unit-tested in isolation.
- Crypto setup tested for a full encrypt → shuffle → cooperative-draw round-trip
  that reconstructs the correct card IDs and verifies shuffle proofs, mirroring the
  onepiece crypto tests.
- Game-level tests drive a scripted 2-, 3-, and 4-player game through all six days using real cards from the asset pack where available (or minimal real metadata).

---

## 10. Open questions / future

- Real card data / full asset pack for remaining 4 eras (scans + OCR + build process
  defined above; only Stone Age + Future Tech in initial pack).
- **5–6 player** support + the discard-two-each-age rule (data-driven extension).
- Deck **recycling/reshuffle** if a deck empties before day 6 (RULES.md is silent;
  M1 simply allows "no draw" when the deck is exhausted).
- Final **deck size** per era (currently default 36; can be driven from pack manifest or
  RULES once full data integrated).

**Recorded 2026-06-26 decisions (see "Implementation Decisions & Constraints" section):**
- Full Timestreams M1 (Tasks 0–15) is the active priority on this branch.
- Hybrid SDD workflow.
- Specific boardgame.io test constraints, local `INVALID_MOVE`, `voided` phase requirements for Task 11.
- The sha256Hex commit-binding bug will be fixed in `packages/poker` and `packages/onepiece` during this resumption.
