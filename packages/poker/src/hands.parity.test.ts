/**
 * S7 — Hand evaluation TS ↔ Solidity parity
 *
 * Shared vectors: `test-vectors/hand-eval-parity.json`
 * Foundry twin: `tests/foundry/verifier/PokerHandEvaluator_parity.t.sol`
 *
 * ## Packing convention (must match both stacks)
 *
 * ```
 * uint8 card = (rank << 4) | suit
 * ```
 *
 * | Field | Range | Meaning |
 * |-------|-------|---------|
 * | rank  | 2..14 | 14 = Ace (high). Matches `RANK_VALUES` / Solidity evaluator. |
 * | suit  | 0..3  | 0=clubs, 1=diamonds, 2=hearts, 3=spades (`SUIT_VALUES` / `encodeCard`). |
 *
 * On-chain path uses the same packing via `encodeCard` in `handOutcome.ts`.
 * TS gameplay cards use string ids (`spades-A`); this suite unpacks packed
 * bytes only for cross-stack comparison.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  evaluateHand,
  compareHands,
  determineWinners,
} from "./hands";
import { encodeCard } from "./handOutcome";
import {
  HandRank,
  RANK_VALUES,
  SUIT_VALUES,
  type PokerCard,
} from "./types";

// ---------------------------------------------------------------------------
// Packing helpers (documented above; keep in sync with Solidity `_c(rank,suit)`)
// ---------------------------------------------------------------------------

const RANK_BY_VALUE: Record<number, PokerCard["rank"]> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

const SUIT_BY_VALUE: Record<number, PokerCard["suit"]> = {
  0: "clubs",
  1: "diamonds",
  2: "hearts",
  3: "spades",
};

/** Decode on-chain packed card byte → PokerCard. */
export function unpackCard(packed: number): PokerCard {
  const rankVal = (packed >> 4) & 0x0f;
  const suitVal = packed & 0x0f;
  const rank = RANK_BY_VALUE[rankVal];
  const suit = SUIT_BY_VALUE[suitVal];
  if (!rank || !suit) {
    throw new Error(`Invalid packed card 0x${packed.toString(16)} (rank=${rankVal} suit=${suitVal})`);
  }
  return {
    id: `${suit}-${rank}`,
    name: `${rank} of ${suit}`,
    rank,
    suit,
  };
}

function unpackSeven(packed: number[]): PokerCard[] {
  if (packed.length !== 7) {
    throw new Error(`Expected 7 packed cards, got ${packed.length}`);
  }
  return packed.map(unpackCard);
}

type Expected = "A_wins" | "B_wins" | "tie";

interface ParityVector {
  id: string;
  description: string;
  handA: number[];
  handB: number[];
  expected: Expected;
}

interface ParityFile {
  packing: {
    format: string;
    rank: string;
    suit: string;
    notes: string[];
  };
  vectors: ParityVector[];
}

const here = dirname(fileURLToPath(import.meta.url));
const vectorPath = join(here, "../test-vectors/hand-eval-parity.json");
const parity: ParityFile = JSON.parse(readFileSync(vectorPath, "utf8"));

function cmpToExpected(cmp: number): Expected {
  if (cmp > 0) return "A_wins";
  if (cmp < 0) return "B_wins";
  return "tie";
}

describe("S7 hand-eval packing convention", () => {
  it("encodeCard matches (rank<<4)|suit for all ranks and suits", () => {
    for (const [rankName, rankVal] of Object.entries(RANK_VALUES)) {
      for (const [suitName, suitVal] of Object.entries(SUIT_VALUES)) {
        const card: PokerCard = {
          id: `${suitName}-${rankName}`,
          name: `${rankName} of ${suitName}`,
          rank: rankName as PokerCard["rank"],
          suit: suitName as PokerCard["suit"],
        };
        const packed = encodeCard(card);
        expect(packed).toBe((rankVal << 4) | suitVal);
        expect(unpackCard(packed)).toMatchObject({
          rank: rankName,
          suit: suitName,
        });
      }
    }
  });

  it("vector file documents packing and has non-empty cases", () => {
    expect(parity.packing.format).toContain("rank << 4");
    expect(parity.vectors.length).toBeGreaterThanOrEqual(6);
  });
});

describe("S7 hand-eval parity vectors (TS)", () => {
  it.each(parity.vectors.map((v) => [v.id, v] as const))(
    "%s",
    (_id, vector) => {
      const handA = evaluateHand(unpackSeven(vector.handA));
      const handB = evaluateHand(unpackSeven(vector.handB));
      const cmp = compareHands(handA, handB);
      expect(cmpToExpected(cmp), vector.description).toBe(vector.expected);
    }
  );

  it("determineWinners agrees with pairwise expected for each vector", () => {
    for (const vector of parity.vectors) {
      const playerHands = new Map([
        ["A", evaluateHand(unpackSeven(vector.handA))],
        ["B", evaluateHand(unpackSeven(vector.handB))],
      ]);
      const winners = determineWinners(playerHands);
      if (vector.expected === "tie") {
        expect(winners.sort(), vector.id).toEqual(["A", "B"]);
      } else if (vector.expected === "A_wins") {
        expect(winners, vector.id).toEqual(["A"]);
      } else {
        expect(winners, vector.id).toEqual(["B"]);
      }
    }
  });
});

describe("S7 category sanity (TS categories for named vectors)", () => {
  it("royal_vs_junk: A is royal, B is high card", () => {
    const v = parity.vectors.find((x) => x.id === "royal_vs_junk")!;
    expect(evaluateHand(unpackSeven(v.handA)).rank).toBe(HandRank.ROYAL_FLUSH);
    expect(evaluateHand(unpackSeven(v.handB)).rank).toBe(HandRank.HIGH_CARD);
  });

  it("wheel_vs_broadway: both straights; broadway higher", () => {
    const v = parity.vectors.find((x) => x.id === "wheel_vs_broadway")!;
    const a = evaluateHand(unpackSeven(v.handA));
    const b = evaluateHand(unpackSeven(v.handB));
    expect(a.rank).toBe(HandRank.STRAIGHT);
    expect(b.rank).toBe(HandRank.STRAIGHT);
    expect(a.values[0]).toBe(5);
    expect(b.values[0]).toBe(14);
  });

  it("three_pair_collapse: both two pair", () => {
    const v = parity.vectors.find((x) => x.id === "three_pair_collapse")!;
    expect(evaluateHand(unpackSeven(v.handA)).rank).toBe(HandRank.TWO_PAIR);
    expect(evaluateHand(unpackSeven(v.handB)).rank).toBe(HandRank.TWO_PAIR);
  });

  it("full house / flush / quads categories", () => {
    const quads = parity.vectors.find((x) => x.id === "quads_vs_full_house")!;
    const fhFlush = parity.vectors.find((x) => x.id === "full_house_vs_flush")!;
    expect(evaluateHand(unpackSeven(quads.handA)).rank).toBe(HandRank.FOUR_OF_A_KIND);
    expect(evaluateHand(unpackSeven(quads.handB)).rank).toBe(HandRank.FULL_HOUSE);
    expect(evaluateHand(unpackSeven(fhFlush.handA)).rank).toBe(HandRank.FULL_HOUSE);
    expect(evaluateHand(unpackSeven(fhFlush.handB)).rank).toBe(HandRank.FLUSH);
  });
});
