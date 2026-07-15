/**
 * Era card abilities (rules-complete path).
 *
 * - era-stone: once-per-game cancel move/discard of a Stone Age invention
 * - era-medieval: steal:bonus-points (wired via tryStealBonusPoints in scoring)
 * - era-modern: at Modern day begin, recover 1 from discard to hand
 * - era-future: when Future era scores, may add 2 scoring slots
 */
import type { EraId, TimestreamsCard, TimestreamsState } from "../types";
import { hasTag, tagNumber, tagsWithPrefix } from "./tags";
import { getCard } from "./state";
import { locateCard } from "./targets";
import {
  isOncePerGameSpent,
  markOncePerGameUsed,
} from "./react";
import type { PlayerPrompt } from "./types";
import { adjustEraScoringSlots } from "../scoringSlots";

export type EraMutation = "move" | "discard";

/** Find era card id for a home-era (hand first, then G.cards registry). */
export function findEraCardForPlayer(
  G: TimestreamsState,
  playerId: string,
  eraCardId: string,
): TimestreamsCard | null {
  const hand = G.players[playerId]?.hand ?? [];
  const inHand = hand.find((c) => c.id === eraCardId || c.id.startsWith(eraCardId));
  if (inHand) return inHand;
  const reg = G.cards?.[eraCardId];
  if (reg && (reg.ownerId === playerId || !reg.ownerId)) return reg;
  // instance ids era-stone#0
  for (const c of Object.values(G.cards ?? {})) {
    if (!c) continue;
    if (
      (c.id === eraCardId || c.id.startsWith(`${eraCardId}#`)) &&
      (c.ownerId === playerId || G.players[playerId]?.homeEra)
    ) {
      if (c.ownerId === playerId) return c;
    }
  }
  return null;
}

export function playerWithHomeEra(
  G: TimestreamsState,
  era: EraId,
): string | null {
  return (
    G.playerOrder.find((pid) => G.players[pid]?.homeEra === era) ?? null
  );
}

/** Invention currently in the Stone Age stack. */
export function isStoneAgeInvention(
  G: TimestreamsState,
  cardId: string,
): boolean {
  const card = getCard(G, cardId);
  if (!card || card.cardType === "action") return false;
  const loc = locateCard(G, cardId);
  return loc?.era === "stone";
}

export interface EraStoneCancelOffer {
  eraCardId: string;
  ownerId: string;
  promptId: string;
}

/**
 * If Stone player still has once-per-game cancel and target is a stone invention,
 * return offer metadata. Caller prompts with yes/no.
 */
export function getEraStoneCancelOffer(
  G: TimestreamsState,
  targetCardId: string,
  mutation: EraMutation,
  sourceKey: string,
): EraStoneCancelOffer | null {
  if (!isStoneAgeInvention(G, targetCardId)) return null;
  const ownerId = playerWithHomeEra(G, "stone");
  if (!ownerId) return null;
  const eraCard =
    findEraCardForPlayer(G, ownerId, "era-stone") ||
    (G.cards?.["era-stone"] as TimestreamsCard | undefined) ||
    null;
  if (!eraCard) return null;
  if (!hasTag(eraCard, "limit:once-per-game") && !hasTag(eraCard, "react:cancel")) {
    // still allow if tagged protect:target:era-invention
    if (!hasTag(eraCard, "protect:target:era-invention")) return null;
  }
  if (isOncePerGameSpent(G, eraCard.id)) return null;
  // Mutation-specific tags
  if (mutation === "move" && !hasTag(eraCard, "protect:move") && !hasTag(eraCard, "react:move") && !hasTag(eraCard, "react:cancel")) {
    return null;
  }
  if (mutation === "discard" && !hasTag(eraCard, "protect:discard") && !hasTag(eraCard, "react:cancel")) {
    return null;
  }
  return {
    eraCardId: eraCard.id,
    ownerId,
    promptId: `${sourceKey}:era-stone-cancel:${targetCardId}`,
  };
}

