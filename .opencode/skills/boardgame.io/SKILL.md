---
name: boardgame.io
description: boardgame.io, bgio, game module, Game object, Client, Server, multiplayer, SocketIO, Local transport, turn, phase, move, event, activePlayers, flow, plugin, Random, secret state, playerView, MCTSBot, Tic-Tac-Toe tutorial. Triggers: "boardgame.io", "bgio", "Game object", "Client", "Server", "multiplayer", "SocketIO", "Local transport", "turn phase", "moves", "events", "activePlayers", "flow", "plugin", "random", "playerView", "MCTSBot"
triggers:
  - boardgame.io
  - bgio
  - Game object
  - Client
  - Server
  - multiplayer
  - SocketIO
  - Local transport
  - turn phase
  - moves
  - events
  - activePlayers
  - flow
  - plugin
  - random
  - playerView
  - MCTSBot
---

# boardgame.io — Turn-Based Game Framework

boardgame.io is a framework for building turn-based games in JavaScript/TypeScript. It handles game state management, networking (multiplayer), random number generation, and bot AI — letting you focus on game logic.

ManaMesh uses it as the core game engine. See `skill:manamesh-game-modules` for how boardgame.io integrates with ManaMesh's crypto layer.

## Core Concepts

### State: `G` and `ctx`

All game state lives in two objects:

```js
{
  G: {},       // Your game state (mutable, JSON-serializable)
  ctx: {        // Read-only framework metadata
    turn: 0,
    currentPlayer: '0',
    numPlayers: 2,
    phase: 'default',
    activePlayers: null,   // or { '0': 'play', '1': 'wait' }
    playOrder: ['0', '1'],
    playOrderPos: 0,
    gameover: undefined,
  }
}
```

- `G` — your domain state. Must be JSON-serializable (no classes/functions).
- `ctx` — framework-managed metadata. Don't mutate directly.

### Moves

Moves are pure reducer functions that modify `G`:

```js
moves: {
  drawCard: ({ G, ctx, playerID }) => {
    const card = G.deck.pop();
    G.hand.push({ card, player: playerID });
  },
}
```

Move arguments after the context are passed from the client:

```js
client.moves.drawCard("queen_of_spades"); // playerID inferred from client
```

### Events

Events are framework-provided functions that change `ctx` (advance turn, end phase, etc.):

```js
client.events.endTurn(); // advance to next player
client.events.endTurn({ next: "1" }); // jump to specific player
client.events.setPhase("play"); // switch phase
client.events.endPhase();
client.events.endGame();
client.events.setActivePlayers({ all: "play" }); // stage system
```

## Game Object

```js
const game = {
  name: "my-game", // optional; defaults to 'default'
  setup: ({ ctx }) => ({
    // initial G
    deck: [],
    hands: {},
  }),
  moves: {
    /* ... */
  },
  turn: {
    /* turn config */
  },
  phases: {
    /* phase configs */
  },
  events: { endGame: false }, // disable events
  endIf: ({ G, ctx }) => {
    /* return truthy to end game */
  },
  onEnd: ({ G, ctx }) => {
    /* cleanup */
  },
  playerView: ({ G, ctx, playerID }) => G, // filter G per player
  seed: "random-string", // RNG seed
  disableUndo: true, // disable undo/redo
  deltaState: true, // use JSON Patch for multiplayer delta
  minPlayers: 2,
  maxPlayers: 6,
};
```

### Long-form Moves

For control over move behavior:

```js
moves: {
  placeBid: {
    move: ({ G, ctx, playerID }, amount) => {
      G.bids[playerID] = amount;
    },
    undoable: false,   // prevent undo (default: true)
    redact: true,      // hide args from game log
    client: false,     // run only on server (not client)
    noLimit: true,     // don't count toward minMoves/maxMoves
    ignoreStaleStateID: true,  // process even if client is out of date
  }
}
```

## Turn Configuration

```js
turn: {
  order: TurnOrder.DEFAULT,  // or TurnOrder.ONCE, or custom

  onBegin: ({ G, ctx, events }) => {},
  onEnd: ({ G, ctx, events }) => {},
  onMove: ({ G, ctx, events }) => {},
  endIf: ({ G, ctx }) => true | { next: '0' },

  minMoves: 1,    // player must make at least N moves
  maxMoves: 1,    // auto-end turn after N moves

  activePlayers: {    // stage-like system
    all: 'play',
    value: { '0': 'bid', '1': 'play' },
  },
}
```

### TurnOrder Presets

```js
import { TurnOrder } from 'boardgame.io/core';

turn: {
  order: TurnOrder.DEFAULT,    // round-robin
  order: TurnOrder.ONCE,       // single pass (player 0 → done)
  order: TurnOrder.CUSTOM(['1', '3']),  // fixed custom order
  order: TurnOrder.CUSTOM_FROM('G.turnOrder'),  // dynamic from G
}
```

### Custom Turn Order

```js
turn: {
  order: {
    first: ({ G, ctx }) => 0,
    next: ({ G, ctx }) => (ctx.playOrderPos + 1) % ctx.numPlayers,
    playOrder: ({ G, ctx }) => ['0', '1'],  // optional override
  }
}
```

