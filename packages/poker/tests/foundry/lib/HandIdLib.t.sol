// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";

contract HandIdLibTest is Test {
    function _makeHandInit() internal pure returns (HandInit memory h) {
        h.players = new address[](2);
        h.players[0] = address(0xAAaa);
        h.players[1] = address(0xBBbb);
        h.buyIns = new uint256[](2);
        h.buyIns[0] = 100e18;
        h.buyIns[1] = 100e18;
        h.vault = address(0xCCcc);
        h.smallBlind = 1e18;
        h.bigBlind = 2e18;
        h.timeoutSeconds = 300;
        h.otherConfig = bytes32(uint256(42));
        h.playerHandNonces = new uint256[](2);
        h.playerHandNonces[0] = 1;
        h.playerHandNonces[1] = 1;
    }

    function test_handIdIsDeterministic() public pure {
        assertEq(HandIdLib.handIdOf(_makeHandInit()), HandIdLib.handIdOf(_makeHandInit()));
    }

    function test_handIdChangesWhenPlayersChange() public pure {
        HandInit memory h = _makeHandInit();
        bytes32 baseline = HandIdLib.handIdOf(h);
        h.players[0] = address(0xDEAD);
        assertTrue(HandIdLib.handIdOf(h) != baseline);
    }

    function test_handIdChangesWhenBuyInsChange() public pure {
        HandInit memory h = _makeHandInit();
        bytes32 baseline = HandIdLib.handIdOf(h);
        h.buyIns[1] = 200e18;
        assertTrue(HandIdLib.handIdOf(h) != baseline);
    }

    function test_handIdChangesWhenNonceChanges() public pure {
        HandInit memory h = _makeHandInit();
        bytes32 baseline = HandIdLib.handIdOf(h);
        h.playerHandNonces[0] = 2;
        assertTrue(HandIdLib.handIdOf(h) != baseline);
    }
}
