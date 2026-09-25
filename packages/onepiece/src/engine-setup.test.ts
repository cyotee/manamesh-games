import { expect, it, vi } from 'vitest';
import { Client } from 'boardgame.io/client';
import { OnePieceGame, createInitialState } from './game';
import { OnePieceCryptoGame } from './crypto';

it('initializes the plaintext game with the engine roster and concurrent setup seats', () => {
  const client = Client({ game: OnePieceGame, numPlayers: 3 });
  const state = client.getState()!;
  expect(Object.keys(state.G.players)).toEqual(['0', '1', '2']);
  expect(state.ctx.activePlayers).toEqual({ '0': 'setup', '1': 'setup', '2': 'setup' });
});

it('initializes the encrypted game synchronously with the engine roster', () => {
  const client = Client({ game: OnePieceCryptoGame, numPlayers: 3 });
  const state = client.getState()!;
  expect(state.G).not.toBeInstanceOf(Promise);
  expect(state.G.playerOrder).toEqual(['0', '1', '2']);
  expect(state.G.deckCardIds).toEqual({ '0': [], '1': [], '2': [] });
});

it('allows a setup seat to load only its own deck', () => {
  const client = Client({ game: OnePieceGame, numPlayers: 2, playerID: '1' });
  const cards = [{ id: 'leader', name: 'Leader', cardType: 'leader', life: 0 }];
  client.moves.loadDeck('0', cards);
  expect(client.getState()!.G.deckLoaded['0']).toBeFalsy();
  client.moves.loadDeck('1', cards);
  expect(client.getState()!.G.deckLoaded['1']).toBe(true);
});

it('binds public-key publication to the engine actor', async () => {
  const { generateKeyPair } = await import('@cyotee/boardgameio-crypto/mental-poker');
  const publicKey = generateKeyPair().publicKey;
  const client = Client({ game: OnePieceCryptoGame, numPlayers: 2, playerID: '0' });
  client.moves.submitPublicKey('1', publicKey);
  expect(client.getState()!.G.players['1'].publicKey).toBeNull();
  client.moves.submitPublicKey('0', publicKey);
  expect(client.getState()!.G.players['0'].publicKey).toBe(publicKey);
});

it('loads ordinary decks and completes public-key admission without losing board zones', async () => {
  const { generateKeyPair } = await import('@cyotee/boardgameio-crypto/mental-poker');
  const client = Client({ game: OnePieceGame, numPlayers: 2, playerID: '0' });
  const keys = [generateKeyPair().publicKey, generateKeyPair().publicKey];
  for (const playerID of ['0', '1']) {
    client.updatePlayerID(playerID);
    client.moves.loadDeck(playerID, [{ id: `leader-${playerID}`, name: 'Leader', cardType: 'leader', life: 1 },
      { id: `life-${playerID}`, name: 'Life', cardType: 'character' },
      { id: `card-${playerID}`, name: 'Card', cardType: 'character' }]);
  }
  expect(client.getState()!.ctx.phase).toBe('keyExchange');
  const decksBefore = Object.fromEntries(Object.entries(client.getState()!.G.players).map(([id, player]) => [id, player.mainDeck]));
  for (const playerID of ['0', '1']) {
    client.updatePlayerID(playerID);
    client.moves.submitPublicKey(playerID, keys[Number(playerID)]);
  }
  const { G, ctx } = client.getState()!;
  expect(ctx.phase).toBe('encrypt');
  expect(G.phase).toBe('encrypt');
  expect(G.crypto.publicKeys).toEqual({ '0': keys[0], '1': keys[1] });
  expect(G.players['0'].mainDeck).toEqual(decksBefore['0']);
  expect(G.players['1'].mainDeck).toEqual(decksBefore['1']);
});


it('initializes the deck-loading protocol independently of the wall clock', () => {
  const now = vi.spyOn(Date, 'now');
  try {
    now.mockReturnValue(1);
    const first = createInitialState({ numPlayers: 2, playerIDs: ['0', '1'] });
    now.mockReturnValue(10000);
    expect(createInitialState({ numPlayers: 2, playerIDs: ['0', '1'] })).toEqual(first);
    expect(first.players['0'].lastHeartbeat).toBe(0);
  } finally { now.mockRestore(); }
});
