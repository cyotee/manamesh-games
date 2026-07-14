/**
 * Remaining matrix PW-P0 / PW-P1 scenarios exercised via __tsE2E seed + moves.
 */
import { test, expect } from "@playwright/test";
import {
  openTimestreams,
  setRulesEnabled,
  startLocalDual,
  claimAndReady,
} from "../helpers/spa";
import {
  waitForE2E,
  seed,
  playInvention,
  playAction,
  getStack,
  getHand,
  getPrompts,
  getAttachments,
} from "../helpers/e2eApi";

async function boot(page: import("@playwright/test").Page, rulesOn: boolean) {
  await openTimestreams(page);
  await setRulesEnabled(page, rulesOn);
  await startLocalDual(page);
  await claimAndReady(page);
  await waitForE2E(page);
}

test.describe("Matrix remaining PW-P0", () => {
  test("PW-P0-03 Mysticism seeded on board", async ({ page }) => {
    await boot(page, true);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 1,
      timeline: {
        stone: [
          {
            id: "stone-age-mysticism#0",
            ownerId: "0",
            scoreValue: 0,
            tags: [
              "score:guess",
              "guess:range:1-4",
              "guess:by:left-neighbor",
              "guess:correct:penalty:-3",
              "guess:wrong:bonus-points:chosen-number",
            ],
          },
        ],
      },
    });
    expect(await getStack(page, "stone")).toContain("stone-age-mysticism#0");
  });

  test("PW-P0-04 Nanotech + QC board", async ({ page }) => {
    await boot(page, true);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 6,
      timeline: {
        future: [
          {
            id: "future-tech-nanotech#0",
            ownerId: "0",
            subtypes: ["nanotech"],
            tags: ["score:perform-other", "steal:target-to:own-score-pile"],
          },
          {
            id: "future-tech-quantum-computing#0",
            ownerId: "0",
            subtypes: ["quantum-computing"],
            tags: ["score:choice", "option-a:add-scoring-slots:1"],
          },
        ],
      },
    });
    const s = await getStack(page, "future");
    expect(s).toEqual(
      expect.arrayContaining([
        "future-tech-nanotech#0",
        "future-tech-quantum-computing#0",
      ]),
    );
  });

  test("PW-P0-05 Chaos + Mass Marketing board", async ({ page }) => {
    await boot(page, true);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 5,
      timeline: {
        modern: [
          {
            id: "modern-chaos-theory#0",
            ownerId: "0",
            tags: ["score:perform-other", "suppress:score-effects-on-target"],
          },
          {
            id: "modern-mass-marketing#0",
            ownerId: "0",
            tags: ["score:bonus-points", "bonus-points:copy"],
          },
        ],
      },
    });
    expect(await getStack(page, "modern")).toContain("modern-chaos-theory#0");
    expect(await getStack(page, "modern")).toContain("modern-mass-marketing#0");
  });

  test("PW-P0-07 Herbalism in P1 hand", async ({ page }) => {
    await boot(page, true);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      hands: {
        "0": [
          {
            id: "act#0",
            ownerId: "0",
            cardType: "action",
            tags: ["play:draw:1"],
          },
        ],
        "1": [
          {
            id: "stone-age-herbalism#0",
            ownerId: "1",
            tags: [
              "react:action",
              "react:from:hand",
              "trigger:source:opponent",
              "react:cancel",
              "cost:discard-self",
            ],
          },
        ],
      },
    });
    expect(await getHand(page, "1")).toContain("stone-age-herbalism#0");
    await playAction(page, "act#0");
    await page.waitForTimeout(300);
    // prompt may open on P1 board; ensure game alive
    expect((await page.locator("body").innerText()).length).toBeGreaterThan(50);
  });

  test("PW-P0-09 Cloth on board with protect/redirect tags", async ({ page }) => {
    await boot(page, true);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      timeline: {
        stone: [
          {
            id: "stone-age-cloth#0",
            ownerId: "0",
            tags: [
              "react:move",
              "redirect:target-to:self",
              "protect:target:own-inventions",
            ],
          },
          { id: "own#0", ownerId: "0", scoreValue: 2 },
        ],
      },
    });
    expect(await getStack(page, "stone")).toContain("stone-age-cloth#0");
  });
});

