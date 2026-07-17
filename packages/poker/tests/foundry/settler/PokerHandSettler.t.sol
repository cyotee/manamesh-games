// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {SignatureLib} from "../../../contracts/lib/SignatureLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";
import {PokerHandSettlerRepo} from "../../../contracts/settler/PokerHandSettlerRepo.sol";
import {PokerHandSettlerTarget} from "../../../contracts/settler/PokerHandSettlerTarget.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";

/// @notice Minimal oracle returning a fixed (operator, rakeBps).
contract MockOracle is IBettingConfigOracle {
    address internal op;
    uint256 internal rake;

    function set(address operator_, uint256 rakeBps_) external {
        op = operator_;
        rake = rakeBps_;
    }

    function configOf(address) external view returns (address, uint256) {
        return (op, rake);
    }

    function defaultConfig() external view returns (address, uint256) {
        return (op, rake);
    }

    function setTokenConfig(address, address, uint256) external {}
    function setDefault(address, uint256) external {}
}

/// @notice Test harness exposing init + EIP-712 helpers; keeps the production
///         Target free of test-only hooks.
contract PokerHandSettlerHarness is PokerHandSettlerTarget {
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
}

contract PokerHandSettlerTest is Test {
    PokerHandSettlerHarness internal settler;
    ERC20Mock internal chip;
    MockOracle internal oracle;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    address internal alice;
    address internal bob;
    address internal operator = makeAddr("operator");

    uint256 internal constant BUY_IN = 100e18;

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);

        chip = new ERC20Mock("Chip", "CHIP");
        oracle = new MockOracle();
        oracle.set(operator, 250); // 2.5%

        settler = new PokerHandSettlerHarness();
        settler.initSettler(address(chip), oracle);

        _fund(alice, 1_000e18);
        _fund(bob, 1_000e18);
    }

    function _fund(address who, uint256 amount) internal {
        chip.mint(who, amount);
        vm.startPrank(who);
        chip.approve(address(settler), type(uint256).max);
        settler.deposit(amount);
        vm.stopPrank();
    }

    /// @dev Players strictly ascending: bob < alice by address for fixture keys.
    function _twoPlayerInit() internal view returns (HandInit memory init) {
        init.players = new address[](2);
        init.players[0] = bob;
        init.players[1] = alice;
        init.buyIns = new uint256[](2);
        init.buyIns[0] = BUY_IN;
        init.buyIns[1] = BUY_IN;
        init.vault = address(settler);
        init.smallBlind = 1e18;
        init.bigBlind = 2e18;
        init.timeoutSeconds = 300;
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

    function _assertTwoPlayerHand() internal returns (HandInit memory init) {
        init = _twoPlayerInit();
        bytes32 structHash = settler.hashHandInit(init);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(bobPk, structHash);
        sigs[1] = _sign(alicePk, structHash);
        settler.assertHandMembership(init, sigs);
    }

    // ----------------------------- deposit/withdraw -------------------------

    function test_deposit_creditsBalanceAndPullsTokens() public view {
        // setUp already deposited 1_000e18 each.
        assertEq(settler.balanceOf(alice), 1_000e18);
        assertEq(chip.balanceOf(address(settler)), 2_000e18);
    }

    function test_deposit_revertsOnZero() public {
        vm.expectRevert(PokerHandSettlerErrors.ZeroAmount.selector);
        vm.prank(alice);
        settler.deposit(0);
    }

    function test_withdraw_sendsTokensAndDebits() public {
        vm.prank(alice);
        settler.withdraw(400e18);
        assertEq(settler.balanceOf(alice), 600e18);
        assertEq(chip.balanceOf(alice), 400e18);
    }

    function test_withdraw_revertsBeyondUnlocked() public {
        _assertTwoPlayerHand(); // locks 100e18 of alice
        uint256 free = settler.balanceOf(alice) - settler.lockedOf(alice); // 900e18
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.InsufficientUnlockedBalance.selector, free, free + 1)
        );
        vm.prank(alice);
        settler.withdraw(free + 1);
    }

    // ----------------------------- assert -----------------------------------

    function test_assert_locksBuyInsAndActivates() public {
        HandInit memory init = _twoPlayerInit();
        bytes32 handId = HandIdLib.handIdOf(init);

        vm.expectEmit(true, true, true, true);
        emit IPokerHandSettler.HandAsserted(handId, 2 * BUY_IN, block.timestamp);
        _assertTwoPlayerHand();

        assertEq(settler.lockedOf(alice), BUY_IN);
        assertEq(settler.lockedOf(bob), BUY_IN);
    }

    function test_assert_revertsOnReassert() public {
        HandInit memory init = _assertTwoPlayerHand();
        bytes32 handId = HandIdLib.handIdOf(init);
        bytes32 structHash = settler.hashHandInit(init);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(bobPk, structHash);
        sigs[1] = _sign(alicePk, structHash);
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.HandAlreadyAsserted.selector, handId));
        settler.assertHandMembership(init, sigs);
    }

    function test_assert_revertsOnBadSignature() public {
        HandInit memory init = _twoPlayerInit();
        bytes32 structHash = settler.hashHandInit(init);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(0xBADBAD, structHash); // not bob (index 0)
        sigs[1] = _sign(alicePk, structHash);
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, bob));
        settler.assertHandMembership(init, sigs);
    }

    function test_assert_revertsOnInsufficientBalance() public {
        // Drain alice so she cannot cover the buy-in.
        vm.prank(alice);
        settler.withdraw(950e18); // 50e18 left, buy-in is 100e18
        HandInit memory init = _twoPlayerInit();
        bytes32 structHash = settler.hashHandInit(init);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(bobPk, structHash);
        sigs[1] = _sign(alicePk, structHash);
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.InsufficientUnlockedBalance.selector, 50e18, BUY_IN)
        );
        settler.assertHandMembership(init, sigs);
    }

    // ----------------------------- settle -----------------------------------

    /// @dev finalStacks parallel to sorted players [bob, alice].
    function _outcomeFor(HandInit memory init, uint256 bobStack, uint256 aliceStack)
        internal
        view
        returns (HandOutcome memory outcome)
    {
        outcome.handId = HandIdLib.handIdOf(init);
        outcome.pot = 2 * BUY_IN;
        outcome.winners = new address[](1);
        outcome.winners[0] = alice;
        outcome.payouts = new uint256[](1);
        outcome.payouts[0] = aliceStack;
        outcome.finalStacks = new uint256[](2);
        outcome.finalStacks[0] = bobStack;
        outcome.finalStacks[1] = aliceStack;
        outcome.finalStateHash = keccak256("final");
        outcome.holeCards = new uint8[2][](2);
        outcome.holeCards[0] = [uint8(0x02), uint8(0x03)];
        outcome.holeCards[1] = [uint8(0x0E), uint8(0x0D)];
        outcome.communityCards = [uint8(0x0C), uint8(0x0B), uint8(0x0A), uint8(0x09), uint8(0x08)];
    }

    function test_settle_reconcilesBalancesAndRake() public {
        HandInit memory init = _assertTwoPlayerHand();
        // pot=200e18, rake 2.5% = 5e18, so stacks sum to 195e18.
        HandOutcome memory outcome = _outcomeFor(init, 0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, settler.hashHandOutcome(outcome));

        settler.settleHand(init, outcome, wsigs);

        // alice: 1000 - 100 (buyin) + 195 = 1095e18
        assertEq(settler.balanceOf(alice), 1_095e18);
        // bob: 1000 - 100 + 0 = 900e18
        assertEq(settler.balanceOf(bob), 900e18);
        // operator rake
        assertEq(settler.balanceOf(operator), 5e18);
        // locks released
        assertEq(settler.lockedOf(alice), 0);
        assertEq(settler.lockedOf(bob), 0);
    }

    function test_settle_revertsOnConservationViolation() public {
        HandInit memory init = _assertTwoPlayerHand();
        // stacks sum to 200e18 but pot-rake is 195e18 -> violation.
        HandOutcome memory outcome = _outcomeFor(init, 0, 200e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, settler.hashHandOutcome(outcome));
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.ConservationViolation.selector, 195e18, 200e18)
        );
        settler.settleHand(init, outcome, wsigs);
    }

    function test_settle_revertsWhenNotActive() public {
        HandInit memory init = _twoPlayerInit(); // never asserted
        bytes32 handId = HandIdLib.handIdOf(init);
        HandOutcome memory outcome = _outcomeFor(init, 0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, settler.hashHandOutcome(outcome));
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.HandNotActive.selector, handId));
        settler.settleHand(init, outcome, wsigs);
    }

    function test_settle_revertsOnWinnerSigMismatch() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory outcome = _outcomeFor(init, 0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(bobPk, settler.hashHandOutcome(outcome)); // bob signs, but winner is alice
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, alice));
        settler.settleHand(init, outcome, wsigs);
    }

    function test_settle_revertsOnDoubleSettle() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory outcome = _outcomeFor(init, 0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, settler.hashHandOutcome(outcome));
        settler.settleHand(init, outcome, wsigs);

        bytes32 handId = HandIdLib.handIdOf(init);
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.HandNotActive.selector, handId));
        settler.settleHand(init, outcome, wsigs);
    }
}
