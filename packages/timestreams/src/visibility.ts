/**
 * Card Visibility State Machine
 *
 * Manages visibility state transitions for cards in Timestreams.
 * Each card has a visibility state that tracks who can see it.
 * All transitions produce cryptographic proofs for auditability.
 *
 * Adapted from packages/onepiece/src/visibility.ts:
 * - OnePieceState replaced with TimestreamsState
 * - CardVisibilityState reduced to "encrypted" | "owner-known" | "public"
 * - Allowed transitions: encrypted→owner-known, encrypted→public, owner-known→public
 */

import type {
  CardVisibilityState,
  CryptographicProof,
  TimestreamsState,
} from './types';
import { createProof, appendProof } from './proofChain';

// =============================================================================
// Local Types
// =============================================================================

/**
 * Tracks a state transition for a card's visibility.
 */
export interface CardStateTransition {
  cardId: string;
  from: CardVisibilityState;
  to: CardVisibilityState;
  timestamp: number;
  initiatedBy: string;
  proof: CryptographicProof;
}

// =============================================================================
// Valid Transitions
// =============================================================================

/**
 * Map of valid visibility state transitions.
 * Key is the source state, value is the set of valid destination states.
 *
 * Allowed transitions: encrypted→owner-known, encrypted→public, owner-known→public.
 */
const VALID_TRANSITIONS: Record<CardVisibilityState, Set<CardVisibilityState>> = {
  'encrypted': new Set([
    'owner-known',    // Owner decrypts (peek, draw)
    'public',         // Revealed to all (direct reveal)
  ]),
  'owner-known': new Set([
    'public',         // Played face-up, revealed to all
  ]),
  'public': new Set([
    // No further transitions — public is terminal in Timestreams
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
  state: TimestreamsState,
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
 * Get the current visibility state of a card.
 * Defaults to 'encrypted' if not tracked.
 */
export function getCardVisibility(
  state: TimestreamsState,
  cardId: string,
): CardVisibilityState {
  return state.cardVisibility[cardId] ?? 'encrypted';
}

/**
 * Initialize visibility tracking for a set of cards.
 */
export function initializeCardVisibility(
  state: TimestreamsState,
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
      return false;
    case 'owner-known':
      return viewerIsOwner;
  }
}
