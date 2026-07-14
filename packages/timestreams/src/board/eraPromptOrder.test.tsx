/**
 * Multi-era choose-card prompts must list cards by era (ERA_ORDER) and
 * within each era in timeline stack order.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TimestreamsBoard } from "./TimestreamsBoard";
import { makeBoardProps, makePlayState } from "./boardTestHelpers";
import { makeCard } from "../effects/testFixtures";

describe("prompt options organized by era order", () => {
  it("groups and orders options by era stack positions", () => {
    const stoneLow = makeCard({
      id: "stone-low#0",
      name: "Fire",
      ownerId: "0",
      cardType: "invention",
    });
    const stoneHigh = makeCard({
      id: "stone-high#0",
      name: "Pottery",
      ownerId: "0",
      cardType: "invention",
    });
    const med = makeCard({
      id: "med#0",
      name: "Coinage",
      ownerId: "0",
      cardType: "invention",
    });
    const modern = makeCard({
      id: "mod#0",
      name: "Internet",
      ownerId: "0",
      cardType: "invention",
    });

    const G = makePlayState({ currentDay: 5 });
    // Stack order: bottom → top (index 0 is bottom / oldest)
    G.timeline.stone.stack = [stoneLow.id, stoneHigh.id];
    G.timeline.medieval.stack = [med.id];
    G.timeline.modern.stack = [modern.id];
    G.cards = {
      [stoneLow.id]: stoneLow,
      [stoneHigh.id]: stoneHigh,
      [med.id]: med,
      [modern.id]: modern,
    };
    // Options deliberately out of era/stack order
    G.pendingPrompts = [
      {
        id: "swap:pair",
        deciderId: "0",
        kind: "choose-card",
        options: [modern.id, stoneHigh.id, med.id, stoneLow.id],
        min: 2,
        max: 2,
        reason: "swap:count:2",
      },
    ];

    const html = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "0" })} />,
    );

    expect(html).toContain('data-testid="prompt-era-row-stone"');
    expect(html).toContain('data-testid="prompt-era-row-medieval"');
    expect(html).toContain('data-testid="prompt-era-row-modern"');

    const stoneIdx = html.indexOf('data-testid="prompt-era-row-stone"');
    const medIdx = html.indexOf('data-testid="prompt-era-row-medieval"');
    const modIdx = html.indexOf('data-testid="prompt-era-row-modern"');
    expect(stoneIdx).toBeGreaterThan(-1);
    expect(medIdx).toBeGreaterThan(stoneIdx);
    expect(modIdx).toBeGreaterThan(medIdx);

    // Within stone, stack order: low then high (not reverse of options array)
    const lowOpt = html.indexOf('data-testid="prompt-option-stone-low#0"');
    const highOpt = html.indexOf('data-testid="prompt-option-stone-high#0"');
    expect(lowOpt).toBeGreaterThan(stoneIdx);
    expect(highOpt).toBeGreaterThan(lowOpt);
  });
});
