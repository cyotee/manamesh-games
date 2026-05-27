import { encodeAbiParameters, getAddress, keccak256, type Hex } from "viem";
import { RANK_VALUES, SUIT_VALUES, type PokerCard } from "./types";
import type { HandOutcome } from "./signing";

/**
 * Minimal structural view of a finished poker hand that {buildHandOutcome}
 * reads. Both `PokerState` and `CryptoPokerState` satisfy it. `hand` holds the
 * revealed hole cards at showdown (crypto poker falls back to `peekedCards`).
 */
export interface SettleableHandState {
  players: Record<
    string,
    { chips: number; hand: PokerCard[]; folded: boolean; peekedCards?: PokerCard[] }
  >;
  /** Chips each player brought into the hand (their on-chain buy-in, pre-scale). */
  startingChips: Record<string, number>;
  /** Winning player IDs (subset of players). */
  winners: string[];
  /** Community cards revealed (0..5). */
  community: PokerCard[];
}

export interface BuildHandOutcomeOptions {
  /**
   * Maps boardgame.io player IDs to on-chain addresses. The game state carries
   * no addresses, so the integration layer (wallet) must supply them.
   */
  addresses: Record<string, Hex>;
  /** On-chain handId — `deriveHandId(handInit)` for the hand being settled. */
  handId: Hex;
  /** Rake in basis points; must match the oracle's `rakeBps` for the token. */
  rakeBps: number;
  /**
   * Multiplier from game chips to token base units (e.g. `10n ** 18n`). The
   * matching `HandInit.buyIns` MUST be `startingChips * scale` per player.
   */
  scale?: bigint;
  /** Opaque final-state commitment; computed deterministically if omitted. */
  finalStateHash?: Hex;
}

/**
 * The on-chain settlement payload: a `HandOutcome` plus the sorted `players`
 * and `buyIns` the caller needs to build the *matching* `HandInit` (the outcome's
 * `finalStacks`/`holeCards` are parallel to `players`).
 */
export interface BuiltSettlement {
  outcome: HandOutcome;
  /** Sorted player addresses — use as `HandInit.players`. */
  players: Hex[];
  /** Per-player buy-ins (scaled), parallel to `players` — use as `HandInit.buyIns`. */
  buyIns: bigint[];
}

const MAX_BPS = 10_000n;

/** Encodes a card as the on-chain `(rank << 4) | suit` byte. */
export function encodeCard(card: PokerCard): number {
  const rank = RANK_VALUES[card.rank];
  const suit = SUIT_VALUES[card.suit];
  if (rank === undefined || suit === undefined) {
    throw new Error(`Unmappable card: rank=${card.rank} suit=${card.suit}`);
  }
  return (rank << 4) | suit;
}

function holeCardsOf(p: { hand: PokerCard[]; peekedCards?: PokerCard[] }): [number, number] {
  const cards = p.hand.length >= 2 ? p.hand : (p.peekedCards ?? []);
  return [cards[0] ? encodeCard(cards[0]) : 0, cards[1] ? encodeCard(cards[1]) : 0];
}

/**
 * Maps a finished poker hand to an on-chain `HandOutcome` ready for EIP-712
 * signing and submission to `PokerHandSettler.settleHand`.
 *
 * `players` is sorted ascending by address (the on-chain convention) and every
 * parallel array (`finalStacks`, `holeCards`) follows that order. Rake is taken
 * out of the winners' stacks (proportional to net winnings) so the on-chain
 * conservation invariant `sum(finalStacks) + rake == pot` holds by construction.
 *
 * Returns the `HandOutcome` together with the sorted `players` + `buyIns` so the
 * caller can build the paired `HandInit` (same player order) and derive the
 * matching `handId`.
 */
export function buildSettlement(state: SettleableHandState, opts: BuildHandOutcomeOptions): BuiltSettlement {
  const scale = opts.scale ?? 1n;
  const ids = Object.keys(state.players);

  // Per-player records keyed by on-chain address.
  const records = ids.map((id) => {
    const addr = opts.addresses[id];
    if (!addr) throw new Error(`No address for player "${id}"`);
    const buyIn = BigInt(state.startingChips[id] ?? 0) * scale;
    const finalChips = BigInt(state.players[id].chips) * scale;
    return {
      id,
      address: getAddress(addr),
      buyIn,
      finalChips,
      winnings: finalChips > buyIn ? finalChips - buyIn : 0n,
      holeCards: holeCardsOf(state.players[id]),
    };
  });

  // Sort ascending by address (on-chain HandInit.players ordering).
  records.sort((a, b) => (BigInt(a.address) < BigInt(b.address) ? -1 : 1));

  const pot = records.reduce((acc, r) => acc + r.buyIn, 0n);
  const rake = (pot * BigInt(opts.rakeBps)) / MAX_BPS;

  // Deduct rake from winners proportional to net winnings so the stacks sum to
  // pot - rake. Any flooring remainder is taken from the largest winner.
  const totalWinnings = records.reduce((acc, r) => acc + r.winnings, 0n);
  const finalStacks = records.map((r) => r.finalChips);
  if (rake > 0n && totalWinnings > 0n) {
    let deducted = 0n;
    let largestIdx = 0;
    for (let i = 0; i < records.length; i++) {
      const share = (rake * records[i].winnings) / totalWinnings;
      finalStacks[i] -= share;
      deducted += share;
      if (records[i].winnings > records[largestIdx].winnings) largestIdx = i;
    }
    finalStacks[largestIdx] -= rake - deducted; // flooring remainder
  } else if (rake > 0n) {
    // No net winners (degenerate): take rake from the first player's stack.
    finalStacks[0] -= rake;
  }

  // Winners (address-sorted) + their payouts (final stacks).
  const winnerSet = new Set(state.winners.map((id) => getAddress(opts.addresses[id]!)));
  const winners: Hex[] = [];
  const payouts: bigint[] = [];
  records.forEach((r, i) => {
    if (winnerSet.has(r.address)) {
      winners.push(r.address);
      payouts.push(finalStacks[i]);
    }
  });

  const players = records.map((r) => r.address);
  const holeCards = records.map((r) => r.holeCards);
  const communityCards = [0, 1, 2, 3, 4].map((i) =>
    state.community[i] ? encodeCard(state.community[i]) : 0,
  ) as [number, number, number, number, number];

  const finalStateHash =
    opts.finalStateHash ??
    keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "address[]" },
          { type: "uint256[]" },
          { type: "uint8[2][]" },
          { type: "uint8[5]" },
        ],
        [opts.handId, players, finalStacks, holeCards, communityCards],
      ),
    );

  const outcome: HandOutcome = {
    handId: opts.handId,
    pot,
    winners,
    payouts,
    finalStacks,
    finalStateHash,
    holeCards,
    communityCards,
  };

  return { outcome, players, buyIns: records.map((r) => r.buyIn) };
}
