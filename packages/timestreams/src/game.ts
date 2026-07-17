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
// in this monorepo. Define INVALID_MOVE / ActivePlayers locally.
const INVALID_MOVE = "INVALID_MOVE" as const;
/** All players may call phase moves (Stage.NULL). Avoid named stages without stage.moves. */
const ALL_ACTIVE = { all: null as null };

/** Concurrent multiplayer moves: master must accept out-of-order dual-seat/P2P races. */
const CONCURRENT = { client: false as const, ignoreStaleStateID: true as const };

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
  dealPlaintextHands,
  requestDraw,
  commitEraSeed,
  revealEraSeed,
  pushActivityLog,
  hasActiveDeckOp,
  commitDeckOpSeed,
  revealDeckOpSeed,
  submitDeckOpReencrypt,
} from "./crypto";
import { resetSetupPlayer } from "@manamesh/boardgameio-crypto";
import { createTimeline } from "./timeline";
import { initializeCardVisibility } from "./visibility";
import { createProof, appendProof } from "./proofChain";
import {
  claimHomeEra,
  setReady,
  allReadyWithDistinctEras,
  assignRandomHomeEras,
  homeEraTurnOrder,
  dayFirstPlayer,
} from "./homeEra";
import {
  playInvention,
  playAction,
  pass,
  endDay,
  submitReact,
  submitPlayChoice,
} from "./play";
import { beginScoringPhase, submitScoreChoice, ackScoreStep } from "./scoring";
import { hasTag } from "./effects/tags";
import { getCard, getTurnFlags } from "./effects/state";
import { isMoveBlocked, isDiscardBlocked } from "./effects/boardOps";
import { timestreamsCardSchema } from "./deck";
import { materializeHomeEraDecks } from "./deckResolver";
import type { PackCatalog } from "./packCatalog";
import {
  applyFreeTool,
  disableRulesEngine,
  type FreeToolArgs,
  type FreeToolId,
} from "./freeTools";
import { debugSeedBoard, type DebugSeedBoardArgs } from "./debugSeed";
import { applyDebugE2EAct, type DebugE2EAct } from "./debugE2E";

// =============================================================================
// Game Definition
// =============================================================================

function nextAfterSetup(G: TimestreamsState): string {
  return G.config?.playMode === "mental-poker" ? "keyExchange" : "play";
}

/**
 * Rules engine policy (RULES_OFF_PRD §2.1):
 * - Default ON; host setup value is shared.
 * - Mid-game: only disable (ON→OFF) is allowed.
 * - Re-enable is forbidden once OFF / rulesLockedOff.
 */
function setRulesEnabledMove(
  G: TimestreamsState,
  enabled: boolean,
  playerId?: string,
): typeof INVALID_MOVE | void {
  if (!G.config) {
    G.config = { ...DEFAULT_CONFIG };
  }
  // One-way: never re-enable after lock or once already OFF.
  if (enabled) {
    if (G.config.rulesEnabled === false || G.config.rulesLockedOff) {
      return INVALID_MOVE;
    }
    // Already ON — no-op
    return;
  }
  // Disable path
  if (G.config.rulesEnabled === false) {
    return; // already off
  }
  disableRulesEngine(G, playerId ?? "?");
}

/** Shared move map fragment for the rules toggle + free tools. */
const setRulesEnabledMoveDef = {
  setRulesEnabled: {
    move: (
      { G, playerID }: { G: TimestreamsState; playerID?: string | null },
      enabled: boolean,
    ) => {
      const r = setRulesEnabledMove(G, enabled, playerID ?? undefined);
      if (r === INVALID_MOVE) return INVALID_MOVE;
    },
    client: false,
  },
  /** Structural free tools when rulesEnabled === false (RULES_OFF_PRD). */
  freeTool: {
    move: (
      {
        G,
        ctx,
        playerID,
      }: { G: TimestreamsState; ctx: Ctx; playerID?: string | null },
      toolId: FreeToolId,
      args: FreeToolArgs = {},
    ) => {
      const pid = playerID ?? ctx.currentPlayer;
      if (!pid) return INVALID_MOVE;
      const r = applyFreeTool(G, pid, toolId, args, ctx.currentPlayer);
      if (r === "INVALID_MOVE") return INVALID_MOVE;
    },
    ...CONCURRENT,
  },
  /**
   * Stage board for e2e when config.debugSeed === true.
   * Concurrent so either dual-seat can call it.
   */
  debugSeedBoard: {
    move: ({ G }: { G: TimestreamsState }, args: DebugSeedBoardArgs = {}) => {
      if (!debugSeedBoard(G, args)) return INVALID_MOVE;
    },
    ...CONCURRENT,
  },
  /**
   * Multi-seat e2e driver (score choices as P1, dual-ack, force scoring, …).
   * Only when config.debugSeed === true.
   */
  debugE2EAct: {
    move: (
      {
        G,
        events,
      }: {
        G: TimestreamsState;
        events?: { endPhase?: () => void };
      },
      act: DebugE2EAct,
    ) => {
      const r = applyDebugE2EAct(G, act, {
        endPhase: () => events?.endPhase?.(),
      });
      if (!r.ok) return INVALID_MOVE;
    },
    ...CONCURRENT,
  },
};

