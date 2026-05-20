// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {HandInit} from "../types/HandInit.sol";

library HandIdLib {
    // tag::handIdOf[]
    /// @custom:signature handIdOf((address[],uint256[],address,uint256,uint256,uint256,bytes32,uint256[]))
    function handIdOf(HandInit memory h) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            h.players,
            h.buyIns,
            h.vault,
            h.smallBlind,
            h.bigBlind,
            h.timeoutSeconds,
            h.otherConfig,
            h.playerHandNonces
        ));
    }
    // end::handIdOf[]
}
