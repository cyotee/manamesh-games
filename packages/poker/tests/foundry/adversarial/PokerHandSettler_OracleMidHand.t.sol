// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {AdversarialHelpers} from "./AdversarialHelpers.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {IMultiStepOwnable} from "@crane/contracts/access/ERC8023/IMultiStepOwnable.sol";

/**
 * @title PokerHandSettler_OracleMidHandTest
 * @notice S6: oracle rake/operator changes after assert, before settle.
 *
 * ## Actual product policy (locked by these tests)
 * `PokerHandSettlerTarget.settleHand` / `forceTimeoutSettlement` call
 * `oracle.configOf(token)` **at settle time** (live read). There is **no**
 * snapshot of rake/operator at `assertHandMembership`. Mid-hand owner updates
 * therefore change conservation math and rake recipient for in-flight hands.
 *
 * Recommended product discussion: snapshot at assert would freeze economics;
 * current code is live-read — tests document and enforce that behavior without
 * changing production.
 */
contract PokerHandSettler_OracleMidHandTest is AdversarialHelpers {
    function setUp() public override {
        super.setUp();
        _fundDefault();
    }

    /// S6.1: Assert under rake A; owner sets rake B; settle uses live B + conservation under B.
    function test_S6_midHandRakeChange_usesLiveConfigOf() public {
        // Confirm default A.
        (, uint256 rakeA) = IBettingConfigOracle(oracleProxy).configOf(address(chip));
        assertEq(rakeA, RAKE_BPS, "fixture rake A");

        HandInit memory init = _assertTwoPlayerHand();

        uint256 pot = 2 * BUY_IN;
        // After assert, owner raises rake to B = 500 bps (5%).
        uint256 rakeBpsB = 500;
        IBettingConfigOracle(oracleProxy).setDefault(operator, rakeBpsB);

        (, uint256 live) = IBettingConfigOracle(oracleProxy).configOf(address(chip));
        assertEq(live, rakeBpsB, "oracle live B");

        uint256 rakeB = (pot * rakeBpsB) / 10_000; // 10e18
        uint256 netB = pot - rakeB; // 190e18
        // Outcome built for live B (not A): Alice takes netB.
        HandOutcome memory o = _royalOutcomeAliceWins(0, netB);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        BalanceSnap memory before_ = _snap();
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);
        BalanceSnap memory after_ = _snap();

        assertEq(after_.alice, before_.alice - BUY_IN + netB, "alice under B");
        assertEq(after_.bob, before_.bob - BUY_IN, "bob");
        assertEq(after_.operator, before_.operator + rakeB, "rake B not A");
        // Explicitly not A: A would have been 5e18.
        assertTrue(rakeB != _rakeOf(pot), "B distinct from A");
        assertEq(netB + rakeB, pot, "conservation under B");
        _assertLedgerIntact(after_);
    }

    /// S6.1b: Outcome sized for old rake A reverts conservation after live B is active.
    function test_S6_outcomeSizedForOldRake_revertsAfterMidHandChange() public {
        HandInit memory init = _assertTwoPlayerHand();

        // Outcome for rake A (250 bps → net 195e18).
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        IBettingConfigOracle(oracleProxy).setDefault(operator, 500);
        uint256 pot = 2 * BUY_IN;
        uint256 expectedNet = pot - (pot * 500) / 10_000; // 190e18

        BalanceSnap memory before_ = _snap();
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.ConservationViolation.selector, expectedNet, 195e18)
        );
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);
        _assertUnchanged(before_, _snap());
    }

    /// S6.2: Change operator mid-hand; rake credits the new operator.
    function test_S6_midHandOperatorChange_rakeToNewOperator() public {
        address operatorB = makeAddr("operatorB");
        HandInit memory init = _assertTwoPlayerHand();

        // Live config switches recipient to operatorB, same rake.
        IBettingConfigOracle(oracleProxy).setDefault(operatorB, RAKE_BPS);

        (address liveOp,) = IBettingConfigOracle(oracleProxy).configOf(address(chip));
        assertEq(liveOp, operatorB);

        uint256 pot = 2 * BUY_IN;
        uint256 rake = _rakeOf(pot);
        HandOutcome memory o = _royalOutcomeAliceWins(0, pot - rake);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        uint256 opABefore = IPokerHandSettler(settlerProxy).balanceOf(operator);
        uint256 opBBefore = IPokerHandSettler(settlerProxy).balanceOf(operatorB);

        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), opABefore, "old op no rake");
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operatorB), opBBefore + rake, "new op rake");

        // Ledger: include operatorB.
        uint256 sum = IPokerHandSettler(settlerProxy).balanceOf(alice)
            + IPokerHandSettler(settlerProxy).balanceOf(bob)
            + IPokerHandSettler(settlerProxy).balanceOf(operator)
            + IPokerHandSettler(settlerProxy).balanceOf(operatorB)
            + IPokerHandSettler(settlerProxy).balanceOf(attacker);
        assertEq(chip.balanceOf(settlerProxy), sum, "ledger");
    }

    /// S6.3: Extreme rake (max-1) mid-hand; conservation under new formula.
    function test_S6_extremeRakeMaxMinusOne_conservation() public {
        HandInit memory init = _assertTwoPlayerHand();
        uint256 extremeBps = 9_999;
        IBettingConfigOracle(oracleProxy).setDefault(operator, extremeBps);

        uint256 pot = 2 * BUY_IN;
        uint256 rake = (pot * extremeBps) / 10_000;
        uint256 net = pot - rake;
        HandOutcome memory o = _royalOutcomeAliceWins(0, net);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 1_000e18 - BUY_IN + net);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), rake);
        assertEq(net + rake, pot);
        _assertLedgerIntact(_snap());
    }

    /// S6.4 / A12 cross-link: non-owner cannot setDefault mid-hand (or anytime).
    function test_S6_nonOwnerCannotSetConfig_A12() public {
        _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();

        vm.expectRevert(abi.encodeWithSelector(IMultiStepOwnable.NotOwner.selector, attacker));
        vm.prank(attacker);
        IBettingConfigOracle(oracleProxy).setDefault(attacker, 9_999);

        vm.expectRevert(abi.encodeWithSelector(IMultiStepOwnable.NotOwner.selector, attacker));
        vm.prank(attacker);
        IBettingConfigOracle(oracleProxy).setTokenConfig(address(chip), attacker, 9_999);

        (address op, uint256 rake) = IBettingConfigOracle(oracleProxy).defaultConfig();
        assertEq(op, operator);
        assertEq(rake, RAKE_BPS);
        _assertUnchanged(before_, _snap());
    }
}
