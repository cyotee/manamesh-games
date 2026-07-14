import type { Ctx } from "boardgame.io";
import type { TimestreamsState, TimestreamsCard } from "./types";
import { eraForDay, appendToEra, appendActionToEra, isLastDay } from "./timeline";
import { transitionCardVisibility } from "./visibility";
import {
  dealForDay,
  dealPlaintextHands,
  pushActivityLog,
  hasActiveDeckOp,
} from "./crypto";
import { dayFirstPlayer } from "./homeEra";
import {
  fireModernEraBegin,
  applyModernEraBeginRecover,
} from "./effects/eraAbilities";
import { registerCard } from "./effects/state";
import { clearRestOfToday } from "./effects/modifiers";
import { fireEvent, registerStaticTriggers } from "./effects/triggers";
import { canPlayCard } from "./effects/gates";
import { resolvePlayEffect } from "./effects/resolvePlay";
import type { ChoiceMap, EffectResult, PlayerPrompt } from "./effects/types";
import { hasTag, tagValue } from "./effects/tags";
import { erasForScope, locateCard } from "./effects/targets";
import { discardFromPlay } from "./effects/boardOps";
import { swapPositions } from "./effects/executors/swap";
import { resolveMutualDiscardPairs } from "./effects/executors/mutualDiscard";
import {
  openHandReactWindowForAction,
  submitHandReactAnswer,
  clearResumeAction,
} from "./effects/handReact";
import {
  cardLabel,
  formatChoiceDisplay,
  logPlay,
  pushEffectLogs,
} from "./activityLogHelpers";
import {
  hasPlayOnce,
  isPlayEffectsComplete,
  markPlayEffectsComplete,
  playOnce,
  resetPlayEffectGates,
} from "./effects/playOnce";

// Local constant (boardgame.io/core may not resolve under vitest+PnP)
export const INVALID_MOVE = "INVALID_MOVE" as const;

/**
 * Search-deck (Think About The Future) spans decrypt → choose → reshuffle.
 * While decrypt/choose is open for this card, play resolution must stay alive.
 */
function isDeckSearchOpen(G: TimestreamsState, cardId: string): boolean {
  const op = G.activeDeckOp;
  if (!op || !hasActiveDeckOp(G)) return false;
  if (op.sourceCardId !== cardId) return false;
  return op.phase === "decrypt" || op.phase === "choose";
}

/** True for standing-trigger / react prompts (not invent play-effect prompts). */
function isEventSourcedPrompt(front: PlayerPrompt): boolean {
  if (front.id.includes(":crop-swap:")) return true;
  if (front.reason === "retaliate:discard") return true;
  if (front.reason === "crop-swap") return true;
  if (front.reason === "react:era-begin") return true;
  if (front.reason === "era-stone-cancel") return true;
  if (front.id.includes("era-begin-recover")) return true;
  if (front.id.includes(":era-stone-cancel:")) return true;
  return false;
}

/** Install react/trigger prompts (Crop Rotation, ID retaliate, Crusades, …). */
function installEventPrompts(
  G: TimestreamsState,
  prompts: PlayerPrompt[],
  log: string[],
  fallbackActor: string,
): void {
  if (log.length) pushEffectLogs(G, log);
  if (!prompts.length) return;
  G.pendingPrompts = [...(G.pendingPrompts || []), ...prompts] as any;
  // Prefer first prompt's decider; keep pendingPlayEffect for submitPlayChoice.
  const front = G.pendingPrompts[0];
  if (front) {
    G.pendingPlayEffect = {
      cardId: front.labelCardId || front.id.split(":")[0],
      actorPlayerId: front.deciderId || fallbackActor,
      kind: G.pendingPlayEffect?.kind || "action",
      choices: { ...(G.pendingPlayEffect?.choices || {}) },
    };
  }
}

/**
 * After invent play effects fully settle, fire invention-played so Crop Rotation,
 * Waylay, Dot Com, Television, etc. see the post-effect board.
 * Deferred (not at place-time) so finishPlayResolve cannot wipe their prompts.
 */