/** Begin the play phase: set G.phase, deal hands, mark day's first player. */
function beginPlayPhase(G: TimestreamsState): void {
  G.phase = "play";
  if (!G.currentDay || G.currentDay < 1) G.currentDay = 1;
  // Day 1 first player = earliest home era (RULES.md).
  // turn.order.first reads dayFirstPlayer (must not mutate frozen G).
  // startOfDayPending stays false so the first endTurn advances normally;
  // endDay re-sets it for subsequent days.
  G.dayFirstPlayer = dayFirstPlayer(G, G.currentDay);
  G.startOfDayPending = false;
  // Replace placeholders with home-era decks from the asset pack catalog (if any).
  materializeHomeEraDecks(G);
  // Plaintext: materialize hands from the card registry immediately.
  // Mental-poker: dealForDay only enqueues cooperative decrypt requests;
  // the board auto-driver peels layers and fills hands.
  if (G.config?.playMode !== "mental-poker") {
    dealPlaintextHands(G, G.currentDay || 1);
  } else {
    dealForDay(G, G.currentDay || 1);
  }
}

/**
 * Pick the next current player after endTurn, honouring:
 * - startOfDayPending (day-first player)
 * - extraTurns (Androids / Inflation — same player goes again)
 * - skipNextTurn (skip and clear the flag)
 */
/** Mutate a property only when the object is extensible/writable (not frozen G). */
function trySet<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): void {
  try {
    obj[key] = value;
  } catch {
    // boardgame.io freezes G during turn-order next(); skip side effects
  }
}

export function resolveNextPlayOrderPos(
  G: TimestreamsState,
  ctx: Ctx,
): number {
  if (G.startOfDayPending) {
    trySet(G, "startOfDayPending", false);
    const pid = G.dayFirstPlayer || dayFirstPlayer(G, G.currentDay || 1);
    trySet(G, "dayFirstPlayer", pid);
    return playOrderIndexForPlayer(G, pid);
  }

  const current = ctx.currentPlayer;
  const flags = getTurnFlags(G, current);
  if (flags.extraTurns > 0) {
    trySet(flags, "extraTurns", flags.extraTurns - 1);
    // Extra turn continues for this player (Androids: noInvention already set).
    return playOrderIndexForPlayer(G, current);
  }

  // Leaving this player's turn sequence — clear per-turn restrictions.
  trySet(flags, "noInventionThisTurn", false);

  const order = homeEraTurnOrder(G);
  if (order.length === 0) {
    return (ctx.playOrderPos + 1) % ctx.numPlayers;
  }

  let idx = order.indexOf(current);
  if (idx < 0) idx = 0;

  // Walk home-era order until we find a player who is not skipped.
  for (let step = 0; step < order.length; step++) {
    idx = (idx + 1) % order.length;
    const pid = order[idx];
    const f = getTurnFlags(G, pid);
    if (f.skipNextTurn) {
      trySet(f, "skipNextTurn", false);
      continue;
    }
    return playOrderIndexForPlayer(G, pid);
  }

  // All skipped (shouldn't happen) — fall back to next seat.
  return (ctx.playOrderPos + 1) % ctx.numPlayers;
}

export function playOrderIndexForPlayer(G: TimestreamsState, playerId: string): number {
  const idx = G.playerOrder.indexOf(playerId);
  return idx >= 0 ? idx : 0;
}

