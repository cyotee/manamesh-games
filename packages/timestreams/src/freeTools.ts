/**
 * Free tools — structural board mutations when rulesEnabled === false.
 * See RULES_OFF_PRD.md. No tag execution; players enforce printed text by hand.
 */

import type { EraId, TimestreamsCard, TimestreamsState } from "./types";
import { ERA_ORDER } from "./types";
import {
  attachTo,
  discardFromPlay,
  effectiveScoreValue,
  moveToEra,
  moveWithinEra,
} from "./effects/boardOps";
import { getAttachments, getCard, registerCard } from "./effects/state";
import { locateCard } from "./effects/targets";
import { pushActivityLog } from "./crypto";
import { computeScoringSlotsForEra } from "./scoringSlots";
import { swapPositions } from "./effects/executors/swap";

/** Local score sync — avoids circular import with scoring.ts */
function syncManualScores(G: TimestreamsState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pid of G.playerOrder) {
    let pile = 0;
    for (const c of G.players[pid]?.scorePile || []) {
      pile += effectiveScoreValue(G, c.id);
    }
    const bonus = G.manualBonus?.[pid] ?? G.bonusPoints?.[pid] ?? 0;
    out[pid] = pile + bonus;
  }
  G.scores = out;
  return out;
}

export const INVALID_FREE = "INVALID_MOVE" as const;

export type FreeToolId =
  | "free:attach"
  | "free:detach"
  | "free:discard"
  | "free:to-era"
  | "free:reorder"
  | "free:swap"
  | "free:to-score-pile"
  | "free:from-score-pile"
  | "free:draw"
  | "free:discard-hand"
  | "free:recover-hand"
  | "free:empty-hand-to-discard"
  | "free:score-bonus-delta"
  | "free:score-slot-cap"
  | "free:score-mark-processed"
  | "free:score-set-current"
  | "free:score-claim-pile"
  | "free:score-era-cleanup"
  | "free:score-discard-all-hands"
  | "free:score-finalize"
  | "free:score-ack";

export type EraCleanupMode = "outside-capacity" | "unprocessed";

export interface FreeToolArgs {
  cardId?: string;
  cardIds?: string[];
  hostCardId?: string;
  /** Attach to era-level actions zone instead of an invention host. */
  eraId?: EraId;
  asEraAction?: boolean;
  position?: "top" | "bottom" | number;
  index?: number;
  pileOwnerId?: string;
  dest?: "hand" | "discard" | "era";
  targetPlayerId?: string;
  amount?: number;
  note?: string;
  mode?: EraCleanupMode;
  processed?: boolean;
  /** For free:score-slot-cap absolute set (when amount is the new cap). */
  setCap?: boolean;
}

export function canUseFreeTools(G: TimestreamsState): boolean {
  return G.config?.rulesEnabled === false;
}

/**
 * Play-phase free tools: current player only.
 * Scoring-phase free tools: any seat.
 */
export function canPlayerUseFreeTool(
  G: TimestreamsState,
  playerId: string,
  currentPlayer?: string | null,
): boolean {
  if (!canUseFreeTools(G)) return false;
  if (G.phase === "scoring") return true;
  if (G.phase === "play") {
    if (currentPlayer != null && currentPlayer !== playerId) return false;
    return true;
  }
  return false;
}

function cardLabel(G: TimestreamsState, cardId: string): string {
  const c = getCard(G, cardId);
  return c?.name || cardId;
}

function logFree(
  G: TimestreamsState,
  playerId: string,
  toolId: FreeToolId,
  detail: string,
): void {
  pushActivityLog(G, `P${playerId} free:${toolId.replace(/^free:/, "")} · ${detail}`, "info");
}