function fireInventionPlayedAfterEffects(
  G: TimestreamsState,
  playerId: string,
  cardId: string,
): void {
  if (hasPlayOnce(G, cardId, "invention-played-event")) return;
  if (isDeckSearchOpen(G, cardId)) return;
  // Only fire once invent play-effect prompts for this card are gone.
  const inventPrompts = (G.pendingPrompts || []).filter(
    (p) => !isEventSourcedPrompt(p as PlayerPrompt) && p.id.startsWith(`${cardId}:`),
  );
  if (inventPrompts.length > 0) return;

  playOnce(G, cardId, "invention-played-event", () => {
    const era =
      locateCard(G, cardId)?.era ?? eraForDay(G.currentDay);
    try {
      // Static triggers for this card were registered at place-time; only fire
      // the event so *other* standing watchers (Crop, Waylay, Dot Com, …) react.
      const ev = fireEvent(G, {
        type: "invention-played",
        cardId,
        eraId: era,
        actorPlayerId: playerId,
      });
      installEventPrompts(G, ev.prompts, ev.log, playerId);
      return ev.log.length ? ev.log : [`${cardId}: invention-played`];
    } catch (err) {
      console.error("[playInvention] rules engine error (triggers)", err);
      return [];
    }
  });
}

/**
 * Apply answers for event-sourced prompts that are not play-effect re-resolves.
 */
function applyEventPromptAnswer(
  G: TimestreamsState,
  front: PlayerPrompt,
  value: string | string[],
): boolean {
  const pick = Array.isArray(value) ? value[0] : value;
  const none = !pick || pick === "" || pick === "__none__";

  // Crop Rotation: `${sourceId}:crop-swap:${triggerId}`
  if (
    front.id.includes(":crop-swap:") ||
    front.reason === "crop-swap"
  ) {
    const sourceId =
      front.labelCardId ||
      front.id.split(":crop-swap:")[0] ||
      front.id.split(":")[0];
    if (none) {
      logPlay(G, `  ↳ Crop Rotation: declined swap`);
      return true;
    }
    if (swapPositions(G, sourceId, pick)) {
      logPlay(G, `  ↳ Crop Rotation: swapped ${sourceId} ↔ ${pick}`);
    }
    return true;
  }

  // Crusades / International Diplomacy retaliate discard
  if (front.reason === "retaliate:discard") {
    if (none) {
      logPlay(G, `  ↳ Retaliate declined`);
      return true;
    }
    const actor = front.deciderId;
    discardFromPlay(G, pick, actor);
    logPlay(G, `  ↳ Retaliate discarded ${cardLabel(G, pick)}`);
    // Chain discarded-from-play for Crusades / Taxes etc.
    const locEra = locateCard(G, pick)?.era ?? null;
    const nested = fireEvent(G, {
      type: "discarded-from-play",
      cardId: pick,
      eraId: locEra,
      actorPlayerId: actor,
    });
    installEventPrompts(G, nested.prompts, nested.log, actor);
    return true;
  }

  // Era-Modern begin: recover from discard
  if (
    front.reason === "react:era-begin" ||
    front.id.includes("era-begin-recover")
  ) {
    applyModernEraBeginRecover(G, front.deciderId, value);
    logPlay(
      G,
      none
        ? `  ↳ Era-Modern: declined recover`
        : `  ↳ Era-Modern: recovered ${cardLabel(G, pick)} to hand`,
    );
    return true;
  }

  return false;
}

