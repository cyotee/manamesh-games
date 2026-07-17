/**
 * S1 — Multi-street crypto hand → settlement artifact (adversarial / integration).
 *
 * Happy path: setup → progressive peek all seats → flop/turn/river deal+peel →
 * buildHandResult + buildSettlement with real card ids (no "unknown").
 *
 * Negative: aborted decrypt → buildHandResult.abortedDecrypt.
 *
 * Note: dealCommunityCards pushes placeholders into G.community and
 * processCommunityCardDecrypt appends revealed cards; settlement uses
 * zone-recovered real cards (and peeked hole cards) so artifacts stay clean.
 */

import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";
import { pad, type Hex } from "viem";
import {
  runMentalPokerSetup,
  progressiveCoopPeekHand,
  progressiveCoopPeekZone,
  mockCtx,
  type PlayerKeys,
} from "./mentalPoker.harness";
import {
  dealCommunityCards,
  buildHandResult,
  voteAbortDecrypt,
  canAbortDecryptNow,
  POKER_DECRYPT_STALL_WINDOW_MOVES,
  type CryptoPokerState,
} from "./crypto";
import { buildSettlement, type SettleableHandState } from "./handOutcome";
import { parseCardId, type PokerCard } from "./types";

/** Recover plaintext cards from a fully peeled encrypted zone. */
function recoverZoneCardIds(
  G: CryptoPokerState,
  zoneId: string,
): PokerCard[] {
  const zone = G.crypto.encryptedZones[zoneId] ?? [];
  const cards: PokerCard[] = [];
  for (const enc of zone) {
    expect(enc.layers).toBe(0);
    const entry = Object.entries(G.crypto.cardPointLookup).find(
      ([, pt]) =>
        pt === enc.ciphertext ||
        pt.toLowerCase() === enc.ciphertext.toLowerCase(),
    );
    expect(entry).toBeDefined();
    const id = entry![0];
    expect(id).not.toBe("unknown");
    expect(G.cardIds).toContain(id);
    const parsed = parseCardId(id);
    expect(parsed).not.toBeNull();
    cards.push({
      id,
      rank: parsed!.rank as PokerCard["rank"],
      suit: parsed!.suit as PokerCard["suit"],
    });
  }
  return cards;
}

function dealAndPeelCommunity(
  G: CryptoPokerState,
  players: PlayerKeys[],
  count: number,
): CryptoPokerState {
  const n = players.length;
  const startLen = G.crypto.encryptedZones["community"]?.length ?? 0;
  dealCommunityCards(G, mockCtx("0", { numPlayers: n }), count);
  const endLen = G.crypto.encryptedZones["community"]!.length;
  expect(endLen).toBe(startLen + count);
  const indices = Array.from({ length: count }, (_, i) => startLen + i);
  return progressiveCoopPeekZone(G, players, "community", indices);
}

