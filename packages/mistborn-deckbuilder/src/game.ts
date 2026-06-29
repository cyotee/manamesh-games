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
import { getAllCards, getCharacter } from './data';
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

  // Structural examples
  if (move === 'buyCard') {
    // In real impl: check market has the card, compute coins from played, etc.
    // For now allow (rules-free)
  }

  return { valid: true };
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
    // Rules-free: move from market to player's discard (or hand in demo)
    const idx = G.market.indexOf(cardId);
    if (idx >= 0) {
      const card = G.market.splice(idx, 1)[0]; // remove id, but for full would lookup
      // For simplicity, add to discard zone simulation
      G.zones.discard[pid] = G.zones.discard[pid] || [];
      G.zones.discard[pid].push({ id: cardId, name: cardId } as any); // placeholder
      // Refill
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
    const play = G.zones.play[pid] || [];
    const hand = G.zones.hand[pid] || [];
    const discard = G.zones.discard[pid] || [];

    // Move non-ally play + remaining hand to discard (Allies stay)
    G.zones.discard[pid] = [...discard, ...play, ...hand];
    G.zones.play[pid] = [];
    G.zones.hand[pid] = [];

    // Draw 5
    const deck = G.zones.deck[pid] || [];
    const toDraw = Math.min(5, deck.length);
    const drawn = deck.splice(0, toDraw);
    G.zones.hand[pid] = drawn;

    G.moveHistory.push({ playerId: pid, move: 'cleanupAndDraw', args: [], timestamp: Date.now() });
    return G;
  },

  advanceTraining: (G: MistbornState, ctx: Ctx) => {
    const pid = ctx.currentPlayer!;
    const player = G.players[pid];
    player.trainingPosition = (player.trainingPosition || 0) + 1;
    // In rules-free, we allow manual; later enforcement will auto-advance on turn start
    // Update burnLimit based on position (example milestones)
    player.burnLimit = Math.min(4, 1 + Math.floor((player.trainingPosition || 0) / 3));
    G.moveHistory.push({ playerId: pid, move: 'advanceTraining', args: [], timestamp: Date.now() });
    return G;
  },

  eliminateCard: (G: MistbornState, ctx: Ctx, cardId: string, from: string) => {
    const pid = ctx.currentPlayer!;
    // Rules-free: remove from specified zone (hand/play/discard simulation)
    const zoneKey = from === 'play' ? 'play' : (from === 'discard' ? 'discard' : 'hand');
    if (G.zones[zoneKey] && G.zones[zoneKey][pid]) {
      G.zones[zoneKey][pid] = G.zones[zoneKey][pid].filter((c: any) => c.id !== cardId);
    }
    G.moveHistory.push({ playerId: pid, move: 'eliminateCard', args: [cardId, from], timestamp: Date.now() });
    return G;
  },
};

// =============================================================================
// Game Definition
// =============================================================================

export const MistbornGame: Game<MistbornState> = {
  name: 'mistborn-deckbuilder',
  setup: (ctx, setupData) => {
    const packCards = setupData?.packCards || [];
    return createInitialState({ 
      numPlayers: ctx.numPlayers, 
      playerIDs: ctx.playOrder,
      packCards,
    } as any);
  },
  moves,
  phases: {
    setup: { start: true, next: 'keyExchange' },
    keyExchange: { /* crypto steps */ },
    encrypt: {},
    shuffle: {},
    play: {
      moves,
      // freeform — player decides when to end
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
      ...data,
    }),
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

  initialState: (config: any) => createInitialState({
    ...config,
    // If the caller passes packCards (e.g. from loaded pack in board/setup), use them.
    packCards: config.packCards,
  }),

  validateMove,

  getBoardgameIOGame: () => MistbornGame,
};

export { MistbornGame };
export default MistbornModule;