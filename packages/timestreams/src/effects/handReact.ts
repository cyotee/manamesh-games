/**
 * Hand-zone reacts (Herbalism, Big Rock, …).
 *
 * Tag shape (no card names):
 *   react:<event>          e.g. react:action → action-played
 *   react:from:hand        scan hands, not the timeline
 *   trigger:source:opponent
 *   react:cancel + cancel:all-effects-of-source
 *   cost:discard-self
 *
 * Flow: after an Action is played (left hand / registered), pause before
 * resolvePlayEffect, offer optional use-react prompts, then either cancel
 * the Action's effects or continue resolve.
 */

import type { TimestreamsState, TimestreamsCard } from "../types";
import type { PlayerPrompt, ChoiceMap } from "./types";
import { hasTag } from "./tags";
import { getCard, registerCard } from "./state";
import { isOncePerGameSpent, markOncePerGameUsed } from "./react";
import { pushActivityLog } from "../crypto";

export type HandReactEventType = "action-played" | "move" | string;

export interface HandReactEvent {
  type: HandReactEventType;
  /** Card that triggered the event (e.g. the Action that was played). */
  cardId: string;
  actorPlayerId: string;
  eraId?: string;
}

export interface ReactOpportunity {
  reactorCardId: string;
  ownerId: string;
  event: HandReactEvent;
}

/** Map react:* tags to event type families. */
export function reactTagForEvent(eventType: string): string {
  // action-played ↔ react:action; move ↔ react:move; etc.
  if (eventType.endsWith("-played")) {
    return `react:${eventType.slice(0, -"-played".length)}`;
  }
  return `react:${eventType}`;
}

function cardMatchesHandReact(
  card: TimestreamsCard,
  event: HandReactEvent,
): boolean {
  if (!hasTag(card, "react:from:hand")) return false;
  const need = reactTagForEvent(event.type);
  if (!hasTag(card, need)) return false;
  if (hasTag(card, "trigger:source:opponent")) {
    if (card.ownerId === event.actorPlayerId) return false;
  }
  return true;
}

/**
 * Scan all player hands for cards that can react to this event.
 * Shape-driven only — no card ids.
 */
export function getAvailableHandReacts(
  G: TimestreamsState,
  event: HandReactEvent,
): ReactOpportunity[] {
  const out: ReactOpportunity[] = [];
  for (const pid of G.playerOrder || Object.keys(G.players || {})) {
    const hand = G.players[pid]?.hand ?? [];
    for (const card of hand) {
      if (!cardMatchesHandReact(card, event)) continue;
      if (
        hasTag(card, "limit:once-per-game") &&
        isOncePerGameSpent(G, card.id)
      ) {
        continue;
      }
      out.push({
        reactorCardId: card.id,
        ownerId: card.ownerId || pid,
        event,
      });
    }
  }
  return out;
}

export function handReactPromptId(reactorCardId: string): string {
  return `${reactorCardId}:use-react`;
}

/** Build optional yes/no prompts for each hand-react opportunity. */
export function buildHandReactPrompts(
  G: TimestreamsState,
  event: HandReactEvent,
): PlayerPrompt[] {
  const opps = getAvailableHandReacts(G, event);
  return opps.map((opp) => {
    const p: PlayerPrompt = {
      id: handReactPromptId(opp.reactorCardId),
      deciderId: opp.ownerId,
      kind: "choose-option",
      options: ["yes", "no"],
      min: 1,
      max: 1,
      reason: "react:from:hand",
      labelCardId: opp.reactorCardId,
    };
    // Event meta for UI (cancel which Action?)
    (p as any).eventCardId = event.cardId;
    (p as any).eventActorId = event.actorPlayerId;
    (p as any).eventType = event.type;
    return p;
  });
}

/**
 * Play a hand react: remove from hand, discard (cost:discard-self), cancel source.
 * Returns whether the triggering event's effects should be cancelled.
 */
export function applyHandReact(
  G: TimestreamsState,
  playerId: string,
  reactorCardId: string,
  event: HandReactEvent,
): { cancelled: boolean; log: string[] } {
  const log: string[] = [];
  const player = G.players[playerId];
  if (!player) return { cancelled: false, log: ["no player"] };

  const idx = player.hand.findIndex((c) => c.id === reactorCardId);
  if (idx < 0) return { cancelled: false, log: [`${reactorCardId} not in hand`] };

  const [card] = player.hand.splice(idx, 1);
  registerCard(G, card);

  if (!cardMatchesHandReact(card, event)) {
    // put back — illegal
    player.hand.splice(idx, 0, card);
    return { cancelled: false, log: [`${reactorCardId}: tags do not match event`] };
  }

  if (hasTag(card, "limit:once-per-game")) {
    markOncePerGameUsed(G, reactorCardId);
  }

  let cancelled = false;
  if (
    hasTag(card, "react:cancel") &&
    hasTag(card, "cancel:all-effects-of-source")
  ) {
    cancelled = true;
    log.push(
      `${card.id}: cancelled effects of ${event.cardId} (hand react)`,
    );
  } else if (hasTag(card, "react:cancel")) {
    cancelled = true;
    log.push(`${card.id}: react:cancel`);
  }

  if (hasTag(card, "cost:discard-self") || hasTag(card, "react:from:hand")) {
    player.discard.push(card);
    log.push(`${card.id}: discarded after hand react`);
  }

  pushActivityLog(
    G,
    `${card.name || card.id}: reacted to cancel ${event.cardId}`,
    "info",
  );
  return { cancelled, log };
}

