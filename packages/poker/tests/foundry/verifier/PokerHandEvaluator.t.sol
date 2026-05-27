// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PokerHandEvaluator} from "../../../contracts/verifier/PokerHandEvaluator.sol";

/// @notice Scoring tests for the 7-card best-of-5 evaluator. Cards encode as
///         `(rank << 4) | suit`, rank 2..14 (14 = Ace), suit 0..3.
contract PokerHandEvaluatorTest is Test {
    function _c(uint8 rank, uint8 suit) internal pure returns (uint8) {
        return uint8((rank << 4) | suit);
    }

    function _seven(uint8 a, uint8 b, uint8 cc, uint8 d, uint8 e, uint8 f, uint8 g)
        internal
        pure
        returns (uint8[7] memory cards)
    {
        cards[0] = a;
        cards[1] = b;
        cards[2] = cc;
        cards[3] = d;
        cards[4] = e;
        cards[5] = f;
        cards[6] = g;
    }

    function test_royalFlushBeatsLowerStraightFlush() public pure {
        uint8[7] memory royal =
            _seven(_c(14, 3), _c(13, 3), _c(12, 3), _c(11, 3), _c(10, 3), _c(2, 0), _c(3, 1));
        uint8[7] memory sf9 = _seven(_c(9, 3), _c(8, 3), _c(7, 3), _c(6, 3), _c(5, 3), _c(2, 0), _c(3, 1));
        assertGt(PokerHandEvaluator.evaluate(royal), PokerHandEvaluator.evaluate(sf9));
    }

    function test_quadsBeatFullHouse() public pure {
        uint8[7] memory quads =
            _seven(_c(9, 0), _c(9, 1), _c(9, 2), _c(9, 3), _c(2, 0), _c(3, 1), _c(4, 2));
        uint8[7] memory fh = _seven(_c(13, 0), _c(13, 1), _c(13, 2), _c(12, 0), _c(12, 1), _c(2, 0), _c(3, 1));
        assertGt(PokerHandEvaluator.evaluate(quads), PokerHandEvaluator.evaluate(fh));
    }

    function test_fullHouseBeatsFlush() public pure {
        uint8[7] memory fh = _seven(_c(13, 0), _c(13, 1), _c(13, 2), _c(12, 0), _c(12, 1), _c(2, 0), _c(3, 1));
        uint8[7] memory flush =
            _seven(_c(14, 2), _c(10, 2), _c(7, 2), _c(5, 2), _c(3, 2), _c(2, 0), _c(4, 1));
        assertGt(PokerHandEvaluator.evaluate(fh), PokerHandEvaluator.evaluate(flush));
    }

    function test_flushBeatsStraight() public pure {
        uint8[7] memory flush =
            _seven(_c(14, 2), _c(10, 2), _c(7, 2), _c(5, 2), _c(3, 2), _c(2, 0), _c(4, 1));
        uint8[7] memory straight =
            _seven(_c(9, 0), _c(8, 1), _c(7, 2), _c(6, 3), _c(5, 0), _c(2, 1), _c(3, 2));
        assertGt(PokerHandEvaluator.evaluate(flush), PokerHandEvaluator.evaluate(straight));
    }

    function test_straightBeatsTrips() public pure {
        uint8[7] memory straight =
            _seven(_c(9, 0), _c(8, 1), _c(7, 2), _c(6, 3), _c(5, 0), _c(2, 1), _c(3, 2));
        uint8[7] memory trips = _seven(_c(9, 0), _c(9, 1), _c(9, 2), _c(2, 3), _c(4, 0), _c(6, 1), _c(8, 2));
        assertGt(PokerHandEvaluator.evaluate(straight), PokerHandEvaluator.evaluate(trips));
    }

    function test_pairWithAceKickerBeatsPairWithKingKicker() public pure {
        // Both pair of 5s; first has A,K,Q kickers, second has K,Q,J kickers.
        uint8[7] memory aceKicker =
            _seven(_c(5, 0), _c(5, 1), _c(14, 2), _c(13, 3), _c(12, 0), _c(3, 1), _c(2, 2));
        uint8[7] memory kingKicker =
            _seven(_c(5, 0), _c(5, 1), _c(13, 2), _c(12, 3), _c(11, 0), _c(3, 1), _c(2, 2));
        assertGt(PokerHandEvaluator.evaluate(aceKicker), PokerHandEvaluator.evaluate(kingKicker));
    }

    function test_wheelIsAStraightButLowest() public pure {
        // A-2-3-4-5 (wheel) is a straight (beats ace-high junk) but loses to 2-3-4-5-6.
        uint8[7] memory wheel =
            _seven(_c(14, 0), _c(2, 1), _c(3, 2), _c(4, 3), _c(5, 0), _c(8, 1), _c(10, 2));
        uint8[7] memory sixHigh =
            _seven(_c(2, 0), _c(3, 1), _c(4, 2), _c(5, 3), _c(6, 0), _c(9, 1), _c(11, 2));
        uint8[7] memory aceHighJunk =
            _seven(_c(14, 0), _c(12, 1), _c(10, 2), _c(8, 3), _c(6, 0), _c(4, 1), _c(2, 2));

        assertGt(PokerHandEvaluator.evaluate(wheel), PokerHandEvaluator.evaluate(aceHighJunk));
        assertGt(PokerHandEvaluator.evaluate(sixHigh), PokerHandEvaluator.evaluate(wheel));
    }

    function test_bestFiveOfSevenPicksTwoPairOverOnePair() public pure {
        uint8[7] memory twoPair =
            _seven(_c(13, 0), _c(13, 1), _c(12, 2), _c(12, 3), _c(2, 0), _c(3, 1), _c(4, 2));
        uint8[7] memory onePair =
            _seven(_c(13, 0), _c(13, 1), _c(9, 2), _c(7, 3), _c(5, 0), _c(3, 1), _c(2, 2));
        assertGt(PokerHandEvaluator.evaluate(twoPair), PokerHandEvaluator.evaluate(onePair));
    }

    function test_threePairsCollapseToBestTwoPair() public pure {
        // K,K,Q,Q,J,J + 2: best five is KK QQ with J kicker. Beats KK QQ with a
        // lower (4) kicker, proving the third pair is used as the kicker rank.
        uint8[7] memory threePairs =
            _seven(_c(13, 0), _c(13, 1), _c(12, 2), _c(12, 3), _c(11, 0), _c(11, 1), _c(2, 2));
        uint8[7] memory twoPairLowKicker =
            _seven(_c(13, 0), _c(13, 1), _c(12, 2), _c(12, 3), _c(4, 0), _c(3, 1), _c(2, 2));
        assertGt(PokerHandEvaluator.evaluate(threePairs), PokerHandEvaluator.evaluate(twoPairLowKicker));
    }

    function test_identicalHandsTie() public pure {
        uint8[7] memory a =
            _seven(_c(14, 0), _c(14, 1), _c(13, 2), _c(13, 3), _c(9, 0), _c(5, 1), _c(2, 2));
        uint8[7] memory b =
            _seven(_c(14, 2), _c(14, 3), _c(13, 0), _c(13, 1), _c(9, 2), _c(5, 3), _c(2, 0));
        assertEq(PokerHandEvaluator.evaluate(a), PokerHandEvaluator.evaluate(b));
    }
}
