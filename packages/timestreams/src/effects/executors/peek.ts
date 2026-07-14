/**
 * play:peek — Fortune Teller style multi-step (idempotent across resubmissions).
 *
 * Mental-poker: top-N must be decrypted before choose prompts (startPeekReveal).
 * Plain / resolved decks: rewrite point ciphertexts → card ids for readable UI.
 *
 * Steps (as choices accumulate):
 *  1) peek-own-hand   — optional card from top N own deck → hand
 *  2) choose-opponent  — if target:choose:opponent
 *  3) peek-opp-discard — discard 1 of top M opponent deck
 */
import { hasTag, tagNumber } from "../tags";
import { done, needs, type ChoiceMap, type Executor, type EffectResult } from "../types";
import { getCard, registerCard } from "../state";
import type { TimestreamsCard, TimestreamsState } from "../../types";
import {
  startPeekReveal,
  resolveCardIdFromPoint,
  looksLikeSecpPointHex,
} from "../../crypto";

type Enc = { ciphertext: string; layers: number };

function marks(G: TimestreamsState): Record<string, boolean> {
  const g = G as TimestreamsState & { _effectMarks?: Record<string, boolean> };
  if (!g._effectMarks) g._effectMarks = {};
  return g._effectMarks;
}

function takeTop(deck: Enc[], n: number): Enc[] {
  return deck.splice(0, Math.min(n, deck.length));
}

function putOnTop(deck: Enc[], cards: Enc[]): void {
  deck.unshift(...cards);
}

function asCard(G: TimestreamsState, id: string, ownerId: string): TimestreamsCard {
  const existing = getCard(G, id);
  if (existing) return { ...existing, ownerId };
  const card: TimestreamsCard = {
    id,
    name: id,
    ownerId,
    cardType: "invention",
    subtypes: [],
    hasPlayEffect: false,
    hasScoreEffect: true,
    hasReact: false,
    tags: [],
  };
  registerCard(G, card);
  return card;
}

function choiceStr(choices: ChoiceMap, key: string): string | undefined {
  if (choices[key] === undefined) return undefined;
  const raw = choices[key];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Resolve deck top entries to plain card ids when possible (display + logic). */
function normalizeTopPlain(
  G: TimestreamsState,
  deck: Enc[],
  n: number,
  ownerId: string,
): string[] {
  const count = Math.min(n, deck.length);
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = deck[i].ciphertext;
    let id = raw;
    if (looksLikeSecpPointHex(raw)) {
      const resolved = resolveCardIdFromPoint(G, raw);
      if (resolved) {
        id = resolved;
        deck[i] = { ciphertext: resolved, layers: 0 };
      }
    } else if ((deck[i].layers ?? 0) === 0) {
      id = raw;
    }
    asCard(G, id, ownerId);
    ids.push(id);
  }
  return ids;
}

function topNeedsDecrypt(deck: Enc[], n: number): boolean {
  const count = Math.min(n, deck.length);
  for (let i = 0; i < count; i++) {
    if ((deck[i].layers ?? 0) > 0) return true;
  }
  return false;
}

function isPeekDecrypting(G: TimestreamsState, sourceCardId: string): boolean {
  const op = G.activeDeckOp;
  return !!(
    op &&
    op.kind === "peek-deck" &&
    op.sourceCardId === sourceCardId &&
    op.phase === "decrypt"
  );
}