## Phases

Phases override game config for a period of play:

```js
phases: {
  setup: {
    start: true,           // this phase begins the game
    moves: { placeBid },  // restrict moves
    turn: { maxMoves: 1 },  // override turn config
    onBegin: ({ G, ctx }) => { /* init bids */ },
    onEnd: ({ G, ctx }) => { /* finalize bids */ },
    endIf: ({ G }) => G.bidsPlaced,
    next: 'play',          // or: next: ({ G }) => G.nextPhase
  },
  play: {
    moves: { drawCard, playCard },
  },
}
```

## Stages

Stages apply to individual players within a turn:

```js
turn: {
  activePlayers: {
    all: 'play',  // all players start in 'play' stage
    value: { '0': 'bid', '1': 'wait' },  // per-player override
  },
  stages: {
    bid: {
      moves: { placeBid },
      next: 'play',
    },
    play: {
      moves: { drawCard, playCard },
    },
  },
}
```

Player moves to next stage via:

```js
client.events.endStage(); // advance to next stage
client.events.setStage("play");
```

## Active Players

```js
// Set active players for current turn
client.events.setActivePlayers({
  all: "play", // all players in 'play' stage
  currentPlayer: "discard", // current player in 'discard' stage
  others: "wait", // other players in 'wait' stage
  value: { 0: "bid", 1: "discard" }, // explicit per-player
  minMoves: 1,
  maxMoves: 1,
});
```

## Randomness

Use `random` in moves — never `Math.random()`:

```js
moves: {
  rollDice: ({ G, random }) => {
    G.die = random.D6();         // 1–6
    G.dice = random.D6(3);      // [1–6, 1–6, 1–6]
    G.rng = random.Number();     // 0–1
    G.deck = random.Shuffle(G.deck);  // in-place shuffle
  },
}
```

Set seed for deterministic replay:

```js
const game = { seed: 42 /* ... */ };
```

## Secret State

Use `playerView` to filter `G` per player (server-side):

```js
import { PlayerView } from "boardgame.io/core";

const game = {
  playerView: ({ G, ctx, playerID }) => {
    // Strip opponent's hand from each player's view
    return {
      ...G,
      opponents: G.opponents.map((o) =>
        o.id === playerID ? o : { ...o, hand: [] },
      ),
    };
  },
  // or simply strip a 'secret' key:
  playerView: PlayerView.STRIP_SECRETS,
};
```

Hide moves that use secret state (run only on server):

```js
moves: {
  revealCard: {
    move: ({ G, random }) => { G.secret = random.Number(); },
    client: false,  // client waits for server response
  },
}
```

## Plugins

Plugins extend game state with private storage and API:

```js
import { PluginPlayer } from "boardgame.io/plugins";

const game = {
  plugins: [
    PluginPlayer({
      setup: (playerID) => ({ score: 0, hand: [] }),
      playerView: (players, playerID) => ({
        [playerID]: players[playerID], // hide others' state
      }),
    }),
  ],
};

// In moves, access via ctx.player:
// ctx.player.get()      → current player's record
// ctx.player.set({ score: 5 })
// ctx.player.opponent.get()  → opponent's record
```

Custom plugin shape:

```js
{
  name: 'my-plugin',
  setup: ({ G, ctx }) => ({ /* private data */ }),
  api: ({ G, ctx, data, playerID }) => ({
    myMethod: () => data.value,
  }),
  flush: ({ G, ctx, data, api }) => data,  // persist to G
  noClient: ({ G, ctx, data }) => data.isSecret,
  isInvalid: ({ G, ctx, data }) => data.invalid ? 'invalid' : false,
  playerView: ({ G, ctx, data, playerID }) => filtered,
}
```

## Client (Plain JS)

```js
import { Client } from "boardgame.io/client";

const client = Client({
  game: MyGame,
  numPlayers: 2,
  debug: true, // Debug Panel
});

client.start();

// Properties
client.moves; // { moveName: fn }
client.events; // { endTurn, endPhase, ... }
client.log;
client.matchID;
client.playerID;
client.matchData; // [{ id, name, isConnected }, ...]

// Methods
client.getState(); // { G, ctx, plugins, log, isActive, isConnected }
client.subscribe(fn); // → unsubscribe fn
client.start();
client.stop();
client.reset();
client.undo();
client.redo();
client.sendChatMessage("hello");

// Multiplayer
import { Local } from "boardgame.io/multiplayer";
import { SocketIO } from "boardgame.io/multiplayer";

const client = Client({
  game: MyGame,
  multiplayer: Local(), // in-memory (pass-and-play)
  // or: multiplayer: SocketIO({ server: 'http://localhost:8000' }),
  matchID: "match-id",
  playerID: "0",
});
```

## Client (React)

```js
import { Client } from "boardgame.io/react";
import Board from "./Board";

const App = Client({
  game: MyGame,
  numPlayers: 2,
  board: Board, // your React component
  loading: LoadingComp, // shown while connecting (multiplayer)
  debug: true,
  multiplayer: SocketIO({ server: "http://localhost:8000" }),
});

<App matchID="match-id" playerID="0" />;
```

