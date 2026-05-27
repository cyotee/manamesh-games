// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {HandOutcome} from "../types/HandOutcome.sol";

// tag::IPokerVerifierFacet[]
/**
 * @title IPokerVerifierFacet - Level-1 on-chain hand verifier.
 * @notice Recomputes each player's best 5-of-7 hand from the revealed cards in a
 *         HandOutcome and asserts the declared winners match.
 * @dev Does NOT verify the encryption/shuffle chain (that stays off-chain, bound
 *      only via `finalStateHash` opacity — PRD §11.11).
 */
interface IPokerVerifierFacet {
    /// @notice Declared winners did not match the on-chain computed winners.
    /// @custom:signature WinnerMismatch()
    error WinnerMismatch();

    /// @notice `holeCards` length did not match the player count.
    /// @custom:signature VerifierArrayLengthMismatch()
    error VerifierArrayLengthMismatch();

    /**
     * @notice Verifies that `outcome.winners` is exactly the set of players with
     *         the best 5-of-7 hand. Reverts {WinnerMismatch} otherwise.
     * @param players The hand participants, parallel to `outcome.holeCards`.
     * @param outcome The showdown outcome carrying revealed hole + community cards.
     * @return ok Always true when the winners match (reverts otherwise).
     */
    function verifyOutcome(address[] calldata players, HandOutcome calldata outcome)
        external
        pure
        returns (bool ok);
}
// end::IPokerVerifierFacet[]