describe.each([2, 3] as const)(
  "S1 multi-street crypto → settlement — %i players",
  (n) => {
    it("setup → peeks → flop/turn/river peels → settleable artifact with real card ids", async () => {
      const { G, players } = await runMentalPokerSetup({ numPlayers: n });
      expect(G.phase).toBe("preflop");

      // Progressive peek every seat
      let state = G;
      for (let i = 0; i < n; i++) {
        state = progressiveCoopPeekHand(state, players, `${i}`);
        expect(state.players[`${i}`].hasPeeked).toBe(true);
        expect(state.players[`${i}`].peekedCards.length).toBe(2);
        for (const c of state.players[`${i}`].peekedCards) {
          expect(c.id).not.toBe("unknown");
          expect(G.cardIds).toContain(c.id);
        }
      }

      // Flop (3) → turn (1) → river (1)
      state.phase = "flop";
      state = dealAndPeelCommunity(state, players, 3);
      state.phase = "turn";
      state = dealAndPeelCommunity(state, players, 1);
      state.phase = "river";
      state = dealAndPeelCommunity(state, players, 1);

      expect(state.crypto.encryptedZones["community"]!.length).toBe(5);
      for (const c of state.crypto.encryptedZones["community"]!) {
        expect(c.layers).toBe(0);
      }

      const communityCards = recoverZoneCardIds(state, "community");
      expect(communityCards.length).toBe(5);
      for (const c of communityCards) {
        expect(c.id).not.toBe("unknown");
        expect(G.cardIds).toContain(c.id);
      }

      // Mutate chips/pot to a settleable shape (minimal betting stub)
      const buyIn = 100;
      for (let i = 0; i < n; i++) {
        state.startingChips[`${i}`] = buyIn;
        state.players[`${i}`].chips = i === 0 ? buyIn * n : 0;
        state.players[`${i}`].folded = i !== 0;
      }
      state.pot = buyIn * (n - 1);
      state.winners = ["0"];
      state.phase = "showdown";

      // buildHandResult
      const handResult = buildHandResult(state);
      expect(handResult.abortedDecrypt).toBeFalsy();
      expect(handResult.winners).toEqual(["0"]);
      expect(handResult.handId).toBe(state.handId);

      // buildSettlement with real hole + community cards
      const addresses: Record<string, Hex> = {};
      for (let i = 0; i < n; i++) {
        addresses[`${i}`] = pad(`0x${(0xa0 + i).toString(16)}`, {
          size: 20,
        }) as Hex;
      }
      const settleable: SettleableHandState = {
        players: Object.fromEntries(
          Array.from({ length: n }, (_, i) => {
            const id = `${i}`;
            return [
              id,
              {
                chips: state.players[id].chips,
                folded: state.players[id].folded,
                hand: state.players[id].peekedCards,
                peekedCards: state.players[id].peekedCards,
              },
            ];
          }),
        ),
        startingChips: { ...state.startingChips },
        winners: ["0"],
        community: communityCards,
      };

      const settlement = buildSettlement(settleable, {
        addresses,
        handId: pad("0x1", { size: 32 }) as Hex,
        rakeBps: 250,
      });

      expect(settlement.outcome.winners.length).toBe(1);
      expect(settlement.players.length).toBe(n);
      expect(settlement.buyIns.length).toBe(n);

      // Hole cards encoded from real peeks (non-zero for winner)
      const winnerAddr = addresses["0"];
      const winnerIdx = settlement.players.findIndex(
        (a) => a.toLowerCase() === winnerAddr.toLowerCase(),
      );
      expect(winnerIdx).toBeGreaterThanOrEqual(0);
      const [h0, h1] = settlement.outcome.holeCards[winnerIdx];
      expect(h0).not.toBe(0);
      expect(h1).not.toBe(0);

      // Community cards all non-zero and from real peels
      for (let i = 0; i < 5; i++) {
        expect(settlement.outcome.communityCards[i]).not.toBe(0);
      }

      // Conservation at TS layer
      const pot = settlement.outcome.pot;
      const rake = (pot * 250n) / 10_000n;
      const stackSum = settlement.outcome.finalStacks.reduce(
        (a, b) => a + b,
        0n,
      );
      expect(stackSum + rake).toBe(pot);

      // All hole card ids from peeks ⊆ original deck
      for (let i = 0; i < n; i++) {
        for (const c of state.players[`${i}`].peekedCards) {
          expect(G.cardIds).toContain(c.id);
        }
      }
    });
  },
);

describe("S1 negative: aborted decrypt flagged", () => {
  it("buildHandResult sets abortedDecrypt after voteAbortDecrypt", async () => {
    const { G } = await runMentalPokerSetup({ numPlayers: 2 });
    // Seed a stalled pending decrypt
    G.phase = "flop";
    G.decryptRequests.push({
      id: "s1-stall",
      requestingPlayer: "0",
      zoneId: "hand:0",
      cardIndices: [0, 1],
      timestamp: 0,
      status: "pending",
      approvals: { "0": true, "1": false },
      decryptionShares: {},
    } as any);

    const ctx = mockCtx("0", {
      numPlayers: 2,
      numMoves: POKER_DECRYPT_STALL_WINDOW_MOVES,
    });
    expect(canAbortDecryptNow(G, ctx)).toBe(true);
    const aborted = voteAbortDecrypt(G, ctx, "0");
    expect(aborted).not.toBe(INVALID_MOVE);
    const state = aborted as CryptoPokerState;
    expect(state.phase).toBe("voided");

    const result = buildHandResult(state);
    expect(result.abortedDecrypt).toBe(true);
    expect(result.winners).toEqual([]);
    expect(result.refusers).toBeDefined();
    expect(result.refusers).toContain("1");
  });
});