/** Apply era-stone cancel choice; returns true if effect is cancelled. */
export function resolveEraStoneCancelChoice(
  G: TimestreamsState,
  offer: EraStoneCancelOffer,
  choice: string | string[] | undefined,
): boolean {
  const pick = Array.isArray(choice) ? choice[0] : choice;
  if (pick === "yes" || pick === "cancel") {
    markOncePerGameUsed(G, offer.eraCardId);
    return true;
  }
  return false;
}

/**
 * Score-phase helper: true if Stone player cancelled this mutation via scoreChoices.
 * Unanswered → false (batch default = no cancel); interactive walks must prompt first.
 */
export function scoreMutationCancelledByEraStone(
  G: TimestreamsState,
  targetCardId: string,
  mutation: EraMutation,
  sourceKey: string,
  choices: Record<string, string | string[]> = {},
): boolean {
  const offer = getEraStoneCancelOffer(G, targetCardId, mutation, sourceKey);
  if (!offer) return false;
  return resolveEraStoneCancelChoice(G, offer, choices[offer.promptId]);
}

/** Prompt shape for era-stone cancel (yes = cancel the mutation). */
export function eraStoneCancelPrompt(offer: EraStoneCancelOffer): PlayerPrompt {
  return {
    id: offer.promptId,
    deciderId: offer.ownerId,
    kind: "choose-option",
    options: ["yes", "no"],
    min: 1,
    max: 1,
    reason: "era-stone-cancel",
    labelCardId: offer.eraCardId,
  };
}

/**
 * Modern day begin: optional recover 1 from discard to hand.
 * Returns prompts to install (may be empty).
 */
export function fireModernEraBegin(
  G: TimestreamsState,
): { prompts: PlayerPrompt[]; log: string[] } {
  const log: string[] = [];
  const ownerId = playerWithHomeEra(G, "modern");
  if (!ownerId) return { prompts: [], log };

  let eraCard =
    findEraCardForPlayer(G, ownerId, "era-modern") ||
    (G.cards?.["era-modern"] as TimestreamsCard | undefined) ||
    null;
  if (!eraCard) {
    // Ensure registry entry for label even if not in hand yet
    return { prompts: [], log };
  }
  if (!hasTag(eraCard, "react:era-begin") && !hasTag(eraCard, "recover:from-discard:1")) {
    return { prompts: [], log };
  }

  const disc = G.players[ownerId]?.discard ?? [];
  if (disc.length === 0) {
    log.push(`era-modern: no discard cards to recover`);
    return { prompts: [], log };
  }

  const promptId = `era-modern:era-begin-recover`;
  log.push(`era-modern: P${ownerId} may recover 1 card from discard`);
  return {
    prompts: [
      {
        id: promptId,
        deciderId: ownerId,
        kind: "choose-card",
        options: ["__none__", ...disc.map((c) => c.id)],
        min: 0,
        max: 1,
        reason: "react:era-begin",
        labelCardId: eraCard.id,
      },
    ],
    log,
  };
}

/** Apply modern era-begin recover answer. */
export function applyModernEraBeginRecover(
  G: TimestreamsState,
  playerId: string,
  value: string | string[],
): boolean {
  const pick = Array.isArray(value) ? value[0] : value;
  if (!pick || pick === "" || pick === "__none__") return true;
  const player = G.players[playerId];
  if (!player) return false;
  const idx = player.discard.findIndex((c) => c.id === pick);
  if (idx === -1) return false;
  const [card] = player.discard.splice(idx, 1);
  player.hand.push(card);
  return true;
}

// ---------------------------------------------------------------------------
// Era-Medieval: steal bonus ledger deltas (interactive prompt, not auto)
// ---------------------------------------------------------------------------

