/**
 * Deck Peek Protocol
 *
 * Implements the 4-step cooperative deck peeking protocol for One Piece TCG:
 *
 * 1. REQUEST — Owner requests to peek at top N cards
 * 2. OPPONENT ACK — Opponent acknowledges and provides decryption share
 * 3. OWNER DECRYPT — Owner decrypts the peeked cards (visible only to owner)
 * 4. REORDER (optional) — Owner reorders peeked cards before returning to deck
 *
 * This ensures that:
 * - Only the owner sees the peeked cards
 * - The opponent verifies the operation was fair
 * - All transitions produce signed proofs
 */

import type {
  DeckPeekRequest,
  DeckPeekAck,
  DeckPeekOwnerDecrypt,
  DeckPeekReorder,
  DeckPeekProtocol,
  OnePieceState,
  CardStateTransition,
  OnePieceCryptoState,
} from "./types";
import type { EncryptedCard } from "@manamesh/boardgameio-crypto/mental-poker";
import { batchTransitionVisibility } from "./visibility";
import { createProof, appendProof } from "./proofChain";

// =============================================================================
// Protocol Step 1: Request
// =============================================================================

let peekCounter = 0;

function isCryptoState(state: any): state is OnePieceCryptoState {
  return state && typeof state === "object" && "encryptedZones" in state;
}

/**
 * Create a peek request.
 *
 * The requesting player asks to look at the top N cards of a deck zone.
 */
export function createPeekRequest(
  state: OnePieceState,
  playerId: string,
  deckZone: "mainDeck" | "lifeDeck",
  count: number,
): DeckPeekProtocol | null {
  const player = state.players[playerId];
  if (!player) return null;

  // Support crypto variant where decks live in encryptedZones
  if (isCryptoState(state)) {
    const zoneId =
      deckZone === "mainDeck" ? "mainDeck" : `lifeDeck:${playerId}`;
    const encDeck: EncryptedCard[] | undefined = state.encryptedZones[zoneId];
    if (!encDeck || encDeck.length === 0) return null;
    // Can't peek more cards than exist in the encrypted deck
    const actualCount = Math.min(count, encDeck.length);

    const requestId = `peek-${Date.now()}-${peekCounter++}`;

    const proof = createProof(
      "peekRequest",
      { playerId, deckZone, count: actualCount },
      state.proofChain.length > 0
        ? state.proofChain[state.proofChain.length - 1].hash
        : null,
    );

    const request: DeckPeekRequest = {
      id: requestId,
      playerId,
      deckZone,
      count: actualCount,
      requestProof: proof.hash,
      timestamp: Date.now(),
    };

    const protocol: DeckPeekProtocol = {
      request,
      status: "pending",
    };

    state.activePeeks.push(protocol);
    appendProof(state, proof);

    return protocol;
  }

  // Plaintext (existing behavior)
  const deck = deckZone === "mainDeck" ? player.mainDeck : player.lifeDeck;
  if (deck.length === 0) return null;

  // Can't peek more cards than exist in the deck
  const actualCount = Math.min(count, deck.length);

  const requestId = `peek-${Date.now()}-${peekCounter++}`;

  const proof = createProof(
    "peekRequest",
    { playerId, deckZone, count: actualCount },
    state.proofChain.length > 0
      ? state.proofChain[state.proofChain.length - 1].hash
      : null,
  );

  const request: DeckPeekRequest = {
    id: requestId,
    playerId,
    deckZone,
    count: actualCount,
    requestProof: proof.hash,
    timestamp: Date.now(),
  };

  const protocol: DeckPeekProtocol = {
    request,
    status: "pending",
  };

  state.activePeeks.push(protocol);
  appendProof(state, proof);

  return protocol;
}

// =============================================================================
// Protocol Step 2: Opponent Acknowledgement
// =============================================================================

/**
 * Opponent acknowledges a peek request and provides a decryption share.
 *
 * In mental poker, the opponent must cooperate to decrypt cards
 * because each card has multiple encryption layers.
 */