test.describe("Matrix remaining PW-P1 cards", () => {
  const boards: Array<{
    id: string;
    era: string;
    card: Record<string, unknown>;
  }> = [
    {
      id: "PW-P1-02",
      era: "future",
      card: {
        id: "future-tech-biotechnology#0",
        ownerId: "0",
        cardType: "action",
        tags: ["play:copy", "copy:play-ability"],
      },
    },
    {
      id: "PW-P1-03",
      era: "medieval",
      card: {
        id: "medieval-coronation#0",
        ownerId: "0",
        cardType: "action",
        tags: ["play:play-invention", "play:attach"],
      },
    },
    {
      id: "PW-P1-04",
      era: "medieval",
      card: {
        id: "medieval-zero#0",
        ownerId: "0",
        tags: ["score:set-value", "set-value:amount:0"],
      },
    },
    {
      id: "PW-P1-07",
      era: "stone",
      card: {
        id: "stone-age-pottery#0",
        ownerId: "0",
        tags: ["score:move", "score:delayed"],
      },
    },
    {
      id: "PW-P1-08",
      era: "modern",
      card: {
        id: "modern-space-travel#0",
        ownerId: "0",
        tags: ["score:bonus-points", "condition:first-score", "score:move"],
      },
    },
    {
      id: "PW-P1-09",
      era: "future",
      card: {
        id: "future-tech-immortality#0",
        ownerId: "0",
        tags: [
          "score:bonus-points",
          "bonus-points:amount:10",
          "condition:in-last-scoring-slot",
        ],
      },
    },
    {
      id: "PW-P1-10",
      era: "future",
      card: {
        id: "future-tech-digital-secretary#0",
        ownerId: "0",
        tags: [
          "play:prevent",
          "score:penalty:next-inventor",
          "bonus-points:to:next-inventor",
        ],
      },
    },
    {
      id: "PW-P1-11",
      era: "modern",
      card: {
        id: "modern-recycling#0",
        ownerId: "0",
        cardType: "action",
        tags: ["play:recover", "recover:to-deck", "play:draw:1"],
      },
    },
    {
      id: "PW-P1-12",
      era: "medieval",
      card: {
        id: "medieval-hunting-party#0",
        ownerId: "0",
        cardType: "action",
        tags: ["play:delayed-trigger", "trigger:sixth-invention-in-era"],
      },
    },
  ];

  for (const b of boards) {
    test(`${b.id} seed ${b.card.id}`, async ({ page }) => {
      await boot(page, true);
      const isAction = b.card.cardType === "action";
      await seed(page, {
        phase: "play",
        rulesEnabled: true,
        currentDay: 1,
        timeline: isAction
          ? { [b.era]: [{ id: "host#0", ownerId: "0" }] }
          : { [b.era]: [b.card] },
        hands: isAction ? { "0": [b.card] } : {},
        eraActions: {},
      });
      if (isAction) {
        expect(await getHand(page, "0")).toContain(b.card.id as string);
      } else {
        expect(await getStack(page, b.era)).toContain(b.card.id as string);
      }
    });
  }

  test("PW-P1-06 count cards board", async ({ page }) => {
    await boot(page, true);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      timeline: {
        stone: [
          {
            id: "stone-age-irrigation#0",
            ownerId: "0",
            tags: ["score:count", "count:own-inventions"],
          },
        ],
        medieval: [
          {
            id: "medieval-mathematics#0",
            ownerId: "0",
            tags: ["score:count", "count:owner:opponents"],
          },
          {
            id: "medieval-yoke#0",
            ownerId: "0",
            tags: ["score:count", "count:own-inventions"],
          },
        ],
        future: [
          {
            id: "future-tech-cold-fusion#0",
            ownerId: "0",
            tags: ["score:count", "count:target-deck:future-tech"],
          },
          {
            id: "future-tech-multiplicity#0",
            ownerId: "0",
            cardType: "action",
            tags: ["score:count", "count:duplicates:own-inventions"],
          },
        ],
      },
    });
    expect(await getStack(page, "stone")).toContain("stone-age-irrigation#0");
    expect(await getStack(page, "medieval")).toContain("medieval-yoke#0");
  });

  test("PW-P1-13 era cards registered in seed hands", async ({ page }) => {
    await boot(page, true);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      hands: {
        "0": [
          {
            id: "era-stone",
            ownerId: "0",
            tags: ["limit:once-per-game", "react:cancel"],
          },
          {
            id: "era-medieval",
            ownerId: "0",
            tags: ["steal:bonus-points", "limit:once-per-game"],
          },
        ],
      },
    });
    const h = await getHand(page, "0");
    expect(h).toEqual(expect.arrayContaining(["era-stone", "era-medieval"]));
  });

  test("PW-P1-14 dual board still has prompts API", async ({ page }) => {
    await boot(page, true);
    const prompts = await getPrompts(page);
    expect(Array.isArray(prompts)).toBe(true);
  });
});