export interface EraMedievalStealOffer {
  eraCardId: string;
  ownerId: string;
  /** scoreChoices / prompt id */
  promptId: string;
  /** player who would receive the ledger delta if not stolen */
  bonusOwnerId: string;
  amount: number;
  sourceCardId: string;
  eventIndex: number;
}

/** Active era-medieval steal source still eligible (once-per-game not spent). */
export function getEraMedievalStealSource(
  G: TimestreamsState,
): { eraCardId: string; ownerId: string } | null {
  const ownerId = playerWithHomeEra(G, "medieval");
  if (!ownerId) return null;
  const eraCard =
    findEraCardForPlayer(G, ownerId, "era-medieval") ||
    (G.cards?.["era-medieval"] as TimestreamsCard | undefined) ||
    null;
  if (!eraCard) return null;
  if (!hasTag(eraCard, "steal:bonus-points")) return null;
  if (hasTag(eraCard, "limit:once-per-game") && isOncePerGameSpent(G, eraCard.id)) {
    return null;
  }
  return { eraCardId: eraCard.id, ownerId };
}

/**
 * Prompt: Medieval player may steal this ledger delta (yes) or leave it (no).
 * Decider is always the medieval owner.
 */
export function eraMedievalStealPrompt(
  offer: EraMedievalStealOffer,
): PlayerPrompt {
  return {
    id: offer.promptId,
    deciderId: offer.ownerId,
    kind: "choose-option",
    options: ["yes", "no"],
    min: 1,
    max: 1,
    reason: "era-medieval-steal",
    labelCardId: offer.eraCardId,
  };
}

/** Build prompt id for a predicted/applied bonus event (must match addBonus sequencing). */
export function eraMedievalStealPromptId(
  eraCardId: string,
  sourceCardId: string,
  eventIndex: number,
): string {
  return `${eraCardId}:steal-bonus:${sourceCardId}:${eventIndex}`;
}

/**
 * Future era begin (scoring): optional +2 scoring slots.
 * Call when the scoring walk first enters the future era.
 */
export function getEraFutureSlotPrompt(
  G: TimestreamsState,
): PlayerPrompt | null {
  const ownerId = playerWithHomeEra(G, "future");
  if (!ownerId) return null;
  const eraCard =
    findEraCardForPlayer(G, ownerId, "era-future") ||
    (G.cards?.["era-future"] as TimestreamsCard | undefined) ||
    null;
  if (!eraCard) return null;
  if (!hasTag(eraCard, "score:choice") && !tagsWithPrefix(eraCard, "score:add-scoring-slots").length) {
    return null;
  }
  const key = `${eraCard.id}:score-choice`;
  if (G.scoreChoices?.[key] !== undefined) return null;
  return {
    id: key,
    deciderId: ownerId,
    kind: "choose-option",
    options: ["yes", "no"],
    min: 1,
    max: 1,
    reason: "era-future-slots",
    labelCardId: eraCard.id,
  };
}

/** Apply era-future slot choice from scoreChoices (yes → +N). */
export function applyEraFutureSlotChoice(
  G: TimestreamsState,
  eraId: EraId = "future",
): string[] {
  const log: string[] = [];
  const ownerId = playerWithHomeEra(G, "future");
  if (!ownerId) return log;
  const eraCard =
    findEraCardForPlayer(G, ownerId, "era-future") ||
    (G.cards?.["era-future"] as TimestreamsCard | undefined) ||
    null;
  if (!eraCard) return log;
  const ch = G.scoreChoices?.[`${eraCard.id}:score-choice`];
  const pick = Array.isArray(ch) ? ch[0] : ch;
  if (pick === "yes" || pick === "option-a" || pick === "add") {
    const n = tagNumber(eraCard, "score:add-scoring-slots") || 2;
    const adj = adjustEraScoringSlots(G, eraId, n, `era-future +${n} slots`);
    if (adj) log.push(`era-future: ${adj.note}`);
  }
  return log;
}
