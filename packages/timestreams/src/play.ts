import type { Ctx } from "boardgame.io";
import type { TimestreamsState, TimestreamsCard } from "./types";
import { eraForDay, appendToEra, appendActionToEra, isLastDay } from "./timeline";
import { transitionCardVisibility } from "./visibility";
import { dealForDay, dealPlaintextHands, pushActivityLog } from "./crypto";
import { dayFirstPlayer } from "./homeEra";
import { registerCard } from "./effects/state";
import { clearRestOfToday } from "./effects/modifiers";
import { fireEvent, registerStaticTriggers } from "./effects/triggers";
import { canPlayCard } from "./effects/gates";
import { resolvePlayEffect } from "./effects/resolvePlay";
import type { ChoiceMap } from "./effects/types";
import { hasTag, tagValue } from "./effects/tags";
import { erasForScope } from "./effects/targets";
import { resolveMutualDiscardPairs } from "./effects/executors/mutualDiscard";
import {
  openHandReactWindowForAction,
  submitHandReactAnswer,
  clearResumeAction,
} from "./effects/handReact";

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

function rulesOn(G: TimestreamsState): boolean {
  // Missing/undefined treats as enabled (legacy fixtures / tests).
  return G.config?.rulesEnabled !== false;
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

  const useRules = rulesOn(G);
  const inHand = player.hand.find((c: TimestreamsCard) => c.id === cardId);
  const resubmission =
    useRules &&
    !inHand &&
    G.cards?.[cardId] !== undefined &&
    (G.pendingPrompts?.length ?? 0) > 0;
  if (!resubmission) {
    if (!inHand || !isInvention(inHand)) return INVALID_MOVE;
    if (useRules && !canPlayCard(G, playerId, cardId).ok) return INVALID_MOVE;
    removeCardFromHand(player, cardId);
    registerCard(G, inHand);
    const era = eraForDay(G.currentDay);
    appendToEra(G.timeline, era, cardId);
    transitionCardVisibility(G, cardId, "public", playerId, "playInvention", { era });
    player.hasPassedThisDay = false;
    if (useRules) {
      try {
        registerStaticTriggers(G, inHand);
        fireEvent(G, { type: "invention-played", cardId, eraId: era, actorPlayerId: playerId });
      } catch (err) {
        console.error("[playInvention] rules engine error (triggers)", err);
      }
    }
  }

  if (useRules) {
    try {
      const result = resolvePlayEffect(G, playerId, cardId, choices);
      G.pendingPrompts = result.prompts.length ? result.prompts : [];
      for (const line of result.log ?? []) {
        pushActivityLog(G, line, "info");
      }
      // Slow Time landing on Fast Time (mutual both directions).
      resolveMutualDiscardPairs(G, playerId);
    } catch (err) {
      console.error("[playInvention] rules engine error (resolvePlay)", err);
      G.pendingPrompts = [];
    }
  } else {
    G.pendingPrompts = [];
  }
  return G;
}

/**
 * Actions with play:scope:today|tomorrow|… attach to that era (Slow/Fast Time).
 * They do NOT enter invention scoring slots — only era.actions.
 */
