# ManaMesh platform archive plan

**Status:** Planned (not executed)  
**Date:** 2026-07-23  

## Why

`packages/manamesh` mixes:

1. **Still-needed SPA shell** (`packages/frontend` — registry, P2P, Vite pages)
2. **Optional signaling backend**
3. **Large historical bulk** (crane `lib/`, `reference/`, `vendor/` duplicates, task archives)

That confuses ownership: games are extracted packages, but the shell still lives under a nested “manamesh” submodule.

## Direction

| Game / concern | Home |
|----------------|------|
| Merkle Battleship | **`game-battleship-merkle`** / `@manamesh/game-battleship-merkle` |
| Poker | `@manamesh/poker` |
| Timestreams | `@manamesh/timestreams` |
| One Piece | `@manamesh/onepiece` |Good, 
| Mistborn | `@manamesh/mistborn-deckbuilder` |
| Shared crypto | `@cyotee/boardgameio-crypto` |
| Shared P2P + Trystero | `@cyotee/boardgameio-p2p` |
| **App shell** (until split) | still `packages/manamesh/packages/frontend` |

**Do not archive the GitHub `cyotee/manamesh` repo until** the frontend shell is relocated or replaced (e.g. per-game SPAs or a thin `manamesh-shell` package). Archiving now would break `yarn dev:frontend`.

## Done in this effort

- [x] Extract Merkle Battleship to `@manamesh/game-battleship-merkle` + GitHub `game-battleship-merkle`
- [x] Trystero Quick connect on merkle-battleship page
- [x] Remove War / Go Fish from game registry (experiments; code may remain unreferenced)
- [x] Remove multi-game shell (`App.tsx`, `GameSelector`, old `main.tsx`); root redirects to Timestreams; per-game scripts `yarn dev:timestreams|poker|battleship|onepiece`

## Before archiving `cyotee/manamesh`

1. Move `packages/manamesh/packages/frontend` → e.g. `packages/frontend` (or `@manamesh/shell`) in **this** monorepo  
2. Move or drop `packages/backend`  
3. Update root workspaces / Vite paths / `Claude.md`  
4. Point submodule consumers to the monorepo only  
5. Then `gh repo archive cyotee/manamesh`  

## Dropped / not preserved

- War, Go Fish — demos only; removed from registry  
- No requirement to keep their modules long-term  
