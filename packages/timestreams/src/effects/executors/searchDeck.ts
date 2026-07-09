/**
 * play:search-deck — look through your remaining deck, put one card into hand,
 * optionally shuffle afterwards (play:shuffle-after / play:to-hand).
 *
 * Mental-poker: full-deck cooperative decrypt → choose → fair multi-party
 * reshuffle of remainder → re-encrypt (see crypto.ts activeDeckOp).
 *
 * Used by: Think About The Future
 *   tags: play:search-deck, play:to-hand, play:shuffle-after
 */
import { hasTag } from "../tags";
import { done, needs, type Executor } from "../types";
import { getCard } from "../state";
import {
  startSearchDeckReveal,
  completeSearchDeckPick,
  deckHasEncryption,
  hasActiveDeckOp,
} from "../../crypto";

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export const searchDeckExecutor: Executor = ({ G, playerId, card, choices }) => {
  if (!hasTag(card, "play:search-deck")) return done([]);

  const deck = G.encryptedDecks[playerId];
  if (!deck) {
    return done([`${card.id}: search-deck fizzles (no deck)`]);
  }

  const toHand = hasTag(card, "play:to-hand") || !hasTag(card, "play:to-deck");
  const shuffleAfter =
    hasTag(card, "play:shuffle-after") || hasTag(card, "play:search-deck");
  // Always use deck-op pipeline in mental-poker so shuffle-after is fair
  // multi-party commit/reveal + re-encrypt (even if deck is currently layers 0).
  const useCrypto =
    G.config?.playMode === "mental-poker" ||
    (G.activeDeckOp?.sourceCardId === card.id && hasActiveDeckOp(G));

  // ---------- Mental-poker path ----------
  if (useCrypto) {
    const op = G.activeDeckOp;

    // Start or continue decrypt session
    if (!op || op.sourceCardId !== card.id) {
      if (deck.length === 0) {
        return done([`${card.id}: search-deck fizzles (empty deck)`]);
      }
      startSearchDeckReveal(G, playerId, card.id, { toHand, shuffleAfter });
      const started = G.activeDeckOp;
      if (started?.phase === "choose") {
        // Plaintext remaining after prior peels — prompt immediately
        return needs({
          id: `${card.id}:search-deck`,
          deciderId: playerId,
          kind: "choose-card",
          options: started.revealed,
          min: 1,
          max: 1,
          reason: "play:search-deck",
        });
      }
      return done([
        `${card.id}: search-deck decrypting ${started?.decryptTotal ?? "?"} card(s)`,
      ]);
    }

    if (op.phase === "decrypt") {
      return done([
        `${card.id}: search-deck decrypting ${op.decryptDone}/${op.decryptTotal}`,
      ]);
    }

    if (op.phase === "choose") {
      const promptId = `${card.id}:search-deck`;
      let pick: string | undefined;
      if (choices[promptId] !== undefined) {
        const raw = choices[promptId];
        pick = Array.isArray(raw) ? raw[0] : raw;
      } else {
        return needs({
          id: promptId,
          deciderId: playerId,
          kind: "choose-card",
          options: [...op.revealed],
          min: 1,
          max: 1,
          reason: "play:search-deck",
        });
      }
      if (!pick || !op.revealed.includes(pick)) {
        return done([`${card.id}: search-deck invalid/missing choice`]);
      }
      completeSearchDeckPick(G, pick);
      const after = G.activeDeckOp;
      if (after && after.phase !== "done") {
        return done([
          `${card.id}: search-deck -> ${pick}; ${after.statusMessage || after.phase}`,
        ]);
      }
      return done([`${card.id}: search-deck -> ${pick} to hand; complete`]);
    }

    // reshuffle / reencrypt in progress
    return done([
      `${card.id}: search-deck ${op.phase} — ${op.statusMessage || "in progress"}`,
    ]);
  }

  // ---------- Plaintext path (layers 0 / playMode plaintext) ----------
  if (deck.length === 0) {
    return done([`${card.id}: search-deck fizzles (empty deck)`]);
  }

  const options = deck.map((c) => c.ciphertext);
  const promptId = `${card.id}:search-deck`;

  let pick: string | undefined;
  if (choices[promptId] !== undefined) {
    const raw = choices[promptId];
    pick = Array.isArray(raw) ? raw[0] : raw;
  } else {
    return needs({
      id: promptId,
      deciderId: playerId,
      kind: "choose-card",
      options,
      min: 1,
      max: 1,
      reason: "play:search-deck",
    });
  }

  if (!pick || !options.includes(pick)) {
    return done([`${card.id}: search-deck invalid/missing choice`]);
  }

  const idx = deck.findIndex((c) => c.ciphertext === pick);
  if (idx === -1) {
    return done([`${card.id}: search-deck fizzles (card gone)`]);
  }

  deck.splice(idx, 1);

  const full =
    getCard(G, pick) ||
    ({
      id: pick,
      name: pick,
      ownerId: playerId,
      cardType: "invention" as const,
      subtypes: [],
      hasPlayEffect: false,
      hasScoreEffect: true,
      hasReact: false,
      scoreValue: 1,
      tags: [],
    });

  const player = G.players[playerId];
  if (!player) return done([`${card.id}: search-deck fizzles (no player)`]);

  if (toHand) {
    player.hand.push({ ...full, ownerId: playerId });
    if (G.cards) G.cards[full.id] = full;
    if (G.cardVisibility) G.cardVisibility[pick] = "owner-known";
  }

  if (shuffleAfter) {
    shuffleInPlace(deck);
  }

  return done([
    `${card.id}: search-deck -> ${pick} to hand; deck shuffled (${deck.length} left)`,
  ]);
};
