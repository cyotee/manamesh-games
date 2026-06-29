/**
 * Timestreams Game Module — boardgame.io Game Definition
 *
 * Rules-agnostic state manager with mental-poker deck operations.
 * This module does NOT enforce game rules (M1 scope) — it manages game state
 * and ensures fair deck operations through cryptographic protocols.
 *
 * Phases:
 * - setup: home era assignment (selectable or random via commit-reveal)
 * - keyExchange: Players exchange public keys for mental poker
 * - encrypt: Players encrypt every player's deck
 * - shuffle: Commit-reveal shuffle of encrypted decks
 * - play: Main gameplay (six days of placing inventions/actions)
 * - scoring: Resolve era scoring
 * - gameOver: Game has ended
 * - voided: Unrecoverable crypto/setup failure
 */

import type { Game, Ctx } from "boardgame.io";

// boardgame.io/core is the workspace source package which lacks a built dist/
// in this monorepo. Define INVALID_MOVE locally.
const INVALID_MOVE = "INVALID_MOVE" as const;

import type {
  TimestreamsCard,
  TimestreamsState,
  TimestreamsConfig,
  EraId,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import type {
  CardSchema,
  GameConfig,
  GameModule,
  MoveValidation,
} from "@manamesh/frontend/src/game/modules/types";
import { TIMESTREAMS_ZONES, ZONE_IDS, getZoneById } from "./zones";
import {
  createCryptoInitialState,
  submitPublicKey,
  encryptDeck,
  commitShuffleSeed,
  revealShuffleSeed,
  shuffleEncryptedDeck,
  submitDecryptionShare,
  dealForDay,
  requestDraw,
  commitEraSeed,
  revealEraSeed,
} from "./crypto";
import { createTimeline } from "./timeline";
import { initializeCardVisibility } from "./visibility";
import { createProof, appendProof } from "./proofChain";
import {
  claimHomeEra,
  setReady,
  allReadyWithDistinctEras,
  assignRandomHomeEras,
  homeEraTurnOrder,
} from "./homeEra";
import { playInvention, playAction, pass, endDay } from "./play";
import { resolveScoring } from "./scoring";
import { timestreamsCardSchema } from "./deck";

// =============================================================================
// Game Definition
// =============================================================================

export const TimestreamsGame: Game<TimestreamsState> = {
  name: "timestreams",

  setup: (ctx: Ctx, setupData?: { moduleConfig?: Partial<TimestreamsConfig>; decks?: Record<string, TimestreamsCard[]> }) => {
    const config = setupData?.moduleConfig ?? {};
    const playerIDs = ctx.playOrder || ctx.playerIDs || [];
    const decks = setupData?.decks;
    // Support pre-resolved decks from packs (per rules-free design).
    // Higher layer (lobby) resolves using resolveDecksFromPack + getDeckSizeFromPack,
    // then passes decks here. Avoids direct LoadedAssetPack coupling in boardgame.io setup.
    return createCryptoInitialState(
      { playerIDs },
      config,
      decks
    );
  },

  phases: {
    setup: {
      start: true,
      moves: {
        claimHomeEra: {
          move: ({ G, ctx, playerID }, era: EraId) =>
            claimHomeEra(G, playerID, era),
          client: false,
        },
        setReady: {
          move: ({ G, ctx, playerID }, ready: boolean) =>
            setReady(G, playerID, ready),
          client: false,
        },
        // For random home era assignment (commit-reveal) - full wiring
        commitEraSeed: {
          move: ({ G, ctx, playerID }, commitHashHex: string) =>
            commitEraSeed(G, ctx, playerID, commitHashHex),
          client: false,
        },
        revealEraSeed: {
          move: ({ G, ctx, playerID }, seedHex: string) =>
            revealEraSeed(G, ctx, playerID, seedHex),
          client: false,
        },
        // Support loading real decks from asset pack (pre-resolved by higher layer)
        loadDecks: {
          move: ({ G, ctx, playerID }, decks: Record<string, TimestreamsCard[]>) => {
            if (!decks) return G;
            for (const pid of G.playerOrder) {
              const real = decks[pid];
              if (real && real.length > 0) {
                G.encryptedDecks[pid] = real.map((card: TimestreamsCard) => ({
                  ciphertext: card.id,
                  layers: 0,
                }));
              }
            }
            return G;
          },
          client: false,
        },
      },
      endIf: ({ G }) => allReadyWithDistinctEras(G),
      next: "keyExchange",
    },

    keyExchange: {
      moves: {
        submitPublicKey: {
          move: ({ G, ctx, playerID }, publicKey: string) =>
            submitPublicKey(G, ctx, playerID, publicKey),
          client: false,
        },
      },
      next: "encrypt",
    },

    encrypt: {
      moves: {
        encryptDeck: {
          move: ({ G, ctx, playerID }, privateKey: string) =>
            encryptDeck(G, ctx, playerID, privateKey),
          client: false,
        },
      },
      next: "shuffle",
    },

    shuffle: {
      moves: {
        commitShuffleSeed: {
          move: ({ G, ctx, playerID }, commitHashHex: string, callerId?: string) =>
            commitShuffleSeed(G, ctx, playerID, commitHashHex, callerId),
          client: false,
        },
        revealShuffleSeed: {
          move: ({ G, ctx, playerID }, seedHex: string, callerId?: string) =>
            revealShuffleSeed(G, ctx, playerID, seedHex, callerId),
          client: false,
        },
        shuffleEncryptedDeck: {
          move: ({ G, ctx, playerID }) => shuffleEncryptedDeck(G, ctx, playerID),
          client: false,
        },
      },
      next: "play",
    },

    play: {
      moves: {
        playInvention: {
          move: ({ G, ctx, playerID }, cardId: string) =>
            playInvention(G, ctx, playerID, cardId),
          client: false,
        },
        playAction: {
          move: ({ G, ctx, playerID }, cardId: string) =>
            playAction(G, ctx, playerID, cardId),
          client: false,
        },
        pass: {
          move: ({ G, ctx, playerID }) => pass(G, ctx, playerID),
          client: false,
        },
      },
      turn: {
        order: {
          // Turn order derived from homeEra chronology
          first: (G: TimestreamsState) => {
            const order = homeEraTurnOrder(G);
            return G.playerOrder.indexOf(order[0]);
          },
          next: (G: TimestreamsState, ctx: Ctx) => {
            const order = homeEraTurnOrder(G);
            const currentIdx = order.indexOf(ctx.currentPlayer);
            return G.playerOrder.indexOf(order[(currentIdx + 1) % order.length]);
          },
        },
      },
      next: "scoring",
    },

    scoring: {
      onBegin: ({ G }) => {
        resolveScoring(G);
      },
      next: "gameOver",
    },

    gameOver: {
      endIf: () => true,
    },

    voided: {
      moves: {
        voteAbortReveal: {
          move: ({ G, ctx, playerID }) => {
            // Stub - full implementation can be added later
            return G;
          },
          client: false,
        },
      },
    },
  },

  endIf: ({ G }) => {
    if (G.phase === "gameOver" && G.winner) {
      return { winner: G.winner };
    }
    return undefined;
  },
};

// =============================================================================
// Module Export
// =============================================================================

export const TimestreamsModule: GameModule<TimestreamsCard, TimestreamsState> = {
  id: "timestreams",
  name: "Timestreams",
  version: "0.1.0",
  description: "Timestreams — cryptographically fair era-seeding card game (M1: structure only)",

  cardSchema: timestreamsCardSchema,
  zones: TIMESTREAMS_ZONES,

  assetRequirements: {
    required: ["card_face", "card_back"],
    optional: [],
    idFormat: "custom",
  },

  initialState: (config: GameConfig, setupData?: { moduleConfig?: Partial<TimestreamsConfig>; decks?: Record<string, TimestreamsCard[]> }) => {
    return createCryptoInitialState(config, setupData?.moduleConfig, setupData?.decks);
  },

  validateMove: (state: TimestreamsState, playerID: string, moveName: string, ...args: unknown[]): MoveValidation => {
    // Basic validation stub — full rules enforcement in later milestones
    return { valid: true };
  },

  getBoardgameIOGame: () => TimestreamsGame,
};

export default TimestreamsModule;
