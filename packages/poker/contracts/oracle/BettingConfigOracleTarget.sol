// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {MultiStepOwnableModifiers} from "@crane/contracts/access/ERC8023/MultiStepOwnableModifiers.sol";
import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";
import {BettingConfigOracleRepo} from "./BettingConfigOracleRepo.sol";

// tag::BettingConfigOracleTarget[]
/**
 * @title BettingConfigOracleTarget - Business logic for the betting config oracle.
 * @notice Exposes the {IBettingConfigOracle} API. Reads are unrestricted; writes
 *         are gated to the ERC8023 owner. The owner is initialized by the
 *         oracle's DFPkg when deployed behind a diamond.
 * @dev Holds no storage of its own; all state lives in {BettingConfigOracleRepo}
 *      and {MultiStepOwnableRepo}. Deployed standalone only for unit testing —
 *      in production it is composed into a diamond via its Facet.
 */
contract BettingConfigOracleTarget is IBettingConfigOracle, MultiStepOwnableModifiers {
    // tag::configOf(address)[]
    /// @inheritdoc IBettingConfigOracle
    function configOf(address token) external view returns (address operator, uint256 rakeBps) {
        return BettingConfigOracleRepo._configOf(token);
    }
    // end::configOf(address)[]

    // tag::defaultConfig()[]
    /// @inheritdoc IBettingConfigOracle
    function defaultConfig() external view returns (address operator, uint256 rakeBps) {
        return BettingConfigOracleRepo._defaultConfig();
    }
    // end::defaultConfig()[]

    // tag::setTokenConfig(address-address-uint256)[]
    /// @inheritdoc IBettingConfigOracle
    function setTokenConfig(address token, address operator, uint256 rakeBps) external onlyOwner {
        BettingConfigOracleRepo._setTokenConfig(token, operator, rakeBps);
    }
    // end::setTokenConfig(address-address-uint256)[]

    // tag::setDefault(address-uint256)[]
    /// @inheritdoc IBettingConfigOracle
    function setDefault(address operator, uint256 rakeBps) external onlyOwner {
        BettingConfigOracleRepo._setDefault(operator, rakeBps);
    }
    // end::setDefault(address-uint256)[]
}
// end::BettingConfigOracleTarget[]
