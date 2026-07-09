/**
 * Strict play:* coverage — every pack `play:*` tag must map to a registered
 * executor family or an explicit allowlist entry with a reason.
 *
 * See TAG_TEST_IMPLEMENTATION_PLAN.md Phase 0.2.
 */

/** Root play families implemented by resolvePlay EXECUTORS (or pure modifiers). */
export const PLAY_IMPLEMENTED_FAMILIES = [
  "play:draw",
  "play:discard",
  "play:move",
  "play:swap",
  "play:attach",
  "play:prevent",
  "play:recover",
  "play:search-deck",
  "play:peek",
  "play:copy",
  "play:play-invention",
  "play:delayed-trigger",
  "play:extra-turn",
  "play:skip-turn",
  "play:allow-next-invention",
  "play:choice",
  // Modifiers / companions handled inside other executors or gates:
  "play:requires-card",
  "play:scope",
  "play:shuffle-after",
  "play:to-hand",
  "play:to-deck",
  "play:add-scoring-slots",
] as const;

/**
 * Known pack play tags not yet implemented — must not silently expand.
 * Prefer empty: all play tags should be implemented.
 */
export const PLAY_ALLOWLIST: Array<{ tagPrefix: string; reason: string }> = [];

export function playTagIsCovered(tag: string): { ok: boolean; via?: string } {
  if (!tag.startsWith("play:")) return { ok: true, via: "non-play" };
  for (const fam of PLAY_IMPLEMENTED_FAMILIES) {
    if (tag === fam || tag.startsWith(fam + ":")) {
      return { ok: true, via: fam };
    }
  }
  for (const a of PLAY_ALLOWLIST) {
    if (tag === a.tagPrefix || tag.startsWith(a.tagPrefix + ":")) {
      return { ok: true, via: `allowlist:${a.tagPrefix}` };
    }
  }
  return { ok: false };
}
