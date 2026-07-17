// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {AdversarialHelpers} from "./AdversarialHelpers.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {SignatureLib} from "../../../contracts/lib/SignatureLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";
import {IPokerVerifierFacet} from "../../../contracts/verifier/IPokerVerifierFacet.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {IMultiStepOwnable} from "@crane/contracts/access/ERC8023/IMultiStepOwnable.sol";

/**
 * @title PokerHandSettler_AdversarialTest
 * @notice Multi-step settlement attacks A1–A3, A5–A7, A12 against production diamond.
 */
contract PokerHandSettler_AdversarialTest is AdversarialHelpers {
    function setUp() public override {
        super.setUp();
        _fundDefault();
    }

    /// A1: inflate finalStacks beyond pot - rake.
    function test_A1_inflateFinalStacks_revertsAndNoProfit() public {
        HandInit memory init = _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();

        HandOutcome memory o = _royalOutcomeAliceWins(0, 200e18); // net must be 195e18
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.ConservationViolation.selector, 195e18, 200e18)
        );
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory after_ = _snap();
        _assertUnchanged(before_, after_);
        _assertLedgerIntact(after_);
    }

    /// A2: Bob declared winner while Alice holds royal flush (verifier on).
    function test_A2_falseWinner_revertsAndNoProfit() public {
        HandInit memory init = _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();

        HandOutcome memory o = _royalOutcomeAliceWins(195e18, 0);
        o.winners = new address[](1);
        o.winners[0] = bob;
        o.payouts = new uint256[](1);
        o.payouts[0] = 195e18;
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(bobPk, PokerSettlementHashLib.hashHandOutcome(o));

        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory after_ = _snap();
        _assertUnchanged(before_, after_);
        _assertLedgerIntact(after_);
    }

    /// A3: Bob signs an outcome that lists Alice as winner (wrong signer for winner).
    function test_A3_forgedWinnerSignature_revertsAndNoProfit() public {
        HandInit memory init = _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();

        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(bobPk, PokerSettlementHashLib.hashHandOutcome(o));

        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, alice));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory after_ = _snap();
        _assertUnchanged(before_, after_);
    }

    /// A5: settle twice after a successful settlement.
    function test_A5_doubleSettle_revertsSecondAttempt() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory before_ = _snap();
        bytes32 handId = HandIdLib.handIdOf(init);
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.HandNotActive.selector, handId));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory after_ = _snap();
        _assertUnchanged(before_, after_);
        _assertLedgerIntact(after_);
    }

    /// A6: withdraw more than unlocked while buy-in is locked.
    function test_A6_withdrawLockedFunds_reverts() public {
        _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();
        uint256 free = before_.alice - IPokerHandSettler(settlerProxy).lockedOf(alice);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.InsufficientUnlockedBalance.selector, free, free + 1)
        );
        IPokerHandSettler(settlerProxy).withdraw(free + 1);

        BalanceSnap memory after_ = _snap();
        _assertUnchanged(before_, after_);
    }

    /// A7a: unsorted players.
    function test_A7a_unsortedPlayers_reverts() public {
        HandInit memory init = _twoPlayerInit();
        init.players[0] = alice;
        init.players[1] = bob;
        bytes[] memory sigs = _signInit(init);
        BalanceSnap memory before_ = _snap();

        vm.expectRevert(PokerHandSettlerErrors.PlayersNotSorted.selector);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);

        _assertUnchanged(before_, _snap());
    }

    /// A7b: vault != this settler.
    function test_A7b_invalidVault_reverts() public {
        HandInit memory init = _twoPlayerInit();
        init.vault = address(0xDEAD);
        bytes[] memory sigs = _signInit(init);
        BalanceSnap memory before_ = _snap();

        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.InvalidVault.selector, settlerProxy, address(0xDEAD))
        );
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);

        _assertUnchanged(before_, _snap());
    }

    /// A7c: player count = 1.
    function test_A7c_invalidPlayerCount_reverts() public {
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

    /// A7d: zero buy-in.
    function test_A7d_zeroBuyIn_reverts() public {
        HandInit memory init = _twoPlayerInit();
        init.buyIns[0] = 0;
        bytes[] memory sigs = _signInit(init);

        vm.expectRevert(PokerHandSettlerErrors.ZeroAmount.selector);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
    }

    /// A7e: assert without covering buy-in.
    function test_A7e_overdraftAssert_reverts() public {
        vm.prank(alice);
        IPokerHandSettler(settlerProxy).withdraw(950e18);
        HandInit memory init = _twoPlayerInit();
        bytes[] memory sigs = _signInit(init);

        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.InsufficientUnlockedBalance.selector, 50e18, BUY_IN)
        );
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
    }

    /// A12: non-owner cannot set oracle default (rake theft attempt).
    function test_A12_nonOwnerOracleConfig_reverts() public {
        BalanceSnap memory before_ = _snap();
        vm.expectRevert(abi.encodeWithSelector(IMultiStepOwnable.NotOwner.selector, attacker));
        vm.prank(attacker);
        IBettingConfigOracle(oracleProxy).setDefault(attacker, 9_999);

        _assertUnchanged(before_, _snap());
        (address op, uint256 rake) = IBettingConfigOracle(oracleProxy).defaultConfig();
        assertEq(op, operator);
        assertEq(rake, RAKE_BPS);
    }
}