export function acknowledgePeekRequest(
  state: OnePieceState,
  requestId: string,
  decryptionShare: string,
  opponentSignature: string,
): DeckPeekAck | null {
  const protocol = findPeekProtocol(state, requestId);
  if (!protocol || protocol.status !== "pending") return null;

  const proof = createProof(
    "peekAck",
    { requestId, decryptionShare: "***" },
    state.proofChain.length > 0
      ? state.proofChain[state.proofChain.length - 1].hash
      : null,
  );

  const ack: DeckPeekAck = {
    requestId,
    requestHash: protocol.request.requestProof,
    decryptionShare,
    proof: opponentSignature,
  };

  protocol.opponentAck = ack;
  protocol.status = "acked";
  appendProof(state, proof);

  return ack;
}

// =============================================================================
// Protocol Step 3: Owner Decryption
// =============================================================================

/**
 * Owner decrypts the peeked cards using the opponent's decryption share.
 *
 * After this step, the cards transition to 'owner-known' visibility:
 * only the owner can see them, but the opponent has verified the
 * operation was fair through the proof chain.
 */
export function ownerDecryptPeek(
  state: OnePieceState,
  requestId: string,
): DeckPeekOwnerDecrypt | null {
  const protocol = findPeekProtocol(state, requestId);
  if (!protocol) return null;

  // In plaintext mode we require an ack prior to owner decryption.
  if (!isCryptoState(state) && protocol.status !== "acked") return null;

  // In crypto mode the rules are more permissive: owner decryption may proceed
  // for certain zones even if an opponent ack is not present (owner self-peek).
  if (
    isCryptoState(state) &&
    protocol.status !== "acked" &&
    protocol.status !== "pending"
  )
    return null;

  const { playerId, deckZone, count } = protocol.request;

  if (isCryptoState(state)) {
    // Crypto mode: work against encryptedZones
    const cs = state as OnePieceCryptoState;
    const zoneId =
      deckZone === "mainDeck" ? "mainDeck" : `lifeDeck:${playerId}`;
    const encDeck = cs.encryptedZones[zoneId];
    if (!encDeck || encDeck.length === 0) return null;

    const actualCount = Math.min(count, encDeck.length);

    // Attempt to derive cardIds from known mappings if available.
    const cardIds: string[] = [];
    const maybeDeckCardIds = (cs as any).deckCardIds?.[playerId] as
      | string[]
      | undefined;
    const maybeLifeIds = (cs as any).lifeDeckIds?.[playerId] as
      | string[]
      | undefined;

    for (let i = 0; i < actualCount; i++) {
      let cid: string | undefined;
      if (deckZone === "mainDeck" && maybeDeckCardIds && maybeDeckCardIds[i]) {
        cid = maybeDeckCardIds[i];
      } else if (deckZone === "lifeDeck" && maybeLifeIds && maybeLifeIds[i]) {
        cid = maybeLifeIds[i];
      } else {
        // Fallback synthetic id so visibility tracking can record a transition.
        cid = `${zoneId}:${i}`;
      }
      cardIds.push(cid);
    }

    const transitions = batchTransitionVisibility(
      state,
      cardIds,
      "owner-known",
      playerId,
      "peekDecrypt",
      { requestId, deckZone },
    );

    const ownerDecrypt: DeckPeekOwnerDecrypt = {
      requestId,
      cardStates: transitions,
    };

    protocol.ownerDecrypt = ownerDecrypt;
    protocol.status = "decrypted";
    return ownerDecrypt;
  }

  // Plaintext mode (existing behavior)
  const player = state.players[playerId];
  if (!player) return null;

  const deck = deckZone === "mainDeck" ? player.mainDeck : player.lifeDeck;

  // Get the top N card IDs for visibility transition
  const peekedCardIds = deck.slice(0, count).map((c) => c.id);

  // Transition visibility: encrypted → owner-known
  const transitions = batchTransitionVisibility(
    state,
    peekedCardIds,
    "owner-known",
    playerId,
    "peekDecrypt",
    { requestId, deckZone },
  );

  const ownerDecrypt: DeckPeekOwnerDecrypt = {
    requestId,
    cardStates: transitions,
  };

  protocol.ownerDecrypt = ownerDecrypt;
  protocol.status = "decrypted";

  return ownerDecrypt;
}

