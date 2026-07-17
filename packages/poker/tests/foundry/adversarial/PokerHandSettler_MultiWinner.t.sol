// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {AdversarialHelpers} from "./AdversarialHelpers.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";
import {IPokerVerifierFacet} from "../../../contracts/verifier/IPokerVerifierFacet.sol";

/**
 * @title PokerHandSettler_MultiWinnerTest
 * @notice S4: multi-winner split pots, side-pot-style finalStacks, structural mismatches.
 * @dev Verifier stays ON (diamond default). Board with four aces + king ties all seats
 *      that hold junk (play the board). Settlement accounting uses finalStacks only;
 *      winners[] must match evaluator ties and each winner must sign.
 */
contract PokerHandSettler_MultiWinnerTest is AdversarialHelpers {
    function setUp() public override {
        super.setUp();
        // Two-player cases fund alice/bob; N=3 side-pot case funds its own seats only.
        _fundDefault();
    }

    /// S4.1: Split pot — two winners, two valid winner sigs, conservation holds.
    function test_S4_splitPot_twoWinners_conservation() public {
        HandInit memory init = _assertTwoPlayerHand();

        uint256 pot = 2 * BUY_IN;
        uint256 rake = _rakeOf(pot);
        uint256 net = pot - rake;
        // Even split of net (200e18 pot, 250 bps → rake 5e18, each 97.5e18).
        uint256 share0 = net / 2;
        uint256 share1 = net - share0;

        HandOutcome memory o = _boardPlaysTieOutcome(init, share0, share1);
        bytes[] memory wsigs = new bytes[](2);
        bytes32 oh = PokerSettlementHashLib.hashHandOutcome(o);
        wsigs[0] = _sign(bobPk, oh);
        wsigs[1] = _sign(alicePk, oh);

        BalanceSnap memory before_ = _snap();
        uint256 attackerBefore = before_.attacker;

        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory after_ = _snap();
        assertEq(after_.bob, before_.bob - BUY_IN + share0, "bob split");
        assertEq(after_.alice, before_.alice - BUY_IN + share1, "alice split");
        assertEq(after_.operator, before_.operator + rake, "rake");
        assertEq(after_.attacker, attackerBefore, "third-party profit");
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(bob), 0);
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(alice), 0);
        // sum(finalStacks) + rake == pot
        assertEq(share0 + share1 + rake, pot, "outcome conservation");
        _assertLedgerIntact(after_);
    }

    /// S4.2: Side-pot style stacks — short stack all-in buy-in; main + side without overpay.
    function test_S4_sidePotStyle_shortStack_conservation() public {
        (HandInit memory init, uint256 winPk) = _assertThreeUnequal();
        // pot 250e18; rake 6.25e18. Short wins main → 146.25e18; mid side → 97.5e18.
        uint256 shortStack = (14625 * 1e18) / 100;
        uint256 sideStack = (975 * 1e18) / 10;
        HandOutcome memory o = _royalWinnerSidePots(init, 0, shortStack, sideStack, 0);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(winPk, PokerSettlementHashLib.hashHandOutcome(o));

        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);
        _assertSidePotPostSettle(init.players[0], init.players[1], init.players[2], shortStack, sideStack);
    }

    function _assertThreeUnequal() internal returns (HandInit memory init, uint256 winPk) {
        (uint256[] memory pks, address[] memory players) = _sortedPlayers(3);
        uint256[] memory buyIns = new uint256[](3);
        buyIns[0] = 50e18;
        buyIns[1] = 100e18;
        buyIns[2] = 100e18;
        _fund(players[0], 1_000e18);
        _fund(players[1], 1_000e18);
        _fund(players[2], 1_000e18);
        init = _nPlayerInit(players, buyIns);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, _signInitN(init, pks));
        winPk = pks[0];
    }

    /// @dev Seats funded 1000 each; buy-ins 50/100/100; short+mid+rake == pot.
    ///      Default alice/bob from setUp also hold 1000 each in the vault ledger.
    function _assertSidePotPostSettle(
        address p0,
        address p1,
        address p2,
        uint256 shortStack,
        uint256 sideStack
    ) internal view {
        IPokerHandSettler s = IPokerHandSettler(settlerProxy);
        uint256 rake = _rakeOf(250e18);
        assertEq(s.balanceOf(p0), 1_000e18 - 50e18 + shortStack, "short");
        assertEq(s.balanceOf(p1), 1_000e18 - 100e18 + sideStack, "side");
        assertEq(s.balanceOf(p2), 1_000e18 - 100e18, "deep");
        assertEq(s.balanceOf(operator), rake, "rake");
        assertEq(s.balanceOf(attacker), 0, "attacker");
        assertEq(s.lockedOf(p0), 0);
        assertEq(s.lockedOf(p1), 0);
        assertEq(s.lockedOf(p2), 0);
        uint256 sum = s.balanceOf(p0) + s.balanceOf(p1) + s.balanceOf(p2) + s.balanceOf(operator)
            + s.balanceOf(alice) + s.balanceOf(bob);
        assertEq(chip.balanceOf(settlerProxy), sum, "ledger");
        assertEq(shortStack + sideStack + rake, 250e18, "stack+rake==pot");
        assertLe(shortStack, 150e18, "short not overpaid vs main pot");
    }

    /// S4.3: winners.length != payouts.length reverts; no balance movement.
    function test_S4_winnersPayoutsLengthMismatch_reverts() public {
        HandInit memory init = _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();

        HandOutcome memory o = _boardPlaysTieOutcome(init, 97.5e18, 97.5e18);
        // Break length invariant: two winners, one payout.
        o.payouts = new uint256[](1);
        o.payouts[0] = 97.5e18;

        bytes[] memory wsigs = new bytes[](2);
        bytes32 oh = PokerSettlementHashLib.hashHandOutcome(o);
        wsigs[0] = _sign(bobPk, oh);
        wsigs[1] = _sign(alicePk, oh);

        vm.expectRevert(PokerHandSettlerErrors.ArrayLengthMismatch.selector);
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        _assertUnchanged(before_, _snap());
        _assertLedgerIntact(_snap());
    }

    /// S4.4: Declaring only one of two tied winners fails verifier (true-tie enforcement).
    function test_S4_partialTieDeclaration_revertsVerifier() public {
        HandInit memory init = _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();

        HandOutcome memory o = _boardPlaysTieOutcome(init, 195e18, 0);
        // Only bob declared while board plays for both.
        o.winners = new address[](1);
        o.winners[0] = bob;
        o.payouts = new uint256[](1);
        o.payouts[0] = 195e18;

        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(bobPk, PokerSettlementHashLib.hashHandOutcome(o));

        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        _assertUnchanged(before_, _snap());
    }

    /// S4.5: Winner address not in init.players → verifier WinnerMismatch; no profit.
    function test_S4_winnerNotInPlayers_reverts() public {
        HandInit memory init = _assertTwoPlayerHand();
        BalanceSnap memory before_ = _snap();

        HandOutcome memory o = _boardPlaysTieOutcome(init, 97.5e18, 97.5e18);
        o.winners = new address[](1);
        o.winners[0] = attacker;
        o.payouts = new uint256[](1);
        o.payouts[0] = 195e18;

        // Attacker would need a valid sig; even with it, verifier rejects non-best set.
        uint256 attackerPk = 0xA77AC;
        // Ensure attacker key maps to attacker address for a well-formed sig attempt.
        // Use a signed outcome from a known key recovered as non-player — SignatureLib
        // accepts any recover==winner, so forge with vm.addr.
        attackerPk = uint256(keccak256("s4-attacker"));
        address forged = vm.addr(attackerPk);
        o.winners[0] = forged;

        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(attackerPk, PokerSettlementHashLib.hashHandOutcome(o));

        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory after_ = _snap();
        _assertUnchanged(before_, after_);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(forged), 0, "outsider vault");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// @dev Board AAAA-K: both seats play the board (quad aces + king) → tie.
    function _boardPlaysTieOutcome(HandInit memory init, uint256 bobStack, uint256 aliceStack)
        internal
        pure
        returns (HandOutcome memory o)
    {
        o.handId = HandIdLib.handIdOf(init);
        o.pot = 2 * BUY_IN;
        o.winners = new address[](2);
        o.winners[0] = init.players[0]; // bob
        o.winners[1] = init.players[1]; // alice
        o.payouts = new uint256[](2);
        o.payouts[0] = bobStack;
        o.payouts[1] = aliceStack;
        o.finalStacks = new uint256[](2);
        o.finalStacks[0] = bobStack;
        o.finalStacks[1] = aliceStack;
        o.finalStateHash = keccak256("s4-split");
        o.holeCards = new uint8[2][](2);
        // Distinct junk; board is four aces + king → both play board.
        o.holeCards[0] = [_c(2, 0), _c(3, 1)];
        o.holeCards[1] = [_c(4, 0), _c(5, 1)];
        o.communityCards = [_c(14, 0), _c(14, 1), _c(14, 2), _c(14, 3), _c(13, 0)];
    }

    function _royalWinnerSidePots(
        HandInit memory init,
        uint256 winIdx,
        uint256 stack0,
        uint256 stack1,
        uint256 stack2
    ) internal pure returns (HandOutcome memory o) {
        uint256 n = init.players.length;
        o.handId = HandIdLib.handIdOf(init);
        o.pot = init.buyIns[0] + init.buyIns[1] + init.buyIns[2];
        o.winners = new address[](1);
        o.winners[0] = init.players[winIdx];
        o.payouts = new uint256[](1);
        o.payouts[0] = winIdx == 0 ? stack0 : (winIdx == 1 ? stack1 : stack2);
        o.finalStacks = new uint256[](n);
        o.finalStacks[0] = stack0;
        o.finalStacks[1] = stack1;
        o.finalStacks[2] = stack2;
        o.finalStateHash = keccak256("s4-side");
        o.holeCards = new uint8[2][](n);
        o.communityCards = [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)];
        for (uint256 i = 0; i < n; ++i) {
            if (i == winIdx) {
                o.holeCards[i] = [_c(11, 2), _c(10, 2)]; // J♥ T♥ → royal
            } else {
                uint8 r = uint8(4 + (i % 6));
                o.holeCards[i] = [_c(r, 0), _c(r, 1)];
            }
        }
    }

    function _sortedPlayers(uint256 n) internal returns (uint256[] memory pks, address[] memory addrs) {
        pks = new uint256[](n);
        addrs = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            pks[i] = uint256(keccak256(abi.encodePacked("s4-player", i))) % (type(uint256).max / 2) + 1;
            addrs[i] = vm.addr(pks[i]);
        }
        for (uint256 i = 0; i < n; ++i) {
            for (uint256 j = i + 1; j < n; ++j) {
                if (addrs[j] < addrs[i]) {
                    (addrs[i], addrs[j]) = (addrs[j], addrs[i]);
                    (pks[i], pks[j]) = (pks[j], pks[i]);
                }
            }
        }
        for (uint256 i = 1; i < n; ++i) {
            require(addrs[i] > addrs[i - 1], "duplicate player addr");
        }
    }

    function _nPlayerInit(address[] memory players, uint256[] memory buyIns)
        internal
        view
        returns (HandInit memory init)
    {
        uint256 n = players.length;
        init.players = players;
        init.buyIns = buyIns;
        init.playerHandNonces = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            init.playerHandNonces[i] = 1;
        }
        init.vault = settlerProxy;
        init.smallBlind = 1e18;
        init.bigBlind = 2e18;
        init.timeoutSeconds = TIMEOUT;
        init.otherConfig = bytes32(uint256(7));
    }

    function _signInitN(HandInit memory init, uint256[] memory pks) internal view returns (bytes[] memory sigs) {
        bytes32 sh = PokerSettlementHashLib.hashHandInit(init);
        sigs = new bytes[](pks.length);
        for (uint256 i = 0; i < pks.length; ++i) {
            sigs[i] = _sign(pks[i], sh);
        }
    }
}
