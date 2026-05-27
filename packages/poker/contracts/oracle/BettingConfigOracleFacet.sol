// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";
import {BettingConfigOracleTarget} from "./BettingConfigOracleTarget.sol";

// tag::BettingConfigOracleFacet[]
/**
 * @title BettingConfigOracleFacet - Diamond facet exposing the betting config oracle.
 * @notice Wraps {BettingConfigOracleTarget} with the {IFacet} metadata the
 *         diamond factory uses to cut the oracle's selectors into a proxy.
 * @dev Only the four {IBettingConfigOracle} selectors are advertised; ownership
 *      mutators come from the separately-cut {MultiStepOwnableFacet}.
 */
contract BettingConfigOracleFacet is BettingConfigOracleTarget, IFacet {
    // tag::facetName()[]
    /// @inheritdoc IFacet
    function facetName() public pure returns (string memory name) {
        return type(BettingConfigOracleFacet).name;
    }
    // end::facetName()[]

    // tag::facetInterfaces()[]
    /// @inheritdoc IFacet
    function facetInterfaces() public pure returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](1);
        interfaces[0] = type(IBettingConfigOracle).interfaceId;
    }
    // end::facetInterfaces()[]

    // tag::facetFuncs()[]
    /// @inheritdoc IFacet
    function facetFuncs() public pure returns (bytes4[] memory funcs) {
        funcs = new bytes4[](4);
        funcs[0] = IBettingConfigOracle.configOf.selector;
        funcs[1] = IBettingConfigOracle.defaultConfig.selector;
        funcs[2] = IBettingConfigOracle.setTokenConfig.selector;
        funcs[3] = IBettingConfigOracle.setDefault.selector;
    }
    // end::facetFuncs()[]

    // tag::facetMetadata()[]
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
    // end::facetMetadata()[]
}
// end::BettingConfigOracleFacet[]
