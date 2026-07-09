import type { TimestreamsState, TimestreamsCard, EraId } from '../types';
import { DEFAULT_CONFIG } from '../types';
import { createTimeline } from '../timeline';
import { registerCard } from './state';

let seq = 0;

export function makeCard(partial: Partial<TimestreamsCard> & { id?: string }): TimestreamsCard {
  return {
    id: partial.id ?? `test-card#${seq++}`,
    name: partial.name ?? partial.id ?? 'Test Card',
    ownerId: partial.ownerId ?? '0',
    cardType: partial.cardType ?? 'invention',
    subtypes: partial.subtypes ?? [],
    hasPlayEffect: partial.hasPlayEffect ?? (partial.tags ?? []).some(t => t.startsWith('play:')),
    hasScoreEffect: partial.hasScoreEffect ?? false,
    hasReact: partial.hasReact ?? (partial.tags ?? []).some(t => t.startsWith('react:')),
    scoreValue: partial.scoreValue,
    tags: partial.tags ?? [],
  } as TimestreamsCard;
}

export function makeState(opts: { players: string[]; currentDay?: number }): TimestreamsState {
  const players: TimestreamsState['players'] = {};
  for (const pid of opts.players) {
    players[pid] = {
      homeEra: null, ready: true, hand: [], discard: [], scorePile: [],
      hasPassedThisDay: false, publicKey: null, hasEncrypted: false, hasShuffled: false,
    };
  }
  return {
    players,
    playerOrder: [...opts.players],
    config: { ...DEFAULT_CONFIG },
    phase: 'play',
    timeline: createTimeline(),
    currentDay: opts.currentDay ?? 1,
    dayFirstPlayer: opts.players[0],
    encryptedDecks: {},
    cardPoints: {},
    shuffleRng: null,
    eraAssignmentRng: null,
    pendingDecryptRequests: [],
    setupPlayerIndex: 0,
    cardVisibility: {},
    proofChain: [],
    scores: {},
    winner: null,
  };
}

export function putInEra(G: TimestreamsState, era: EraId, ...cards: TimestreamsCard[]): void {
  for (const card of cards) {
    registerCard(G, card);
    G.timeline[era].stack.push(card.id);
  }
}

/** Place action cards onto an era (not scoring slots). */
export function putActionOnEra(G: TimestreamsState, era: EraId, ...cards: TimestreamsCard[]): void {
  if (!G.timeline[era].actions) G.timeline[era].actions = [];
  for (const card of cards) {
    registerCard(G, card);
    G.timeline[era].actions!.push(card.id);
  }
}

export function putInHand(G: TimestreamsState, playerId: string, ...cards: TimestreamsCard[]): void {
  for (const card of cards) {
    registerCard(G, card);
    G.players[playerId].hand.push(card);
  }
}
