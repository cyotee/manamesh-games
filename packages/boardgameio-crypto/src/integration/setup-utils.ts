import { sha256Hex } from "../sha256";

interface SetupPlayerState {
  playerOrder: string[];
  setupPlayerIndex: number;
}

export function getCurrentSetupPlayer<S extends SetupPlayerState>(
  state: S,
): string {
  return state.playerOrder[state.setupPlayerIndex];
}

export function advanceSetupPlayer<S extends SetupPlayerState>(
  state: S,
): boolean {
  state.setupPlayerIndex++;
  return state.setupPlayerIndex >= state.playerOrder.length;
}

export function resetSetupPlayer<S extends SetupPlayerState>(state: S): void {
  state.setupPlayerIndex = 0;
}

export function lookupCardIdFromPoint(
  cardPointLookup: Record<string, string>,
  point: string,
): string | null {
  for (const [cardId, cardPoint] of Object.entries(cardPointLookup)) {
    if (cardPoint === point) return cardId;
  }
  return null;
}

function isHex(s: string): boolean {
  return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s);
}

export function deterministicShuffle<T>(arr: T[], seedHex: string): T[] {
  const out = arr.slice();
  const len = out.length;
  if (len <= 1) return out;
  if (!isHex(seedHex) || seedHex.length === 0) return out;

  let counter = 0;
  const nextU32 = (): number => {
    const bytes = new TextEncoder().encode(`${seedHex}:${counter++}`);
    const hex = sha256Hex(bytes);
    return parseInt(hex.slice(0, 8), 16) >>> 0;
  };

  for (let i = len - 1; i > 0; i--) {
    const j = nextU32() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/**
 * Extract a logical move count from boardgame.io ctx for determinism.
 * Falls back gracefully.
 */
export function getLogicalMoveCount(ctx: any): number {
  if (ctx && typeof ctx.numMoves === 'number') return ctx.numMoves;
  if (ctx && typeof ctx.turn === 'number') return ctx.turn;
  return 0;
}
