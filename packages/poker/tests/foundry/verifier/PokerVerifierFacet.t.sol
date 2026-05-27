// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {IPokerVerifierFacet} from "../../../contracts/verifier/IPokerVerifierFacet.sol";
import {PokerVerifierFacet} from "../../../contracts/verifier/PokerVerifierFacet.sol";

contract PokerVerifierFacetTest is Test {
    PokerVerifierFacet internal verifier;

    address internal p0 = makeAddr("p0");
    address internal p1 = makeAddr("p1");

    function setUp() public {
        verifier = new PokerVerifierFacet();
    }

    function _c(uint8 rank, uint8 suit) internal pure returns (uint8) {
        return uint8((rank << 4) | suit);
    }

    function _players() internal view returns (address[] memory players) {
        players = new address[](2);
        players[0] = p0;
        players[1] = p1;
    }

    /// @dev Base outcome; cards filled per test. Non-card fields are ignored by the verifier.
    function _outcome(uint8[2] memory hole0, uint8[2] memory hole1, uint8[5] memory community)
        internal
        pure
        returns (HandOutcome memory o)
    {
        o.holeCards = new uint8[2][](2);
        o.holeCards[0] = hole0;
        o.holeCards[1] = hole1;
        o.communityCards = community;
    }

    function test_verifyOutcome_acceptsCorrectWinner() public view {
        // Board A-K-Q hearts + 2c 3d; p0 holds J-T hearts (royal flush), p1 pair of 2s.
        HandOutcome memory o = _outcome(
            [_c(11, 2), _c(10, 2)],
            [_c(2, 3), _c(7, 1)],
            [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)]
        );
        o.winners = new address[](1);
        o.winners[0] = p0;
        assertTrue(verifier.verifyOutcome(_players(), o));
    }

    function test_verifyOutcome_revertsOnWrongWinner() public {
        HandOutcome memory o = _outcome(
            [_c(11, 2), _c(10, 2)],
            [_c(2, 3), _c(7, 1)],
            [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)]
        );
        o.winners = new address[](1);
        o.winners[0] = p1; // wrong: p0 has the royal flush
        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        verifier.verifyOutcome(_players(), o);
    }

    function test_verifyOutcome_revertsWhenWinnerOmitted() public {
        // Board plays for both (quad aces + K kicker) -> a tie. Declaring only p0 is wrong.
        HandOutcome memory o = _outcome(
            [_c(2, 0), _c(3, 1)],
            [_c(4, 0), _c(5, 1)],
            [_c(14, 0), _c(14, 1), _c(14, 2), _c(14, 3), _c(13, 0)]
        );
        o.winners = new address[](1);
        o.winners[0] = p0;
        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        verifier.verifyOutcome(_players(), o);
    }

    function test_verifyOutcome_acceptsTie() public view {
        HandOutcome memory o = _outcome(
            [_c(2, 0), _c(3, 1)],
            [_c(4, 0), _c(5, 1)],
            [_c(14, 0), _c(14, 1), _c(14, 2), _c(14, 3), _c(13, 0)]
        );
        o.winners = new address[](2);
        o.winners[0] = p0;
        o.winners[1] = p1;
        assertTrue(verifier.verifyOutcome(_players(), o));
    }

    function test_verifyOutcome_revertsOnHoleCardsLengthMismatch() public {
        HandOutcome memory o;
        o.holeCards = new uint8[2][](1); // only 1, but 2 players
        o.communityCards = [_c(14, 0), _c(13, 0), _c(12, 0), _c(2, 0), _c(3, 0)];
        o.winners = new address[](1);
        o.winners[0] = p0;
        vm.expectRevert(IPokerVerifierFacet.VerifierArrayLengthMismatch.selector);
        verifier.verifyOutcome(_players(), o);
    }
}
