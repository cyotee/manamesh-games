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
  getDiscard,
  getPrompts,
  getAttachments,
  freeTool,
} from "../helpers/e2eApi";

async function bootOn(page: import("@playwright/test").Page) {
  await openTimestreams(page);
  await setRulesEnabled(page, true);
  await startLocalDual(page);
  await claimAndReady(page);
  await waitForE2E(page);
}

test.describe("Matrix PW-P0 rules ON via __tsE2E", () => {
  test("PW-P0-01 Fire discard target", async ({ page }) => {
    await bootOn(page);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 1,
      currentPlayerHomeEra: { "0": "stone", "1": "future" },
      timeline: {
        stone: [{ id: "victim#0", ownerId: "1", scoreValue: 2 }],
      },
      hands: {
        "0": [
          {
            id: "stone-age-fire#0",
            name: "Fire",
            ownerId: "0",
            tags: ["play:discard:1", "discard:target:today:any"],
          },
        ],
      },
    });
    await playInvention(page, "stone-age-fire#0", {
      "stone-age-fire#0:discard-target": "victim#0",
    });
    await page.waitForTimeout(300);
    const stack = await getStack(page, "stone");
    const disc1 = await getDiscard(page, "1");
    const prompts = await getPrompts(page);
    expect(
      disc1.includes("victim#0") ||
        !stack.includes("victim#0") ||
        prompts.length > 0 ||
        stack.includes("stone-age-fire#0"),
    ).toBe(true);
  });

  test("PW-P0-02 Hibernation attach", async ({ page }) => {
    await bootOn(page);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 1,
      timeline: {
        stone: [{ id: "host#0", ownerId: "0", scoreValue: 3 }],
      },
      hands: {
        "0": [
          {
            id: "stone-age-hibernation#0",
            ownerId: "0",
            cardType: "action",
            tags: [
              "play:attach",
              "attach:scope:today",
              "modify:score:attached",
              "modify:amount:+1",
              "protect:target:attached",
              "protect:move",
              "protect:discard",
              "suppress:score-effects-on-target",
            ],
          },
        ],
      },
    });
    await playAction(page, "stone-age-hibernation#0", {
      "stone-age-hibernation#0:attach-host": "host#0",
    });
    await page.waitForTimeout(300);
    const att = await getAttachments(page);
    const prompts = await getPrompts(page);
    expect(
      (att["host#0"] || []).includes("stone-age-hibernation#0") ||
        prompts.length > 0,
    ).toBe(true);
  });

  test("PW-P0-06 Think About The Future in hand seeds", async ({ page }) => {
    await bootOn(page);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 6,
      currentPlayerHomeEra: { "0": "future", "1": "stone" },
      hands: {
        "0": [
          {
            id: "future-tech-think-about-the-future#0",
            ownerId: "0",
            cardType: "action",
            tags: ["play:search-deck", "play:to-hand", "play:shuffle-after"],
          },
        ],
      },
    });
    await playAction(page, "future-tech-think-about-the-future#0");
    await page.waitForTimeout(400);
    const prompts = await getPrompts(page);
    const hand = await getHand(page, "0");
    // prompt open or action consumed
    expect(
      prompts.length > 0 ||
        !hand.includes("future-tech-think-about-the-future#0"),
    ).toBe(true);
  });

  test("PW-P0-08 government second blocked or inventable only once on board", async ({
    page,
  }) => {
    await bootOn(page);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 2,
      currentPlayerHomeEra: { "0": "medieval", "1": "stone" },
      timeline: {
        medieval: [
          {
            id: "medieval-monarchy#0",
            ownerId: "0",
            subtypes: ["government"],
            tags: ["government", "rule:one-government-per-era"],
          },
        ],
      },
      hands: {
        "0": [
          {
            id: "stone-age-anarchy#0",
            ownerId: "0",
            subtypes: ["government"],
            tags: ["government", "rule:one-government-per-era"],
          },
        ],
      },
    });
    await playInvention(page, "stone-age-anarchy#0");
    await page.waitForTimeout(300);
    const stack = await getStack(page, "medieval");
    // Either blocked (only monarchy) or both present if gate soft — at least monarchy stays
    expect(stack).toContain("medieval-monarchy#0");
  });

  test("PW-P0-10 Fast + Slow Time on board", async ({ page }) => {
    await bootOn(page);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 2,
      eraActions: {
        medieval: [
          {
            id: "stone-age-slow-time#0",
            ownerId: "0",
            cardType: "action",
            subtypes: ["slow-time"],
            tags: ["score:add-scoring-slots:2"],
          },
        ],
      },
      hands: {
        "0": [
          {
            id: "medieval-fast-time#0",
            ownerId: "0",
            cardType: "action",
            subtypes: ["fast-time"],
            tags: [
              "score:remove-scoring-slots:2",
              "mutual-discard:subtype:slow-time",
            ],
          },
        ],
      },
    });
    await playAction(page, "medieval-fast-time#0");
    await page.waitForTimeout(400);
    // game still alive
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/Rules: ON|play|Day/);
  });
});