/** Shared post-resolve bookkeeping for playInvention / playAction / submitPlayChoice. */
function finishPlayResolve(
  G: TimestreamsState,
  playerId: string,
  cardId: string,
  kind: "invention" | "action",
  merged: ChoiceMap,
  result: EffectResult,
  opts?: { quietContinue?: boolean },
): void {
  // Re-check after executors run (search pick may have advanced activeDeckOp).
  const openSearch = isDeckSearchOpen(G, cardId);

  // Preserve event-sourced prompts (Crop / retaliate) when invent effects settle.
  const preservedEvents = (G.pendingPrompts || []).filter((p) =>
    isEventSourcedPrompt(p as PlayerPrompt),
  );

  if (result.prompts.length > 0) {
    // Invent/action play-effect prompts take priority; keep events behind them.
    G.pendingPrompts = [...result.prompts, ...preservedEvents] as any;
  } else if (!openSearch) {
    G.pendingPrompts = preservedEvents as any;
  }
  // else: decrypt/choose still open — keep prompts installed by crypto

  const livePrompts = G.pendingPrompts || [];
  const stillWaitingPlay =
    result.prompts.length > 0 || openSearch;
  const stillWaiting = livePrompts.length > 0 || openSearch;

  if (stillWaitingPlay) {
    // Keep pendingPlayEffect so submitPlayChoice can answer invent/search pick
    G.pendingPlayEffect = {
      cardId,
      actorPlayerId: playerId,
      kind,
      choices: { ...merged },
    };
    if (G.playEffectsComplete) delete G.playEffectsComplete[cardId];
  } else if (stillWaiting) {
    // Only event prompts remain — bind to front event decider
    const front = livePrompts[0];
    G.pendingPlayEffect = {
      cardId: (front as PlayerPrompt).labelCardId || front.id.split(":")[0],
      actorPlayerId: front.deciderId || playerId,
      kind: "action",
      choices: {},
    };
    markPlayEffectsComplete(G, cardId);
  } else {
    stashPendingPlayEffect(G, cardId, playerId, kind, merged, []);
  }

  pushEffectLogs(G, result.log);
  if (result.prompts.length > 0) {
    if (!opts?.quietContinue) {
      logPlay(
        G,
        `  ⏳ Waiting for play choices on ${cardLabel(G, cardId)}: ${result.prompts
          .map((p) => p.reason || p.id)
          .join(", ")}`,
      );
    }
  } else if (openSearch) {
    logPlay(
      G,
      `  ⏳ Deck search for ${cardLabel(G, cardId)} — ${G.activeDeckOp?.phase}` +
        (G.activeDeckOp?.statusMessage
          ? ` (${G.activeDeckOp.statusMessage})`
          : ""),
    );
  } else {
    markPlayEffectsComplete(G, cardId);
    logPlay(G, `✓ Play effects done for ${cardLabel(G, cardId)}`);
    // Invent play effects first, then standing reacts (Crop Rotation, Waylay, …)
    if (kind === "invention") {
      fireInventionPlayedAfterEffects(G, playerId, cardId);
    }
  }
  resolveMutualDiscardPairs(G, playerId);
}

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

function stashPendingPlayEffect(
  G: TimestreamsState,
  cardId: string,
  actorPlayerId: string,
  kind: "invention" | "action",
  choices: ChoiceMap,
  prompts: { length: number },
): void {
  if (prompts.length > 0) {
    G.pendingPlayEffect = {
      cardId,
      actorPlayerId,
      kind,
      choices: { ...choices },
    };
  } else {
    delete G.pendingPlayEffect;
  }
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
  const alreadyInPlay = !!locateCard(G, cardId);

  // Fully resolved play — ignore double-clicks / re-submits
  // (but not while search-deck decrypt/choose is still open).
  if (
    useRules &&
    isPlayEffectsComplete(G, cardId) &&
    !inHand &&
    !isDeckSearchOpen(G, cardId)
  ) {
    return G;
  }

  // Resume effect resolution after prompts — never re-place the card.
  const resubmission =
    useRules &&
    !inHand &&
    G.cards?.[cardId] !== undefined &&
    (alreadyInPlay ||
      (G.pendingPrompts?.length ?? 0) > 0 ||
      G.pendingPlayEffect?.cardId === cardId ||
      isDeckSearchOpen(G, cardId));

  // Block NEW plays while Fortune Teller / search-deck cooperative decrypt runs.
  // Interrupting wipes pendingPlayEffect and desyncs peels (stuck mid 0–N).
  if (
    !resubmission &&
    G.activeDeckOp &&
    (G.activeDeckOp.phase === "decrypt" || G.activeDeckOp.phase === "choose") &&
    G.activeDeckOp.sourceCardId !== cardId
  ) {
    return INVALID_MOVE;
  }

  if (!resubmission) {
    if (!inHand || !isInvention(inHand)) return INVALID_MOVE;
    // Already on the timeline under this id — do not stack a second copy.
    if (alreadyInPlay) return INVALID_MOVE;
    if (useRules && !canPlayCard(G, playerId, cardId).ok) return INVALID_MOVE;
    removeCardFromHand(player, cardId);
    // Seat ownership must match the inventing player for target-owner deciders
    // (Surgical Strike option prompt, etc.).
    inHand.ownerId = playerId;
    registerCard(G, inHand);
    resetPlayEffectGates(G, cardId);
    const era = eraForDay(G.currentDay);
    appendToEra(G.timeline, era, cardId);
    transitionCardVisibility(G, cardId, "public", playerId, "playInvention", { era });
    player.hasPassedThisDay = false;
    logPlay(
      G,
      `▶ P${playerId} plays invention ${cardLabel(G, cardId)} → ${era} (top of stack)`,
    );
    // Standing triggers for this card register on place; invention-played for
    // *other* cards (Crop Rotation, …) fires after invent play effects settle
    // so Organ Transplant swap prompts are not wiped by finishPlayResolve.
    if (useRules) {
      try {
        registerStaticTriggers(G, inHand);
      } catch (err) {
        console.error("[playInvention] rules engine error (register triggers)", err);
      }
    }
  } else {
    if (!alreadyInPlay && !G.cards?.[cardId]) return INVALID_MOVE;
  }

  if (useRules) {
    try {
      const prevChoices =
        G.pendingPlayEffect?.cardId === cardId
          ? G.pendingPlayEffect.choices
          : {};
      const merged = { ...prevChoices, ...choices };
      // No new answers and still waiting — skip re-resolve noise.
      const newKeys = Object.keys(choices).filter(
        (k) =>
          choices[k] !== undefined &&
          JSON.stringify(prevChoices[k]) !== JSON.stringify(choices[k]),
      );
      // Waiting on event prompts (Crop) after invent effects — do not re-resolve invent.
      const onlyEventPrompts =
        (G.pendingPrompts?.length ?? 0) > 0 &&
        (G.pendingPrompts || []).every((p) =>
          isEventSourcedPrompt(p as PlayerPrompt),
        );
      if (
        resubmission &&
        newKeys.length === 0 &&
        ((G.pendingPrompts?.length ?? 0) > 0 && Object.keys(choices).length === 0)
      ) {
        return G;
      }
      if (onlyEventPrompts && newKeys.length === 0 && isPlayEffectsComplete(G, cardId)) {
        return G;
      }

      const result = resolvePlayEffect(G, playerId, cardId, merged);
      finishPlayResolve(G, playerId, cardId, "invention", merged, result, {
        quietContinue: resubmission && newKeys.length === 0,
      });
    } catch (err) {
      console.error("[playInvention] rules engine error (resolvePlay)", err);
      // Drop only this invent's play-effect prompts; keep event prompts if any.
      G.pendingPrompts = (G.pendingPrompts || []).filter((p) =>
        isEventSourcedPrompt(p as PlayerPrompt),
      ) as any;
      delete G.pendingPlayEffect;
      markPlayEffectsComplete(G, cardId);
      logPlay(G, `  · ERROR resolving ${cardLabel(G, cardId)} play effects`);
      fireInventionPlayedAfterEffects(G, playerId, cardId);
    }
  } else {
    G.pendingPrompts = [];
    delete G.pendingPlayEffect;
    markPlayEffectsComplete(G, cardId);
  }
  return G;
}