export const TimestreamsGame: Game<TimestreamsState> = {
  name: "timestreams",

  setup: (arg: any, setupData?: {
    moduleConfig?: Partial<TimestreamsConfig>;
    decks?: Record<string, TimestreamsCard[]>;
    packCatalog?: PackCatalog;
    packName?: string;
  }) => {
    // boardgame.io calls setup(fnContext, setupData) where fnContext = { ctx, ...plugins }.
    // Unit tests may pass a bare Ctx-like object with playOrder at the top level.
    const ctx: Ctx = arg?.ctx ?? arg;
    const config = setupData?.moduleConfig ?? {};
    const playerIDs: string[] =
      (ctx?.playOrder as string[] | undefined) ||
      (arg?.playOrder as string[] | undefined) ||
      (arg?.playerIDs as string[] | undefined) ||
      Array.from({ length: ctx?.numPlayers || 2 }, (_, i) => String(i));
    const decks = setupData?.decks;
    // Support pre-resolved decks from packs (per rules-free design).
    // Higher layer (lobby) resolves using resolveDecksFromPack + getDeckSizeFromPack,
    // then passes decks here. Avoids direct LoadedAssetPack coupling in boardgame.io setup.
    const G = createCryptoInitialState(
      { playerIDs },
      config,
      decks
    );
    // Pack catalog is attached for materializeHomeEraDecks at play start
    // (home eras are not known until after setup claims).
    if (setupData?.packCatalog) {
      G.packCatalog = setupData.packCatalog;
      G.packName = setupData.packName;
    }
    return G;
  },

  phases: {
    setup: {
      start: true,
      // Both players claim eras / ready concurrently (not turn-based).
      turn: {
        activePlayers: ALL_ACTIVE,
      },
      moves: {
        ...setRulesEnabledMoveDef,
        claimHomeEra: {
          move: ({ G, playerID }, era: EraId) => {
            if (!claimHomeEra(G, playerID, era)) return INVALID_MOVE;
            // Keep G.phase aligned with the bgio setup phase while claiming.
            G.phase = "setup";
          },
          client: false,
        },
        setReady: {
          move: ({ G, playerID }, ready: boolean = true) => {
            setReady(G, playerID, ready);
          },
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
          move: ({ G }, decks: Record<string, TimestreamsCard[]>) => {
            if (!decks) return;
            if (!G.cards) G.cards = {};
            for (const pid of G.playerOrder) {
              const real = decks[pid];
              if (real && real.length > 0) {
                G.encryptedDecks[pid] = real.map((card: TimestreamsCard) => {
                  G.cards![card.id] = card;
                  return { ciphertext: card.id, layers: 0 };
                });
              }
            }
          },
          client: false,
        },
      },
      endIf: ({ G }) => allReadyWithDistinctEras(G),
      next: ({ G }) => nextAfterSetup(G),
    },

    keyExchange: {
      onBegin: ({ G }) => {
        G.phase = "keyExchange";
        // Materialize pack decks before encrypt so mental-poker layers real cards.
        materializeHomeEraDecks(G);
        pushActivityLog(G, "Key exchange — mental-poker setup", "system");
      },
      // Explicit stage so both seats always have the move (dual-seat Local + P2P).
      turn: {
        activePlayers: { all: "crypto" },
        stages: {
          crypto: {
            moves: {
              ...setRulesEnabledMoveDef,
              submitPublicKey: {
                move: ({ G, ctx, playerID }, publicKey: string) =>
                  submitPublicKey(G, ctx, playerID, publicKey),
                ...CONCURRENT,
              },
            },
          },
        },
      },
      // Phase-level copy (fallback if stage resolution differs)
      moves: {
        ...setRulesEnabledMoveDef,
        submitPublicKey: {
          move: ({ G, ctx, playerID }, publicKey: string) =>
            submitPublicKey(G, ctx, playerID, publicKey),
          ...CONCURRENT,
        },
      },
      endIf: ({ G }) =>
        G.phase === "encrypt" ||
        G.phase === "shuffle" ||
        G.phase === "play" ||
        G.playerOrder.every((pid) => !!G.players[pid]?.publicKey),
      next: "encrypt",
    },

    encrypt: {
      onBegin: ({ G }) => {
        G.phase = "encrypt";
        resetSetupPlayer(G);
        pushActivityLog(G, "Encrypt phase — each player layers all decks", "system");
      },
      turn: {
        activePlayers: { all: "crypto" },
        stages: {
          crypto: {
            moves: {
              ...setRulesEnabledMoveDef,
              encryptDeck: {
                // Multiplayer: args are (null | undefined, preEncrypted) only.
                // Never put privateKey in move args — use prepareEncryptionLayer client-side.
                move: (
                  { G, ctx, playerID },
                  privateKey?: string | null,
                  preEncrypted?: Record<string, { ciphertext: string; layers: number }[]>,
                ) => encryptDeck(G, ctx, playerID, privateKey, preEncrypted as any),
                ...CONCURRENT,
              },
            },
          },
        },
      },
      moves: {
        ...setRulesEnabledMoveDef,
        encryptDeck: {
          // Multiplayer: (null, preEncrypted). Offline tests may pass privateKey alone.
          move: (
            { G, ctx, playerID },
            privateKey?: string | null,
            preEncrypted?: Record<string, { ciphertext: string; layers: number }[]>,
          ) => encryptDeck(G, ctx, playerID, privateKey, preEncrypted as any),
          ...CONCURRENT,
        },
      },
      endIf: ({ G }) =>
        G.phase === "shuffle" ||
        G.phase === "play" ||
        G.playerOrder.every((pid) => !!G.players[pid]?.hasEncrypted),
      next: "shuffle",
    },

    shuffle: {
      onBegin: ({ G }) => {
        G.phase = "shuffle";
        resetSetupPlayer(G);
        pushActivityLog(G, "Shuffle phase — commit/reveal then permute", "system");
      },
      turn: {
        activePlayers: { all: "crypto" },
        stages: {
          crypto: {
            moves: {
              ...setRulesEnabledMoveDef,
              commitShuffleSeed: {
                move: ({ G, ctx, playerID }, commitHashHex: string, callerId?: string) =>
                  commitShuffleSeed(G, ctx, playerID, commitHashHex, callerId),
                ...CONCURRENT,
              },
              revealShuffleSeed: {
                move: ({ G, ctx, playerID }, seedHex: string, callerId?: string) =>
                  revealShuffleSeed(G, ctx, playerID, seedHex, callerId),
                ...CONCURRENT,
              },
              shuffleEncryptedDeck: {
                move: ({ G, ctx, playerID, events }) =>
                  shuffleEncryptedDeck(G, ctx, playerID, events),
                ...CONCURRENT,
              },
            },
          },
        },
      },
      moves: {
        ...setRulesEnabledMoveDef,
        commitShuffleSeed: {
          move: ({ G, ctx, playerID }, commitHashHex: string, callerId?: string) =>
            commitShuffleSeed(G, ctx, playerID, commitHashHex, callerId),
          ...CONCURRENT,
        },
        revealShuffleSeed: {
          move: ({ G, ctx, playerID }, seedHex: string, callerId?: string) =>
            revealShuffleSeed(G, ctx, playerID, seedHex, callerId),
          ...CONCURRENT,
        },
        shuffleEncryptedDeck: {
          move: ({ G, ctx, playerID, events }) =>
            shuffleEncryptedDeck(G, ctx, playerID, events),
          ...CONCURRENT,
        },
      },
      endIf: ({ G }) =>
        G.phase === "play" ||
        G.playerOrder.every((pid) => !!G.players[pid]?.hasShuffled),
      next: "play",
    },

    play: {
      onBegin: ({ G }) => {
        beginPlayPhase(G);
      },
      moves: {
        ...setRulesEnabledMoveDef,
        playInvention: {
          move: ({ G, ctx, playerID, events }, cardId: string, choices?: any) => {
            const result = playInvention(G, ctx, playerID, cardId, choices || {});
            if (result === INVALID_MOVE) return INVALID_MOVE;
            // Hold turn for rules prompts and mid-game deck ops (search/reshuffle).
            if (
              !(G.pendingPrompts && G.pendingPrompts.length > 0) &&
              !hasActiveDeckOp(G)
            ) {
              events?.endTurn?.();
            }
            return result;
          },
          client: false,
        },
        playAction: {
          move: ({ G, ctx, playerID, events }, cardId: string, choices?: any) => {
            const result = playAction(G, ctx, playerID, cardId, choices || {});
            if (result === INVALID_MOVE) return INVALID_MOVE;
            if (
              !(G.pendingPrompts && G.pendingPrompts.length > 0) &&
              !hasActiveDeckOp(G) &&
              !(G as any).pendingActionResolve
            ) {
              events?.endTurn?.();
            }
            return result;
          },
          client: false,
        },
        /**
         * Hand react (Herbalism-style): any seat that owns the reactor may answer
         * yes/no even when it is not their turn.
         */
        submitReact: {
          move: (
            { G, playerID, events },
            promptId: string,
            value: string | string[],
          ) => {
            const result = submitReact(G, playerID, promptId, value);
            if (result === INVALID_MOVE) return INVALID_MOVE;
            // After cancel or full resolve (no more prompts / deck op), end turn.
            if (
              !(G.pendingPrompts && G.pendingPrompts.length > 0) &&
              !hasActiveDeckOp(G) &&
              !(G as any).pendingActionResolve
            ) {
              events?.endTurn?.();
            }
            return result;
          },
          ...CONCURRENT,
        },
        /**
         * Play-effect prompts for a non-actor (e.g. Thought Police redirect).
         * Concurrent so the defending owner can answer off-turn.
         */
        submitPlayChoice: {
          move: (
            { G, playerID, events },
            promptId: string,
            value: string | string[],
          ) => {
            const result = submitPlayChoice(G, playerID, promptId, value);
            if (result === INVALID_MOVE) return INVALID_MOVE;
            if (
              !(G.pendingPrompts && G.pendingPrompts.length > 0) &&
              !hasActiveDeckOp(G) &&
              !G.pendingPlayEffect
            ) {
              events?.endTurn?.();
            }
            return result;
          },
          ...CONCURRENT,
        },
        pass: {
          move: ({ G, ctx, playerID, events }) => {
            const result = pass(G, ctx, playerID);
            if (result === INVALID_MOVE) return INVALID_MOVE;
            // Day may have advanced inside pass → endDay; still end the turn.
            if (G.phase === "scoring") {
              events?.endPhase?.();
            } else {
              events?.endTurn?.();
            }
            return result;
          },
          client: false,
        },
        /** Cooperative mental-poker decrypt layer (auto-driven by board). */
        submitDecryptionShare: {
          move: ({ G, ctx, playerID }, requestId: string, share: any) =>
            submitDecryptionShare(G, ctx, playerID, requestId, share),
          ...CONCURRENT,
        },
        /** Mid-game fair reshuffle commit (search-deck / shuffle-after). */
        commitDeckOpSeed: {
          move: ({ G, playerID }, commitHashHex: string) =>
            commitDeckOpSeed(G, playerID, commitHashHex),
          ...CONCURRENT,
        },
        revealDeckOpSeed: {
          move: ({ G, playerID, events }, seedHex: string) => {
            const r = revealDeckOpSeed(G, playerID, seedHex);
            if (r === INVALID_MOVE) return INVALID_MOVE;
            // Reshuffle may finish without reencrypt (empty remainder).
            if (!hasActiveDeckOp(G) && !(G.pendingPrompts?.length)) {
              events?.endTurn?.();
            }
            return r;
          },
          ...CONCURRENT,
        },
        /** Re-encrypt remaining deck after search/reshuffle (sequential). */
        submitDeckOpReencrypt: {
          move: (
            { G, playerID, events },
            privateKey?: string | null,
            preEncrypted?: any,
          ) => {
            const r = submitDeckOpReencrypt(G, playerID, privateKey, preEncrypted);
            if (r === INVALID_MOVE) return INVALID_MOVE;
            if (!hasActiveDeckOp(G) && !(G.pendingPrompts?.length)) {
              events?.endTurn?.();
            }
            return r;
          },
          ...CONCURRENT,
        },
      },
      turn: {
        // Keep all players active so either peer can toggle rules / submit decrypt
        // shares without waiting for their turn. Invent/action/pass still check currentPlayer.
        activePlayers: ALL_ACTIVE,
        order: {
          /**
           * RULES.md: earliest home-era deck goes first on day 1; each new day
           * the first player rotates to the next home era in chronological order.
           * Within a day, turns cycle homeEraTurnOrder until all pass.
           */
          first: ({ G }: { G: TimestreamsState }) => {
            // Do not mutate G here — boardgame.io freezes state during turn-order
            // init (assigning dayFirstPlayer throws "read only property").
            // beginPlayPhase / endDay already set dayFirstPlayer + startOfDayPending.
            const pid =
              G.dayFirstPlayer || dayFirstPlayer(G, G.currentDay || 1);
            return playOrderIndexForPlayer(G, pid);
          },
          next: ({ G, ctx }: { G: TimestreamsState; ctx: Ctx }) =>
            resolveNextPlayOrderPos(G, ctx),
        },
      },
      endIf: ({ G }) => G.phase === "scoring" || G.phase === "gameOver",
      next: "scoring",
    },

    scoring: {
      onBegin: ({ G }) => {
        try {
          const done = beginScoringPhase(G);
          if (done) G.phase = "gameOver";
        } catch (err) {
          console.error("[scoring] beginScoringPhase failed — falling back", err);
          G.scores = Object.fromEntries(G.playerOrder.map((pid) => [pid, 0]));
          G.winner = G.playerOrder[0] ?? null;
          G.phase = "gameOver";
        }
      },
      // Stage.NULL (all: null) keeps phase-level moves available for every seat.
      // A named stage without stages.moves drops ackScoreStep/submitScoreChoice
      // after multi-step chains (Nanotech loop) — dual-seat then looks "stuck".
      turn: {
        activePlayers: ALL_ACTIVE,
      },
      moves: {
        ...setRulesEnabledMoveDef,
        /** Answer score-phase effect choices (guess, choice, swap, …). */
        submitScoreChoice: {
          move: (
            { G, playerID },
            promptId: string,
            value: string | string[],
          ) => {
            const result = submitScoreChoice(G, playerID, promptId, value);
            if (result === "INVALID_MOVE") return INVALID_MOVE;
            return G;
          },
          // Dual-seat / P2P: nested Nanotech prompts + concurrent acks race stateIDs.
          ...CONCURRENT,
        },
        /**
         * Dual-ack: both players confirm the current scored card before the
         * walk advances to the next slot (all eras, iteratively).
         */
        ackScoreStep: {
          move: ({ G, playerID }) => {
            const result = ackScoreStep(G, playerID);
            if (result === "INVALID_MOVE") return INVALID_MOVE;
            return G;
          },
          ...CONCURRENT,
        },
      },
      endIf: ({ G }) => G.phase === "gameOver",
      next: "gameOver",
    },

    gameOver: {
      endIf: () => true,
    },

    voided: {
      moves: {
        voteAbortReveal: {
          move: ({ G, playerID }) => {
            if (!G.abortVotes) G.abortVotes = {};
            G.abortVotes[playerID] = true;
            const voted = Object.keys(G.abortVotes).length;
            const total = G.playerOrder?.length || 0;
            if (voted >= Math.ceil(total / 2)) {
              // Majority voted to abort — mark for external handling (e.g. UI shows aborted state)
              G.aborted = true;
              G.abortReason = 'majority-vote-abort-reveal';
            }
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
  description: "Timestreams — cryptographically fair era-seeding card game (full M2/M3 rules engine: play effects, scoring, reacts)",

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
    // Free tools + structural play when rules engine is off.
    if (state.config?.rulesEnabled === false) {
      if (moveName === "setRulesEnabled" && args[0] === true) {
        return { valid: false, reason: "rules cannot be re-enabled this match" };
      }
      return { valid: true };
    }
    // Basic rules enforcement (government, protect/move/discard blocks)
    if (moveName === 'playInvention' || moveName === 'playAction') {
      const cardId = args[0] as string;
      const card = getCard(state, cardId) || state.players[playerID]?.hand.find(c => c.id === cardId);
      if (!card) return { valid: false, reason: 'unknown card' };

      // Government rule
      if (hasTag(card, 'rule:one-government-per-era') && card.subtypes?.includes('government')) {
        const today = state.timeline[Object.keys(state.timeline)[state.currentDay - 1] as any] || { stack: [] };
        const hasGov = (today.stack || []).some((id: string) => {
          const c = getCard(state, id);
          return c?.subtypes?.includes('government');
        });
        if (hasGov) return { valid: false, reason: 'rule:one-government-per-era' };
      }

      // Basic protect for certain moves (if the move implies discard/move)
      if (moveName === 'playInvention' && hasTag(card, 'play:discard')) {
        // would be validated in executor, but basic here
      }
    }

    if (moveName === 'playInvention') {
      // could add more
    }

    return { valid: true };
  },

  getBoardgameIOGame: () => TimestreamsGame,
};

export default TimestreamsModule;
