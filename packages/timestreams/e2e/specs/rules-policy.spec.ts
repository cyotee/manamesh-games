import { test, expect } from "@playwright/test";
import {
  openTimestreams,
  setRulesEnabled,
  startLocalDual,
  claimAndReady,
} from "../helpers/spa";

test.describe("Rules ON/OFF policy (PW-R1)", () => {
  test("PW-R1-02: free tools bar absent when rules ON", async ({ page }) => {
    await openTimestreams(page);
    await setRulesEnabled(page, true);
    await startLocalDual(page);
    await claimAndReady(page);

    await expect(page.getByTestId("free-tools-bar")).toHaveCount(0);
    const body = await page.locator("body").innerText();
    expect(body).toContain("Rules: ON");
  });

  test("PW-R1-01: mid-game disable shows free tools and locks re-enable", async ({
    page,
  }) => {
    await openTimestreams(page);
    await setRulesEnabled(page, true);
    await startLocalDual(page);
    await claimAndReady(page);

    await expect(page.getByTestId("free-tools-bar")).toHaveCount(0);

    page.once("dialog", (d) => d.accept());
    await page.getByTestId("rules-engine-toggle-btn").first().click();
    await page.waitForTimeout(500);

    await expect(page.getByTestId("free-tools-bar").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).toContain("Rules: OFF");
    expect(body).toMatch(/Cannot re-enable|DISABLED|manual mode/i);

    // Re-enable control is disabled
    await expect(page.getByTestId("rules-engine-toggle-btn").first()).toBeDisabled();
  });
});