function ensureManual(G: TimestreamsState): void {
  if (!G.manualBonus) G.manualBonus = {};
  if (!G.manualSlotCap) G.manualSlotCap = {};
  if (!G.manualProcessed) G.manualProcessed = {};
  if (G.manualCurrentCardId === undefined) G.manualCurrentCardId = null;
  if (!G.manualScoreAcks) G.manualScoreAcks = {};
  if (!G.bonusPoints) G.bonusPoints = {};
  for (const pid of G.playerOrder) {
    if (G.manualBonus[pid] === undefined) G.manualBonus[pid] = 0;
    if (G.bonusPoints[pid] === undefined) G.bonusPoints[pid] = 0;
  }
}

/** Enter rules-off manual scoring desk (no auto tag walk / no auto finalize). */
export function initManualScoring(G: TimestreamsState): void {
  ensureManual(G);
  G.phase = "scoring";
  G.pendingPrompts = [];
  G.scoringWalk = undefined;
  G.scoringActiveEra = null;
  G.bonusLedger = G.bonusLedger || [];
  for (const pid of G.playerOrder) {
    G.manualBonus![pid] = G.manualBonus![pid] ?? 0;
    G.bonusPoints![pid] = G.manualBonus![pid];
  }
  syncManualScores(G);
  pushActivityLog(
    G,
    "Scoring (rules engine OFF — manual free tools / scoring desk)",
    "system",
  );
}

export type FreeCardZone =
  | { zone: "hand"; playerId: string; index: number }
  | { zone: "discard"; playerId: string; index: number }
  | { zone: "scorePile"; playerId: string; index: number }
  | { zone: "stack"; era: EraId; index: number }
  | { zone: "actions"; era: EraId; index: number }
  | { zone: "attachment"; hostId: string; index: number };

export function findCardAnywhere(
  G: TimestreamsState,
  cardId: string,
): FreeCardZone | null {
  for (const pid of G.playerOrder) {
    const p = G.players[pid];
    if (!p) continue;
    const hi = p.hand.findIndex((c) => c.id === cardId);
    if (hi >= 0) return { zone: "hand", playerId: pid, index: hi };
    const di = p.discard.findIndex((c) => c.id === cardId);
    if (di >= 0) return { zone: "discard", playerId: pid, index: di };
    const si = p.scorePile.findIndex((c) => c.id === cardId);
    if (si >= 0) return { zone: "scorePile", playerId: pid, index: si };
  }
  const loc = locateCard(G, cardId);
  if (loc) {
    if (loc.zone === "actions") {
      return { zone: "actions", era: loc.era, index: loc.index };
    }
    return { zone: "stack", era: loc.era, index: loc.index };
  }
  const attachments = getAttachments(G);
  for (const [hostId, list] of Object.entries(attachments)) {
    const idx = list.indexOf(cardId);
    if (idx >= 0) return { zone: "attachment", hostId, index: idx };
  }
  return null;
}

/** Remove card from its current zone; return the card object (or undefined). */
export function extractCard(
  G: TimestreamsState,
  cardId: string,
): TimestreamsCard | undefined {
  const where = findCardAnywhere(G, cardId);
  if (!where) {
    return getCard(G, cardId);
  }
  switch (where.zone) {
    case "hand": {
      const [c] = G.players[where.playerId].hand.splice(where.index, 1);
      return c;
    }
    case "discard": {
      const [c] = G.players[where.playerId].discard.splice(where.index, 1);
      return c;
    }
    case "scorePile": {
      const [c] = G.players[where.playerId].scorePile.splice(where.index, 1);
      return c;
    }
    case "stack": {
      G.timeline[where.era].stack.splice(where.index, 1);
      return getCard(G, cardId);
    }
    case "actions": {
      const actions = G.timeline[where.era].actions ?? [];
      actions.splice(where.index, 1);
      G.timeline[where.era].actions = actions;
      return getCard(G, cardId);
    }
    case "attachment": {
      const list = getAttachments(G)[where.hostId] ?? [];
      list.splice(where.index, 1);
      if (list.length === 0) delete getAttachments(G)[where.hostId];
      else getAttachments(G)[where.hostId] = list;
      return getCard(G, cardId);
    }
  }
}

