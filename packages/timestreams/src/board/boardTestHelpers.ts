/**
 * Shared harness for TimestreamsBoard tests (plan Phase 0.B).
 */
import type { TimestreamsState, TimestreamsCard, EraId } from "../types";
import { DEFAULT_CONFIG } from "../types";
import { createTimeline } from "../timeline";
import { makeCard } from "../effects/testFixtures";

export type BoardMoves = {
  playInvention?: (...args: any[]) => void;
  playAction?: (...args: any[]) => void;
  pass?: (...args: any[]) => void;
  claimHomeEra?: (...args: any[]) => void;
  setReady?: (...args: any[]) => void;
  setRulesEnabled?: (...args: any[]) => void;
  ackScoreStep?: (...args: any[]) => void;
  submitScoreChoice?: (...args: any[]) => void;
  [k: string]: any;
};

export function basePlayer(overrides: Partial<TimestreamsState["players"][string]> = {}) {
  return {
    homeEra: null as EraId | null,
    ready: false,
    hand: [] as TimestreamsCard[],
    discard: [] as TimestreamsCard[],
    scorePile: [] as TimestreamsCard[],
    hasPassedThisDay: false,
    publicKey: null,
    hasEncrypted: false,
    hasShuffled: false,
    ...overrides,
  };
}

export function makePlayState(overrides: Partial<TimestreamsState> = {}): TimestreamsState {
  const playerOrder = overrides.playerOrder ?? ["0", "1"];
  const players: TimestreamsState["players"] = { ...(overrides.players || {}) };
  for (const pid of playerOrder) {
    if (!players[pid]) {
      players[pid] = basePlayer({
        homeEra: pid === "0" ? "stone" : "future",
        ready: true,
      });
    }
  }
  return {
    playerOrder,
    phase: "play",
    timeline: createTimeline(),
    currentDay: 1,
    dayFirstPlayer: playerOrder[0],
    encryptedDecks: Object.fromEntries(playerOrder.map((p) => [p, []])),
    cardPoints: {},
    shuffleRng: null,
    eraAssignmentRng: null,
    pendingDecryptRequests: [],
    setupPlayerIndex: 0,
    cardVisibility: {},
    proofChain: [],
    scores: Object.fromEntries(playerOrder.map((p) => [p, 0])),
    winner: null,
    cards: {},
    pendingPrompts: [],
    ...overrides,
    players,
    config: { ...DEFAULT_CONFIG, ...(overrides.config || {}) },
  } as TimestreamsState;
}

export function makeSetupState(overrides: Partial<TimestreamsState> = {}): TimestreamsState {
  return makePlayState({
    phase: "setup",
    players: {
      "0": basePlayer(),
      "1": basePlayer(),
    },
    ...overrides,
  });
}

export function makeBoardProps(overrides: {
  G?: Partial<TimestreamsState>;
  ctx?: Record<string, unknown>;
  moves?: BoardMoves;
  playerID?: string;
} = {}) {
  const G = makePlayState(overrides.G || {});
  const moves: BoardMoves = {
    playInvention: () => {},
    playAction: () => {},
    pass: () => {},
    claimHomeEra: () => {},
    setReady: () => {},
    setRulesEnabled: () => {},
    ...overrides.moves,
  };
  return {
    G,
    ctx: {
      currentPlayer: "0",
      phase: G.phase,
      numPlayers: G.playerOrder.length,
      playOrder: G.playerOrder,
      ...overrides.ctx,
    },
    moves,
    playerID: overrides.playerID ?? "0",
  } as any;
}

export function cardInHand(
  G: TimestreamsState,
  playerId: string,
  partial: Partial<TimestreamsCard> & { id: string },
): TimestreamsCard {
  const card = makeCard({ ownerId: playerId, ...partial });
  if (!G.cards) G.cards = {};
  G.cards[card.id] = card;
  G.players[playerId].hand.push(card);
  return card;
}

export { makeCard };