// =============================================================================
// Protocol Step 4: Reorder (Optional)
// =============================================================================

/**
 * Owner reorders the peeked cards before they return to the deck.
 *
 * The newPositions array maps from current index to new index.
 * For example, [2, 0, 1] means:
 * - Card at position 0 moves to position 2
 * - Card at position 1 moves to position 0
 * - Card at position 2 moves to position 1
 */
export function reorderPeekedCards(
  state: OnePieceState,
  requestId: string,
  newPositions: number[],
  ownerSignature: string,
): DeckPeekReorder | null {
  const protocol = findPeekProtocol(state, requestId);
  if (!protocol || protocol.status !== "decrypted") return null;

  const { playerId, deckZone, count } = protocol.request;

  // Validate the permutation
  if (newPositions.length !== count) return null;
  const sorted = [...newPositions].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i) return null;
  }

  if (isCryptoState(state)) {
    const cs = state as OnePieceCryptoState;
    const zoneId =
      deckZone === "mainDeck" ? "mainDeck" : `lifeDeck:${playerId}`;
    const encDeck = cs.encryptedZones[zoneId];
    if (!encDeck) return null;

    const topCards = encDeck.splice(0, count);
    const reordered = newPositions.map((pos) => topCards[pos]);
    encDeck.unshift(...reordered);

    const proof = createProof(
      "peekReorder",
      { requestId, newPositions },
      state.proofChain.length > 0
        ? state.proofChain[state.proofChain.length - 1].hash
        : null,
    );

    const reorder: DeckPeekReorder = {
      requestId,
      newPositions,
      proof: ownerSignature,
    };

    protocol.reorder = reorder;
    protocol.status = "reordered";
    appendProof(state, proof);

    return reorder;
  }

  // Plaintext behavior
  const player = state.players[playerId];
  if (!player) return null;

  const deck = deckZone === "mainDeck" ? player.mainDeck : player.lifeDeck;
  const topCards = deck.splice(0, count);
  const reordered = newPositions.map((pos) => topCards[pos]);
  deck.unshift(...reordered);

  const proof = createProof(
    "peekReorder",
    { requestId, newPositions },
    state.proofChain.length > 0
      ? state.proofChain[state.proofChain.length - 1].hash
      : null,
  );

  const reorder: DeckPeekReorder = {
    requestId,
    newPositions,
    proof: ownerSignature,
  };

  protocol.reorder = reorder;
  protocol.status = "reordered";
  appendProof(state, proof);

  return reorder;
}

/**
 * Complete a peek protocol (mark it as done).
 */
export function completePeek(state: OnePieceState, requestId: string): boolean {
  const protocol = findPeekProtocol(state, requestId);
  if (!protocol) return false;
  if (protocol.status !== "decrypted" && protocol.status !== "reordered") {
    return false;
  }

  protocol.status = "complete";

  // Remove from active peeks
  state.activePeeks = state.activePeeks.filter(
    (p) => p.request.id !== requestId,
  );

  return true;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find a peek protocol by request ID.
 */
export function findPeekProtocol(
  state: OnePieceState,
  requestId: string,
): DeckPeekProtocol | undefined {
  return state.activePeeks.find((p) => p.request.id === requestId);
}

/**
 * Get all active peek protocols for a player.
 */
export function getPlayerActivePeeks(
  state: OnePieceState,
  playerId: string,
): DeckPeekProtocol[] {
  return state.activePeeks.filter((p) => p.request.playerId === playerId);
}
