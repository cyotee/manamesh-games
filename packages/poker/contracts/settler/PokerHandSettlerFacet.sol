// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IPokerHandSettler} from "./IPokerHandSettler.sol";
import {PokerHandSettlerTarget} from "./PokerHandSettlerTarget.sol";

// tag::PokerHandSettlerFacet[]
/**
 * @title PokerHandSettlerFacet - Diamond facet exposing the settler.
 * @notice Wraps {PokerHandSettlerTarget} with {IFacet} metadata so the diamond
 *         factory can cut the settler's selectors into a per-token proxy.
 */
contract PokerHandSettlerFacet is PokerHandSettlerTarget, IFacet {
    // tag::facetName()[]
    /// @inheritdoc IFacet
    function facetName() public pure returns (string memory) {
        return type(PokerHandSettlerFacet).name;
    }
    // end::facetName()[]

    // tag::facetInterfaces()[]
    /// @inheritdoc IFacet
    function facetInterfaces() public pure returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](1);
        interfaces[0] = type(IPokerHandSettler).interfaceId;
    }
    // end::facetInterfaces()[]

    // tag::facetFuncs()[]
    /// @inheritdoc IFacet
    function facetFuncs() public pure returns (bytes4[] memory funcs) {
        funcs = new bytes4[](9);
        funcs[0] = IPokerHandSettler.token.selector;
        funcs[1] = IPokerHandSettler.oracle.selector;
        funcs[2] = IPokerHandSettler.balanceOf.selector;
        funcs[3] = IPokerHandSettler.lockedOf.selector;
        funcs[4] = IPokerHandSettler.deposit.selector;
        funcs[5] = IPokerHandSettler.withdraw.selector;
        funcs[6] = IPokerHandSettler.assertHandMembership.selector;
        funcs[7] = IPokerHandSettler.settleHand.selector;
        funcs[8] = IPokerHandSettler.forceTimeoutSettlement.selector;
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
// end::PokerHandSettlerFacet[]