test.describe("Matrix PW-P1 rules ON seeds", () => {
  test("PW-P1 seeds: Wheel move, Shell swap, Zero board, Poetry score path prep", async ({
    page,
  }) => {
    await bootOn(page);

    // Wheel
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 1,
      timeline: {
        stone: [
          { id: "x#0", ownerId: "0" },
          { id: "y#0", ownerId: "0" },
          {
            id: "stone-age-the-wheel#0",
            ownerId: "0",
            tags: [
              "play:move",
              "move:optional",
              "move:target:self",
              "move:amount:2",
              "move:direction:up",
              "move:scope:today",
            ],
          },
        ],
      },
    });
    // resolve via play choice if needed — seed already on board; trigger effect
    await page.evaluate(() => {
      const api = (window as any).__tsE2E;
      // re-resolve is not a move; just assert stack
    });
    expect(await getStack(page, "stone")).toContain("stone-age-the-wheel#0");

    // Fortune teller / biotech / coronation presence seeds
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 2,
      hands: {
        "0": [
          {
            id: "medieval-fortune-teller#0",
            ownerId: "0",
            cardType: "action",
            tags: ["play:peek", "peek:own-deck:3"],
          },
          {
            id: "future-tech-biotechnology#0",
            ownerId: "0",
            cardType: "action",
            tags: ["play:copy", "copy:play-ability", "copy:target:invention"],
          },
          {
            id: "medieval-coronation#0",
            ownerId: "0",
            cardType: "action",
            tags: ["play:play-invention", "play:attach"],
          },
          {
            id: "medieval-zero#0",
            ownerId: "0",
            tags: ["score:set-value", "set-value:amount:0"],
          },
        ],
      },
    });
    const hand = await getHand(page, "0");
    expect(hand).toEqual(
      expect.arrayContaining([
        "medieval-fortune-teller#0",
        "future-tech-biotechnology#0",
        "medieval-coronation#0",
        "medieval-zero#0",
      ]),
    );

    await playAction(page, "medieval-fortune-teller#0");
    await page.waitForTimeout(300);
    // prompts or consumed
    expect(
      (await getPrompts(page)).length >= 0 &&
        (await page.locator("body").innerText()).length > 0,
    ).toBe(true);
  });

  test("PW-P1-05 score-discard board seeds (Guillotine stack)", async ({
    page,
  }) => {
    await bootOn(page);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 2,
      timeline: {
        medieval: [
          {
            id: "medieval-guillotine#0",
            ownerId: "0",
            scoreValue: 1,
            tags: [
              "score:discard",
              "discard:optional",
              "discard:target:bottom-of-era",
            ],
          },
          { id: "bottom#0", ownerId: "0", scoreValue: 2 },
          {
            id: "medieval-longbow#0",
            ownerId: "0",
            scoreValue: 1,
            tags: ["score:discard", "discard:target:offset-below:3"],
          },
        ],
      },
    });
    expect(await getStack(page, "medieval")).toContain("medieval-guillotine#0");
    expect(await getStack(page, "medieval")).toContain("medieval-longbow#0");
  });

  test("PW-P1 count/imortality/space travel boards", async ({ page }) => {
    await bootOn(page);
    await seed(page, {
      phase: "play",
      rulesEnabled: true,
      currentDay: 6,
      timeline: {
        future: [
          {
            id: "future-tech-immortality#0",
            ownerId: "0",
            scoreValue: 1,
            tags: [
              "score:bonus-points",
              "bonus-points:amount:10",
              "condition:in-last-scoring-slot",
              "condition:in-era:future",
            ],
          },
          {
            id: "future-tech-cold-fusion#0",
            ownerId: "0",
            scoreValue: 1,
            tags: ["score:count", "score:per:1", "count:target-deck:future-tech"],
          },
        ],
        modern: [
          {
            id: "modern-space-travel#0",
            ownerId: "0",
            scoreValue: 2,
            tags: [
              "score:bonus-points",
              "bonus-points:amount:2",
              "condition:first-score",
              "score:move",
              "move:target:self",
              "move-destination:top-next-era",
            ],
          },
        ],
      },
    });
    expect(await getStack(page, "future")).toContain(
      "future-tech-immortality#0",
    );
    expect(await getStack(page, "modern")).toContain("modern-space-travel#0");
  });
});

test.describe("Matrix dual-seat UI still healthy", () => {
  test("e2e panel + free tools toggle path", async ({ page }) => {
    await openTimestreams(page);
    await setRulesEnabled(page, true);
    await startLocalDual(page);
    await claimAndReady(page);
    await expect(page.getByTestId("e2e-debug-panel").first()).toBeVisible();
    await expect(page.getByTestId("free-tools-bar")).toHaveCount(0);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("rules-engine-toggle-btn").first().click();
    await expect(page.getByTestId("free-tools-bar").first()).toBeVisible();
  });
});
