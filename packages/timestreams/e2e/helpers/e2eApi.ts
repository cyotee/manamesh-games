import type { Page } from "@playwright/test";

export type TsE2E = {
  seed: (args: any) => void;
  freeTool: (toolId: string, args?: any) => void;
  setRulesEnabled: (enabled: boolean) => void;
  playInvention: (cardId: string, choices?: any) => void;
  playAction: (cardId: string, choices?: any) => void;
  pass: () => void;
  submitScoreChoice: (id: string, value: any) => void;
  ackScoreStep: () => void;
  getStack: (era: string) => string[];
  getHand: (pid: string) => string[];
  getDiscard: (pid: string) => string[];
  getScorePile: (pid: string) => string[];
  getScores: () => Record<string, number>;
  getPrompts: () => any[];
  getAttachments: () => Record<string, string[]>;
  phase: string;
  rulesEnabled: boolean;
};

export async function waitForE2E(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => !!(window as any).__tsE2E?.seed,
    null,
    { timeout },
  );
}

export async function e2eCall<T>(
  page: Page,
  fn: (api: TsE2E) => T,
): Promise<T> {
  return page.evaluate((fnSrc) => {
    // eslint-disable-next-line no-new-func
    const f = new Function("api", `return (${fnSrc})(api);`);
    return f((window as any).__tsE2E);
  }, fn.toString());
}

export async function seed(page: Page, args: any) {
  await waitForE2E(page);
  await page.evaluate((a) => (window as any).__tsE2E.seed(a), args);
  await page.waitForTimeout(200);
}

export async function freeTool(page: Page, toolId: string, args: any = {}) {
  await waitForE2E(page);
  await page.evaluate(
    ({ toolId, args }) => (window as any).__tsE2E.freeTool(toolId, args),
    { toolId, args },
  );
  await page.waitForTimeout(150);
}

export async function getStack(page: Page, era: string) {
  return page.evaluate((e) => (window as any).__tsE2E.getStack(e), era);
}

export async function getHand(page: Page, pid: string) {
  return page.evaluate((p) => (window as any).__tsE2E.getHand(p), pid);
}

export async function getDiscard(page: Page, pid: string) {
  return page.evaluate((p) => (window as any).__tsE2E.getDiscard(p), pid);
}

export async function getScorePile(page: Page, pid: string) {
  return page.evaluate((p) => (window as any).__tsE2E.getScorePile(p), pid);
}

export async function getPrompts(page: Page) {
  return page.evaluate(() => (window as any).__tsE2E.getPrompts());
}

export async function getAttachments(page: Page) {
  return page.evaluate(() => (window as any).__tsE2E.getAttachments());
}

export async function playInvention(page: Page, cardId: string, choices?: any) {
  await page.evaluate(
    ({ cardId, choices }) =>
      (window as any).__tsE2E.playInvention(cardId, choices),
    { cardId, choices },
  );
  await page.waitForTimeout(200);
}

export async function playAction(page: Page, cardId: string, choices?: any) {
  await page.evaluate(
    ({ cardId, choices }) =>
      (window as any).__tsE2E.playAction(cardId, choices),
    { cardId, choices },
  );
  await page.waitForTimeout(200);
}

export async function submitPlayChoice(page: Page, id: string, value: any) {
  await page.evaluate(
    ({ id, value }) => (window as any).__tsE2E.submitPlayChoice?.(id, value),
    { id, value },
  );
  await page.waitForTimeout(150);
}

export async function submitScoreChoice(page: Page, id: string, value: any) {
  await page.evaluate(
    ({ id, value }) => (window as any).__tsE2E.submitScoreChoice(id, value),
    { id, value },
  );
  await page.waitForTimeout(150);
}

export async function ackScoreStep(page: Page) {
  await page.evaluate(() => (window as any).__tsE2E.ackScoreStep());
  await page.waitForTimeout(150);
}
