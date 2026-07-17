// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {RoundStateTransition} from "../../../contracts/types/RoundStateTransition.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";
import {PokerHandSettlerRepo} from "../../../contracts/settler/PokerHandSettlerRepo.sol";
import {PokerHandSettlerTarget} from "../../../contracts/settler/PokerHandSettlerTarget.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";

contract FtMockOracle is IBettingConfigOracle {
    address internal op;

    constructor(address operator_) {
        op = operator_;
    }

    function configOf(address) external view returns (address, uint256) {
        return (op, 250);
    }

    function defaultConfig() external view returns (address, uint256) {
        return (op, 250);
    }

    function setTokenConfig(address, address, uint256) external {}
    function setDefault(address, uint256) external {}
}

contract FtHarness is PokerHandSettlerTarget {
    function initSettler(address token_, IBettingConfigOracle oracle_) external {
        PokerHandSettlerRepo._initialize(token_, oracle_, false);
    }

    function domainSeparator() external view returns (bytes32) {
        return PokerSettlementHashLib.domainSeparator();
    }

    function hashHandInit(HandInit calldata init) external pure returns (bytes32) {
        return PokerSettlementHashLib.hashHandInit(init);
    }

    function hashHandOutcome(HandOutcome calldata outcome) external pure returns (bytes32) {
        return PokerSettlementHashLib.hashHandOutcome(outcome);
    }

    function hashRoundStateTransition(RoundStateTransition calldata state) external pure returns (bytes32) {
        return PokerSettlementHashLib.hashRoundStateTransition(state);
    }
}

