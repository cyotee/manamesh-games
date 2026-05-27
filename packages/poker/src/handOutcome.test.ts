import { describe, it, expect } from "vitest";
import { getAddress, pad, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildSettlement, type SettleableHandState } from "./handOutcome";
import { settlerDomain, signHandOutcome, recoverHandOutcomeSigner } from "./signing";
import type { PokerCard } from "./types";

const alice = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const ALICE = getAddress(alice.address); // 0x7099...
const BOB = pad("0x01", { size: 20 }) as Hex; // sorts before ALICE

function card(rank: string, suit: string): PokerCard {
  return { rank, suit, id: `${suit}-${rank}`, name: `${rank} of ${suit}` } as PokerCard;
}

// Alice wins the 200-chip pot; Bob folded/lost.
const state: SettleableHandState = {
  players: {
    "0": { chips: 200, folded: false, hand: [card("A", "hearts"), card("K", "hearts")] },
    "1": { chips: 0, folded: true, hand: [card("2", "clubs"), card("3", "diamonds")] },
  },
  startingChips: { "0": 100, "1": 100 },
  winners: ["0"],
  community: [card("Q", "hearts"), card("J", "hearts"), card("10", "hearts"), card("2", "spades"), card("3", "spades")],
};

const opts = { addresses: { "0": ALICE, "1": BOB }, handId: pad("0x01", { size: 32 }) as Hex, rakeBps: 250 };

describe("buildHandOutcome", () => {
  it("conserves the pot: sum(finalStacks) + rake == pot", () => {
    const { outcome: o } = buildSettlement(state, opts);
    const rake = (o.pot * 250n) / 10_000n;
    const stackSum = o.finalStacks.reduce((a, b) => a + b, 0n);
    expect(o.pot).toBe(200n);
    expect(stackSum + rake).toBe(o.pot);
  });

  it("sorts players ascending by address with parallel arrays", () => {
    const { outcome: o, players, buyIns } = buildSettlement(state, opts);
    expect(players).toEqual([getAddress(BOB), ALICE]); // BOB < ALICE
    expect(buyIns).toEqual([100n, 100n]); // for the matching HandInit
    expect(o.finalStacks).toEqual([0n, 195n]); // bob 0, alice 200-5 rake
    // hole cards parallel: bob then alice; A=14,K=13; hearts=2,clubs=0,diamonds=1
    expect(o.holeCards).toEqual([
      [(2 << 4) | 0, (3 << 4) | 1],
      [(14 << 4) | 2, (13 << 4) | 2],
    ]);
  });

  it("maps winners + payouts and encodes community cards", () => {
    const { outcome: o } = buildSettlement(state, opts);
    expect(o.winners).toEqual([ALICE]);
    expect(o.payouts).toEqual([195n]);
    expect(o.communityCards).toEqual([
      (12 << 4) | 2,
      (11 << 4) | 2,
      (10 << 4) | 2,
      (2 << 4) | 3,
      (3 << 4) | 3,
    ]);
  });

  it("applies the scale multiplier to token base units", () => {
    const { outcome: o } = buildSettlement(state, { ...opts, scale: 10n ** 18n });
    expect(o.pot).toBe(200n * 10n ** 18n);
    expect(o.finalStacks.reduce((a, b) => a + b, 0n)).toBe(195n * 10n ** 18n);
  });

  it("produces a signable HandOutcome (winner can sign + recover)", async () => {
    const { outcome: o } = buildSettlement(state, opts);
    const domain = settlerDomain(31337, pad("0xdead", { size: 20 }) as Hex);
    const sig = await signHandOutcome(alice, domain, o);
    expect(await recoverHandOutcomeSigner(domain, o, sig)).toBe(ALICE);
  });

  it("throws when an address mapping is missing", () => {
    expect(() => buildSettlement(state, { ...opts, addresses: { "0": ALICE } })).toThrow(/No address/);
  });
});
