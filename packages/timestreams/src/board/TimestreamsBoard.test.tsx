import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TimestreamsBoard, playedCardIdFromPromptId } from "./TimestreamsBoard";
import {
  makeBoardProps,
  makePlayState,
  makeSetupState,
  cardInHand,
  makeCard,
} from "./boardTestHelpers";
import { playAction } from "../play";
import { createTimeline } from "../timeline";

describe("TimestreamsBoard — baseline & lifecycle (plan Phase 0.5 / 5.A)", () => {
  it("renders six era columns, day indicator, rules toggle", () => {
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps()} />);
    expect(html).toContain("Stone");
    expect(html).toContain("Future");
    expect((html.match(/ts-era-column/g) ?? []).length).toBe(6);
    expect(html).toContain("Day 1");
    expect(html).toContain("Teaching mode: Always show your hand");
    expect(html).toContain("Card detail");
    expect(html).toContain("Rules engine");
    expect(html).toContain('data-testid="rules-midgame-toggle"');
    expect(html).toContain('data-testid="rules-engine-toggle-btn"');
  });

  it("highlights active era for day 2 (Medieval)", () => {
    const html = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G: { currentDay: 2 } })} />,
    );
    expect(html).toContain("Medieval");
    expect((html.match(/slot|Slots/gi) ?? []).length).toBeGreaterThan(0);
  });

  it("renders hand cards with play controls when it is my turn", () => {
    const G = makePlayState();
    cardInHand(G, "0", {
      id: "test-card#0",
      name: "Test Card",
      cardType: "invention",
    });
    const html = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G })} />,
    );
    expect(html).toContain("Test Card");
    expect(html).toContain("Play Invention");
    expect(html).toContain("Pass");
    expect(html).toContain("YOUR TURN");
    expect(html).toContain('data-testid="player-hand"');
  });

  it("setup phase shows claim UI and disabled Ready without era", () => {
    const G = makeSetupState();
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          ctx: { phase: "setup", currentPlayer: "0" },
        })}
      />,
    );
    expect(html).toContain("Claim Your Home Era");
    expect(html).toContain('data-testid="setup-claim"');
    expect(html).toContain('data-testid="set-ready"');
    expect(html).toContain("disabled");
  });

  it("setup with my era claimed enables Ready label path", () => {
    const G = makeSetupState({
      players: {
        "0": {
          homeEra: "stone",
          ready: false,
          hand: [],
          discard: [],
          scorePile: [],
          hasPassedThisDay: false,
          publicKey: null,
          hasEncrypted: false,
          hasShuffled: false,
        },
        "1": {
          homeEra: null,
          ready: false,
          hand: [],
          discard: [],
          scorePile: [],
          hasPassedThisDay: false,
          publicKey: null,
          hasEncrypted: false,
          hasShuffled: false,
        },
      },
    });
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({ G, ctx: { phase: "setup", currentPlayer: "0" } })}
      />,
    );
    expect(html).toContain("Set Ready");
    expect(html).toContain("Home: Stone Age");
  });

  it("shows pack banner when packName is set", () => {
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G: {
            phase: "setup",
            packName: "Timestreams - Core Scanned",
            packCatalog: { stone: [{ id: "x", name: "X", front: "/x.png" }] as any },
            players: {
              "0": {
                homeEra: null,
                ready: false,
                hand: [],
                discard: [],
                scorePile: [],
                hasPassedThisDay: false,
                publicKey: null,
                hasEncrypted: false,
                hasShuffled: false,
              },
              "1": {
                homeEra: null,
                ready: false,
                hand: [],
                discard: [],
                scorePile: [],
                hasPassedThisDay: false,
                publicKey: null,
                hasEncrypted: false,
                hasShuffled: false,
              },
            },
          },
          ctx: { phase: "setup" },
        })}
      />,
    );
    expect(html).toContain("Timestreams - Core Scanned");
  });

  it("disables invent/pass for non-current player", () => {
    const G = makePlayState();
    cardInHand(G, "1", {
      id: "p1-card",
      name: "Opp Card",
      cardType: "invention",
    });
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          playerID: "1",
          ctx: { currentPlayer: "0", phase: "play" },
        })}
      />,
    );
    expect(html).not.toContain("YOUR TURN");
    expect(html).toContain("Waiting for P0");
  });

  it("after invention in G, timeline stack shows the card name", () => {
    const G = makePlayState({ currentDay: 1 });
    const inv = makeCard({
      id: "stone-wheel",
      name: "The Wheel",
      ownerId: "0",
      cardType: "invention",
    });
    G.cards = { [inv.id]: inv };
    G.timeline = createTimeline();
    G.timeline.stone.stack.push(inv.id);
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps({ G })} />);
    expect(html).toContain("The Wheel");
    expect(html).toContain("Capacity: 6");
  });

  it("shows Slow Time as era action (not a scoring slot) and +2 slots", () => {
    const G = makePlayState({ currentDay: 1 });
    const slow = makeCard({
      id: "stone-age-slow-time#0",
      name: "Slow Time",
      ownerId: "0",
      cardType: "action",
      tags: ["play:scope:today", "score:add-scoring-slots:2"],
    });
    const inv = makeCard({
      id: "stone-age-fire#0",
      name: "Fire",
      ownerId: "0",
      cardType: "invention",
    });
    G.cards = { [slow.id]: slow, [inv.id]: inv };
    G.timeline = createTimeline();
    G.timeline.stone.stack = [inv.id];
    G.timeline.stone.actions = [slow.id];
    G.config = { ...G.config, scoringSlots: 6 } as any;
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps({ G })} />);
    expect(html).toContain('data-scoring-slots="8"');
    expect(html).toContain("Capacity: 8");
    expect(html).toContain("base 6");
    expect(html).toContain("+2 Slow Time");
    expect(html).toContain("On era (actions)");
    expect(html).toContain(`data-testid="era-action-${slow.id}"`);
    // Slow Time is not listed as scoring-slot item "1. Slow Time"
    expect(html).not.toMatch(/1\.\s*Slow Time/);
    expect(html).toContain("1. Fire");
  });

  it("shows attached cards indented under host in era column (Hibernation)", () => {
    const G = makePlayState({ currentDay: 1 });
    const host = makeCard({
      id: "stone-age-fire#0",
      name: "Fire",
      ownerId: "0",
      cardType: "invention",
    });
    const hib = makeCard({
      id: "stone-age-hibernation#0",
      name: "Hibernation",
      ownerId: "0",
      cardType: "action",
    });
    G.cards = { [host.id]: host, [hib.id]: hib };
    G.timeline = createTimeline();
    G.timeline.stone.stack = [host.id];
    G.attachments = { [host.id]: [hib.id] };
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps({ G })} />);
    expect(html).toContain("Fire");
    expect(html).toContain("- Hibernation");
    expect(html).toContain(`data-testid="timeline-attachment-${hib.id}"`);
    expect(html).toContain(`data-host="${host.id}"`);
    // Attachment appears after host name in the same column
    const hostIdx = html.indexOf("Fire");
    const attIdx = html.indexOf("- Hibernation");
    expect(attIdx).toBeGreaterThan(hostIdx);
  });

  it("rules OFF shows banner", () => {
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G: { config: { rulesEnabled: false } as any },
        })}
      />,
    );
    expect(html).toMatch(/Rules engine\s+OFF|structural play only/i);
  });
});