export const peekExecutor: Executor = ({ G, playerId, card, choices }): EffectResult => {
  if (!hasTag(card, "play:peek")) return done([]);

  const log: string[] = [];
  const m = marks(G);
  const ownN = tagNumber(card, "peek:own-deck") ?? 0;
  const oppN = tagNumber(card, "peek:opponent-deck") ?? 0;
  const mayToHand = hasTag(card, "to-hand:choose:1") || hasTag(card, "play:to-hand");
  const ownMark = `${card.id}:own-peek-done`;
  const oppMark = `${card.id}:opp-peek-done`;

  // Hold while cooperative peek decrypt is in flight
  if (isPeekDecrypting(G, card.id)) {
    return done([
      ...log,
      `${card.id}: decrypting peek (${G.activeDeckOp?.decryptDone ?? 0}/${G.activeDeckOp?.decryptTotal ?? "?"})`,
    ]);
  }

  // ---------- Own deck ----------
  if (ownN > 0 && !m[ownMark]) {
    const deck = G.encryptedDecks[playerId] ?? (G.encryptedDecks[playerId] = []);

    // Mental-poker: peel top N before offering choices
    if (topNeedsDecrypt(deck, ownN)) {
      const handKey = `${card.id}:peek-own-hand`;
      if (choices[handKey] === undefined) {
        startPeekReveal(G, playerId, card.id, ownN, {
          allowNone: mayToHand,
          reason: "peek:own-to-hand",
          deciderId: playerId,
        });
        return done([
          ...log,
          `${card.id}: started peek decrypt of top ${ownN}`,
        ]);
      }
    }

    const peekedIds = normalizeTopPlain(G, deck, ownN, playerId);

    if (peekedIds.length === 0) {
      log.push(`${card.id}: own peek empty`);
      m[ownMark] = true;
    } else {
      const handKey = `${card.id}:peek-own-hand`;
      if (mayToHand && choices[handKey] === undefined) {
        // Ensure prompt options are human-resolvable card ids
        return needs({
          id: handKey,
          deciderId: playerId,
          kind: "choose-card",
          options: [...peekedIds, "__none__"],
          min: 1,
          max: 1,
          reason: "peek:own-to-hand",
        });
      }

      const handPickRaw = mayToHand ? choiceStr(choices, handKey) : "__none__";
      const handPick =
        handPickRaw && handPickRaw !== "__none__" && handPickRaw !== ""
          ? handPickRaw
          : null;

      const window = takeTop(deck, peekedIds.length);
      const rest = window.filter((c) => c.ciphertext !== handPick);
      const taken = handPick
        ? window.find((c) => c.ciphertext === handPick)
        : undefined;

      if (taken) {
        const full = asCard(G, taken.ciphertext, playerId);
        G.players[playerId].hand.push(full);
        if (G.cardVisibility) G.cardVisibility[full.id] = "owner-known";
        log.push(`${card.id}: peek own -> ${full.name || full.id} to hand`);
      } else {
        log.push(`${card.id}: peek own -> took none`);
      }

      putOnTop(deck, rest);
      log.push(`${card.id}: returned ${rest.length} to top of own deck`);
      m[ownMark] = true;
      if (G.activeDeckOp?.kind === "peek-deck" && G.activeDeckOp.sourceCardId === card.id) {
        G.activeDeckOp = null;
      }
    }
  }

  // ---------- Opponent deck ----------
  if (oppN > 0 && !m[oppMark]) {
    const oppKey = `${card.id}:choose-opponent`;
    let oppId: string | undefined;

    if (hasTag(card, "target:choose:opponent")) {
      if (choices[oppKey] === undefined) {
        const opponents = G.playerOrder.filter((p) => p !== playerId);
        if (opponents.length === 0) {
          m[oppMark] = true;
          return done([...log, `${card.id}: no opponents`]);
        }
        return needs({
          id: oppKey,
          deciderId: playerId,
          kind: "choose-option",
          options: opponents,
          min: 1,
          max: 1,
          reason: "target:choose:opponent",
        });
      }
      oppId = choiceStr(choices, oppKey);
    } else {
      oppId = G.playerOrder.find((p) => p !== playerId);
    }

    if (!oppId || !G.players[oppId]) {
      m[oppMark] = true;
      return done([...log, `${card.id}: opponent peek fizzles`]);
    }

    const oppDeck = G.encryptedDecks[oppId] ?? (G.encryptedDecks[oppId] = []);

    if (topNeedsDecrypt(oppDeck, oppN)) {
      const discardKey = `${card.id}:peek-opp-discard`;
      if (choices[discardKey] === undefined) {
        startPeekReveal(G, oppId, card.id, oppN, {
          allowNone: false,
          reason: "discard:opponent-deck-card",
          deciderId: playerId,
        });
        return done([
          ...log,
          `${card.id}: started opponent peek decrypt (P${oppId})`,
        ]);
      }
    }

    const peekedIds = normalizeTopPlain(G, oppDeck, oppN, oppId);
    if (peekedIds.length === 0) {
      m[oppMark] = true;
      return done([...log, `${card.id}: opponent deck empty`]);
    }

    const discardKey = `${card.id}:peek-opp-discard`;
    if (hasTag(card, "discard:opponent-deck-card") && choices[discardKey] === undefined) {
      return needs({
        id: discardKey,
        deciderId: playerId,
        kind: "choose-card",
        options: peekedIds,
        min: 1,
        max: 1,
        reason: "discard:opponent-deck-card",
      });
    }

    const discardPick = choiceStr(choices, discardKey) ?? peekedIds[0];
    const window = takeTop(oppDeck, peekedIds.length);
    const discarded =
      window.find((c) => c.ciphertext === discardPick) ?? window[0];
    const rest = window.filter((c) => c !== discarded);

    if (discarded) {
      const full = asCard(G, discarded.ciphertext, oppId);
      G.players[oppId].discard.push(full);
      log.push(
        `${card.id}: discarded ${full.name || full.id} from P${oppId} deck`,
      );
    }

    putOnTop(oppDeck, rest);
    log.push(`${card.id}: returned ${rest.length} to top of P${oppId} deck`);
    m[oppMark] = true;
    if (G.activeDeckOp?.kind === "peek-deck" && G.activeDeckOp.sourceCardId === card.id) {
      G.activeDeckOp = null;
    }
  }

  // Clear marks when fully done so a future card with same id instance is fine
  if ((ownN === 0 || m[ownMark]) && (oppN === 0 || m[oppMark])) {
    delete m[ownMark];
    delete m[oppMark];
  }

  return done(log);
};