function detachAttachmentIds(G: TimestreamsState, hostId: string): string[] {
  const attachments = getAttachments(G);
  const list = attachments[hostId] ?? [];
  delete attachments[hostId];
  return [...list];
}

/** Discard host + structural attach-discard glue (attachments → owners' discards). */
function freeDiscard(G: TimestreamsState, cardId: string): boolean {
  const where = findCardAnywhere(G, cardId);
  if (!where) return false;

  if (where.zone === "stack" || where.zone === "actions") {
    return discardFromPlay(G, cardId, "0");
  }

  const card = extractCard(G, cardId);
  if (!card) return false;
  registerCard(G, card);
  // If this was a host with attachments (shouldn't be for hand/pile, but safe)
  for (const attId of detachAttachmentIds(G, cardId)) {
    const att = getCard(G, attId);
    if (att) G.players[att.ownerId]?.discard.push(att);
  }
  G.players[card.ownerId]?.discard.push(card);
  return true;
}

function freeAttach(
  G: TimestreamsState,
  actionCardId: string,
  hostCardId: string | undefined,
  eraId: EraId | undefined,
  asEraAction: boolean,
): boolean {
  const card = extractCard(G, actionCardId);
  if (!card) return false;
  registerCard(G, card);

  // Detach from previous host if re-hosting
  // (extract already removed from attachment list)

  if (asEraAction && eraId) {
    if (!G.timeline[eraId].actions) G.timeline[eraId].actions = [];
    G.timeline[eraId].actions!.push(actionCardId);
    return true;
  }
  if (!hostCardId) return false;
  // Host must be on timeline
  if (!locateCard(G, hostCardId)) return false;
  attachTo(G, actionCardId, hostCardId);
  return true;
}

function freeDetach(G: TimestreamsState, actionCardId: string): boolean {
  const where = findCardAnywhere(G, actionCardId);
  if (!where || where.zone !== "attachment") return false;
  const card = extractCard(G, actionCardId);
  if (!card) return false;
  registerCard(G, card);
  // Always owner's hand (PRD §15)
  G.players[card.ownerId]?.hand.push(card);
  return true;
}

function freeToEra(
  G: TimestreamsState,
  cardId: string,
  eraId: EraId,
  position: "top" | "bottom" | number = "top",
): boolean {
  const where = findCardAnywhere(G, cardId);
  if (!where) return false;

  // Already on stack — use boardOps (attachments follow by id)
  if (where.zone === "stack") {
    return moveToEra(G, cardId, eraId, position);
  }

  const card = extractCard(G, cardId);
  if (!card) return false;
  registerCard(G, card);
  const stack = G.timeline[eraId].stack;
  const index =
    position === "top"
      ? 0
      : position === "bottom"
        ? stack.length
        : Math.max(0, Math.min(position, stack.length));
  stack.splice(index, 0, cardId);
  return true;
}

function freeToScorePile(
  G: TimestreamsState,
  cardId: string,
  pileOwnerId?: string,
): boolean {
  const card = extractCard(G, cardId);
  if (!card) return false;
  registerCard(G, card);
  // Host leaving timeline: discard attachments (PRD §6.5)
  for (const attId of detachAttachmentIds(G, cardId)) {
    const att = getCard(G, attId);
    if (att) G.players[att.ownerId]?.discard.push(att);
  }
  const owner = pileOwnerId || card.ownerId;
  if (!G.players[owner]) return false;
  G.players[owner].scorePile.push(card);
  return true;
}

function freeFromScorePile(
  G: TimestreamsState,
  cardId: string,
  dest: "hand" | "discard" | "era",
  eraId?: EraId,
  position: "top" | "bottom" | number = "top",
): boolean {
  const where = findCardAnywhere(G, cardId);
  if (!where || where.zone !== "scorePile") return false;
  const card = extractCard(G, cardId);
  if (!card) return false;
  registerCard(G, card);
  if (dest === "hand") {
    G.players[card.ownerId]?.hand.push(card);
    return true;
  }
  if (dest === "discard") {
    G.players[card.ownerId]?.discard.push(card);
    return true;
  }
  if (dest === "era" && eraId) {
    const stack = G.timeline[eraId].stack;
    const index =
      position === "top"
        ? 0
        : position === "bottom"
          ? stack.length
          : Math.max(0, Math.min(position, stack.length));
    stack.splice(index, 0, cardId);
    return true;
  }
  return false;
}

