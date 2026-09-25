# Mistborn Deck Builder (Manamesh Module)

Rules-free Phase 1 implementation for testing.

## Local tests

Run `yarn workspace @manamesh/mistborn-deckbuilder test` from the
manamesh-games root using Yarn 4. The suite uses bounded fork workers because
the transitive snarkjs worker loader is incompatible with Vitest threads.

The historical quick-test menu instructions do not describe the current
Timestreams entry point. This package is a rules-free prototype, not a standalone
production game or a certified malicious-host protocol.

The board runs in standalone demo mode with local state:
- Click market cards to buy (adds to current hand)
- Click hand cards to play them
- Click played cards to toggle sideways (metal use)
- Use buttons for cleanup, advance training, simulate combat
- Switch players, reset demo

All data and images come from the enriched asset pack.

## Frontend integration

The frontend workspace is `@cyotee/manamesh`. Its current production build emits
the Timestreams page; running that build does not deploy this Mistborn prototype.
A dedicated entry and browser validation are needed before offering it as a
separate product.

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


## Engine and crypto integration limits

The game callbacks now use the boardgame.io context-object API; a real Client
regression covers setup, turn initialization and drawing. Main moves bind the
actor to the current player, and public-key publication binds the claimed seat
to the engine actor.

The private-key `crypto.encryptDeck` helper is offline-only and is not registered
as a multiplayer move. The encryption phase cannot complete until a validated
public-payload protocol and client preparation are implemented. Existing setup
progression, deterministic move history and complete multiplayer crypto still
require work; passing package tests does not establish a playable secure match.

The public module card factory requires `id`, `name`, `cost` and `cardType`.
Cost must be a nonnegative safe integer; optional metal, pairing, defense, tag
and image metadata is validated when supplied. Incomplete or malformed factory
input throws instead of creating a card with undefined game values.