describe("TimestreamsBoard — prompts (plan L3 / 1.A.1)", () => {
  it("renders search-deck prompt with options and confirm control", () => {
    const G = makePlayState();
    G.cards = {
      "future-tech-cloning": makeCard({
        id: "future-tech-cloning",
        name: "Cloning",
        ownerId: "0",
      }),
      "future-tech-nanotech": makeCard({
        id: "future-tech-nanotech",
        name: "Nanotech",
        ownerId: "0",
      }),
    };
    G.pendingPrompts = [
      {
        id: "future-tech-think-about-the-future:search-deck",
        deciderId: "0",
        kind: "choose-card",
        options: ["future-tech-cloning", "future-tech-nanotech"],
        min: 1,
        max: 1,
        reason: "play:search-deck",
      },
    ];
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps({ G })} />);
    expect(html).toContain('data-testid="rules-prompt"');
    expect(html).toContain("Search your deck");
    expect(html).toContain("Cloning");
    expect(html).toContain("Nanotech");
    expect(html).toContain('data-testid="confirm-prompt"');
    expect(html).toContain('data-testid="prompt-option-future-tech-cloning"');
  });

  it("engine + board: search-deck creates pendingPrompts then resolves into hand", () => {
    const G = makePlayState({ currentDay: 6 });
    G.phase = "play";
    const deckIds = ["future-tech-nanotech", "future-tech-cloning"];
    G.encryptedDecks["0"] = deckIds.map((id) => ({ ciphertext: id, layers: 0 }));
    G.cards = {};
    for (const id of deckIds) {
      G.cards[id] = makeCard({ id, name: id, ownerId: "0", cardType: "invention" });
    }
    const think = makeCard({
      id: "future-tech-think-about-the-future",
      name: "Think About The Future",
      ownerId: "0",
      cardType: "action",
      tags: ["play:search-deck", "play:to-hand", "play:shuffle-after"],
    });
    G.players["0"].hand = [think];
    G.cards[think.id] = think;

    playAction(G, { currentPlayer: "0" } as any, "0", think.id);
    expect(G.pendingPrompts?.length).toBe(1);

    const mid = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, ctx: { currentPlayer: "0", phase: "play" } })} />,
    );
    expect(mid).toContain("rules-prompt");
    expect(mid).toContain("Search your deck");

    playAction(G, { currentPlayer: "0" } as any, "0", think.id, {
      [`${think.id}:search-deck`]: "future-tech-cloning",
    });
    expect(G.pendingPrompts ?? []).toEqual([]);
    expect(G.players["0"].hand.map((c) => c.id)).toContain("future-tech-cloning");

    const after = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, ctx: { currentPlayer: "0", phase: "play" } })} />,
    );
    expect(after).not.toContain("Search your deck");
    expect(after).toContain("future-tech-cloning"); // in hand display via name
  });

  it("non-decider sees waiting only — no option grid or card names", () => {
    const G = makePlayState();
    G.cards = {
      secret: makeCard({ id: "secret", name: "Secret Deck Card", ownerId: "0" }),
    };
    G.pendingPrompts = [
      {
        id: "x:search-deck",
        deciderId: "0",
        kind: "choose-card",
        options: ["secret"],
        min: 1,
        max: 1,
        reason: "play:search-deck",
      },
    ];
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          playerID: "1",
          ctx: { currentPlayer: "0", phase: "play" },
        })}
      />,
    );
    expect(html).toContain("prompt-waiting");
    expect(html).toContain("Waiting for P0");
    expect(html).not.toContain("Secret Deck Card");
    expect(html).not.toContain("confirm-prompt");
    expect(html).not.toContain("prompt-option-secret");
  });

  it("playedCardIdFromPromptId strips attach-host / search-deck suffixes", () => {
    expect(playedCardIdFromPromptId("stone-age-hibernation#0:attach-host")).toBe(
      "stone-age-hibernation#0",
    );
    expect(playedCardIdFromPromptId("future-tech-think-about-the-future:search-deck")).toBe(
      "future-tech-think-about-the-future",
    );
  });

  it("Shell Game prompt advertises two-card multi-select", () => {
    const G = makePlayState({ currentDay: 1 });
    G.cards = {
      "a#0": makeCard({ id: "a#0", name: "Fire", ownerId: "0" }),
      "b#0": makeCard({ id: "b#0", name: "Pottery", ownerId: "0" }),
      "c#0": makeCard({ id: "c#0", name: "Wheel", ownerId: "0" }),
    };
    G.pendingPrompts = [
      {
        id: "stone-age-shell-game#0:swap-pair",
        deciderId: "0",
        kind: "choose-card",
        options: ["a#0", "b#0", "c#0"],
        min: 2,
        max: 2,
        reason: "swap:count:2",
      },
    ];
    const html = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "0" })} />,
    );
    expect(html.toLowerCase()).toContain("choose two inventions");
    expect(html.toLowerCase()).toContain("exactly two inventions");
    expect(html).toContain('data-testid="prompt-option-a#0"');
    expect(html).toContain('data-testid="prompt-option-b#0"');
    // Confirm disabled until two picks (no selection yet)
    expect(html).toMatch(/data-testid="confirm-prompt"[^>]*disabled/);
  });

  it("copy choice prompt labels use labelCardId tags (Laser via Biotechnology)", () => {
    const laser = makeCard({
      id: "future-tech-high-powered-laser#0",
      name: "High-powered Laser",
      ownerId: "1",
      tags: [
        "play:choice",
        "option-a:draw:2",
        "option-b:discard:1",
        "option-b:discard:target:any-card",
        "option-b:discard:scope:today-or-tomorrow",
      ],
    });
    const bio = makeCard({
      id: "future-tech-biotechnology#0",
      name: "Biotechnology",
      ownerId: "0",
      tags: ["play:copy"],
    });
    const G = makePlayState({ currentDay: 6 });
    G.cards = { [laser.id]: laser, [bio.id]: bio };
    G.pendingPrompts = [
      {
        id: `${bio.id}:option`,
        deciderId: "0",
        kind: "choose-option",
        options: ["option-a", "option-b"],
        min: 1,
        max: 1,
        reason: "play:choice",
        labelCardId: laser.id,
      } as any,
    ];
    const html = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "0" })} />,
    );
    expect(html).toContain("Draw 2 cards");
    expect(html).toMatch(/Discard 1 card.*Today or Tomorrow/i);
    expect(html).not.toMatch(/>option-a</);
    expect(html).not.toMatch(/>option-b</);
  });
});

