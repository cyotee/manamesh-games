/**
 * Tag coverage gates (plan Phase 0 / 6).
 *
 * 1) Every pack tag starts with a handled or deferred prefix (legacy allowlist).
 * 2) Every pack `play:*` tag maps to an implemented family or explicit PLAY_ALLOWLIST.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { playTagIsCovered, PLAY_ALLOWLIST } from "./playTagRegistry";

const PACKS = join(__dirname, "..", "..", "assets", "packs", "timestreams");

/** Tag prefixes the play + score + react pipelines consume. */
const HANDLED_PREFIXES = [
  "play:",
  "score:",
  "react:",
  "move:",
  "move-source:",
  "move-destination:",
  "swap:",
  "attach:",
  "modify:",
  "discard:",
  "draw:",
  "opponents-draw:",
  "recover:",
  "prevent:",
  "duration:",
  "requires:",
  "rule:",
  "government",
  "protect:",
  "target:",
  "decider:",
  "option-a:",
  "option-b:",
  "forced:",
  "trigger:",
  "ongoing:",
  "skip:",
  "skip-turn:",
  "allow:",
  "extra-turn:",
  "cost:",
  "condition:",
  "additional:",
  "peek:",
  "to-hand:",
  "return:",
  "return-order:",
  "penalty:",
  "bonus-points:",
  "count:",
  "copy:",
  "perform:",
  "cancel:",
  "if-true:",
  "if-false:",
  "branch:",
  "delayed:",
  "suppress:",
  "steal:",
  "redirect:",
  "replace:",
  "guess:",
  "set-value:",
  "slots:",
  "limit:",
  "mutual-discard:",
  "extend:",
];

/**
 * Families handled by score/react pipelines (post gap-closure Phases 1–5).
 * Kept as "known" prefixes so unknown tags still fail CI.
 * Prefer behavioral tests over this soft gate.
 */
const DEFERRED_PREFIXES = [
  // Still partially interactive / era-card polish — not silent no-ops for core packs
  "retaliate:",
];

function allTags(): Set<string> {
  const tags = new Set<string>();
  for (const deck of readdirSync(PACKS)) {
    const file = join(PACKS, deck, "manifest.json");
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    for (const card of manifest.cards ?? []) {
      for (const t of card.metadata?.tags ?? []) tags.add(t);
    }
  }
  return tags;
}

describe("tag coverage gate (PRD 12)", () => {
  it("every manifest tag is handled or explicitly deferred", () => {
    const unknown: string[] = [];
    for (const tag of allTags()) {
      const known = [...HANDLED_PREFIXES, ...DEFERRED_PREFIXES].some(
        (p) => tag === p || tag.startsWith(p),
      );
      if (!known) unknown.push(tag);
    }
    expect(unknown, `unhandled tags: ${unknown.join(", ")}`).toEqual([]);
  });

  it("every play:* pack tag is implemented or allowlisted (strict — no silent no-ops)", () => {
    const playTags = [...allTags()].filter((t) => t.startsWith("play:")).sort();
    const missing: string[] = [];
    for (const tag of playTags) {
      if (!playTagIsCovered(tag).ok) missing.push(tag);
    }
    expect(
      missing,
      `Unimplemented play tags (add executor or PLAY_ALLOWLIST):\n${missing.join("\n")}\n\nAllowlist:\n${PLAY_ALLOWLIST.map((a) => `  ${a.tagPrefix}: ${a.reason}`).join("\n")}`,
    ).toEqual([]);
  });
});
