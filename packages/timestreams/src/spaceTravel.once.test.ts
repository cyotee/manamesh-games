import { describe, it, expect } from "vitest";
import { makeCard, makeState, putInEra } from "./effects/testFixtures";
import { resolveCardScoreEffectsFull } from "./effects/executors/score";
import { hasUsedFirstScore } from "./effects/conditions";
import { collectInteractivePromptsForCard } from "./scoring";

const ST_TAGS = [
  "score:bonus-points",
  "bonus-points:amount:2",
  "condition:first-score",
  "score:move",
  "move:target:self",
  "move-destination:top-next-era",
];

describe("Space Travel — move only once (first-score)", () => {
  it("first score: +2 and moves self to top of next era; second score: no move, no prompts", () => {
    const G = makeState({ players: ["0"], currentDay: 5 });
    G.players["0"].homeEra = "modern";
    const st = makeCard({
      id: "modern-space-travel#0",
      name: "Space Travel",
      ownerId: "0",
      scoreValue: 2,
      tags: ST_TAGS,
    });
    putInEra(G, "modern", st);
    G.scoringActiveEra = "modern";

    // First score — should move
    const r1 = resolveCardScoreEffectsFull(G, st, "modern", 0, {});
    expect(hasUsedFirstScore(G, st.id)).toBe(true);
    expect(G.timeline.future.stack[0]).toBe(st.id);
    expect(G.timeline.modern.stack).not.toContain(st.id);
    expect(r1.log.some((l) => l.includes("moved"))).toBe(true);
    expect(r1.extra).toBe(2); // first-score bonus

    // Second score in future — no move, no move prompts
    G.scoringActiveEra = "future";
    const prompts = collectInteractivePromptsForCard(G, st.id);
    expect(prompts.some((p) => p.reason?.startsWith("score:move"))).toBe(false);

    const futureBefore = [...G.timeline.future.stack];
    const r2 = resolveCardScoreEffectsFull(G, st, "future", 0, {});
    expect(G.timeline.future.stack).toEqual(futureBefore); // stayed put
    expect(r2.log.some((l) => l.includes("moved"))).toBe(false);
    expect(r2.extra).toBe(0); // no second first-score bonus
  });
});