function freeDraw(G: TimestreamsState, playerId: string, n = 1): number {
  const deck = G.encryptedDecks[playerId];
  if (!deck) return 0;
  let drawn = 0;
  for (let i = 0; i < n && deck.length > 0; i++) {
    const top = deck.shift();
    if (!top) break;
    // Plaintext decks store card id as ciphertext. Mental-poker layers>0:
    // still allow structural free-draw when card is known in registry
    // (typical after setup materialize); otherwise put back and stop.
    const cardId = top.ciphertext;
    const fromRegistry = G.cards?.[cardId];
    if ((top.layers ?? 0) > 0 && !fromRegistry) {
      deck.unshift(top);
      break;
    }
    const card: TimestreamsCard = fromRegistry
      ? { ...fromRegistry, ownerId: fromRegistry.ownerId || playerId }
      : {
          id: cardId,
          name: cardId,
          ownerId: playerId,
          cardType: "invention",
          subtypes: [],
          hasPlayEffect: false,
          hasScoreEffect: true,
          hasReact: false,
          scoreValue: 1,
          tags: [],
        };
    registerCard(G, card);
    G.players[playerId]?.hand.push(card);
    drawn++;
  }
  return drawn;
}

/**
 * Move cards from the acting player's own discard → hand.
 * Never touches another seat's discard (even if cardId is known).
 */
function freeRecoverHand(G: TimestreamsState, playerId: string, cardIds: string[]): number {
  const p = G.players[playerId];
  if (!p) return 0;
  let n = 0;
  for (const cardId of cardIds) {
    const idx = p.discard.findIndex((c) => c.id === cardId);
    if (idx < 0) continue;
    // Refuse if the card sits in someone else's discard (should never match above).
    const otherHas = G.playerOrder.some(
      (pid) =>
        pid !== playerId &&
        (G.players[pid]?.discard ?? []).some((c) => c.id === cardId),
    );
    if (otherHas) continue;
    const [card] = p.discard.splice(idx, 1);
    card.ownerId = playerId;
    registerCard(G, card);
    p.hand.push(card);
    n++;
  }
  return n;
}

export function previewEraCleanup(
  G: TimestreamsState,
  eraId: EraId,
  mode: EraCleanupMode,
): { toPile: string[]; toDiscard: string[]; eraActions: string[] } {
  ensureManual(G);
  const era = G.timeline[eraId];
  if (!era) return { toPile: [], toDiscard: [], eraActions: [] };
  const stack = [...era.stack];
  const eraActions = [...(era.actions ?? [])];
  const toPile: string[] = [];
  const toDiscard: string[] = [];

  if (mode === "outside-capacity") {
    const cap =
      G.manualSlotCap?.[eraId] ??
      computeScoringSlotsForEra(G, eraId);
    for (let i = 0; i < stack.length; i++) {
      if (i < cap) toPile.push(stack[i]);
      else toDiscard.push(stack[i]);
    }
  } else {
    // Mode B: unprocessed only
    for (const cid of stack) {
      if (G.manualProcessed?.[cid]) toPile.push(cid);
      else toDiscard.push(cid);
    }
  }
  return { toPile, toDiscard, eraActions };
}

