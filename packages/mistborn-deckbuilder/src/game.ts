/**
 * Mistborn Game Module — boardgame.io definition.
 *
 * Phase 1: Rules-free (structural enforcement only) + full mental-poker.
 * Freeform main phase until player ends turn.
 * Market + core card zones prioritized.
 */

import type { Game, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import type {
  MistbornState,
  MistbornConfig,
  MistbornCard,
  MistbornMove,
} from './types';
import { getBurnLimit } from './types';
import { MISTBORN_ZONES } from './zones';
import { getAllCards, getCharacter, PACK_CARDS_FROM_MANIFESTS } from './data';
import {
  MISTBORN_SETS,
  DECK_SET_MAPPING,
  getCardsForDeckType,
  getCardsForSet,
  DEFAULT_MISTBORN_PACK_SOURCE,
  IPFS_MISTBORN_PACK_SOURCE,
} from './assets';
import type { GameModule, GameConfig, MoveValidation } from '@manamesh/frontend/src/game/modules/types';
import type { CardManifestEntry } from '@manamesh/frontend/src/assets/manifest/types';

// =============================================================================
// Initial State
// =============================================================================

export function createInitialState(
  config: GameConfig & { packCards?: CardManifestEntry[] }
): MistbornState {
  const players: Record<string, any> = {};
  const zones: any = {
    deck: {},
    hand: {},
    play: {},
    discard: {},
    allies: {},
    market: { shared: [] },
    eliminated: { shared: [] },
    lordRulerDeck: { shared: [] },
  };

  const playerIDs = config.playerIDs || Array.from({ length: config.numPlayers }, (_, i) => `p${i}`);
  const packCards = config.packCards || [];
  packCardsCache = packCards; // for validateMove metadata access

  // Prefer pack cards using the explicit DECK_SET_MAPPING when provided
  let starterPool: MistbornCard[] = [];
  let marketIds: string[] = [];

  if (packCards.length > 0) {
    const starterManifests = getCardsForDeckType(packCards, 'starters');
    // Ensure 2 of each metal training card in the available pool
    const metalTraining = getCardsForSet(packCards, 'metal-training' as any);
    const metalWithDups = [...metalTraining, ...metalTraining.map((c, i) => ({...c, id: `${c.id}-dup${i}`}))];
    const charManifests = getCardsForSet(packCards, 'character' as any);
    const fundingManifests = getCardsForSet(packCards, 'funding' as any);

    // Build a starter pool: 4 metals + 1 character + 6 funding (rules-free selection)
    starterPool = [
      ...metalWithDups.slice(0, 4),
      charManifests[0] || metalWithDups[0],
      ...fundingManifests.slice(0, 6),
    ].map((c: any) => ({
      id: c.id,
      name: c.name,
      cost: c.metadata?.cost ?? 0,
      metal: c.metadata?.metal,
      pairing: c.metadata?.pairing,
      cardType: c.metadata?.cardType || (c.id.includes('Metal') ? 'character-starter' : 'funding'),
      effectText: c.metadata?.effectText,
      tags: c.metadata?.tags || [],
      imageCid: c.front,
      imagePath: c.front,
    } as MistbornCard));

    const marketManifests = getCardsForDeckType(packCards, 'market').slice(0, 6);
    marketIds = marketManifests.map((c: any) => c.id);
  } else {
    // Fallback local data
    const allCards = getAllCards();
    const metalBase = allCards.filter(c => c.cardType === 'character-starter' && c.metal);
    const metalDeck: MistbornCard[] = [];
    metalBase.forEach(card => {
      metalDeck.push({ ...card });
      metalDeck.push({ ...card, id: card.id + '-2' });
    });
    const charCard = allCards.find(c => c.cardType === 'character-starter' && c.name.toLowerCase().includes('vin')) || allCards[0];
    const fundings = allCards.filter(c => c.cardType === 'funding').slice(0, 6);
    starterPool = [...metalDeck.slice(0, 4), { ...charCard }, ...fundings];
    marketIds = allCards.slice(0, 6).map(c => c.id);
  }

  for (const pid of playerIDs) {
    const starterForPlayer = starterPool.map((c, idx) => ({
      ...c,
      id: `${c.id}-${pid}-${idx}`,
    }));

    const pos = 0;
    players[pid] = {
      character: 'vin',
      trainingPosition: pos,
      burnLimit: getBurnLimit(pos),
      unlockedLevels: 0,
      health: 36,
      metals: Array.from({ length: 8 }, (_, i) => ({
        metal: ['pewter','tin','bronze','copper','zinc','brass','iron','steel'][i] as any,
        burned: false,
        flared: false,
      })),
      missionPoints: 0,
      missionCubes: {},
      hasTarget: false,
    };

    zones.deck[pid] = [...starterForPlayer];
    zones.hand[pid] = [];
    zones.play[pid] = [];
    zones.discard[pid] = [];
    zones.allies[pid] = [];
  }

  const initialMarket = marketIds.length > 0 ? marketIds : getAllCards().slice(0, 6).map(c => c.id);

  return {
    players,
    playerOrder: playerIDs,
    currentPlayer: playerIDs[0],
    phase: 'setup',
    zones,
    market: initialMarket,
    marketDeckCount: 40,
    eliminated: [],
    boxingsAvailable: 14,
    atiumAvailable: 16,
    selectedMissions: ['pits-of-hathsin', 'kredik-shaw', 'another'],
    isCoop: false,
    crypto: { players: {} } as any,
    cardVisibility: {},
    proofChain: [],
    moveHistory: [],
    winner: null,
  };
}

// =============================================================================
// Move Validation (Phase 1: structural only)
// =============================================================================

export function validateMove(
  state: MistbornState,
  move: string,
  playerID: string,
  ...args: any[]
): MoveValidation {
  const isCurrent = playerID === state.currentPlayer;

  if (!isCurrent && !['drawLordRulerCard'].includes(move)) {
    return { valid: false, error: 'Not your turn' };
  }

  const player = state.players[playerID];
  if (!player) return { valid: false, error: 'Player not found' };

  // Structural turn + zone checks always
  if (move === 'burnMetal' || move === 'playCard' || move === 'useAsMetal') {
    const currentBurns = (player.metals || []).filter((m: any) => m.burned).length;
    if (currentBurns >= (player.burnLimit || 1)) {
      // For Phase 1/early rules engine, we return invalid for overburn (can relax for pure free if desired)
      return { valid: false, error: `Burn limit reached (${player.burnLimit})` };
    }
  }

  if (move === 'playCard') {
    const cardId = args[0];
    const sideways = !!args[1];
    const entry = packCardsCache.find((c: any) => c.id === cardId) || {};
    const meta = entry.metadata || entry;
    const requiredMetal = meta.metal || meta.requiredMetal;

    if (sideways) {
      // Playing sideways = using the card as a metal via its pairing.
      // No external metal burn required; the card itself provides it.
      return { valid: true };
    }

    if (requiredMetal) {
      const hasMetal = (player.metals || []).some((m: any) => {
        const mName = Array.isArray(requiredMetal) ? requiredMetal.includes(m.metal) : m.metal === requiredMetal;
        return mName && !m.burned;
      });
      if (!hasMetal) {
        return { valid: false, error: `Missing required metal: ${requiredMetal}` };
      }
    }
  }

  if (move === 'buyCard') {
    const cardId = args[0];
    const inMarket = (state.market || []).some((c: any) => (typeof c === 'string' ? c === cardId : c.id === cardId));
    if (!inMarket) {
      return { valid: false, error: 'Card not in market' };
    }
    const meta = (packCardsCache.find((p: any) => p.id === cardId)?.metadata) || {};
    const cost = Number(meta.cost ?? 0);
    const coins = computeCoins(state, playerID);
    if (cost > 0 && coins < cost) {
      return { valid: false, error: `Not enough coins (have ${coins}, need ${cost})` };
    }
  }

  if (move === 'eliminateCard') {
    // Only cards you control (structural)
    const from = args[1];
    if (from && !['hand', 'play', 'discard'].includes(from)) {
      return { valid: false, error: 'Invalid eliminate source zone' };
    }
  }

  // Structural moves (order enforced at top of validate)
  if (['cleanupAndDraw', 'passTarget', 'endTurn', 'refillMarket', 'draw'].includes(move)) {
    return { valid: true };
  }

  return { valid: true };
}

// Temporary cache for pack cards in validation (will be wired better)
let packCardsCache: any[] = [];

// Expose a setter for consumers (e.g. board or test harness can refresh metadata)
export function setPackCardsForValidation(cards: any[]) {
  packCardsCache = Array.isArray(cards) ? cards : [];
}

// Helper to compute available coins from played cards using pack metadata.
// Rules engine version: looks for explicit "coin" tags and "gain ... coin" effects.
// Funding cards (tag or type) contribute 1 each.
export function computeCoins(G: MistbornState, pid: string): number {
  const play = G.zones.play?.[pid] || [];
  let coins = 0;

  play.forEach((c: any) => {
    const id = c?.id || c;
    const meta = (packCardsCache.find((p: any) => p.id === id)?.metadata) || (c as any).metadata || {};
    const tags: string[] = meta.tags || [];
    const effect: string = (meta.effectText || '').toLowerCase();
    const cardType = meta.cardType || '';

    if (tags.includes('coin') || effect.includes('coin') || /gain\s+\d*\s*coin/.test(effect)) {
      // Prefer explicit value if present; fall back to 1 or card cost heuristic
      const val = meta.coinValue ?? (meta.cost && meta.cost > 0 ? meta.cost : 1);
      coins += val;
    }

    if (tags.includes('funding') || cardType === 'funding') {
      coins += 1;
    }
  });

  // Boxings can be converted (very simple model for now)
  const boxings = (G as any).boxingsAvailable || 0;
  coins += Math.min(2, Math.floor(boxings / 2)); // e.g. spend boxings for coins

  return coins;
}

// =============================================================================
// Moves (stubs — implement real logic next)
// =============================================================================

const moves = {
  draw: (G: MistbornState, ctx: Ctx, count = 5) => {
    const pid = ctx.currentPlayer!;
    const deck = G.zones.deck[pid] || [];
    const hand = G.zones.hand[pid] || [];
    const toDraw = Math.min(count, deck.length);
    const drawn = deck.splice(0, toDraw);
    G.zones.hand[pid] = [...hand, ...drawn];
    G.moveHistory.push({ playerId: pid, move: 'draw', args: [count], timestamp: Date.now() });
    return G;
  },

  playCard: (G: MistbornState, ctx: Ctx, cardId: string, sideways = false) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'playCard', pid, cardId, sideways);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    const hand = G.zones.hand[pid] || [];
    const play = G.zones.play[pid] || [];
    const idx = hand.findIndex((c: any) => c.id === cardId);
    if (idx >= 0) {
      const card = hand.splice(idx, 1)[0];
      // sideways can be represented by a flag on the card instance in play
      (card as any)._sideways = sideways;
      G.zones.play[pid] = [...play, card];
    }
    G.moveHistory.push({ playerId: pid, move: 'playCard', args: [cardId, sideways], timestamp: Date.now() });
    return G;
  },

  burnMetal: (G: MistbornState, ctx: Ctx, metal: string, attachTo?: string) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'burnMetal', pid, metal, attachTo);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    const player = G.players[pid];
    const ms = player.metals.find((m: any) => m.metal === metal);
    if (ms) {
      ms.burned = true;
      if (attachTo) ms.attachedTo = attachTo;
    }
    G.moveHistory.push({ playerId: pid, move: 'burnMetal', args: [metal, attachTo], timestamp: Date.now() });
    return G;
  },

  refillMarket: (G: MistbornState, ctx: Ctx) => {
    // Simple structural refill (rules-free version)
    while (G.market.length < 6 && G.marketDeckCount > 0) {
      // In real: draw from market deck zone
      G.market.push(`market-${G.market.length + 100}`);
      G.marketDeckCount--;
    }
    G.moveHistory.push({ playerId: ctx.currentPlayer!, move: 'refillMarket', args: [], timestamp: Date.now() });
    return G;
  },

  buyCard: (G: MistbornState, ctx: Ctx, cardId: string) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'buyCard', pid, cardId);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    const idx = G.market.findIndex((c: any) => (typeof c === 'string' ? c === cardId : c.id === cardId));
    if (idx >= 0) {
      G.market.splice(idx, 1);
      // Resolve full enriched entry from pack cache when possible (for future metadata use)
      const entry = packCardsCache.find((p: any) => p.id === cardId) || { id: cardId, name: cardId };
      const fullCard = {
        id: entry.id || cardId,
        name: entry.name || cardId,
        cost: entry.metadata?.cost ?? entry.cost ?? 0,
        metal: entry.metadata?.metal,
        tags: entry.metadata?.tags || [],
        effectText: entry.metadata?.effectText,
        imagePath: entry.front || entry.imagePath,
      };
      G.zones.discard[pid] = G.zones.discard[pid] || [];
      G.zones.discard[pid].push(fullCard as any);
      if (G.marketDeckCount > 0) {
        G.market.push(`market-refill-${Date.now()}`);
        G.marketDeckCount--;
      }
    }
    G.moveHistory.push({ playerId: pid, move: 'buyCard', args: [cardId], timestamp: Date.now() });
    return G;
  },

  cleanupAndDraw: (G: MistbornState, ctx: Ctx) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'cleanupAndDraw', pid);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    const play = G.zones.play[pid] || [];
    const hand = G.zones.hand[pid] || [];
    const discard = G.zones.discard[pid] || [];

    G.zones.discard[pid] = [...discard, ...play, ...hand];
    G.zones.play[pid] = [];
    G.zones.hand[pid] = [];

    const deck = G.zones.deck[pid] || [];
    const toDraw = Math.min(5, deck.length);
    const drawn = deck.splice(0, toDraw);
    G.zones.hand[pid] = drawn;

    G.moveHistory.push({ playerId: pid, move: 'cleanupAndDraw', args: [], timestamp: Date.now() });
    return G;
  },

  // Single definition (rules-free for Phase 1; will add metadata checks in validate + Phase 2)
  advanceTraining: (G: MistbornState, ctx: Ctx) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'advanceTraining', pid);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    const player = G.players[pid];
    if (player) {
      player.trainingPosition = (player.trainingPosition || 0) + 1;
      player.burnLimit = Math.min(4, 1 + Math.floor((player.trainingPosition || 0) / 3));
    }
    G.moveHistory.push({ playerId: pid, move: 'advanceTraining', args: [], timestamp: Date.now() });
    return G;
  },

  eliminateCard: (G: MistbornState, ctx: Ctx, cardId: string, from: string) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'eliminateCard', pid, cardId, from);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    const zoneKey = from === 'play' ? 'play' : (from === 'discard' ? 'discard' : 'hand');
    if (G.zones[zoneKey] && G.zones[zoneKey][pid]) {
      G.zones[zoneKey][pid] = G.zones[zoneKey][pid].filter((c: any) => c.id !== cardId);
    }
    G.moveHistory.push({ playerId: pid, move: 'eliminateCard', args: [cardId, from], timestamp: Date.now() });
    return G;
  },

  useAsMetal: (G: MistbornState, ctx: Ctx, cardId: string) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'useAsMetal', pid, cardId);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    // Find in play, mark as sideways/used as metal
    if (G.zones.play && G.zones.play[pid]) {
      const card = G.zones.play[pid].find((c: any) => c.id === cardId);
      if (card) {
        (card as any)._sideways = true;
        // Simulate burning a metal from the card's pairing (metadata driven later)
      }
    }
    G.moveHistory.push({ playerId: pid, move: 'useAsMetal', args: [cardId], timestamp: Date.now() });
    return G;
  },

  passTarget: (G: MistbornState, ctx: Ctx) => {
    const pid = ctx.currentPlayer!;
    const validation = validateMove(G, 'passTarget', pid);
    if (!validation.valid) {
      return INVALID_MOVE;
    }
    const pids = Object.keys(G.players);
    const idx = pids.indexOf(pid);
    const next = pids[(idx + 1) % pids.length];
    (G as any).targetHolder = next;
    G.moveHistory.push({ playerId: pid, move: 'passTarget', args: [], timestamp: Date.now() });
    return G;
  },

  // End current player's main actions (rules engine will gate by phase)
  endTurn: (G: MistbornState, ctx: Ctx) => {
    const pid = ctx.currentPlayer!;
    // In full rules: perform cleanup/draw automatically or require explicit
    G.moveHistory.push({ playerId: pid, move: 'endTurn', args: [], timestamp: Date.now() });
    // boardgame.io will advance via turn order; explicit phase end handled in future
    return G;
  },
};