describe("TimestreamsBoard — hand layout controls", () => {
  it("renders group/sort controls and stack badge when grouped", () => {
    const fire0 = makeCard({
      id: "fire#0",
      name: "Fire",
      ownerId: "0",
      cardType: "invention",
      scoreValue: 2,
    });
    const fire1 = makeCard({
      id: "fire#1",
      name: "Fire",
      ownerId: "0",
      cardType: "invention",
      scoreValue: 2,
    });
    const G = makePlayState({ currentDay: 1 });
    G.players["0"].hand = [fire0, fire1];
    const html = renderToStaticMarkup(
      <TimestreamsBoard {...makeBoardProps({ G, playerID: "0" })} />,
    );
    expect(html).toContain('data-testid="hand-layout-controls"');
    expect(html).toContain('data-testid="hand-group-toggle"');
    expect(html).toContain('data-testid="hand-sort-key"');
  });
});

describe("TimestreamsBoard — scoring / game over display (plan 5.D)", () => {
  it("shows iterative scoring walk banner and ack control", () => {
    const G = makePlayState({
      phase: "scoring",
      scores: { "0": 0, "1": 0 },
      scoringWalk: {
        steps: [
          { eraId: "stone", slotIndex: 0, cardId: "s#0", kind: "slot" },
        ],
        stepIndex: 0,
        stepPhase: "ack",
        acks: { "0": false, "1": false },
        processedCardIds: [],
        currentCardId: "s#0",
        lastSummary:
          "stone · slot 1 · Fire · P0 +3 (running 3; totals finalize after all cards)",
        erasCompleted: [],
        provisionalScores: { "0": 3, "1": 0 },
        bonusPoints: { "0": 0, "1": 0 },
        activeEraId: "stone",
        eraSlotTotal: 6,
        remainingSlots: 5,
        slotsUsedInEra: 1,
        eraActionsPhase: false,
      },
      cards: {
        "s#0": makeCard({ id: "s#0", name: "Fire", ownerId: "0" }),
      },
    } as any);
    G.timeline.stone.stack = ["s#0"];
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({
          G,
          playerID: "0",
          ctx: { phase: "scoring", currentPlayer: "0" },
          moves: { ackScoreStep: () => {} },
        })}
      />,
    );
    expect(html).toContain('data-testid="scoring-walk-banner"');
    expect(html).toContain("OK — next card");
    expect(html).toContain("stone · slot 1");
    expect(html).toContain('data-scoring-current="true"');
    expect(html).toContain('data-testid="score-inventory"');
    expect(html).toContain('data-testid="score-total-0"');
    expect(html).toContain("Score pile");
    expect(html).toContain("Bonus points");
    expect(html).toContain("totals finalize after all cards");
  });

  it("shows scores and winner when phase is gameOver", () => {
    const G = makePlayState({
      phase: "gameOver",
      scores: { "0": 12, "1": 7 },
      winner: "0",
    });
    const html = renderToStaticMarkup(
      <TimestreamsBoard
        {...makeBoardProps({ G, ctx: { phase: "gameOver", currentPlayer: "0" } })}
      />,
    );
    expect(html).toMatch(/game over|winner|score/i);
    expect(html).toContain("12");
    expect(html).toContain("7");
  });
});