function freeEraCleanup(
  G: TimestreamsState,
  eraId: EraId,
  mode: EraCleanupMode,
): { pile: number; discard: number } {
  const preview = previewEraCleanup(G, eraId, mode);
  const era = G.timeline[eraId];
  if (!era) return { pile: 0, discard: 0 };

  let pile = 0;
  let discard = 0;

  for (const cid of preview.toPile) {
    // Already in a pile? leave alone
    const where = findCardAnywhere(G, cid);
    if (where?.zone === "scorePile") continue;
    if (freeToScorePile(G, cid)) pile++;
  }
  for (const cid of preview.toDiscard) {
    if (freeDiscard(G, cid)) discard++;
  }
  for (const actId of preview.eraActions) {
    if (freeDiscard(G, actId)) discard++;
  }
  era.stack = era.stack.filter((id) => findCardAnywhere(G, id)?.zone === "stack");
  // Clear any leftovers still on era after moves
  for (const cid of [...era.stack]) {
    // cards already moved out via freeToScorePile/freeDiscard
  }
  // Ensure era is clean of claimed/discarded
  era.stack = era.stack.filter((id) => {
    const w = findCardAnywhere(G, id);
    return w?.zone === "stack" && w.era === eraId;
  });
  era.actions = [];
  return { pile, discard };
}

export function finalizeManualScores(G: TimestreamsState): void {
  ensureManual(G);
  for (const pid of G.playerOrder) {
    if (!G.bonusPoints) G.bonusPoints = {};
    G.bonusPoints[pid] = G.manualBonus?.[pid] ?? 0;
  }
  syncManualScores(G);
  let best = -Infinity;
  let winner: string | null = null;
  for (const pid of G.playerOrder) {
    const s = G.scores[pid] ?? 0;
    if (s > best) {
      best = s;
      winner = pid;
    }
  }
  G.winner = winner;
  G.phase = "gameOver";
  pushActivityLog(
    G,
    `Manual scoring finalized — winner P${G.winner} (${Object.entries(G.scores)
      .map(([p, s]) => `P${p}:${s}`)
      .join(", ")})`,
    "score",
  );
}

/**
 * One-way disable of the rules engine for the rest of the match.
 * Re-enable is forbidden (PRD §2.1).
 */
export function disableRulesEngine(G: TimestreamsState, playerId: string): boolean {
  if (!G.config) return false;
  if (G.config.rulesEnabled === false) {
    // Already off — do not allow re-enable path through this function
    return false;
  }
  G.config.rulesEnabled = false;
  G.config.rulesLockedOff = true;
  G.pendingPrompts = [];
  G.pendingPlayEffect = undefined;
  G.pendingActionResolve = undefined;
  (G as any).scoringWalk = G.scoringWalk; // keep walk if mid-score; UI will switch
  // If mid scoring with walk, convert to manual desk
  if (G.phase === "scoring") {
    initManualScoring(G);
  }
  pushActivityLog(
    G,
    `Rules engine DISABLED for all players by P${playerId} (manual mode). Cannot re-enable this match.`,
    "system",
  );
  return true;
}