// =============================================================================
// Game Definition
// =============================================================================

export const MistbornGame: Game<MistbornState> = {
  name: 'mistborn-deckbuilder',
  setup: (ctx: Ctx, setupData?: any) => {
    const packCards = setupData?.packCards || PACK_CARDS_FROM_MANIFESTS;
    return createInitialState({ 
      numPlayers: ctx.numPlayers, 
      playerIDs: ctx.playOrder,
      packCards,
    } as any);
  },
  // Note: onBegin etc. typed in the turn config below

  moves,
  turn: {
    // Rules engine: auto advance training at start of turn (per RULES)
    onBegin: (G: MistbornState, ctx: Ctx) => {
      const pid = ctx.currentPlayer!;
      const player = G.players[pid];
      if (player) {
        player.trainingPosition = (player.trainingPosition || 0) + 1;
        player.burnLimit = Math.min(4, 1 + Math.floor(player.trainingPosition / 3));
        // Reset per-turn metal burns (rules engine will do on turn begin)
        if (Array.isArray(player.metals)) {
          player.metals.forEach((m: any) => { m.burned = false; m.flared = false; });
        }
      }
      // Ensure targetHolder seeded
      if (!(G as any).targetHolder) {
        (G as any).targetHolder = pid;
      }
      return G;
    },
  },
  phases: {
    setup: { start: true, next: 'keyExchange' },
    keyExchange: { /* crypto for mental poker - full in later milestone */ },
    encrypt: {},
    shuffle: {},
    play: {
      moves,
      // Main freeform play for rules-free + early engine.
      // Later: onBegin of subphases, endIf conditions, explicit endMainPhase -> combat/cleanup.
    },
  },
  endIf: (G) => G.winner,
};

