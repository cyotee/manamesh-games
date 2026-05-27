// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {HandOutcome} from "../types/HandOutcome.sol";
import {IPokerVerifierFacet} from "./IPokerVerifierFacet.sol";
import {PokerHandEvaluator} from "./PokerHandEvaluator.sol";

// tag::PokerVerifierFacet[]
/**
 * @title PokerVerifierFacet - Diamond facet for the Level-1 hand verifier.
 * @notice Stateless: computes winners from revealed cards via
 *         {PokerHandEvaluator}. Cut into each settler diamond and invoked by
 *         `settleHand` when the verifier is enabled.
 */
contract PokerVerifierFacet is IPokerVerifierFacet, IFacet {
    using PokerHandEvaluator for uint8[7];

    // tag::verifyOutcome(address[]-HandOutcome)[]
    /// @inheritdoc IPokerVerifierFacet
    function verifyOutcome(address[] calldata players, HandOutcome calldata outcome)
        external
        pure
        returns (bool ok)
    {
        uint256 n = players.length;
        if (outcome.holeCards.length != n) revert VerifierArrayLengthMismatch();

        uint256 bestScore;
        uint256 numWinners;
        // First pass: best score + how many players hold it.
        for (uint256 i = 0; i < n; ++i) {
            uint256 score = _scoreOf(outcome, i);
            if (score > bestScore) {
                bestScore = score;
                numWinners = 1;
            } else if (score == bestScore) {
                numWinners += 1;
            }
        }

        // The declared winner set must be exactly the best-scoring players.
        if (outcome.winners.length != numWinners) revert WinnerMismatch();
        for (uint256 i = 0; i < n; ++i) {
            bool isBest = _scoreOf(outcome, i) == bestScore;
            bool declared = _contains(outcome.winners, players[i]);
            if (isBest != declared) revert WinnerMismatch();
        }

        return true;
    }
    // end::verifyOutcome(address[]-HandOutcome)[]

    /// @dev Best 5-of-7 score for player `i` (2 hole cards + 5 community).
    function _scoreOf(HandOutcome calldata outcome, uint256 i) private pure returns (uint256) {
        uint8[7] memory hand;
        hand[0] = outcome.holeCards[i][0];
        hand[1] = outcome.holeCards[i][1];
        for (uint256 j = 0; j < 5; ++j) {
            hand[2 + j] = outcome.communityCards[j];
        }
        return PokerHandEvaluator.evaluate(hand);
    }

    function _contains(address[] calldata arr, address x) private pure returns (bool) {
        for (uint256 i = 0; i < arr.length; ++i) {
            if (arr[i] == x) return true;
        }
        return false;
    }

    // ------------------------------- IFacet ---------------------------------

    /// @inheritdoc IFacet
    function facetName() public pure returns (string memory) {
        return type(PokerVerifierFacet).name;
    }

    /// @inheritdoc IFacet
    function facetInterfaces() public pure returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](1);
        interfaces[0] = type(IPokerVerifierFacet).interfaceId;
    }

    /// @inheritdoc IFacet
    function facetFuncs() public pure returns (bytes4[] memory funcs) {
        funcs = new bytes4[](1);
        funcs[0] = IPokerVerifierFacet.verifyOutcome.selector;
    }

    /// @inheritdoc IFacet
    function facetMetadata()
        external
        pure
        returns (string memory name, bytes4[] memory interfaces, bytes4[] memory functions)
    {
        name = facetName();
        interfaces = facetInterfaces();
        functions = facetFuncs();
    }
}
// end::PokerVerifierFacet[]