contract PokerHandSettlerForceTimeoutTest is Test {
    FtHarness internal settler;
    ERC20Mock internal chip;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    address internal alice;
    address internal bob;
    address internal operator = makeAddr("operator");

    uint256 internal constant BUY_IN = 100e18;
    uint256 internal constant TIMEOUT = 300;
    uint256 internal startTime;

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        assertTrue(bob < alice, "fixture order");
        chip = new ERC20Mock("Chip", "CHIP");
        settler = new FtHarness();
        settler.initSettler(address(chip), new FtMockOracle(operator));
        _fund(alice);
        _fund(bob);
        startTime = block.timestamp;
        _assertHand();
    }

    function _fund(address who) internal {
        chip.mint(who, 1_000e18);
        vm.startPrank(who);
        chip.approve(address(settler), type(uint256).max);
        settler.deposit(1_000e18);
        vm.stopPrank();
    }

    function _init() internal view returns (HandInit memory init) {
        init.players = new address[](2);
        init.players[0] = bob;
        init.players[1] = alice;
        init.buyIns = new uint256[](2);
        init.buyIns[0] = BUY_IN;
        init.buyIns[1] = BUY_IN;
        init.vault = address(settler);
        init.smallBlind = 1e18;
        init.bigBlind = 2e18;
        init.timeoutSeconds = TIMEOUT;
        init.otherConfig = bytes32(uint256(7));
        init.playerHandNonces = new uint256[](2);
        init.playerHandNonces[0] = 1;
        init.playerHandNonces[1] = 1;
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", settler.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _assertHand() internal {
        HandInit memory init = _init();
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(bobPk, settler.hashHandInit(init));
        sigs[1] = _sign(alicePk, settler.hashHandInit(init));
        settler.assertHandMembership(init, sigs);
    }

    /// @dev finalStacks parallel to [bob, alice].
    function _outcome(address[] memory winners, uint256 bobStack, uint256 aliceStack)
        internal
        view
        returns (HandOutcome memory o)
    {
        o.handId = HandIdLib.handIdOf(_init());
        o.pot = 2 * BUY_IN;
        o.winners = winners;
        o.payouts = new uint256[](winners.length);
        o.finalStacks = new uint256[](2);
        o.finalStacks[0] = bobStack;
        o.finalStacks[1] = aliceStack;
        o.finalStateHash = keccak256("final");
        o.holeCards = new uint8[2][](2);
        o.communityCards = [uint8(0), 0, 0, 0, 0];
    }

    function _lastRound() internal view returns (RoundStateTransition memory r) {
        r.handId = HandIdLib.handIdOf(_init());
        r.roundNumber = 3;
        r.currentPot = 2 * BUY_IN;
        r.playerStacks = new uint256[](2);
        r.actionHash = keccak256("actions");
    }

    function _lastRoundSigs() internal view returns (bytes[] memory sigs) {
        RoundStateTransition memory r = _lastRound();
        bytes32 sh = settler.hashRoundStateTransition(r);
        sigs = new bytes[](2);
        sigs[0] = _sign(bobPk, sh);
        sigs[1] = _sign(alicePk, sh);
    }

    function _warpPastTimeout() internal {
        vm.warp(startTime + TIMEOUT + 1);
    }

    function test_forceTimeout_revertsBeforeTimeout() public {
        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _outcome(winners, 0, 195e18);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(alicePk, settler.hashHandOutcome(o));
        // Precompute args before expectRevert — external staticcalls during arg
        // evaluation would otherwise consume the expectRevert (Foundry pitfall).
        HandInit memory init = _init();
        RoundStateTransition memory rst = _lastRound();
        bytes[] memory lrSigs = _lastRoundSigs();
        vm.expectRevert(
            abi.encodeWithSelector(
                PokerHandSettlerErrors.TimeoutNotElapsed.selector, block.timestamp, startTime + TIMEOUT
            )
        );
        settler.forceTimeoutSettlement(init, o, sigs, rst, lrSigs);
    }

    function test_forceTimeout_signedWinnerPaid() public {
        _warpPastTimeout();
        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _outcome(winners, 0, 195e18);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(alicePk, settler.hashHandOutcome(o));
        HandInit memory init = _init();
        RoundStateTransition memory rst = _lastRound();
        bytes[] memory lrSigs = _lastRoundSigs();

        settler.forceTimeoutSettlement(init, o, sigs, rst, lrSigs);

        assertEq(settler.balanceOf(alice), 1_095e18);
        assertEq(settler.balanceOf(bob), 900e18);
        assertEq(settler.balanceOf(operator), 5e18); // rake only
    }

    function test_forceTimeout_unsignedWinnerForfeitsToOperator() public {
        _warpPastTimeout();
        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _outcome(winners, 0, 195e18);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = ""; // alice did NOT sign -> her 195e18 share forfeits
        HandInit memory init = _init();
        RoundStateTransition memory rst = _lastRound();
        bytes[] memory lrSigs = _lastRoundSigs();

        vm.expectEmit(true, true, false, true);
        emit IPokerHandSettler.PlayerForfeited(HandIdLib.handIdOf(init), alice, 195e18);
        settler.forceTimeoutSettlement(init, o, sigs, rst, lrSigs);

        assertEq(settler.balanceOf(alice), 900e18); // lost buy-in, share forfeited
        assertEq(settler.balanceOf(bob), 900e18);
        assertEq(settler.balanceOf(operator), 200e18); // rake 5 + forfeit 195
    }

    function test_forceTimeout_abandonmentRefundsMinusRake() public {
        _warpPastTimeout();
        // No winners: each player keeps their stack; total returned = pot - rake.
        address[] memory winners = new address[](0);
        HandOutcome memory o = _outcome(winners, 97.5e18, 97.5e18);
        bytes[] memory sigs = new bytes[](0);
        HandInit memory init = _init();
        RoundStateTransition memory rst = _lastRound();
        bytes[] memory lrSigs = _lastRoundSigs();

        settler.forceTimeoutSettlement(init, o, sigs, rst, lrSigs);

        assertEq(settler.balanceOf(alice), 997.5e18);
        assertEq(settler.balanceOf(bob), 997.5e18);
        assertEq(settler.balanceOf(operator), 5e18);
    }

    function test_forceTimeout_revertsOnConservationViolation() public {
        _warpPastTimeout();
        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _outcome(winners, 0, 200e18); // sum 200 != pot-rake 195
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(alicePk, settler.hashHandOutcome(o));
        HandInit memory init = _init();
        RoundStateTransition memory rst = _lastRound();
        bytes[] memory lrSigs = _lastRoundSigs();
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.ConservationViolation.selector, 195e18, 200e18)
        );
        settler.forceTimeoutSettlement(init, o, sigs, rst, lrSigs);
    }

    function test_forceTimeout_revertsWhenNotActive() public {
        _warpPastTimeout();
        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _outcome(winners, 0, 195e18);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(alicePk, settler.hashHandOutcome(o));
        HandInit memory init = _init();
        RoundStateTransition memory rst = _lastRound();
        bytes[] memory lrSigs = _lastRoundSigs();
        settler.forceTimeoutSettlement(init, o, sigs, rst, lrSigs);
        bytes32 handId = HandIdLib.handIdOf(init);
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.HandNotActive.selector, handId));
        settler.forceTimeoutSettlement(init, o, sigs, rst, lrSigs);
    }
}
