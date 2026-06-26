import type { Ctx } from "boardgame.io";
import type { TimestreamsState, TimestreamsCard } from "./types";
import { eraForDay, appendToEra, isLastDay } from "./timeline";
import { transitionCardVisibility } from "./visibility";
import { dealForDay } from "./crypto";
import { dayFirstPlayer } from "./homeEra";

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
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const card = player.hand.find((c: TimestreamsCard) => c.id === cardId);
  if (!card || !isInvention(card)) return INVALID_MOVE;

  removeCardFromHand(player, cardId);
  const era = eraForDay(G.currentDay);
  appendToEra(G.timeline, era, cardId);
  transitionCardVisibility(G, cardId, "public", playerId, "playInvention", { era });
  player.hasPassedThisDay = false;

  return G;
}

export function playAction(
  G: TimestreamsState,
  ctx: Ctx,
  playerId: string,
  cardId: string,
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (ctx.currentPlayer !== playerId) return INVALID_MOVE;

  const player = G.players[playerId];
  if (!player) return INVALID_MOVE;

  const card = player.hand.find((c: TimestreamsCard) => c.id === cardId);
  if (!card || !isAction(card)) return INVALID_MOVE;

  removeCardFromHand(player, cardId);
  player.discard.push(card);
  transitionCardVisibility(G, cardId, "public", playerId, "playAction", {});
  player.hasPassedThisDay = false;

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
