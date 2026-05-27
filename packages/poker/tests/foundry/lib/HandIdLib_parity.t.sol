// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";

/// @notice Logs the canonical handId for a fixed HandInit so the TypeScript
///         `deriveHandId` helper can be snapshot-tested against the same value
///         (cross-stack parity). The canonical vector is mirrored in
///         `src/handId.test.ts`.
contract HandIdLibParityTest is Test {
    function _canonical() internal pure returns (HandInit memory h) {
        h.players = new address[](2);
        h.players[0] = address(uint160(0xaaa));
        h.players[1] = address(uint160(0xbbb));
        h.buyIns = new uint256[](2);
        h.buyIns[0] = 100e18;
        h.buyIns[1] = 100e18;
        h.vault = address(uint160(0xccc));
        h.smallBlind = 1e18;
        h.bigBlind = 2e18;
        h.timeoutSeconds = 300;
        h.otherConfig = bytes32(uint256(42));
        h.playerHandNonces = new uint256[](2);
        h.playerHandNonces[0] = 1;
        h.playerHandNonces[1] = 1;
    }

    function test_logCanonicalHandId() public pure {
        console2.logBytes32(HandIdLib.handIdOf(_canonical()));
    }

    /// @dev Baked from {test_logCanonicalHandId}; if HandIdLib's encoding ever
    ///      changes this fails, flagging a TS/Solidity parity break.
    function test_canonicalHandIdMatchesSnapshot() public pure {
        assertEq(
            HandIdLib.handIdOf(_canonical()),
            0x1a678d2ac546cb070239d0fc94c9234eaa97e58ddfcce1b7c61bc9b371d37fed
        );
    }
}
