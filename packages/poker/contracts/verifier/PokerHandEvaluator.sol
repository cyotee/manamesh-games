// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

// tag::PokerHandEvaluator[]
/**
 * @title PokerHandEvaluator - 7-card best-of-5 Texas Hold'em hand scorer.
 * @notice {evaluate} returns a single monotonic score: a strictly higher score
 *         means a strictly better 5-card hand, so winners are found by comparing
 *         scores. Cards encode as `(rank << 4) | suit`, rank 2..14 (14 = Ace),
 *         suit 0..3.
 * @dev Score layout (4 bits each, MSB first): [category | t1 | t2 | t3 | t4 | t5]
 *      where category 8=straight flush .. 0=high card and t1..t5 are rank
 *      tiebreakers. The wheel (A-2-3-4-5) is scored as a 5-high straight.
 */
library PokerHandEvaluator {
    uint256 private constant CAT_STRAIGHT_FLUSH = 8;
    uint256 private constant CAT_QUADS = 7;
    uint256 private constant CAT_FULL_HOUSE = 6;
    uint256 private constant CAT_FLUSH = 5;
    uint256 private constant CAT_STRAIGHT = 4;
    uint256 private constant CAT_TRIPS = 3;
    uint256 private constant CAT_TWO_PAIR = 2;
    uint256 private constant CAT_ONE_PAIR = 1;
    uint256 private constant CAT_HIGH_CARD = 0;

    // tag::evaluate(uint8[7])[]
    /// @notice Scores the best 5-card hand from 7 cards.
    function evaluate(uint8[7] memory cards) internal pure returns (uint256) {
        uint8[15] memory rankCount; // indexed by rank 2..14
        uint8[4] memory suitCount;
        for (uint256 i = 0; i < 7; ++i) {
            rankCount[cards[i] >> 4] += 1;
            suitCount[cards[i] & 0x0f] += 1;
        }

        // Straight flush: a straight within the flush suit's cards.
        int256 flushSuit = -1;
        for (uint8 s = 0; s < 4; ++s) {
            if (suitCount[s] >= 5) flushSuit = int256(uint256(s));
        }
        if (flushSuit >= 0) {
            bool[15] memory suitPresent;
            for (uint256 i = 0; i < 7; ++i) {
                if ((cards[i] & 0x0f) == uint8(uint256(flushSuit))) suitPresent[cards[i] >> 4] = true;
            }
            uint8 sfHigh = _straightHigh(suitPresent);
            if (sfHigh > 0) return _score(CAT_STRAIGHT_FLUSH, sfHigh, 0, 0, 0, 0);
        }

        // Collect trips and pairs in descending rank order.
        uint8[3] memory trips;
        uint256 nTrips;
        uint8[3] memory pairs;
        uint256 nPairs;
        for (uint8 r = 14; r >= 2; --r) {
            if (rankCount[r] == 4) {
                uint8 kicker = _nthHighest(rankCount, r, 0, 0, 1);
                return _score(CAT_QUADS, r, kicker, 0, 0, 0);
            }
            if (rankCount[r] == 3) {
                trips[nTrips++] = r;
            } else if (rankCount[r] == 2) {
                pairs[nPairs++] = r;
            }
            if (r == 2) break;
        }

        // Full house: a trip plus another trip or a pair.
        if (nTrips >= 1 && (nTrips >= 2 || nPairs >= 1)) {
            uint8 pairRank = nTrips >= 2 ? trips[1] : pairs[0];
            return _score(CAT_FULL_HOUSE, trips[0], pairRank, 0, 0, 0);
        }

        // Flush: top five ranks of the flush suit.
        if (flushSuit >= 0) {
            uint8[5] memory top;
            uint256 c;
            for (uint8 r = 14; r >= 2; --r) {
                // count cards of this rank in the flush suit
                // (rebuild presence cheaply by scanning is avoided; use suitPresent again)
                if (c < 5) {
                    // recompute presence for this rank in flush suit
                    bool inSuit;
                    for (uint256 i = 0; i < 7 && !inSuit; ++i) {
                        if ((cards[i] & 0x0f) == uint8(uint256(flushSuit)) && (cards[i] >> 4) == r) inSuit = true;
                    }
                    if (inSuit) top[c++] = r;
                }
                if (r == 2) break;
            }
            return _score(CAT_FLUSH, top[0], top[1], top[2], top[3], top[4]);
        }

        // Straight (any suit).
        bool[15] memory present;
        for (uint8 r = 2; r <= 14; ++r) {
            present[r] = rankCount[r] > 0;
        }
        uint8 stHigh = _straightHigh(present);
        if (stHigh > 0) return _score(CAT_STRAIGHT, stHigh, 0, 0, 0, 0);

        // Three of a kind.
        if (nTrips >= 1) {
            uint8 k1 = _nthHighest(rankCount, trips[0], 0, 0, 1);
            uint8 k2 = _nthHighest(rankCount, trips[0], 0, 0, 2);
            return _score(CAT_TRIPS, trips[0], k1, k2, 0, 0);
        }

        // Two pair.
        if (nPairs >= 2) {
            uint8 kicker = _nthHighest(rankCount, pairs[0], pairs[1], 0, 1);
            return _score(CAT_TWO_PAIR, pairs[0], pairs[1], kicker, 0, 0);
        }

        // One pair.
        if (nPairs == 1) {
            uint8 k1 = _nthHighest(rankCount, pairs[0], 0, 0, 1);
            uint8 k2 = _nthHighest(rankCount, pairs[0], 0, 0, 2);
            uint8 k3 = _nthHighest(rankCount, pairs[0], 0, 0, 3);
            return _score(CAT_ONE_PAIR, pairs[0], k1, k2, k3, 0);
        }

        // High card.
        uint8 h1 = _nthHighest(rankCount, 0, 0, 0, 1);
        uint8 h2 = _nthHighest(rankCount, 0, 0, 0, 2);
        uint8 h3 = _nthHighest(rankCount, 0, 0, 0, 3);
        uint8 h4 = _nthHighest(rankCount, 0, 0, 0, 4);
        uint8 h5 = _nthHighest(rankCount, 0, 0, 0, 5);
        return _score(CAT_HIGH_CARD, h1, h2, h3, h4, h5);
    }
    // end::evaluate(uint8[7])[]

    /// @dev Highest card of a 5-in-a-row, or 0 if none. Handles the wheel.
    function _straightHigh(bool[15] memory present) private pure returns (uint8) {
        for (uint8 high = 14; high >= 6; --high) {
            if (
                present[high] && present[high - 1] && present[high - 2] && present[high - 3] && present[high - 4]
            ) {
                return high;
            }
        }
        if (present[14] && present[2] && present[3] && present[4] && present[5]) return 5;
        return 0;
    }

    /// @dev Returns the `n`-th highest rank (by count, descending) excluding up
    ///      to three ranks. Counts multiplicity, so a remaining pair contributes
    ///      two kicker slots of the same rank.
    function _nthHighest(uint8[15] memory rankCount, uint8 ex1, uint8 ex2, uint8 ex3, uint256 n)
        private
        pure
        returns (uint8)
    {
        uint256 seen;
        for (uint8 r = 14; r >= 2; --r) {
            if (r == ex1 || r == ex2 || r == ex3) {
                if (r == 2) break;
                continue;
            }
            uint8 cnt = rankCount[r];
            for (uint8 k = 0; k < cnt; ++k) {
                seen += 1;
                if (seen == n) return r;
            }
            if (r == 2) break;
        }
        return 0;
    }

    function _score(uint256 cat, uint256 t1, uint256 t2, uint256 t3, uint256 t4, uint256 t5)
        private
        pure
        returns (uint256)
    {
        return (cat << 20) | (t1 << 16) | (t2 << 12) | (t3 << 8) | (t4 << 4) | t5;
    }
}
// end::PokerHandEvaluator[]
