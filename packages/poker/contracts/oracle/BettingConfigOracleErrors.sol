// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

// tag::BettingConfigOracleErrors[]
/**
 * @title BettingConfigOracleErrors - Custom errors for the betting config oracle.
 * @notice Shared by the oracle Repo, Target, and Facet.
 */
library BettingConfigOracleErrors {
    /**
     * @notice Thrown when the global default operator is set to the zero address.
     * @dev The default entry must always resolve to a payable rake recipient.
     * @custom:signature ZeroOperator()
     */
    error ZeroOperator();

    /**
     * @notice Thrown when a rake exceeds or equals 100% (10_000 basis points).
     * @param rakeBps The offending rake, in basis points.
     * @custom:signature RakeTooHigh(uint256)
     */
    error RakeTooHigh(uint256 rakeBps);
}
// end::BettingConfigOracleErrors[]
