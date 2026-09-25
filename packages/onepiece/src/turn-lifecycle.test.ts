import { expect, it } from 'vitest';
import { Client } from 'boardgame.io/client';
import { OnePieceGame, createInitialState, onePieceCardSchema } from './game';

it('ends the current turn and refreshes/draws for the next player', () => {
  const client = Client({
    game: {
      ...OnePieceGame,
      setup: ({ ctx }) => {
        const G = createInitialState({ numPlayers: ctx.numPlayers, playerIDs: ctx.playOrder });
        G.phase = 'play';
        G.players['1'].mainDeck = [onePieceCardSchema.create({ id: 'next-card', name: 'Next card' })];
        G.players['1'].playArea[0].attachedDon = 2;
        G.players['1'].activeDon = 2;
        return G;
      },
      phases: { play: { ...OnePieceGame.phases!.play, start: true } },
    },
    numPlayers: 2,
  });
  const turn = client.getState()!.ctx.turn;
  client.moves.endTurn();
  const { G, ctx } = client.getState()!;
  expect(ctx.currentPlayer).toBe('1');
  expect(ctx.turn).toBe(turn + 1);
  expect(G.players['1'].playArea[0].attachedDon).toBe(0);
  expect(G.players['1'].donArea).toHaveLength(2);
  expect(G.players['1'].activeDon).toBe(0);
  expect(G.players['1'].mainDeck).toHaveLength(0);
  expect(G.players['1'].hand.map(card => card.id)).toEqual(['next-card']);
});
