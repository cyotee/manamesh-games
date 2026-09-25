import { expect, it } from 'vitest';
import { ProcessGameConfig } from 'boardgame.io/internal';
import { OnePieceGame } from './game';
import { OnePieceCryptoGame } from './crypto';

it.each([OnePieceGame, OnePieceCryptoGame])('does not register private-key encryption in $name', game => {
  expect(ProcessGameConfig(game).moveNames).not.toContain('encryptDeck');
});