**Board props** received:

```jsx
function Board({
  G,
  ctx,
  moves,
  events,
  reset,
  undo,
  redo,
  isActive,
  playerID,
  matchID,
}) {
  return <div>{/* render G and ctx */}</div>;
}
```

## Server

```js
import { Server, Origins } from "boardgame.io/server";

const server = Server({
  games: [MyGame],
  origins: ["https://yourgame.com", Origins.LOCALHOST_IN_DEVELOPMENT],
  db: new DbConnector(), // or omit for in-memory
  // transport: custom transport
});

server.run(8000);
// → { apiServer, appServer }
```

### Lobby REST API (auto-hosted on same port)

```
GET  /games                     → list game names
GET  /games/:name              → list matches
GET  /games/:name/:id           → match metadata
POST /games/:name/create        → create match
POST /games/:name/:id/join      → join match
POST /games/:name/:id/leave    → leave match
POST /games/:name/:id/update    → update player metadata
POST /games/:name/:id/playAgain → restart
```

## Bots (AI)

```js
import { Client } from "boardgame.io/client";
import { Local } from "boardgame.io/multiplayer";
import { MCTSBot } from "boardgame.io/bots";

const client = Client({
  game: MyGame,
  multiplayer: Local({
    bots: {
      1: MCTSBot, // player 1 is a bot
    },
  }),
  playerID: "0",
});
```

In the game definition, provide an `ai.enumerate` to define valid moves for the bot:

```js
const game = {
  ai: {
    enumerate: (G, ctx) => {
      let moves = [];
      for (let i = 0; i < 9; i++) {
        if (G.cells[i] === null) {
          moves.push({ move: "clickCell", args: [i] });
        }
      }
      return moves;
    },
  },
};
```

Bot implementation (`src/ai/ai.ts`): `Step(client, bot)` makes one move; `Simulate(game, bots, state, depth)` plays to gameover.

## Key Source Files

| File                                | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `src/core/game.ts`                  | `ProcessGameConfig`, game object defaults                  |
| `src/core/flow.ts`                  | `Flow()` — turn/phase/stage engine                         |
| `src/types.ts`                      | All TypeScript types: `Game`, `State`, `Ctx`, `ClientOpts` |
| `src/client/client.ts`              | `_ClientImpl` — client implementation                      |
| `src/client/transport/transport.ts` | Abstract `Transport` class                                 |
| `src/server/index.ts`               | `Server()` factory                                         |
| `src/ai/ai.ts`                      | `Step`, `Simulate` bot helpers                             |
| `src/plugins/`                      | Built-in plugins (Random, PluginPlayer)                    |
| `vendor/boardgame.io/src/`          | Forked boardgame.io (ManaMesh's vendored version)          |

## Constraints / Gotchas

1. **`G` must be JSON-serializable** — no classes, functions, Maps, Sets. Use plain objects and arrays.
2. **Moves are pure reducers** — don't depend on external state or have side effects. Use `events` to advance game state.
3. **`client: false` moves run server-only** — client will wait for authoritative update. Essential for secret state.
4. **Optimistic updates** — in multiplayer, client runs moves locally for responsiveness, then reconciles with server. If client computes wrong state (e.g., invalid move), server overrides.
5. **No `Math.random()` in moves** — use `random.D6()`, `random.Shuffle()`, etc. The PRNG state lives on the server.
6. **`deltaState: true`** — sends JSON Patch diffs instead of full state in multiplayer, reducing bandwidth.
7. **Undo/redo** — enabled by default. Disable with `disableUndo: true` or per-move with `undoable: false`.
8. **`playerView` runs server-side in multiplayer** — filters `G` before sending to each client. Not applied in single-player.
9. **No `crytography.md` docs** — boardgame.io has no built-in crypto docs. For secret state use `playerView` + `client: false` moves. ManaMesh adds SRA encryption on top via its own plugin.
10. **bots.md is missing from docs** — bot authoring uses `ai.enumerate` in game definition + `MCTSBot` from `boardgame.io/bots`.

## ManaMesh Usage

ManaMesh uses a **forked** boardgame.io at `vendor/boardgame.io/`. The fork is at `vendor/boardgame.io/` as a git submodule. ManaMesh's customizations:

- `skill:manamesh-game-modules` — all games wrap boardgame.io with crypto plugins
- `skill:manamesh-crypto` — SRA mental poker and other crypto primitives layered on top via custom plugin hooks (`fnWrap`, `noClient`)
- `skill:manamesh-p2p` — P2P networking replaces boardgame.io's default SocketIO transport

The `getBoardgameIOGame()` function in each game module converts the crypto game definition into a plain boardgame.io `Game` object.

## See Also

- `skill:manamesh-game-modules` — how ManaMesh wraps boardgame.io for crypto games
- `skill:manamesh-crypto` — ManaMesh's cryptographic layer (SRA, Shamir, EC ElGamal)
- `skill:manamesh-p2p` — P2P networking replacing SocketIO transport
- https://boardgame.io (official docs)
- https://github.com/boardgameio/boardgame.io (commit 4f3c90d, ManaMesh's vendored version)
