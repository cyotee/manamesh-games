import type { EraId, TimestreamsState } from "./types";
import { ERA_ORDER } from "./types";
import { deterministicShuffle, sha256Hex } from "@manamesh/boardgameio-crypto";

/**
 * Selectable mode: claim a home era.
 * Rejects if era already taken or player already ready.
 */
export function claimHomeEra(G: TimestreamsState, playerId: string, era: EraId): boolean {
  const p = G.players[playerId];
  if (!p || p.ready) return false;
  const alreadyClaimed = Object.values(G.players).some(
    (pl: any) => pl.homeEra === era
  );
  if (alreadyClaimed) return false;
  p.homeEra = era;
  return true;
}

export function setReady(G: TimestreamsState, playerId: string, ready: boolean): void {
  const p = G.players[playerId];
  if (p) p.ready = ready;
}

export function allReadyWithDistinctEras(G: TimestreamsState): boolean {
  const players = Object.values(G.players) as any[];
  if (players.length === 0) return false;
  const allReady = players.every((p) => p.ready && p.homeEra);
  if (!allReady) return false;
  const eras = players.map((p) => p.homeEra);
  return new Set(eras).size === eras.length;
}

/**
 * Cryptographically fair random assignment using deterministicShuffle on eras.
 * Assigns distinct eras to players in playerOrder.
 */
export function assignRandomHomeEras(G: TimestreamsState, finalSeedHex: string): void {
  // deterministicShuffle expects the items and a seed; returns shuffled copy
  const shuffled = deterministicShuffle([...ERA_ORDER], finalSeedHex);
  const n = G.playerOrder.length;
  for (let i = 0; i < n; i++) {
    const pid = G.playerOrder[i];
    if (G.players[pid]) {
      G.players[pid].homeEra = shuffled[i] as EraId;
    }
  }
}

export function homeEraTurnOrder(G: TimestreamsState): string[] {
  const entries = G.playerOrder.map((pid) => {
    const era = G.players[pid]?.homeEra;
    const idx = era ? ERA_ORDER.indexOf(era) : Infinity;
    return { pid, idx };
  });
  entries.sort((a, b) => a.idx - b.idx);
  return entries.map((e) => e.pid);
}

export function dayFirstPlayer(G: TimestreamsState, day: number): string {
  const order = homeEraTurnOrder(G);
  if (order.length === 0) return G.playerOrder[0];
  const idx = (day - 1) % order.length;
  return order[idx];
}
