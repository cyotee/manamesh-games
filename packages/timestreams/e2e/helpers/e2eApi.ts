import type { Page } from "@playwright/test";

export type DebugE2EAct =
  | { op: "forceScoring" }
  | {
      op: "scoreChoice";
      playerId: string;
      promptId: string;
      value: string | string[];
    }
  | { op: "ack"; playerId: string }
  | { op: "ackAll" }
  | {
      op: "react";
      playerId: string;
      promptId: string;
      value: string | string[];
    }
  | {
      op: "playChoice";
      playerId: string;
      promptId: string;
      value: string | string[];
    }
  | { op: "finishScoring"; maxSteps?: number };

export type TsE2E = {
  seed: (args: any) => void;
  freeTool: (toolId: string, args?: any) => void;
  setRulesEnabled: (enabled: boolean) => void;
  playInvention: (cardId: string, choices?: any) => void;
  playAction: (cardId: string, choices?: any) => void;
  pass: () => void;
  submitScoreChoice: (id: string, value: any) => void;
  ackScoreStep: () => void;
  submitReact?: (id: string, value: any) => void;
  submitPlayChoice?: (id: string, value: any) => void;
  debugAct?: (act: DebugE2EAct) => void;
  getStack: (era: string) => string[];
  getHand: (pid: string) => string[];
  getDiscard: (pid: string) => string[];
  getScorePile: (pid: string) => string[];
  getScores: () => Record<string, number>;
  getBonusPoints?: () => Record<string, number>;
  getBonusLedger?: () => any[];
  getScoringWalk?: () => {
    stepPhase: string;
    currentCardId: string | null;
    acks: Record<string, boolean>;
    stepIndex: number;
    stepsLen: number;
  } | null;
  getPrompts: () => any[];
  getAttachments: () => Record<string, string[]>;
  getPhase?: () => string;
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
  return page.evaluate(
    (e) => (window as any).__tsE2E?.getStack?.(e) ?? [],
    era,
  );
}

export async function getHand(page: Page, pid: string) {
  return page.evaluate(
    (p) => (window as any).__tsE2E?.getHand?.(p) ?? [],
    pid,
  );
}

export async function getDiscard(page: Page, pid: string) {
  return page.evaluate(
    (p) => (window as any).__tsE2E?.getDiscard?.(p) ?? [],
    pid,
  );
}

export async function getScorePile(page: Page, pid: string) {
  return page.evaluate(
    (p) => (window as any).__tsE2E?.getScorePile?.(p) ?? [],
    pid,
  );
}

export async function getScores(page: Page) {
  return page.evaluate(() => (window as any).__tsE2E?.getScores?.() ?? {});
}

export async function getBonusPoints(page: Page) {
  return page.evaluate(() => (window as any).__tsE2E?.getBonusPoints?.() ?? {});
}

export async function getPhase(page: Page) {
  return page.evaluate(() => {
    const api = (window as any).__tsE2E;
    if (!api) return "";
    return api.getPhase?.() ?? api.phase ?? api.getG?.()?.phase ?? "";
  });
}

export async function getScoringWalk(page: Page) {
  return page.evaluate(() => (window as any).__tsE2E?.getScoringWalk?.() ?? null);
}

export async function getPrompts(page: Page) {
  return page.evaluate(() => (window as any).__tsE2E?.getPrompts?.() ?? []);
}

export async function getAttachments(page: Page) {
  return page.evaluate(() => (window as any).__tsE2E?.getAttachments?.() ?? {});
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

export async function debugAct(page: Page, act: DebugE2EAct) {
  await waitForE2E(page);
  await page.evaluate((a) => {
    const api = (window as any).__tsE2E;
    if (!api?.debugAct) throw new Error("__tsE2E.debugAct not available");
    api.debugAct(a);
  }, act);
  await page.waitForTimeout(200);
}

/** Enter scoring phase (debugSeed only) and wait for walk or gameOver. */
export async function forceScoring(page: Page) {
  await debugAct(page, { op: "forceScoring" });
  await page.waitForFunction(
    () => {
      const api = (window as any).__tsE2E;
      const ph = api
        ? (typeof api.getPhase === "function" ? api.getPhase() : null) ??
          api.phase ??
          api.getG?.()?.phase ??
          ""
        : "";
      if (ph === "scoring" || ph === "gameOver") return true;
      // UI fallback: scoring desk / dual-ack chrome (harness may be mid re-bind)
      const t = document.body.innerText || "";
      if (/G\.phase:\s*(scoring|gameOver)/i.test(t)) return true;
      if (/Scoring\s*[—–-]/.test(t)) return true;
      if (api?.getScoringWalk?.()) return true;
      return false;
    },
    null,
    { timeout: 20_000 },
  );
  // Ensure harness rebound after phase change
  await waitForE2E(page);
}

/** Answer a score prompt as an explicit seat (P0 or P1). */
export async function scoreChoiceAs(
  page: Page,
  playerId: string,
  promptId: string,
  value: string | string[],
) {
  await debugAct(page, {
    op: "scoreChoice",
    playerId,
    promptId,
    value,
  });
}

/** Dual-ack current score step from both seats. */
export async function ackAll(page: Page) {
  await debugAct(page, { op: "ackAll" });
}

/** Auto-resolve remaining scoring walk (default first options + dual-ack). */
export async function finishScoring(page: Page, maxSteps = 100) {
  await debugAct(page, { op: "finishScoring", maxSteps });
  await page.waitForTimeout(200);
}

export async function reactAs(
  page: Page,
  playerId: string,
  promptId: string,
  value: string | string[],
) {
  await debugAct(page, { op: "react", playerId, promptId, value });
}

/**
 * Drive interactive scoring until gameOver or guard.
 * For each choice, uses `chooser(prompt)` if provided, else first option / empty if min=0.
 */
export async function driveScoring(
  page: Page,
  chooser?: (prompt: {
    id: string;
    deciderId: string;
    options: string[];
    min: number;
    max: number;
    reason: string;
  }) => string | string[] | undefined,
  maxSteps = 80,
) {
  for (let i = 0; i < maxSteps; i++) {
    const phase = await getPhase(page);
    if (phase === "gameOver") return;
    if (phase !== "scoring") return;

    const walk = await getScoringWalk(page);
    const prompts = await getPrompts(page);
    if (walk?.stepPhase === "choice" && prompts[0]) {
      const front = prompts[0];
      const custom = chooser?.(front);
      const value =
        custom !== undefined
          ? custom
          : front.min === 0
            ? ""
            : front.options?.[0] ?? "";
      await scoreChoiceAs(page, String(front.deciderId), front.id, value);
      continue;
    }
    if (walk?.stepPhase === "ack" || !prompts.length) {
      await ackAll(page);
      continue;
    }
    // No walk info — try finishScoring fallback
    await finishScoring(page, 20);
    return;
  }
}
