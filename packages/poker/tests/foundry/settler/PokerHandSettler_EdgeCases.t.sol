// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {TestBase_PokerSystem} from "../base/TestBase_PokerSystem.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {RoundStateTransition} from "../../../contracts/types/RoundStateTransition.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {SignatureLib} from "../../../contracts/lib/SignatureLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";
import {IPokerVerifierFacet} from "../../../contracts/verifier/IPokerVerifierFacet.sol";

/**
 * @title PokerHandSettler_EdgeCasesTest
 * @notice Production-diamond edge cases for PRD §11 invariants (player bounds,
 *         vault binding, sorted players, lastRound signatures, force-timeout).
 */
contract PokerHandSettler_EdgeCasesTest is TestBase_PokerSystem {
    uint256 internal startTime;

    function setUp() public override {
        TestBase_PokerSystem.setUp();
        _fundDefault();
        startTime = block.timestamp;
    }

    function test_assert_revertsWhenPlayersUnsorted() public {
        HandInit memory init = _twoPlayerInit();
        // Reverse order (alice > bob) — not strictly ascending.
        init.players[0] = alice;
        init.players[1] = bob;
        bytes[] memory sigs = _signInit(init);
        // Signatures were built for original sorted message hash; either way assert must fail first.
        vm.expectRevert(PokerHandSettlerErrors.PlayersNotSorted.selector);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
    }

    function test_assert_revertsOnInvalidVault() public {
        HandInit memory init = _twoPlayerInit();
        init.vault = address(0xDEAD);
        bytes[] memory sigs = _signInit(init);
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.InvalidVault.selector, settlerProxy, address(0xDEAD))
        );
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
    }

    function test_assert_revertsOnInvalidPlayerCount() public {
        HandInit memory init = _twoPlayerInit();
        init.players = new address[](1);
        init.players[0] = bob;
        init.buyIns = new uint256[](1);
        init.buyIns[0] = BUY_IN;
        init.playerHandNonces = new uint256[](1);
        init.playerHandNonces[0] = 1;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(bobPk, PokerSettlementHashLib.hashHandInit(init));
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.InvalidPlayerCount.selector, 1));
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
    }

    function test_assert_revertsOnZeroBuyIn() public {
        HandInit memory init = _twoPlayerInit();
        init.buyIns[0] = 0;
        bytes[] memory sigs = _signInit(init);
        vm.expectRevert(PokerHandSettlerErrors.ZeroAmount.selector);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
    }

    function test_fullSettle_aliceWins_withVerifier() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 1_095e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(bob), 900e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), 5e18);
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(alice), 0);
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(bob), 0);
    }

    function test_settle_verifierRejectsWrongWinner() public {
        HandInit memory init = _assertTwoPlayerHand();
        // Alice has royal, but bob is declared winner.
        HandOutcome memory o = _royalOutcomeAliceWins(195e18, 0);
        o.winners = new address[](1);
        o.winners[0] = bob;
        o.payouts = new uint256[](1);
        o.payouts[0] = 195e18;
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(bobPk, PokerSettlementHashLib.hashHandOutcome(o));

        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);
    }

    function test_forceTimeout_requiresLastRoundSignatures() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(startTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory winnerSigs = new bytes[](1);
        winnerSigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);

        bytes[] memory empty = new bytes[](0);
        vm.expectRevert(PokerHandSettlerErrors.ArrayLengthMismatch.selector);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, winnerSigs, rst, empty);
    }

    function test_forceTimeout_revertsOnBadLastRoundSig() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(startTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory winnerSigs = new bytes[](1);
        winnerSigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);
        lrSigs[0] = _sign(0xBADBAD, PokerSettlementHashLib.hashRoundStateTransition(rst));

        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, bob));
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, winnerSigs, rst, lrSigs);
    }

    function test_forceTimeout_unsignedWinnerForfeits() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(startTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory winnerSigs = new bytes[](1);
        winnerSigs[0] = ""; // alice did not sign → forfeit
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);

        vm.expectEmit(true, true, false, true);
        emit IPokerHandSettler.PlayerForfeited(HandIdLib.handIdOf(init), alice, 195e18);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, winnerSigs, rst, lrSigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 900e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(bob), 900e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), 200e18); // rake 5 + forfeit 195
    }

    function test_forceTimeout_happyPath() public {
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(startTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory winnerSigs = new bytes[](1);
        winnerSigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);

        vm.prank(bob);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, winnerSigs, rst, lrSigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 1_095e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(bob), 900e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), 5e18);
    }

    function test_forceTimeout_revertsBeforeTimeout() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory winnerSigs = new bytes[](1);
        winnerSigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRound(init);
        bytes[] memory lrSigs = _signLastRound(init, rst);

        vm.expectRevert(
            abi.encodeWithSelector(
                PokerHandSettlerErrors.TimeoutNotElapsed.selector, block.timestamp, startTime + TIMEOUT
            )
        );
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, winnerSigs, rst, lrSigs);
    }

    function test_fullSettle_overridesAfterForceWouldBeReady() public {
        // Full settle is allowed even after the timeout window (does not require force).
        HandInit memory init = _assertTwoPlayerHand();
        vm.warp(startTime + TIMEOUT + 1);

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 1_095e18);
    }

    function test_invariant_ledgerBalancesMatchToken() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        uint256 ledger = IPokerHandSettler(settlerProxy).balanceOf(alice)
            + IPokerHandSettler(settlerProxy).balanceOf(bob)
            + IPokerHandSettler(settlerProxy).balanceOf(operator);
        assertEq(ledger, chip.balanceOf(settlerProxy), "ledger == token balance");
    }
}
