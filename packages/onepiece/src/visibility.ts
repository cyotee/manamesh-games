/**
 * Card Visibility State Machine
 *
 * Manages visibility state transitions for cards in the One Piece TCG.
 * Each card has a visibility state that tracks who can see it.
 * All transitions produce cryptographic proofs for auditability.
 */

import type {
  CardVisibilityState,
  CardStateTransition,
  CryptographicProof,
  OnePieceState,
} from './types';
import { createProof, appendProof } from './proofChain';

// =============================================================================
// Valid Transitions
// =============================================================================

/**
 * Map of valid visibility state transitions.
 * Key is the source state, value is the set of valid destination states.
 */
const VALID_TRANSITIONS: Record<CardVisibilityState, Set<CardVisibilityState>> = {
  'encrypted': new Set([
    'owner-known',    // Owner decrypts (peek, draw)
    'public',         // Revealed to all (life damage, trash)
    'all-known',      // Both cooperatively decrypt
  ]),
  'public': new Set([
    'encrypted',      // Re-encrypted (shuffle back into deck)
  ]),
  'secret': new Set([
    'owner-known',    // Owner decrypts
    'opponent-known', // Opponent decrypts
    'public',         // Revealed to all
    'encrypted',      // Re-encrypted
  ]),
  'owner-known': new Set([
    'public',         // Played face-up, revealed
    'all-known',      // Shown to opponent privately
    'encrypted',      // Shuffled back into deck
  ]),
  'opponent-known': new Set([
    'public',         // Revealed to all
    'all-known',      // Owner also sees it
    'encrypted',      // Shuffled back
  ]),
  'all-known': new Set([
    'public',         // Made fully public
    'encrypted',      // Shuffled back into deck
  ]),
};

// =============================================================================
// Transition Logic
// =============================================================================

/**
 * Check whether a visibility state transition is valid.
 */
export function isValidTransition(
  from: CardVisibilityState,
  to: CardVisibilityState,
): boolean {
  if (from === to) return false;
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets ? validTargets.has(to) : false;
}

/**
 * Get all valid transitions from a given state.
 */
export function getValidTransitions(from: CardVisibilityState): CardVisibilityState[] {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets ? Array.from(validTargets) : [];
}

/**
 * Perform a visibility state transition on a card.
 *
 * Validates the transition, updates state, and produces a cryptographic proof.
 *
 * @returns The transition record, or null if the transition is invalid.
 */
export function transitionCardVisibility(
  state: OnePieceState,
  cardId: string,
  to: CardVisibilityState,
  initiatedBy: string,
  action: string,
  data: Record<string, unknown> = {},
): CardStateTransition | null {
  const from = state.cardVisibility[cardId] ?? 'encrypted';

  if (!isValidTransition(from, to)) {
    return null;
  }

  const lastProof = state.proofChain.length > 0
    ? state.proofChain[state.proofChain.length - 1]
    : null;

  const proof = createProof(
    action,
    { cardId, from, to, ...data },
    lastProof?.hash ?? null,
  );

  const transition: CardStateTransition = {
    cardId,
    from,
    to,
    timestamp: proof.timestamp,
    initiatedBy,
    proof,
  };

  // Update state
  state.cardVisibility[cardId] = to;
  appendProof(state, proof);

  return transition;
}

/**
 * Batch transition multiple cards at once (e.g., peeking at top N).
 * All transitions share the same action context but produce individual proofs.
 */
export function batchTransitionVisibility(
  state: OnePieceState,
  cardIds: string[],
  to: CardVisibilityState,
  initiatedBy: string,
  action: string,
  data: Record<string, unknown> = {},
): CardStateTransition[] {
  const transitions: CardStateTransition[] = [];

  for (const cardId of cardIds) {
    const transition = transitionCardVisibility(
      state,
      cardId,
      to,
      initiatedBy,
      action,
      { ...data, batchIndex: transitions.length },
    );
    if (transition) {
      transitions.push(transition);
    }
  }

  return transitions;
}

/**
 * Get the current visibility state of a card.
 * Defaults to 'encrypted' if not tracked.
 */
export function getCardVisibility(
  state: OnePieceState,
  cardId: string,
): CardVisibilityState {
  return state.cardVisibility[cardId] ?? 'encrypted';
}

/**
 * Initialize visibility tracking for a set of cards.
 */
export function initializeCardVisibility(
  state: OnePieceState,
  cardIds: string[],
  initialState: CardVisibilityState = 'encrypted',
): void {
  for (const cardId of cardIds) {
    state.cardVisibility[cardId] = initialState;
  }
}

/**
 * Check if a card is visible to a specific player.
 */
export function isCardVisibleTo(
  visibility: CardVisibilityState,
  viewerIsOwner: boolean,
): boolean {
  switch (visibility) {
    case 'public':
      return true;
    case 'encrypted':
    case 'secret':
      return false;
    case 'owner-known':
      return viewerIsOwner;
    case 'opponent-known':
      return !viewerIsOwner;
    case 'all-known':
      return true;
  }
}
