// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {AdversarialHelpers} from "./AdversarialHelpers.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {RoundStateTransition} from "../../../contracts/types/RoundStateTransition.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {SignatureLib} from "../../../contracts/lib/SignatureLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";

/**
 * @title PokerHandSettler_ForceTimeoutGriefTest
 * @notice Force-timeout economic grief matrix A8–A11.
 */
contract PokerHandSettler_ForceTimeoutGriefTest is AdversarialHelpers {
    uint256 internal assertTime;

    function setUp() public override {
        super.setUp();
        _fundDefault();
        assertTime = block.timestamp;
    }

    function test_A8_forceTimeoutBeforeWindow_reverts() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);

        BalanceSnap memory before_ = _snap();
        uint256 readyTime = assertTime + TIMEOUT;
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.TimeoutNotElapsed.selector, block.timestamp, readyTime)
        );
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        _assertUnchanged(before_, _snap());
    }

    function test_A8_forceTimeoutExactlyAtReadyTime_succeeds() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);

        vm.warp(assertTime + TIMEOUT); // timestamp >= lastActivity + timeout
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 1_095e18);
        _assertLedgerIntact(_snap());
    }

    function test_A9_forgedLastRoundSigs_reverts() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(assertTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);
        lrSigs[0] = _sign(0xBADBAD, PokerSettlementHashLib.hashRoundStateTransition(rst));

        BalanceSnap memory before_ = _snap();
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, bob));
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        _assertUnchanged(before_, _snap());
    }

    function test_A9b_missingLastRoundSigArray_reverts() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(assertTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory empty = new bytes[](0);

        BalanceSnap memory before_ = _snap();
        vm.expectRevert(PokerHandSettlerErrors.ArrayLengthMismatch.selector);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, empty);

        _assertUnchanged(before_, _snap());
    }

    function test_A10_unsignedWinnerForfeitsToOperatorNotCaller() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(assertTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = ""; // Alice refuses to sign
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);

        BalanceSnap memory before_ = _snap();
        uint256 attackerBefore = before_.attacker;

        vm.expectEmit(true, true, false, true);
        emit IPokerHandSettler.PlayerForfeited(HandIdLib.handIdOf(init), alice, 195e18);

        vm.prank(attacker);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        BalanceSnap memory after_ = _snap();
        assertEq(after_.attacker, attackerBefore, "attacker must not receive forfeit");
        assertEq(after_.alice, 900e18);
        assertEq(after_.bob, 900e18);
        assertEq(after_.operator, 200e18); // rake 5 + forfeit 195
        _assertLedgerIntact(after_);
    }

    function test_A11_thirdPartySubmitDoesNotSteal() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(assertTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);

        BalanceSnap memory before_ = _snap();
        vm.prank(attacker);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        BalanceSnap memory after_ = _snap();
        assertEq(after_.attacker, before_.attacker, "third-party submitter profit");
        assertEq(after_.alice, 1_095e18);
        assertEq(after_.bob, 900e18);
        assertEq(after_.operator, 5e18);
        _assertLedgerIntact(after_);
    }
}
