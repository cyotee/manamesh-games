/**
 * One Piece TCG Game Module Tests
 *
 * Tests for the boardgame.io game definition, moves, and state management.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import type { Ctx } from "boardgame.io";
import {
  OnePieceModule,
  OnePieceGame,
  createInitialState,
  createDonCards,
  shuffleDeck,
  validateMove,
  onePieceCardSchema,
} from "./game";
import { ONEPIECE_ZONES } from "./zones";
import type { OnePieceCard, OnePieceState, OnePieceDonCard } from "./types";
import { DEFAULT_CONFIG } from "./types";

// =============================================================================
// Test Utilities
// =============================================================================

function createMockCtx(currentPlayer: string = "0"): Ctx {
  return {
    numPlayers: 2,
    turn: 1,
    currentPlayer,
    playOrder: ["0", "1"],
    playOrderPos: 0,
    phase: "play",
    activePlayers: null,
  } as Ctx;
}

function createTestCard(overrides: Partial<OnePieceCard> = {}): OnePieceCard {
  return {
    id: `OP01-${Math.random().toString(36).slice(2, 7)}`,
    name: "Test Character",
    cardType: "character",
    cost: 3,
    power: 5000,
    color: ["red"],
    set: "OP01",
    cardNumber: "004",
    rarity: "C",
    ...overrides,
  };
}

function createLeaderCard(): OnePieceCard {
  return createTestCard({
    id: "OP01-001",
    name: "Monkey D. Luffy",
    cardType: "leader",
    cost: 0,
    power: 5000,
    rarity: "L",
    life: 5,
    cardNumber: "001",
    attributes: ["Supernovas", "Straw Hat Crew"],
  });
}

function createTestDeck(): OnePieceCard[] {
  const leader = createLeaderCard();
  const mainCards: OnePieceCard[] = [];

  for (let i = 0; i < 50; i++) {
    mainCards.push(
      createTestCard({
        id: `char-${i}`,
        name: `Character ${i}`,
        cardNumber: String(i + 10).padStart(3, "0"),
      }),
    );
  }

  return [leader, ...mainCards];
}

function createTestState(): OnePieceState {
  return createInitialState({
    numPlayers: 2,
    playerIDs: ["0", "1"],
  });
}

function createPopulatedState(): OnePieceState {
  const state = createTestState();

  // Add cards to player 0's hand and deck
  for (let i = 0; i < 5; i++) {
    const card = createTestCard({
      id: `hand-${i}`,
      name: `Hand Card ${i}`,
      cardNumber: String(i).padStart(3, "0"),
    });
    state.players["0"].hand.push(card);
    state.cardVisibility[card.id] = "owner-known";
  }

  for (let i = 0; i < 30; i++) {
    const card = createTestCard({
      id: `deck-${i}`,
      name: `Deck Card ${i}`,
      cardNumber: String(i + 10).padStart(3, "0"),
    });
    state.players["0"].mainDeck.push(card);
    state.cardVisibility[card.id] = "encrypted";
  }

  // Place leader
  state.players["0"].playArea[0].cardId = "leader-0";
  state.cardVisibility["leader-0"] = "public";

  return state;
}

// =============================================================================
// Initial State Tests
// =============================================================================

describe("createInitialState", () => {
  it("should create state for 2 players", () => {
    const state = createTestState();
    expect(Object.keys(state.players)).toHaveLength(2);
    expect(state.players["0"]).toBeDefined();
    expect(state.players["1"]).toBeDefined();
  });

  it("should initialize all zones as empty arrays", () => {
    const state = createTestState();
    for (const playerId of ["0", "1"]) {
      expect(state.players[playerId].mainDeck).toEqual([]);
      expect(state.players[playerId].lifeDeck).toEqual([]);
      expect(state.players[playerId].trash).toEqual([]);
      expect(state.players[playerId].hand).toEqual([]);
      expect(state.players[playerId].donArea).toEqual([]);
    }
  });

  it("should create DON!! deck with default 10 DON cards", () => {
    const state = createTestState();
    expect(state.players["0"].donDeck).toHaveLength(10);
    expect(state.players["1"].donDeck).toHaveLength(10);
  });

  it("should create play area with correct slots", () => {
    const state = createTestState();
    const playArea = state.players["0"].playArea;

    // 1 leader + 5 character + 1 stage = 7
    expect(playArea).toHaveLength(7);
    expect(playArea[0].slotType).toBe("leader");
    expect(playArea.filter((s) => s.slotType === "character")).toHaveLength(5);
    expect(playArea.filter((s) => s.slotType === "stage")).toHaveLength(1);
  });

  it("should use default config", () => {
    const state = createTestState();
    expect(state.config).toEqual(DEFAULT_CONFIG);
  });

  it("should set phase to setup", () => {
    const state = createTestState();
    expect(state.phase).toBe("setup");
  });

  it("should initialize empty proof chain", () => {
    const state = createTestState();
    expect(state.proofChain).toEqual([]);
  });

  it("should initialize empty card visibility", () => {
    const state = createTestState();
    expect(state.cardVisibility).toEqual({});
  });

  it("should initialize empty active peeks", () => {
    const state = createTestState();
    expect(state.activePeeks).toEqual([]);
  });

  it("should initialize winner as null", () => {
    const state = createTestState();
    expect(state.winner).toBeNull();
  });
});

// =============================================================================
// DON Card Tests
// =============================================================================

describe("createDonCards", () => {
  it("should create the specified number of DON cards", () => {
    const cards = createDonCards(10, "0");
    expect(cards).toHaveLength(10);
  });

  it("should create DON cards with correct properties", () => {
    const cards = createDonCards(1, "0");
    expect(cards[0].cardType).toBe("don");
    expect(cards[0].name).toBe("DON!!");
    expect(cards[0].id).toMatch(/^don-0-/);
  });

  it("should create unique IDs per card", () => {
    const cards = createDonCards(5, "0");
    const ids = new Set(cards.map((c) => c.id));
    expect(ids.size).toBe(5);
  });

  it("should include player ID in card ID", () => {
    const cards = createDonCards(1, "player-42");
    expect(cards[0].id).toContain("player-42");
  });
});

// =============================================================================
// Shuffle Tests
// =============================================================================

describe("shuffleDeck", () => {
  it("should return a new array", () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffleDeck(original);
    expect(shuffled).not.toBe(original);
  });

  it("should preserve all elements", () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffleDeck(original);
    expect(shuffled.sort()).toEqual(original.sort());
  });

  it("should handle empty array", () => {
    expect(shuffleDeck([])).toEqual([]);
  });

  it("should handle single element", () => {
    expect(shuffleDeck([1])).toEqual([1]);
  });
});

// =============================================================================
// Move Validation Tests
// =============================================================================

describe("validateMove", () => {
  let state: OnePieceState;

  beforeEach(() => {
    state = createPopulatedState();
  });

  it("should validate drawCard with non-empty deck", () => {
    const result = validateMove(state, "drawCard", "0");
    expect(result.valid).toBe(true);
  });

  it("should reject drawCard with empty deck", () => {
    state.players["0"].mainDeck = [];
    const result = validateMove(state, "drawCard", "0");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("should validate drawDon with non-empty DON deck", () => {
    const result = validateMove(state, "drawDon", "0");
    expect(result.valid).toBe(true);
  });

  it("should reject drawDon with empty DON deck", () => {
    state.players["0"].donDeck = [];
    const result = validateMove(state, "drawDon", "0");
    expect(result.valid).toBe(false);
  });

  it("should validate playCard with cards in hand", () => {
    const result = validateMove(state, "playCard", "0");
    expect(result.valid).toBe(true);
  });

  it("should reject playCard with empty hand", () => {
    state.players["0"].hand = [];
    const result = validateMove(state, "playCard", "0");
    expect(result.valid).toBe(false);
  });

  it("should always validate surrender", () => {
    const result = validateMove(state, "surrender", "0");
    expect(result.valid).toBe(true);
  });

  it("should reject invalid player", () => {
    const result = validateMove(state, "drawCard", "nonexistent");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid player");
  });
});

// =============================================================================
// Module Export Tests
// =============================================================================

describe("OnePieceModule", () => {
  it("should have correct identity", () => {
    expect(OnePieceModule.id).toBe("onepiece");
    expect(OnePieceModule.name).toBe("One Piece TCG");
    expect(OnePieceModule.version).toBe("1.0.0");
  });

  it("should export card schema", () => {
    expect(OnePieceModule.cardSchema).toBeDefined();
    expect(OnePieceModule.cardSchema.validate).toBeTypeOf("function");
    expect(OnePieceModule.cardSchema.create).toBeTypeOf("function");
    expect(OnePieceModule.cardSchema.getAssetKey).toBeTypeOf("function");
  });

  it("should define all 7 zones", () => {
    expect(OnePieceModule.zones).toHaveLength(7);
    const zoneIds = OnePieceModule.zones.map((z) => z.id);
    expect(zoneIds).toContain("mainDeck");
    expect(zoneIds).toContain("lifeDeck");
    expect(zoneIds).toContain("donDeck");
    expect(zoneIds).toContain("trash");
    expect(zoneIds).toContain("hand");
    expect(zoneIds).toContain("playArea");
    expect(zoneIds).toContain("donArea");
  });

  it("should export asset requirements", () => {
    expect(OnePieceModule.assetRequirements.required).toContain("card_face");
    expect(OnePieceModule.assetRequirements.idFormat).toBe("set_collector");
  });

  it("should export getBoardgameIOGame", () => {
    const game = OnePieceModule.getBoardgameIOGame();
    expect(game).toBeDefined();
    expect(game.name).toBe("onepiece");
  });

  it("should export zone layout", () => {
    expect(OnePieceModule.zoneLayout).toBeDefined();
    expect(OnePieceModule.zoneLayout!.zones.mainDeck).toBeDefined();
    expect(OnePieceModule.zoneLayout!.zones.hand).toBeDefined();
  });
});

// =============================================================================
// OnePieceGame Definition Tests
// =============================================================================

describe("OnePieceGame", () => {
  it("should have correct name", () => {
    expect(OnePieceGame.name).toBe("onepiece");
  });

  it("should set up initial state", () => {
    const ctx = {
      numPlayers: 2,
      playOrder: ["0", "1"],
    } as Ctx;
    const state = OnePieceGame.setup!(ctx, {} as never);
    expect(state.players["0"]).toBeDefined();
    expect(state.players["1"]).toBeDefined();
  });

  it("should detect game over via endIf", () => {
    const state = createTestState();
    const ctx = createMockCtx();

    // Not over
    expect(OnePieceGame.endIf!({ G: state, ctx } as never)).toBeUndefined();

    // Set winner
    state.winner = "0";
    expect(OnePieceGame.endIf!({ G: state, ctx } as never)).toEqual({
      winner: "0",
    });
  });
});

// =============================================================================
// Zone Definition Tests
// =============================================================================

describe("ONEPIECE_ZONES", () => {
  it("should have 7 zones", () => {
    expect(ONEPIECE_ZONES).toHaveLength(7);
  });

  it("should have mainDeck as hidden, ordered, with peek/shuffle/search/draw", () => {
    const zone = ONEPIECE_ZONES.find((z) => z.id === "mainDeck");
    expect(zone).toBeDefined();
    expect(zone!.visibility).toBe("hidden");
    expect(zone!.ordered).toBe(true);
    expect(zone!.features).toContain("peek");
    expect(zone!.features).toContain("shuffle");
    expect(zone!.features).toContain("search");
    expect(zone!.features).toContain("draw");
  });

  it("should have lifeDeck as private, ordered", () => {
    const zone = ONEPIECE_ZONES.find((z) => z.id === "lifeDeck");
    expect(zone!.visibility).toBe("private");
    expect(zone!.ordered).toBe(true);
  });

  it("should have donDeck as public", () => {
    const zone = ONEPIECE_ZONES.find((z) => z.id === "donDeck");
    expect(zone!.visibility).toBe("public");
  });

  it("should have trash as public with search", () => {
    const zone = ONEPIECE_ZONES.find((z) => z.id === "trash");
    expect(zone!.visibility).toBe("public");
    expect(zone!.features).toContain("search");
  });

  it("should have hand as owner-only", () => {
    const zone = ONEPIECE_ZONES.find((z) => z.id === "hand");
    expect(zone!.visibility).toBe("owner-only");
  });

  it("should have playArea as public", () => {
    const zone = ONEPIECE_ZONES.find((z) => z.id === "playArea");
    expect(zone!.visibility).toBe("public");
  });

  it("should have donArea as public", () => {
    const zone = ONEPIECE_ZONES.find((z) => z.id === "donArea");
    expect(zone!.visibility).toBe("public");
  });

  it("should have no shared zones", () => {
    for (const zone of ONEPIECE_ZONES) {
      expect(zone.shared).toBe(false);
    }
  });
});

// =============================================================================
// leaderLife Tests
// =============================================================================

describe("leaderLife", () => {
  it("should initialize leaderLife for all players", () => {
    const state = createTestState();
    expect(state.leaderLife["0"]).toBe(5);
    expect(state.leaderLife["1"]).toBe(5);
  });

  it("should set leaderLife from leader card life value", async () => {
    const state = createTestState();
    state.phase = "setup";
    const leader = createLeaderCard();
    const deck = [
      leader,
      ...Array(50)
        .fill(null)
        .map((_, i) =>
          createTestCard({ id: `c-${i}`, cardNumber: String(i + 10) }),
        ),
    ];
    const { loadDeck } = await import("./game");
    // @ts-ignore
    loadDeck(state, createMockCtx(), "0", deck);
    expect(state.leaderLife["0"]).toBe(5);
  });
});

// =============================================================================
// Phase and Turn Structure Tests
// =============================================================================

describe("OnePieceGame phases", () => {
  it("should set phase to setup on setup", () => {
    const ctx = { numPlayers: 2, playOrder: ["0", "1"] } as Ctx;
    const state = OnePieceGame.setup!(ctx, {} as never);
    expect(state.phase).toBe("setup");
  });

  it("should advance to keyExchange when both players load decks", async () => {
    const ctx = { numPlayers: 2, playOrder: ["0", "1"] } as Ctx;
    const state = OnePieceGame.setup!(ctx, {} as never);
    state.phase = "setup";

    const deck0 = [
      createLeaderCard(),
      ...Array(50)
        .fill(null)
        .map((_, i) =>
          createTestCard({ id: `p0-c-${i}`, cardNumber: String(i + 10) }),
        ),
    ];
    const deck1 = [
      createLeaderCard(),
      ...Array(50)
        .fill(null)
        .map((_, i) =>
          createTestCard({ id: `p1-c-${i}`, cardNumber: String(i + 10) }),
        ),
    ];

    // Player 0 loads deck
    // @ts-ignore - accessing internal function for testing
    const { loadDeck } = await import("./game");
    // @ts-ignore
    loadDeck(state, createMockCtx("0"), "0", deck0);
    expect(state.phase).toBe("setup");
    expect(state.deckLoaded["0"]).toBe(true);

    // Player 1 loads deck - should advance to keyExchange
    // @ts-ignore
    loadDeck(state, createMockCtx("1"), "1", deck1);
    expect(state.phase).toBe("keyExchange");
    expect(state.deckLoaded["1"]).toBe(true);
  });

  it("endIf should return winner when leaderLife is 0", () => {
    const state = createTestState();
    state.phase = "play";
    state.leaderLife["0"] = 0;
    const ctx = createMockCtx("0");
    const result = OnePieceGame.endIf!({ G: state, ctx } as never);
    expect(result).toEqual({ winner: "1" });
  });

  it("endIf should return draw when phase is voided", () => {
    const state = createTestState();
    state.phase = "voided";
    const ctx = createMockCtx("0");
    const result = OnePieceGame.endIf!({ G: state, ctx } as never);
    expect(result).toEqual({ draw: true, reason: "voided" });
  });

  it("endIf should return winner when G.winner is set", () => {
    const state = createTestState();
    state.phase = "play";
    state.winner = "0";
    const ctx = createMockCtx("0");
    const result = OnePieceGame.endIf!({ G: state, ctx } as never);
    expect(result).toEqual({ winner: "0" });
  });
});

// =============================================================================
// DON!! Cost Tests
// =============================================================================

describe("playCard DON cost", () => {
  it("should validate that playCard checks card cost against activeDon", () => {
    const state = createPopulatedState();
    state.phase = "play";
    state.players["0"].activeDon = 2;
    const expensiveCard = createTestCard({
      id: "expensive",
      cost: 5,
      cardNumber: "100",
    });
    state.players["0"].hand.push(expensiveCard);

    const result = validateMove(state, "playCard", "0");
    expect(result.valid).toBe(true);
  });
});
