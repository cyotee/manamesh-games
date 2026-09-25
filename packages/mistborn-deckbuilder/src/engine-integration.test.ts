import { describe, expect, it } from 'vitest';
import { Client } from 'boardgame.io/client';
import { MistbornGame } from './game';

describe('Mistborn engine integration', () => {
  it('initializes players, runs turn setup, and dispatches a draw through Client', () => {
    const client = Client({ game: MistbornGame, numPlayers: 2 });
    const before = client.getState()!;
    expect(Object.keys(before.G.players)).toEqual(['0', '1']);
    expect(before.G.players['0'].trainingPosition).toBe(1);
    const handSize = before.G.zones.hand['0'].length;
    const deckSize = before.G.zones.deck['0'].length;
    expect(deckSize).toBeGreaterThan(0);
    client.moves.draw(1);
    const after = client.getState()!;
    expect(after.G.zones.hand['0']).toHaveLength(handSize + 1);
    expect(after.G.zones.deck['0']).toHaveLength(deckSize - 1);
  });

  it('does not register the private-key encryption helper as a multiplayer move', () => {
    const client = Client({ game: MistbornGame, numPlayers: 2 });
    expect(client.moves.encryptDeck).toBeUndefined();
  });
});
