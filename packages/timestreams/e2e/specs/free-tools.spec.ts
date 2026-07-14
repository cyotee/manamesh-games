import { test, expect } from "@playwright/test";
import {
  openTimestreams,
  setRulesEnabled,
  startLocalDual,
  claimAndReady,
  seedViaButton,
} from "../helpers/spa";

test.describe("Rules OFF free tools (PW-R0 / FT)", () => {
  test("PW-R0-01: free tools bar, attach, detach, discard", async ({ page }) => {
    await openTimestreams(page);
    await setRulesEnabled(page, false);
    await startLocalDual(page);
    await claimAndReady(page);

    await expect(page.getByTestId("free-tools-bar").first()).toBeVisible();
    await expect(page.getByText("Cannot re-enable this match").first()).toBeVisible();

    await seedViaButton(page, "e2e-seed-free-tools");

    // Select hibernation (hand) then host (timeline) for attach: selection order
    // is multi-select — click action then host
    const hib = page.locator('[data-testid^="hand-card-hib"]').first();
    if (await hib.count()) {
      await hib.click();
    } else {
      // card may render as hand-card-hib#0
      await page.locator('[data-card-id="hib#0"]').first().click();
    }
    await page.locator('[data-testid="timeline-card-host#0"]').first().click();
    await page.getByTestId("free-tool-free:attach").first().click();
    await page.waitForTimeout(400);

    const body = await page.locator("body").innerText();
    expect(body).toMatch(/free:attach/i);

    // Detach attachment
    const att = page.locator('[data-testid="timeline-attachment-hib#0"]').first();
    if (await att.count()) {
      await att.click();
      await page.getByTestId("free-tool-free:detach").first().click();
      await page.waitForTimeout(300);
      const body2 = await page.locator("body").innerText();
      expect(body2).toMatch(/free:detach/i);
    }

    // Discard host
    await page.locator('[data-testid="timeline-card-host#0"]').first().click();
    await page.getByTestId("free-tool-free:discard").first().click();
    await page.waitForTimeout(300);
    const body3 = await page.locator("body").innerText();
    expect(body3).toMatch(/free:discard/i);
  });

  test("PW-R0-02: seed score board, claim to pile, swap remaining", async ({
    page,
  }) => {
    await openTimestreams(page);
    await setRulesEnabled(page, false);
    await startLocalDual(page);
    await claimAndReady(page);

    await seedViaButton(page, "e2e-seed-scoring-manual");
    await expect(page.getByTestId("timeline-card-s0-card").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("free-tools-bar").first()).toBeVisible();

    // Claim to score pile
    await page.getByTestId("timeline-card-s0-card").first().click();
    await page.getByTestId("free-tool-free:to-score-pile").first().click();
    await page.waitForTimeout(400);
    let body = await page.locator("body").innerText();
    expect(body).toMatch(/free:to-score-pile|free:score-claim|Score pile|score pile/i);

    // Swap two remaining inventions
    await page.getByTestId("timeline-card-s1-card").first().click();
    await page.getByTestId("timeline-card-s2-card").first().click();
    await page.getByTestId("free-tool-free:swap").first().click();
    await page.waitForTimeout(400);
    body = await page.locator("body").innerText();
    expect(body).toMatch(/free:swap/i);
    expect(body).toContain("Rules: OFF");
  });

  test("PW-R0-03: rules OFF invent does not require engine prompts", async ({
    page,
  }) => {
    await openTimestreams(page);
    await setRulesEnabled(page, false);
    await startLocalDual(page);
    await claimAndReady(page);

    // Play first invention if available (structural only)
    const inv = page.getByTestId(/^play-invention-/).first();
    if (await inv.isEnabled()) {
      await inv.click();
      await page.waitForTimeout(500);
    }
    // Free tools still present; no stuck rules prompt required
    await expect(page.getByTestId("free-tools-bar").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).toContain("Rules: OFF");
  });
});
