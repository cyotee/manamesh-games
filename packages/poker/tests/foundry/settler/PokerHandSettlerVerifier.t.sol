// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {PokerHandSettlerRepo} from "../../../contracts/settler/PokerHandSettlerRepo.sol";
import {PokerHandSettlerTarget} from "../../../contracts/settler/PokerHandSettlerTarget.sol";
import {PokerVerifierFacet} from "../../../contracts/verifier/PokerVerifierFacet.sol";
import {IPokerVerifierFacet} from "../../../contracts/verifier/IPokerVerifierFacet.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";

contract VerifierMockOracle is IBettingConfigOracle {
    function configOf(address) external view returns (address, uint256) {
        return (address(this), 250);
    }

    function defaultConfig() external view returns (address, uint256) {
        return (address(this), 250);
    }

    function setTokenConfig(address, address, uint256) external {}
    function setDefault(address, uint256) external {}
}

/// @notice Combines the settler Target with the verifier Facet in one contract so
///         `settleHand`'s `IPokerVerifierFacet(address(this)).verifyOutcome` self
///         call resolves — exercising the Task 4.3 wiring without a full diamond.
contract SettlerWithVerifierHarness is PokerHandSettlerTarget, PokerVerifierFacet {
    function initSettler(address token_, IBettingConfigOracle oracle_) external {
        PokerHandSettlerRepo._initialize(token_, oracle_, true); // verifier ENABLED
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

contract PokerHandSettlerVerifierTest is Test {
    SettlerWithVerifierHarness internal settler;
    ERC20Mock internal chip;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    address internal alice;
    address internal bob;

    uint256 internal constant BUY_IN = 100e18;

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        chip = new ERC20Mock("Chip", "CHIP");
        settler = new SettlerWithVerifierHarness();
        settler.initSettler(address(chip), new VerifierMockOracle());
        _fund(alice);
        _fund(bob);
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
        // Sorted ascending: bob < alice.
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

    function _c(uint8 rank, uint8 suit) internal pure returns (uint8) {
        return uint8((rank << 4) | suit);
    }

    function _assertHand() internal {
        HandInit memory init = _init();
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(bobPk, settler.hashHandInit(init));
        sigs[1] = _sign(alicePk, settler.hashHandInit(init));
        settler.assertHandMembership(init, sigs);
    }

    /// @dev Board A-K-Q hearts + 2c 3d; alice (index 1) holds J-T hearts (royal flush).
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
        o.holeCards[0] = [_c(2, 3), _c(7, 1)]; // bob junk
        o.holeCards[1] = [_c(11, 2), _c(10, 2)]; // alice J-T hearts -> royal with the board
        o.communityCards = [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)];
    }

    function test_settleWithVerifier_acceptsTrueWinner() public {
        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _outcome(winners, 0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, settler.hashHandOutcome(o));

        settler.settleHand(_init(), o, wsigs);
        assertEq(settler.balanceOf(alice), 1_095e18);
    }

    function test_settleWithVerifier_rejectsFalseWinner() public {
        // Bob is declared + signs, but alice actually holds the royal flush.
        address[] memory winners = new address[](1);
        winners[0] = bob;
        HandOutcome memory o = _outcome(winners, 195e18, 0);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(bobPk, settler.hashHandOutcome(o));

        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        settler.settleHand(_init(), o, wsigs);
    }
}