/** Pending Action whose play-effects wait for hand-react answers. */
export interface PendingActionResolve {
  cardId: string;
  actorPlayerId: string;
  choices: ChoiceMap;
  event: HandReactEvent;
  /** Prompt ids still waiting (yes/no). */
  remainingPromptIds: string[];
  cancelled: boolean;
}

/**
 * After placing an Action, open a hand-react window if any apply.
 * Returns true if the Action's resolvePlayEffect must wait.
 */
export function openHandReactWindowForAction(
  G: TimestreamsState,
  actionCardId: string,
  actorPlayerId: string,
  choices: ChoiceMap,
): boolean {
  const event: HandReactEvent = {
    type: "action-played",
    cardId: actionCardId,
    actorPlayerId,
    eraId: undefined,
  };
  const prompts = buildHandReactPrompts(G, event);
  if (prompts.length === 0) {
    delete (G as any).pendingActionResolve;
    return false;
  }

  G.pendingPrompts = [
    ...(G.pendingPrompts || []).filter((p) => !p.id.endsWith(":use-react")),
    ...prompts,
  ] as any;

  (G as any).pendingActionResolve = {
    cardId: actionCardId,
    actorPlayerId,
    choices: { ...choices },
    event,
    remainingPromptIds: prompts.map((p) => p.id),
    cancelled: false,
  } satisfies PendingActionResolve;

  pushActivityLog(
    G,
    `Hand react available — waiting (${prompts.map((p) => p.deciderId).join(", ")})`,
    "system",
  );
  return true;
}

/**
 * Answer a use-react prompt. Returns:
 *  - 'waiting' if more reacts pending
 *  - 'cancelled' if Action effects should be skipped
 *  - 'continue' if Action effects should resolve now
 *  - 'INVALID_MOVE' on bad input
 */
export function submitHandReactAnswer(
  G: TimestreamsState,
  playerId: string,
  promptId: string,
  value: string | string[],
): "waiting" | "cancelled" | "continue" | "INVALID_MOVE" {
  const pending = (G as any).pendingActionResolve as PendingActionResolve | undefined;
  if (!pending) return "INVALID_MOVE";

  const queue = G.pendingPrompts ?? [];
  const front = queue[0];
  // Allow answering any remaining use-react owned by this player (not only front)
  // Prefer front if it's theirs; else find theirs in queue.
  let prompt =
    front && front.deciderId === playerId && front.id === promptId
      ? front
      : queue.find((p) => p.id === promptId && p.deciderId === playerId);

  if (!prompt) {
    // Strict: only front of queue to keep order simple
    if (!front || front.id !== promptId) return "INVALID_MOVE";
    if (front.deciderId !== playerId) return "INVALID_MOVE";
    prompt = front;
  }
  if (prompt.reason !== "react:from:hand" && !prompt.id.endsWith(":use-react")) {
    return "INVALID_MOVE";
  }

  const answer = Array.isArray(value) ? value[0] : value;
  if (answer !== "yes" && answer !== "no") return "INVALID_MOVE";

  const reactorId = promptId.includes(":use-react")
    ? promptId.slice(0, promptId.indexOf(":use-react"))
    : promptId.split(":")[0];

  // Remove this prompt from queue
  G.pendingPrompts = queue.filter((p) => p.id !== promptId);
  pending.remainingPromptIds = pending.remainingPromptIds.filter(
    (id) => id !== promptId,
  );

  if (answer === "yes") {
    const result = applyHandReact(G, playerId, reactorId, pending.event);
    for (const line of result.log) pushActivityLog(G, line, "info");
    if (result.cancelled) {
      pending.cancelled = true;
      // Drop remaining react prompts — effect already cancelled
      G.pendingPrompts = (G.pendingPrompts || []).filter(
        (p) => !p.id.endsWith(":use-react"),
      );
      pending.remainingPromptIds = [];
      delete (G as any).pendingActionResolve;
      return "cancelled";
    }
  }

  if (pending.remainingPromptIds.length > 0 && (G.pendingPrompts?.length ?? 0) > 0) {
    // Ensure remaining use-react prompts stay at front
    return "waiting";
  }

  if (pending.cancelled) {
    delete (G as any).pendingActionResolve;
    return "cancelled";
  }

  // No more reacts — caller should resolve Action effects
  const cont = pending;
  delete (G as any).pendingActionResolve;
  // Stash choices for playAction continuation if needed
  (G as any)._resumeActionChoices = cont.choices;
  (G as any)._resumeActionCardId = cont.cardId;
  (G as any)._resumeActionActor = cont.actorPlayerId;
  return "continue";
}

export function clearResumeAction(G: TimestreamsState): void {
  delete (G as any)._resumeActionChoices;
  delete (G as any)._resumeActionCardId;
  delete (G as any)._resumeActionActor;
}
