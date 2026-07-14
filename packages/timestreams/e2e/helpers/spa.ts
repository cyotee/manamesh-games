import type { Page } from "@playwright/test";

/** Timestreams SPA with e2e=1 → plaintext + debugSeed on local dual. */
export async function openTimestreams(page: Page) {
  await page.goto("/src/pages/timestreams/?e2e=1");
  await page.getByRole("heading", { name: "Timestreams" }).waitFor({
    state: "visible",
    timeout: 60_000,
  });
}

export async function setRulesEnabled(page: Page, enabled: boolean) {
  const box = page.getByTestId("menu-rules-toggle").locator("input");
  await box.waitFor({ state: "visible" });
  const checked = await box.isChecked();
  if (checked !== enabled) await box.click();
}

/** Start local dual-seat after menu options are set. */
export async function startLocalDual(page: Page) {
  await page.getByTestId("local-dual").click();
  await page.getByText("Local dual-seat").waitFor({ state: "visible" });
}

/** Claim Stone (P0) + Future (P1) and ready both seats. */
export async function claimAndReady(page: Page) {
  await page.getByRole("button", { name: /Stone Age/ }).first().click();
  await page.getByTestId("set-ready").first().click();
  await page.getByRole("button", { name: /Future/ }).last().click();
  await page.getByTestId("set-ready").last().click();
  // plaintext e2e should reach play quickly
  await page.waitForFunction(
    () => document.body.innerText.includes("G.phase: play"),
    null,
    { timeout: 60_000 },
  );
}

export async function waitForPlayPhase(page: Page) {
  await page.waitForFunction(
    () => document.body.innerText.includes("G.phase: play"),
    null,
    { timeout: 90_000 },
  );
}

export async function seedViaButton(page: Page, testId: string) {
  const btn = page.getByTestId(testId).first();
  await btn.waitFor({ state: "visible", timeout: 30_000 });
  await btn.click();
  await page.waitForTimeout(300);
}