// =============================================================================
// GameModule
// =============================================================================

export const MistbornModule: GameModule = {
  id: 'mistborn-deckbuilder',
  name: 'Mistborn: The Deck Building Game',
  version: '0.1.0',
  description: 'Deck-building game with metals, training tracks, and missions. Phase 1 = rules-free digital tabletop. Asset packs load from IPFS, local FS, or bundled (Vercel).',

  cardSchema: {
    validate: (card: any): card is MistbornCard => {
      return typeof card === 'object' && card !== null && 'id' in card && 'name' in card;
    },
    create: (data) => ({
      id: data.id,
      name: data.name,
      imageCid: data.imageCid,
      ...(data as Partial<MistbornCard>),
    }),
    getAssetKey: (card) => card.id,
  },

  zones: MISTBORN_ZONES,

  assetRequirements: {
    required: ['card_face'],
    optional: ['token', 'playmat'],
    idFormat: 'custom',
  },

  // Explicit modeling of how asset pack sets map to game concepts / decks on the board.
  // Use the helpers from './assets' together with a loaded pack (via useAssetPack).
  assetPacks: {
    defaultSource: DEFAULT_MISTBORN_PACK_SOURCE,
    ipfsSource: IPFS_MISTBORN_PACK_SOURCE,
    // Recommended usage:
    //   useAssetPack(MistbornModule.assetPacks.defaultSource)  // local/bundled
    //   useAssetPack(MistbornModule.assetPacks.ipfsSource)     // after publishing to IPFS
    //
    // Users can also provide their own local directory at runtime.
  },
  assetSets: {
    all: MISTBORN_SETS,
    mapping: DECK_SET_MAPPING,
    // Example at runtime:
    //   const pack = useAssetPack(DEFAULT_MISTBORN_PACK_SOURCE);
    //   const marketCards = getCardsForDeckType(pack.pack?.cards ?? [], 'market');
    //   const starterCards = getCardsForDeckType(pack.pack?.cards ?? [], 'starters');
  },

  initialState: (config: GameConfig) => createInitialState({
    ...config,
    // If the caller passes packCards (e.g. from loaded pack in board/setup), use them.
    packCards: (config as any).packCards,
  }),

  validateMove: (state: MistbornState, move: string, playerID: string, ...args: unknown[]) =>
    validateMove(state, move, playerID, ...args),

  getBoardgameIOGame: () => MistbornGame,
};

export { MistbornGame };
export default MistbornModule;