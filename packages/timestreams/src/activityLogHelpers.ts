/**
 * Shared helpers for human-readable activity log lines (play + scoring).
 */
import type { TimestreamsState } from "./types";
import { getCard } from "./effects/state";
import { pushActivityLog } from "./crypto";

export function cardLabel(G: TimestreamsState, cardId: string): string {
  const c = getCard(G, cardId);
  if (c?.name) return c.name;
  const fromPlayers = Object.values(G.players || {}).flatMap((p) => [
    ...(p.hand || []),
    ...(p.discard || []),
    ...(p.scorePile || []),
  ]);
  const found = fromPlayers.find((x) => x.id === cardId);
  if (found?.name) return found.name;
  return (cardId.split("#")[0] || cardId).replace(/-/g, " ");
}

export function formatChoiceDisplay(
  G: TimestreamsState,
  value: string | string[],
): string {
  const parts = Array.isArray(value)
    ? value
    : value === ""
      ? ["(skip)"]
      : [value];
  return parts
    .map((v) => {
      if (v === "option-a") return "option A";
      if (v === "option-b") return "option B";
      if (
        v === "yes" ||
        v === "no" ||
        v === "perform" ||
        v === "suppress" ||
        v === "use" ||
        v === "skip"
      ) {
        return v;
      }
      if (getCard(G, v) || v.includes("#") || G.cards?.[v]) {
        return cardLabel(G, v);
      }
      return v;
    })
    .join(", ");
}

/** Rewrite raw executor lines that embed card ids as human names. */
export function humanizeLogLine(G: TimestreamsState, line: string): string {
  let s = line;
  const idMatches = s.match(/[a-zA-Z0-9._-]+#[0-9]+/g) || [];
  for (const id of idMatches) {
    s = s.split(id).join(cardLabel(G, id));
  }
  // Also rewrite bare base ids when they match a known card in G.cards
  for (const id of Object.keys(G.cards || {})) {
    if (s.includes(id)) s = s.split(id).join(cardLabel(G, id));
  }
  return s
    .replace(/play:draw/g, "draw")
    .replace(/moved (.+) to /g, "moved $1 → ")
    .replace(/: recovered /g, ": recovered ")
    .replace(/: discarded /g, ": discarded ");
}

export function logPlay(G: TimestreamsState, message: string): void {
  pushActivityLog(G, message, "play");
}

export function pushEffectLogs(
  G: TimestreamsState,
  lines: string[] | undefined,
): void {
  for (const line of lines ?? []) {
    if (!line) continue;
    logPlay(G, `  · ${humanizeLogLine(G, line)}`);
  }
}
