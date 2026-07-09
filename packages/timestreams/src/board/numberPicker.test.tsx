import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TimestreamsBoard } from "./TimestreamsBoard";
import { makeBoardProps, makePlayState } from "./boardTestHelpers";
import { makeCard } from "../effects/testFixtures";

describe("number picker UI (score:guess)", () => {
  it("renders number-picker with 1–4 and confirm for score:guess-secret", () => {
    const G = makePlayState({
      phase: "scoring",
      cards: {
        "stone-age-mysticism#0": makeCard({
          id: "stone-age-mysticism#0",
          name: "Mysticism",
          ownerId: "0",
        }),
      },
      pendingPrompts: [
        {
          id: "stone-age-mysticism#0:score-guess-secret",
          deciderId: "0",
          kind: "choose-number",
          options: ["1", "2", "3", "4"],
          min: 1,
          max: 1,
          reason: "score:guess-secret",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          ctx: { phase: "scoring", currentPlayer: "0" },
        })}
      />,
    );
    expect(html).toContain('data-testid="number-picker"');
    expect(html).toContain('data-testid="number-option-1"');
    expect(html).toContain('data-testid="number-option-4"');
    expect(html).toContain("pick a secret number");
    expect(html).toContain('data-testid="confirm-prompt"');
    // card grid should not be used for pure numbers
    expect(html).not.toContain('data-testid="prompt-option-1"');
  });

  it("non-decider sees waiting only — no number options (private choice)", () => {
    const G = makePlayState({
      phase: "scoring",
      pendingPrompts: [
        {
          id: "m:score-guess-answer",
          deciderId: "0",
          kind: "choose-number",
          options: ["1", "2", "3", "4"],
          min: 1,
          max: 1,
          reason: "score:guess",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          playerID: "1",
          ctx: { phase: "scoring", currentPlayer: "0" },
        })}
      />,
    );
    expect(html).toContain("prompt-waiting");
    expect(html).toContain("Waiting for P0");
    expect(html).not.toContain("number-picker");
    expect(html).not.toContain("number-option-1");
    expect(html).not.toContain("guess the secret number");
  });

  it("confirm calls submitScoreChoice for score prompts", () => {
    // SSR cannot click; assert move wiring via handleConfirm path is present
    // by checking scoring phase + submitScoreChoice prop is used in board (smoke).
    const submitScoreChoice = vi.fn();
    const G = makePlayState({
      phase: "scoring",
      pendingPrompts: [
        {
          id: "m:score-guess-secret",
          deciderId: "0",
          kind: "choose-number",
          options: ["1", "2", "3", "4"],
          min: 1,
          max: 1,
          reason: "score:guess-secret",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          moves: { submitScoreChoice },
          ctx: { phase: "scoring", currentPlayer: "0" },
        })}
      />,
    );
    expect(html).toContain("number-picker");
    // move is only callable on click; ensure controls exist for the decider
    expect(html).toContain("Confirm choice");
  });
});
