/**
 * Crypto layer — full mental-poker for player decks (Phase 1).
 * Adapted from @manamesh/onepiece and boardgameio-crypto.
 *
 * For now: stubs + integration points. Real implementation will use
 * encryptDeck, shuffle, cooperative draw, etc.
 */

import type { MistbornState } from './types';
import type { Ctx } from 'boardgame.io';

export function createCryptoInitialState(): any {
  return { players: {} };
}

// Placeholder moves that will be replaced with real ones
export const cryptoMoves = {
  submitPublicKey: (G: MistbornState, ctx: Ctx, key: string) => G,
  encryptDeck: (G: MistbornState, ctx: Ctx) => G,
  // ... shuffle steps
};

export function getCurrentSetupPlayer(G: MistbornState): string | null {
  // TODO
  return null;
}