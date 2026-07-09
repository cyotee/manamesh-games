/**
 * play:peek — Fortune Teller style multi-step (idempotent across resubmissions).
 *
 * Steps (as choices accumulate):
 *  1) peek-own-hand   — optional card from top N own deck → hand
 *  2) choose-opponent  — if target:choose:opponent
 *  3) peek-opp-discard — discard 1 of top M opponent deck
 *
 * Each step records completion on G._effectMarks so re-resolve does not double-apply.
 */
import { hasTag, tagNumber } from "../tags";
import { done, needs, type ChoiceMap, type Executor, type EffectResult } from "../types";
import { getCard } from "../state";
import type { TimestreamsCard, TimestreamsState } from "../../types";

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
  return {
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
}

function choiceStr(choices: ChoiceMap, key: string): string | undefined {
  if (choices[key] === undefined) return undefined;
  const raw = choices[key];
  return Array.isArray(raw) ? raw[0] : raw;
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

  // ---------- Own deck ----------
  if (ownN > 0 && !m[ownMark]) {
    const deck = G.encryptedDecks[playerId] ?? (G.encryptedDecks[playerId] = []);
    const peekedIds = deck.slice(0, Math.min(ownN, deck.length)).map((c) => c.ciphertext);

    if (peekedIds.length === 0) {
      log.push(`${card.id}: own peek empty`);
      m[ownMark] = true;
    } else {
      const handKey = `${card.id}:peek-own-hand`;
      if (mayToHand && choices[handKey] === undefined) {
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
        if (!G.cards) G.cards = {};
        G.cards[full.id] = full;
        if (G.cardVisibility) G.cardVisibility[full.id] = "owner-known";
        log.push(`${card.id}: peek own -> ${full.id} to hand`);
      } else {
        log.push(`${card.id}: peek own -> took none`);
      }

      putOnTop(deck, rest);
      log.push(`${card.id}: returned ${rest.length} to top of own deck`);
      m[ownMark] = true;
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
    const peekedIds = oppDeck.slice(0, Math.min(oppN, oppDeck.length)).map((c) => c.ciphertext);
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
      if (!G.cards) G.cards = {};
      G.cards[full.id] = full;
      log.push(`${card.id}: discarded ${full.id} from P${oppId} deck`);
    }

    putOnTop(oppDeck, rest);
    log.push(`${card.id}: returned ${rest.length} to top of P${oppId} deck`);
    m[oppMark] = true;
  }

  // Clear marks when fully done so a future card with same id instance is fine
  if ((ownN === 0 || m[ownMark]) && (oppN === 0 || m[oppMark])) {
    delete m[ownMark];
    delete m[oppMark];
  }

  return done(log);
};