export function applyFreeTool(
  G: TimestreamsState,
  playerId: string,
  toolId: FreeToolId,
  args: FreeToolArgs = {},
  currentPlayer?: string | null,
): true | typeof INVALID_FREE {
  if (!canUseFreeTools(G)) return INVALID_FREE;
  if (!canPlayerUseFreeTool(G, playerId, currentPlayer)) return INVALID_FREE;

  ensureManual(G);

  switch (toolId) {
    case "free:attach": {
      const cardId = args.cardId;
      if (!cardId) return INVALID_FREE;
      const ok = freeAttach(
        G,
        cardId,
        args.hostCardId,
        args.eraId,
        !!args.asEraAction,
      );
      if (!ok) return INVALID_FREE;
      logFree(
        G,
        playerId,
        toolId,
        args.asEraAction
          ? `${cardLabel(G, cardId)} → era ${args.eraId} actions`
          : `${cardLabel(G, cardId)} → ${cardLabel(G, args.hostCardId!)}`,
      );
      return true;
    }

    case "free:detach": {
      const cardId = args.cardId;
      if (!cardId) return INVALID_FREE;
      if (!freeDetach(G, cardId)) return INVALID_FREE;
      const owner = getCard(G, cardId)?.ownerId ?? "?";
      logFree(G, playerId, toolId, `${cardLabel(G, cardId)} → P${owner} hand`);
      return true;
    }

    case "free:discard":
    case "free:discard-hand": {
      const ids = args.cardIds?.length
        ? args.cardIds
        : args.cardId
          ? [args.cardId]
          : [];
      if (!ids.length) return INVALID_FREE;
      let n = 0;
      for (const id of ids) {
        if (freeDiscard(G, id)) n++;
      }
      if (!n) return INVALID_FREE;
      logFree(
        G,
        playerId,
        toolId,
        ids.map((id) => cardLabel(G, id)).join(", ") + " → discard",
      );
      return true;
    }

    case "free:to-era": {
      const cardId = args.cardId;
      const eraId = args.eraId;
      if (!cardId || !eraId) return INVALID_FREE;
      if (!freeToEra(G, cardId, eraId, args.position ?? "top")) return INVALID_FREE;
      logFree(
        G,
        playerId,
        toolId,
        `${cardLabel(G, cardId)} → ${eraId} (${args.position ?? "top"})`,
      );
      return true;
    }

    case "free:reorder": {
      const cardId = args.cardId;
      if (!cardId || args.index === undefined) return INVALID_FREE;
      if (!moveWithinEra(G, cardId, args.index)) return INVALID_FREE;
      logFree(G, playerId, toolId, `${cardLabel(G, cardId)} → index ${args.index}`);
      return true;
    }

    case "free:swap": {
      const ids = args.cardIds ?? [];
      if (ids.length !== 2) return INVALID_FREE;
      if (!swapPositions(G, ids[0], ids[1])) return INVALID_FREE;
      logFree(
        G,
        playerId,
        toolId,
        `${cardLabel(G, ids[0])} ↔ ${cardLabel(G, ids[1])}`,
      );
      return true;
    }

    case "free:to-score-pile":
    case "free:score-claim-pile": {
      const ids = args.cardIds?.length
        ? args.cardIds
        : args.cardId
          ? [args.cardId]
          : [];
      if (!ids.length) return INVALID_FREE;
      let n = 0;
      for (const id of ids) {
        if (freeToScorePile(G, id, args.pileOwnerId)) n++;
      }
      if (!n) return INVALID_FREE;
      logFree(
        G,
        playerId,
        toolId,
        ids.map((id) => cardLabel(G, id)).join(", ") +
          ` → P${args.pileOwnerId || "owner"} pile`,
      );
      syncManualScores(G);
      return true;
    }

    case "free:from-score-pile": {
      const cardId = args.cardId;
      if (!cardId || !args.dest) return INVALID_FREE;
      if (
        !freeFromScorePile(
          G,
          cardId,
          args.dest,
          args.eraId,
          args.position ?? "top",
        )
      ) {
        return INVALID_FREE;
      }
      logFree(
        G,
        playerId,
        toolId,
        `${cardLabel(G, cardId)} pile → ${args.dest}${args.eraId ? ` ${args.eraId}` : ""}`,
      );
      syncManualScores(G);
      return true;
    }

    case "free:draw": {
      const target = args.targetPlayerId || playerId;
      const n = freeDraw(G, target, Math.max(1, args.amount ?? 1));
      if (!n) return INVALID_FREE;
      logFree(G, playerId, toolId, `P${target} drew ${n}`);
      return true;
    }

    case "free:recover-hand": {
      const ids = args.cardIds?.length
        ? args.cardIds
        : args.cardId
          ? [args.cardId]
          : [];
      if (!ids.length) return INVALID_FREE;
      const n = freeRecoverHand(G, playerId, ids);
      if (!n) return INVALID_FREE;
      logFree(
        G,
        playerId,
        toolId,
        ids.map((id) => cardLabel(G, id)).join(", ") + " discard → hand",
      );
      return true;
    }

    case "free:empty-hand-to-discard":
    case "free:score-discard-all-hands": {
      const targets =
        toolId === "free:score-discard-all-hands"
          ? G.playerOrder
          : [args.targetPlayerId || playerId];
      let total = 0;
      for (const pid of targets) {
        const hand = G.players[pid]?.hand ?? [];
        const ids = hand.map((c) => c.id);
        for (const id of ids) {
          if (freeDiscard(G, id)) total++;
        }
      }
      logFree(G, playerId, toolId, `${total} cards → discard`);
      return true;
    }

    case "free:score-bonus-delta": {
      if (G.phase !== "scoring" && G.phase !== "play") return INVALID_FREE;
      const target = args.targetPlayerId;
      const amount = args.amount;
      if (target == null || amount == null || !Number.isFinite(amount)) {
        return INVALID_FREE;
      }
      G.manualBonus![target] = (G.manualBonus![target] ?? 0) + amount;
      if (!G.bonusPoints) G.bonusPoints = {};
      G.bonusPoints[target] = G.manualBonus![target];
      if (!G.bonusLedger) G.bonusLedger = [];
      G.bonusLedger.push({
        playerId: target,
        amount,
        note: args.note || "manual free tool",
      });
      syncManualScores(G);
      logFree(
        G,
        playerId,
        toolId,
        `P${target} ${amount >= 0 ? "+" : ""}${amount}` +
          (args.note ? ` · ${args.note}` : ""),
      );
      return true;
    }

    case "free:score-slot-cap": {
      const eraId = args.eraId;
      if (!eraId) return INVALID_FREE;
      const base = G.config?.scoringSlots ?? 6;
      const cur = G.manualSlotCap?.[eraId] ?? base;
      if (args.setCap && args.amount != null) {
        G.manualSlotCap![eraId] = Math.max(1, args.amount);
      } else if (args.amount != null) {
        G.manualSlotCap![eraId] = Math.max(1, cur + args.amount);
      } else {
        return INVALID_FREE;
      }
      logFree(
        G,
        playerId,
        toolId,
        `${eraId} cap → ${G.manualSlotCap![eraId]}`,
      );
      return true;
    }

    case "free:score-mark-processed": {
      const cardId = args.cardId;
      if (!cardId) return INVALID_FREE;
      const mark = args.processed !== false;
      if (mark) G.manualProcessed![cardId] = true;
      else delete G.manualProcessed![cardId];
      logFree(
        G,
        playerId,
        toolId,
        `${cardLabel(G, cardId)} ${mark ? "processed" : "unprocessed"}`,
      );
      return true;
    }

    case "free:score-set-current": {
      G.manualCurrentCardId = args.cardId ?? null;
      logFree(
        G,
        playerId,
        toolId,
        args.cardId ? cardLabel(G, args.cardId) : "cleared",
      );
      return true;
    }

    case "free:score-era-cleanup": {
      const eraId = args.eraId;
      const mode = args.mode ?? "outside-capacity";
      if (!eraId) return INVALID_FREE;
      const { pile, discard } = freeEraCleanup(G, eraId, mode);
      syncManualScores(G);
      logFree(
        G,
        playerId,
        toolId,
        `${eraId} mode=${mode} · ${pile}→pile ${discard}→discard`,
      );
      return true;
    }

    case "free:score-finalize": {
      if (G.phase !== "scoring") return INVALID_FREE;
      finalizeManualScores(G);
      logFree(G, playerId, toolId, `winner P${G.winner}`);
      return true;
    }

    case "free:score-ack": {
      if (G.phase !== "scoring") return INVALID_FREE;
      if (!G.manualScoreAcks) G.manualScoreAcks = {};
      G.manualScoreAcks[playerId] = true;
      const all = G.playerOrder.every((pid) => G.manualScoreAcks![pid]);
      logFree(G, playerId, toolId, all ? "all acked" : "partial");
      if (all) {
        // Advance shared pointer: clear current; clear acks
        G.manualScoreAcks = {};
        // Optional: leave current for players to set next
      }
      return true;
    }

    default:
      return INVALID_FREE;
  }
}