/**
 * Answer the front pending play-effect prompt (any player who is the decider).
 * Used for Thought Police redirect (owner may not be current player).
 */
export function submitPlayChoice(
  G: TimestreamsState,
  playerId: string,
  promptId: string,
  value: string | string[],
): TimestreamsState | typeof INVALID_MOVE {
  if (G.phase !== "play") return INVALID_MOVE;
  if (!rulesOn(G)) return INVALID_MOVE;

  const front = G.pendingPrompts?.[0];
  if (!front || front.id !== promptId) return INVALID_MOVE;
  if (front.deciderId !== playerId) return INVALID_MOVE;

  // Event-sourced prompts only (Crop Rotation, Crusades, ID retaliate).
  // Do NOT treat invent play:swap (Organ Transplant) as an event — same reason
  // string `swap:target:self` is used by both; route Organ through resolvePlayEffect.
  if (isEventSourcedPrompt(front)) {
    logPlay(
      G,
      `  ↳ P${playerId} chose [${front.reason || promptId}]: ${formatChoiceDisplay(G, value)}`,
    );
    applyEventPromptAnswer(G, front, value);
    // Pop this prompt; keep any chained ones from installEventPrompts
    G.pendingPrompts = (G.pendingPrompts || []).filter((p) => p.id !== promptId);
    if ((G.pendingPrompts?.length ?? 0) === 0) {
      delete G.pendingPlayEffect;
    } else {
      const next = G.pendingPrompts[0];
      G.pendingPlayEffect = {
        cardId: next.labelCardId || next.id.split(":")[0],
        actorPlayerId: next.deciderId,
        kind: "action",
        choices: {},
      };
    }
    return G;
  }

  // Revive pendingPlayEffect for search-deck choose after decrypt (may have
  // been cleared when decrypt returned done() with no prompts).
  let pending = G.pendingPlayEffect;
  const searchOp = G.activeDeckOp;
  if (
    !pending &&
    searchOp &&
    searchOp.phase === "choose" &&
    promptId === `${searchOp.sourceCardId}:search-deck`
  ) {
    pending = {
      cardId: searchOp.sourceCardId,
      actorPlayerId: searchOp.ownerId,
      kind: "action",
      choices: {},
    };
    G.pendingPlayEffect = pending;
    if (G.playEffectsComplete) delete G.playEffectsComplete[searchOp.sourceCardId];
  }
  if (!pending) return INVALID_MOVE;

  if (
    isPlayEffectsComplete(G, pending.cardId) &&
    !isDeckSearchOpen(G, pending.cardId)
  ) {
    return G;
  }

  // Duplicate answer for the same prompt (unless search re-prompt after failed pick)
  if (
    pending.choices[promptId] !== undefined &&
    !isDeckSearchOpen(G, pending.cardId)
  ) {
    return INVALID_MOVE;
  }

  const merged: ChoiceMap = {
    ...pending.choices,
    [promptId]: value,
  };
  pending.choices = merged;

  logPlay(
    G,
    `  ↳ P${playerId} chose [${front.reason || promptId}]: ${formatChoiceDisplay(G, value)}` +
      ` (for ${cardLabel(G, pending.cardId)})`,
  );

  try {
    const result = resolvePlayEffect(
      G,
      pending.actorPlayerId,
      pending.cardId,
      merged,
    );
    finishPlayResolve(
      G,
      pending.actorPlayerId,
      pending.cardId,
      pending.kind,
      merged,
      result,
    );
  } catch (err) {
    console.error("[submitPlayChoice] failed", err);
    return INVALID_MOVE;
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

  if (
    useRules &&
    isPlayEffectsComplete(G, cardId) &&
    !inHand &&
    !isDeckSearchOpen(G, cardId)
  ) {
    return G;
  }

  const alreadyPlaced =
    !!locateCard(G, cardId) ||
    (player.discard || []).some((c) => c.id === cardId);
  const resubmission =
    useRules &&
    !inHand &&
    G.cards?.[cardId] !== undefined &&
    (alreadyPlaced ||
      ((G.pendingPrompts?.length ?? 0) > 0 && !(G as any).pendingActionResolve) ||
      G.pendingPlayEffect?.cardId === cardId ||
      isDeckSearchOpen(G, cardId));

  if (
    !resubmission &&
    G.activeDeckOp &&
    (G.activeDeckOp.phase === "decrypt" || G.activeDeckOp.phase === "choose") &&
    G.activeDeckOp.sourceCardId !== cardId
  ) {
    return INVALID_MOVE;
  }

  if (!resubmission) {
    if (!inHand || !isAction(inHand)) return INVALID_MOVE;
    if (alreadyPlaced) return INVALID_MOVE;
    // Gates: Smoke Signals (prevent:play:action), etc.
    if (useRules && !canPlayCard(G, playerId, cardId).ok) return INVALID_MOVE;
    removeCardFromHand(player, cardId);
    registerCard(G, inHand);
    resetPlayEffectGates(G, cardId);
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
    const scope = tagValue(inHand, "play:scope");
    const destEra = placedOnEra
      ? erasForScope(G, scope || "today", cardId)[0] ?? eraForDay(G.currentDay)
      : null;
    transitionCardVisibility(
      G,
      cardId,
      "public",
      playerId,
      "playAction",
      placedOnEra ? { era: destEra || eraForDay(G.currentDay) } : {},
    );
    player.hasPassedThisDay = false;
    logPlay(
      G,
      `▶ P${playerId} plays action ${cardLabel(G, cardId)}` +
        (placedOnEra && destEra
          ? ` → ${destEra} (era action)`
          : " → discard (resolve effects)"),
    );
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
          logPlay(
            G,
            `  ⏳ Hand react window open for ${cardLabel(G, cardId)} — effects paused`,
          );
          return G;
        }
      } catch (err) {
        console.error("[playAction] hand-react window failed", err);
      }
    }
  }

  if (useRules) {
    try {
      const prevChoices =
        G.pendingPlayEffect?.cardId === cardId
          ? G.pendingPlayEffect.choices
          : {};
      const merged = { ...prevChoices, ...choices };
      const newKeys = Object.keys(choices).filter(
        (k) =>
          choices[k] !== undefined &&
          JSON.stringify(prevChoices[k]) !== JSON.stringify(choices[k]),
      );
      if (
        resubmission &&
        newKeys.length === 0 &&
        (G.pendingPrompts?.length ?? 0) > 0 &&
        Object.keys(choices).length === 0
      ) {
        return G;
      }
      const result = resolvePlayEffect(G, playerId, cardId, merged);
      finishPlayResolve(G, playerId, cardId, "action", merged, result, {
        quietContinue: resubmission && newKeys.length === 0,
      });
    } catch (err) {
      console.error("[playAction] rules engine error (resolvePlay)", err);
      G.pendingPrompts = [];
      delete G.pendingPlayEffect;
      logPlay(G, `  · ERROR resolving ${cardLabel(G, cardId)} play effects`);
    }
  } else {
    G.pendingPrompts = [];
    delete G.pendingPlayEffect;
    markPlayEffectsComplete(G, cardId);
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
  logPlay(
    G,
    `  ↳ resume action effects for ${cardLabel(G, cardId)} (hand reacts cleared)`,
  );
  try {
    const result = resolvePlayEffect(G, actorId, cardId, choices);
    finishPlayResolve(G, actorId, cardId, "action", choices, result);
  } catch (err) {
    console.error("[resumePendingActionEffects] failed", err);
    G.pendingPrompts = [];
    delete G.pendingPlayEffect;
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
    logPlay(G, `  · Action effects cancelled by hand react`);
    pushActivityLog(G, `Action effects cancelled by hand react`, "system");
    return G;
  }
  if (result === "waiting") {
    logPlay(G, `  ↳ P${playerId} hand-react answer recorded — still waiting on others`);
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
  logPlay(G, `P${playerId} passes`);

  if (allPlayersPassed(G)) {
    logPlay(G, `All players passed — end of day ${G.currentDay}`);
    endDay(G);
  }

  return G;
}

export function endDay(G: TimestreamsState): void {
  // Guard against double endDay (concurrent pass / re-entry).
  if (G.phase !== "play") return;
  if ((G as any)._endingDay) return;
  (G as any)._endingDay = true;

  try {
    if (rulesOn(G)) {
      try {
        clearRestOfToday(G);
      } catch (err) {
        console.error("[endDay] rules engine error (clearRestOfToday)", err);
      }
    }
    if (isLastDay(G.currentDay)) {
      logPlay(G, `Last day complete → scoring phase`);
      G.phase = "scoring";
      return;
    }

    const prev = G.currentDay;
    G.currentDay += 1;
    // reset pass flags
    for (const pid of G.playerOrder) {
      if (G.players[pid]) G.players[pid].hasPassedThisDay = false;
    }
    // Next turn must start with this day's first player (chronological home-era rotation).
    G.dayFirstPlayer = dayFirstPlayer(G, G.currentDay);
    G.startOfDayPending = true;
    logPlay(
      G,
      `── Day ${prev} → Day ${G.currentDay} (first player P${G.dayFirstPlayer}) ──`,
    );

    // Always deal the next day's cards. dealForDay falls back to plain materialize
    // when decks have no encryption layers left (board cannot peel layers===0).
    try {
      if (G.config?.playMode === "mental-poker") {
        dealForDay(G, G.currentDay);
      } else {
        dealPlaintextHands(G, G.currentDay);
      }
    } catch (err) {
      console.error("[endDay] deal failed — falling back to plain deal", err);
      try {
        dealPlaintextHands(G, G.currentDay);
      } catch (err2) {
        console.error("[endDay] plain deal also failed", err2);
      }
    }

    // Era-Modern: at the beginning of Modern Day, optional recover from discard
    if (rulesOn(G) && eraForDay(G.currentDay) === "modern") {
      try {
        const { prompts, log } = fireModernEraBegin(G);
        for (const line of log) logPlay(G, `  · ${line}`);
        if (prompts.length) {
          installEventPrompts(G, prompts, [], G.dayFirstPlayer || "0");
        }
      } catch (err) {
        console.error("[endDay] era-modern begin failed", err);
      }
    }

    // Sanity log: hands should grow (or stay if decks empty).
    for (const pid of G.playerOrder) {
      const h = G.players[pid]?.hand?.length ?? 0;
      const rem = G.pendingDealRemaining?.[pid] ?? 0;
      if (rem > 0) {
        logPlay(
          G,
          `  · P${pid} still decrypting day deal (${rem} left, hand=${h})`,
        );
      } else {
        logPlay(G, `  · P${pid} hand size after day deal: ${h}`);
      }
    }
  } finally {
    delete (G as any)._endingDay;
  }
}
