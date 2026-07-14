/**
 * Dev/e2e board seeding — only when config.debugSeed is true.
 * Used by unit tests and Playwright to stage deterministic card layouts.
 */

import type { EraId, TimestreamsCard, TimestreamsState } from "./types";
import { ERA_ORDER } from "./types";
import { registerCard } from "./effects/state";
import { registerStaticTriggers } from "./effects/triggers";
import { pushActivityLog } from "./crypto";
import { initManualScoring } from "./freeTools";

export type SeedCardSpec = Partial<TimestreamsCard> & {
  id: string;
  ownerId?: string;
};

export interface DebugSeedBoardArgs {
  phase?: TimestreamsState["phase"];
  currentDay?: number;
  currentPlayerHomeEra?: Partial<Record<string, EraId>>;
  /** eraId -> ordered stack of cards (top = index 0) */
  timeline?: Partial<Record<EraId, SeedCardSpec[]>>;
  /** eraId -> era action attachments */
  eraActions?: Partial<Record<EraId, SeedCardSpec[]>>;
  hands?: Record<string, SeedCardSpec[]>;
  discards?: Record<string, SeedCardSpec[]>;
  scorePiles?: Record<string, SeedCardSpec[]>;
  attachments?: Record<string, string[]>;
  rulesEnabled?: boolean;
  clearBoard?: boolean;
}

function toCard(spec: SeedCardSpec, defaultOwner: string): TimestreamsCard {
  const ownerId = spec.ownerId ?? defaultOwner;
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    ownerId,
    cardType: spec.cardType ?? "invention",
    subtypes: spec.subtypes ?? [],
    hasPlayEffect: spec.hasPlayEffect ?? (spec.tags ?? []).some((t) => t.startsWith("play:")),
    hasScoreEffect:
      spec.hasScoreEffect ??
      (spec.tags ?? []).some((t) => t.startsWith("score:") || t.startsWith("bonus")),
    hasReact: spec.hasReact ?? (spec.tags ?? []).some((t) => t.startsWith("react:")),
    scoreValue: spec.scoreValue ?? 1,
    tags: spec.tags ?? [],
    imageUrl: spec.imageUrl,
    backImageUrl: spec.backImageUrl,
  } as TimestreamsCard;
}

export function canDebugSeed(G: TimestreamsState): boolean {
  return G.config?.debugSeed === true;
}

/**
 * Stage hands/timeline for e2e and focused unit tests.
 * Returns false if debug seeding is not allowed.
 */
export function debugSeedBoard(
  G: TimestreamsState,
  args: DebugSeedBoardArgs = {},
): boolean {
  if (!canDebugSeed(G)) return false;

  if (args.clearBoard !== false) {
    for (const era of ERA_ORDER) {
      G.timeline[era].stack = [];
      G.timeline[era].actions = [];
    }
    for (const pid of G.playerOrder) {
      if (!G.players[pid]) continue;
      G.players[pid].hand = [];
      G.players[pid].discard = [];
      G.players[pid].scorePile = [];
    }
    G.attachments = {};
    G.pendingPrompts = [];
    G.pendingPlayEffect = undefined;
    G.pendingActionResolve = undefined;
    G.scoringWalk = undefined;
    G.pendingTriggers = [];
    G.manualProcessed = {};
    G.manualBonus = {};
    G.manualSlotCap = {};
    G.manualCurrentCardId = null;
  }

  if (args.rulesEnabled !== undefined) {
    if (!G.config) return false;
    G.config.rulesEnabled = args.rulesEnabled;
    if (args.rulesEnabled === false) G.config.rulesLockedOff = true;
  }

  if (args.currentDay != null) G.currentDay = args.currentDay;
  if (args.phase) G.phase = args.phase;

  // Manual scoring desk fields when entering scoring with rules off.
  if (
    args.phase === "scoring" &&
    (args.rulesEnabled === false || G.config?.rulesEnabled === false)
  ) {
    initManualScoring(G);
    G.phase = "scoring";
  }

  if (args.currentPlayerHomeEra) {
    for (const [pid, era] of Object.entries(args.currentPlayerHomeEra)) {
      if (G.players[pid] && era) G.players[pid].homeEra = era;
    }
  }

  for (const [era, list] of Object.entries(args.timeline ?? {})) {
    const e = era as EraId;
    if (!G.timeline[e] || !list) continue;
    for (const spec of list) {
      const card = toCard(spec, spec.ownerId ?? "0");
      registerCard(G, card);
      G.timeline[e].stack.push(card.id);
      // Standing triggers (Crop Rotation, Dot Com, …) so e2e seeds behave like play
      try {
        registerStaticTriggers(G, card);
      } catch {
        /* ignore seed trigger registration errors */
      }
    }
  }

  for (const [era, list] of Object.entries(args.eraActions ?? {})) {
    const e = era as EraId;
    if (!G.timeline[e] || !list) continue;
    if (!G.timeline[e].actions) G.timeline[e].actions = [];
    for (const spec of list) {
      const card = toCard(spec, spec.ownerId ?? "0");
      registerCard(G, card);
      G.timeline[e].actions!.push(card.id);
      try {
        registerStaticTriggers(G, card);
      } catch {
        /* ignore */
      }
    }
  }

  for (const [pid, list] of Object.entries(args.hands ?? {})) {
    if (!G.players[pid] || !list) continue;
    for (const spec of list) {
      const card = toCard(spec, pid);
      registerCard(G, card);
      G.players[pid].hand.push(card);
    }
  }

  for (const [pid, list] of Object.entries(args.discards ?? {})) {
    if (!G.players[pid] || !list) continue;
    for (const spec of list) {
      const card = toCard(spec, pid);
      registerCard(G, card);
      G.players[pid].discard.push(card);
    }
  }

  for (const [pid, list] of Object.entries(args.scorePiles ?? {})) {
    if (!G.players[pid] || !list) continue;
    for (const spec of list) {
      const card = toCard(spec, pid);
      registerCard(G, card);
      G.players[pid].scorePile.push(card);
    }
  }

  if (args.attachments) {
    G.attachments = { ...args.attachments };
  }

  pushActivityLog(G, "debugSeedBoard applied (e2e/dev only)", "system");
  return true;
}