function placeActionOnScopedEra(
  G: TimestreamsState,
  card: TimestreamsCard,
  cardId: string,
): boolean {
  // Tags look like play:scope:today
  const scope = tagValue(card, "play:scope");
  if (!scope) return false;
  const era =
    erasForScope(G, scope, cardId)[0] ?? eraForDay(G.currentDay);
  appendActionToEra(G.timeline, era, cardId);
  return true;
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

  const useRules = rulesOn(G);
  const inHand = player.hand.find((c: TimestreamsCard) => c.id === cardId);
  // Waiting on hand-react answers for this Action — do not re-place or re-fire.
  const waitingHandReact =
    useRules &&
    (G as any).pendingActionResolve?.cardId === cardId &&
    (G as any).pendingActionResolve?.actorPlayerId === playerId;
  if (waitingHandReact) {
    return G;
  }

  const resubmission =
    useRules &&
    !inHand &&
    G.cards?.[cardId] !== undefined &&
    (G.pendingPrompts?.length ?? 0) > 0 &&
    !(G as any).pendingActionResolve;
  if (!resubmission) {
    if (!inHand || !isAction(inHand)) return INVALID_MOVE;
    // Gates: Smoke Signals (prevent:play:action), etc.
    if (useRules && !canPlayCard(G, playerId, cardId).ok) return INVALID_MOVE;
    removeCardFromHand(player, cardId);
    registerCard(G, inHand);
    // Slow/Fast Time: "Play on Today" → era stack, not discard.
    const placedOnEra =
      useRules &&
      (hasTag(inHand, "play:scope:today") ||
        hasTag(inHand, "play:scope:tomorrow") ||
        !!tagValue(inHand, "play:scope")) &&
      placeActionOnScopedEra(G, inHand, cardId);
    if (!placedOnEra) {
      player.discard.push(inHand);
    }
    transitionCardVisibility(
      G,
      cardId,
      "public",
      playerId,
      "playAction",
      placedOnEra ? { era: eraForDay(G.currentDay) } : {},
    );
    player.hasPassedThisDay = false;
    if (useRules) {
      try {
        fireEvent(G, {
          type: "action-played",
          cardId,
          eraId: eraForDay(G.currentDay),
          actorPlayerId: playerId,
        });
      } catch (err) {
        console.error("[playAction] rules engine error (triggers)", err);
      }
      // Hand reacts (Herbalism-style) pause before Action effects resolve.
      try {
        if (openHandReactWindowForAction(G, cardId, playerId, choices)) {
          return G;
        }
      } catch (err) {
        console.error("[playAction] hand-react window failed", err);
      }
    }
  }

  if (useRules) {
    try {
      const result = resolvePlayEffect(G, playerId, cardId, choices);
      G.pendingPrompts = result.prompts.length ? result.prompts : [];
      for (const line of result.log ?? []) {
        pushActivityLog(G, line, "info");
      }
      // Fast Time ↔ Slow Time: discard one pair when both share an era.
      resolveMutualDiscardPairs(G, playerId);
    } catch (err) {
      console.error("[playAction] rules engine error (resolvePlay)", err);
      G.pendingPrompts = [];
    }
  } else {
    G.pendingPrompts = [];
  }
  return G;
}

/**
 * Resume Action effect resolution after all hand reacts declined (or none cancelled).
 * Called from submitReact move.
 */
export function resumePendingActionEffects(
  G: TimestreamsState,
): void {
  const cardId = (G as any)._resumeActionCardId as string | undefined;
  const actorId = (G as any)._resumeActionActor as string | undefined;
  const choices = ((G as any)._resumeActionChoices as ChoiceMap) || {};
  clearResumeAction(G);
  if (!cardId || !actorId || !rulesOn(G)) return;
  try {
    const result = resolvePlayEffect(G, actorId, cardId, choices);
    G.pendingPrompts = result.prompts.length ? result.prompts : [];
    for (const line of result.log ?? []) {
      pushActivityLog(G, line, "info");
    }
    resolveMutualDiscardPairs(G, actorId);
  } catch (err) {
    console.error("[resumePendingActionEffects] failed", err);
    G.pendingPrompts = [];
  }
}

/**
 * Answer a hand-react prompt (any player who owns the reactor — concurrent).
 */
export function submitReact(
  G: TimestreamsState,
  playerId: string,
  promptId: string,
  value: string | string[],
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (!rulesOn(G)) return INVALID_MOVE;

  const result = submitHandReactAnswer(G, playerId, promptId, value);
  if (result === "INVALID_MOVE") return INVALID_MOVE;

  if (result === "cancelled") {
    // Action already played/spent; effects fizzle. Clear any leftover prompts.
    pushActivityLog(G, `Action effects cancelled by hand react`, "system");
    return G;
  }
  if (result === "waiting") {
    return G;
  }
  // continue — resolve the paused Action
  resumePendingActionEffects(G);
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
  if (rulesOn(G)) {
    try {
      clearRestOfToday(G);
    } catch (err) {
      console.error("[endDay] rules engine error (clearRestOfToday)", err);
    }
  }
  if (isLastDay(G.currentDay)) {
    G.phase = "scoring";
    return;
  }

  G.currentDay += 1;
  // reset pass flags
  for (const pid of G.playerOrder) {
    if (G.players[pid]) G.players[pid].hasPassedThisDay = false;
  }
  // Next turn must start with this day's first player (chronological home-era rotation).
  G.dayFirstPlayer = dayFirstPlayer(G, G.currentDay);
  G.startOfDayPending = true;
  if (G.config?.playMode === "mental-poker") {
    dealForDay(G, G.currentDay);
  } else {
    // Append new cards for the next day (day > 1 keeps existing hand).
    dealPlaintextHands(G, G.currentDay);
  }
}
