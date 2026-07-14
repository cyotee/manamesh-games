/**
 * Debug-only e2e acts (config.debugSeed). Lets Playwright drive multi-seat
 * scoring/react choices from the P0 board without waiting on dual clients.
 */
import type { TimestreamsState } from "./types";
import { canDebugSeed } from "./debugSeed";
import { submitReact, submitPlayChoice } from "./play";
import {
  submitScoreChoice,
  ackScoreStep,
  beginScoringPhase,
} from "./scoring";

const INVALID_MOVE = "INVALID_MOVE" as const;

export type DebugE2EAct =
  | { op: "forceScoring" }
  | {
      op: "scoreChoice";
      playerId: string;
      promptId: string;
      value: string | string[];
    }
  | { op: "ack"; playerId: string }
  | { op: "ackAll" }
  | {
      op: "react";
      playerId: string;
      promptId: string;
      value: string | string[];
    }
  | {
      op: "playChoice";
      playerId: string;
      promptId: string;
      value: string | string[];
    }
  | { op: "finishScoring"; maxSteps?: number };

export type DebugE2EResult =
  | { ok: true; done?: boolean; phase?: string }
  | { ok: false; reason: string };

/**
 * Apply a debug e2e act. Caller supplies `endPhase` when op is forceScoring
 * (boardgame.io events.endPhase).
 */
export function applyDebugE2EAct(
  G: TimestreamsState,
  act: DebugE2EAct,
  opts: { endPhase?: () => void } = {},
): DebugE2EResult {
  if (!canDebugSeed(G)) {
    return { ok: false, reason: "debugSeed not enabled" };
  }

  switch (act.op) {
    case "forceScoring": {
      if (G.phase === "gameOver") {
        return { ok: true, phase: G.phase };
      }
      if (G.phase === "scoring") {
        // Already in scoring desk but walk never started (desync) — start it.
        if (!G.scoringWalk) beginScoringPhase(G);
        return { ok: true, phase: G.phase };
      }
      // Mirror end-of-last-day: set phase flag then leave play → scoring.
      G.phase = "scoring";
      if (opts.endPhase) {
        opts.endPhase();
      }
      // If the phase machine did not run onBegin (or events missing), start walk.
      if (G.phase === "scoring" && !G.scoringWalk) {
        beginScoringPhase(G);
      }
      return { ok: true, phase: G.phase };
    }

    case "scoreChoice": {
      const r = submitScoreChoice(
        G,
        String(act.playerId),
        act.promptId,
        act.value,
      );
      if (r === "INVALID_MOVE") {
        return { ok: false, reason: "INVALID_MOVE scoreChoice" };
      }
      return { ok: true, phase: G.phase, done: r === true };
    }

    case "ack": {
      const r = ackScoreStep(G, String(act.playerId));
      if (r === "INVALID_MOVE") {
        return { ok: false, reason: "INVALID_MOVE ack" };
      }
      return { ok: true, phase: G.phase, done: r === true };
    }

    case "ackAll": {
      for (const pid of G.playerOrder) {
        const r = ackScoreStep(G, String(pid));
        if (r === "INVALID_MOVE") {
          // Soft: already-acked seats are fine mid-loop
          continue;
        }
      }
      return { ok: true, phase: G.phase, done: G.phase === "gameOver" };
    }

    case "react": {
      const r = submitReact(G, String(act.playerId), act.promptId, act.value);
      if (r === INVALID_MOVE) {
        return { ok: false, reason: "INVALID_MOVE react" };
      }
      return { ok: true, phase: G.phase };
    }

    case "playChoice": {
      const r = submitPlayChoice(
        G,
        String(act.playerId),
        act.promptId,
        act.value,
      );
      if (r === INVALID_MOVE) {
        return { ok: false, reason: "INVALID_MOVE playChoice" };
      }
      return { ok: true, phase: G.phase };
    }

    case "finishScoring": {
      const max = act.maxSteps ?? 100;
      let guard = 0;
      while (G.phase === "scoring" && guard++ < max) {
        const walk = G.scoringWalk;
        if (!walk) break;
        if (walk.stepPhase === "choice") {
          const front = G.pendingPrompts?.[0];
          if (!front) break;
          const pick =
            front.min === 0
              ? ""
              : Array.isArray(front.options) && front.options.length
                ? front.options[0]
                : "";
          const r = submitScoreChoice(
            G,
            String(front.deciderId),
            front.id,
            pick,
          );
          if (r === "INVALID_MOVE") break;
        } else if (walk.stepPhase === "ack") {
          for (const pid of G.playerOrder) {
            ackScoreStep(G, String(pid));
          }
        } else {
          break;
        }
      }
      return {
        ok: true,
        phase: G.phase,
        done: G.phase === "gameOver",
      };
    }

    default:
      return { ok: false, reason: "unknown op" };
  }
}
