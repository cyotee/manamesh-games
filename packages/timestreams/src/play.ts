import type { Ctx } from "boardgame.io";
import type { TimestreamsState, TimestreamsCard } from "./types";
import { eraForDay, appendToEra, isLastDay } from "./timeline";
import { transitionCardVisibility } from "./visibility";
import { dealForDay } from "./crypto";
import { dayFirstPlayer } from "./homeEra";
import { registerCard } from "./effects/state";
import { clearRestOfToday } from "./effects/modifiers";
import { fireEvent, registerStaticTriggers } from "./effects/triggers";
import { canPlayCard } from "./effects/gates";
import { resolvePlayEffect } from "./effects/resolvePlay";
import type { ChoiceMap } from "./effects/types";

// Local constant (boardgame.io/core may not resolve under vitest+PnP)
export const INVALID_MOVE = "INVALID_MOVE" as const;

function removeCardFromHand(player: any, cardId: string): TimestreamsCard | undefined {
  const idx = player.hand.findIndex((c: TimestreamsCard) => c.id === cardId);
  if (idx < 0) return undefined;
  const [card] = player.hand.splice(idx, 1);
  return card;
}

function isInvention(card: TimestreamsCard): boolean {
  return card.cardType === "invention";
}

function isAction(card: TimestreamsCard): boolean {
  return card.cardType === "action";
}

export function playInvention(
  G: TimestreamsState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
  choices: ChoiceMap = {},
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const inHand = player.hand.find((c: TimestreamsCard) => c.id === cardId);
  const resubmission = !inHand && G.cards?.[cardId] !== undefined && (G.pendingPrompts?.length ?? 0) > 0;
  if (!resubmission) {
    if (!inHand || !isInvention(inHand)) return INVALID_MOVE;
    if (!canPlayCard(G, playerId, cardId).ok) return INVALID_MOVE;
    removeCardFromHand(player, cardId);
    registerCard(G, inHand);
    const era = eraForDay(G.currentDay);
    appendToEra(G.timeline, era, cardId);
    transitionCardVisibility(G, cardId, "public", playerId, "playInvention", { era });
    player.hasPassedThisDay = false;
    registerStaticTriggers(G, inHand);
    fireEvent(G, { type: "invention-played", cardId, eraId: era, actorPlayerId: playerId });
  }

  const result = resolvePlayEffect(G, playerId, cardId, choices);
  G.pendingPrompts = result.prompts.length ? result.prompts : [];
  return G;
}

export function playAction(
  G: TimestreamsState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
  choices: ChoiceMap = {},
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const inHand = player.hand.find((c: TimestreamsCard) => c.id === cardId);
  const resubmission = !inHand && G.cards?.[cardId] !== undefined && (G.pendingPrompts?.length ?? 0) > 0;
  if (!resubmission) {
    if (!inHand || !isAction(inHand)) return INVALID_MOVE;
    removeCardFromHand(player, cardId);
    registerCard(G, inHand);
    player.discard.push(inHand);
    transitionCardVisibility(G, cardId, "public", playerId, "playAction", {});
    player.hasPassedThisDay = false;
    fireEvent(G, { type: "action-played", cardId, eraId: eraForDay(G.currentDay), actorPlayerId: playerId });
  }

  const result = resolvePlayEffect(G, playerId, cardId, choices);
  G.pendingPrompts = result.prompts.length ? result.prompts : [];
  return G;
}

function allPlayersPassed(G: TimestreamsState): boolean {
  return G.playerOrder.every((pid) => G.players[pid]?.hasPassedThisDay);
}

export function pass(
  G: TimestreamsState,
  ctx: Ctx,
  playerId: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  player.hasPassedThisDay = true;

  if (allPlayersPassed(G)) {
    endDay(G);
  }

  return G;
}

export function endDay(G: TimestreamsState): void {
  clearRestOfToday(G);
  if (isLastDay(G.currentDay)) {
    G.phase = "scoring";
    return;
  }

  G.currentDay += 1;
  // reset pass flags
  for (const pid of G.playerOrder) {
    if (G.players[pid]) G.players[pid].hasPassedThisDay = false;
  }
  G.dayFirstPlayer = dayFirstPlayer(G, G.currentDay);
  dealForDay(G, G.currentDay);
}
