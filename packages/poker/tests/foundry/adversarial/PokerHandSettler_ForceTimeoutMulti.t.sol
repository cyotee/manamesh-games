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
 * @title PokerHandSettler_ForceTimeoutMultiTest
 * @notice S5: force-timeout economic rules for N≥3 (sorted seats).
 * @dev Force-timeout skips the hand verifier; lastRoundSignatures must cover all
 *      seats. Unsigned declared winners forfeit their finalStack to the operator.
 */
contract PokerHandSettler_ForceTimeoutMultiTest is AdversarialHelpers {
    uint256 internal assertTime;
    uint256 internal constant N = 3;

    uint256[] internal pks;
    address[] internal players;

    function setUp() public override {
        super.setUp();
        (pks, players) = _sortedPlayers(N);
        for (uint256 i = 0; i < N; ++i) {
            _fund(players[i], 1_000e18);
        }
    }

    /// S5.1: All winners sign → paid; conservation holds.
    function test_S5_allWinnersSign_paid() public {
        HandInit memory init = _assertN();
        HandOutcome memory o = _royalWinnerAt(init, 0);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(pks[0], PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRoundN(init);
        bytes[] memory lrSigs = _signLastRoundN(init, rst, pks);

        uint256 pot = N * BUY_IN;
        uint256 rake = _rakeOf(pot);
        uint256 net = pot - rake;

        uint256[] memory balBefore = _balances();
        uint256 opBefore = IPokerHandSettler(settlerProxy).balanceOf(operator);
        uint256 attackerBefore = IPokerHandSettler(settlerProxy).balanceOf(attacker);

        vm.warp(assertTime + TIMEOUT + 1);
        vm.prank(attacker);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        for (uint256 i = 0; i < N; ++i) {
            uint256 expected = balBefore[i] - BUY_IN + (i == 0 ? net : 0);
            assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[i]), expected, "stack");
            assertEq(IPokerHandSettler(settlerProxy).lockedOf(players[i]), 0);
        }
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), opBefore + rake, "rake");
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(attacker), attackerBefore, "caller profit");
        _assertLedgerSum();
    }

    /// S5.2: One unsigned winner → forfeit stack to operator; non-winners unpaid stacks still paid.
    function test_S5_oneUnsignedWinner_forfeitsToOperator() public {
        HandInit memory init = _assertN();
        // Two winners declared with equal stacks (force-timeout skips verifier).
        uint256 pot = N * BUY_IN;
        uint256 rake = _rakeOf(pot);
        uint256 net = pot - rake;
        uint256 share0 = net / 2;
        uint256 share1 = net - share0;

        HandOutcome memory o = _twoWinnerOutcome(init, 0, 1, share0, share1);
        bytes[] memory wsigs = new bytes[](2);
        bytes32 oh = PokerSettlementHashLib.hashHandOutcome(o);
        wsigs[0] = _sign(pks[0], oh); // winner 0 signs
        wsigs[1] = ""; // winner 1 refuses → forfeit share1
        RoundStateTransition memory rst = _lastRoundN(init);
        bytes[] memory lrSigs = _signLastRoundN(init, rst, pks);

        uint256[] memory balBefore = _balances();
        uint256 opBefore = IPokerHandSettler(settlerProxy).balanceOf(operator);
        uint256 attackerBefore = IPokerHandSettler(settlerProxy).balanceOf(attacker);

        vm.warp(assertTime + TIMEOUT + 1);

        vm.expectEmit(true, true, false, true);
        emit IPokerHandSettler.PlayerForfeited(HandIdLib.handIdOf(init), players[1], share1);

        vm.prank(attacker);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        // Winner 0 paid; winner 1 forfeited; seat 2 stack 0.
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[0]), balBefore[0] - BUY_IN + share0);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[1]), balBefore[1] - BUY_IN);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[2]), balBefore[2] - BUY_IN);
        assertEq(
            IPokerHandSettler(settlerProxy).balanceOf(operator),
            opBefore + rake + share1,
            "rake+forfeit"
        );
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(attacker), attackerBefore, "caller");
        _assertLedgerSum();
    }

    /// S5.3: Incomplete lastRoundSignatures reverts.
    function test_S5_incompleteLastRoundSigs_reverts() public {
        HandInit memory init = _assertN();
        HandOutcome memory o = _royalWinnerAt(init, 0);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(pks[0], PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRoundN(init);

        // Empty array.
        bytes[] memory empty = new bytes[](0);
        uint256[] memory balBefore = _balances();
        uint256 opBefore = IPokerHandSettler(settlerProxy).balanceOf(operator);

        vm.warp(assertTime + TIMEOUT + 1);
        vm.expectRevert(PokerHandSettlerErrors.ArrayLengthMismatch.selector);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, empty);

        // Wrong length (N-1).
        bytes[] memory short_ = new bytes[](N - 1);
        for (uint256 i = 0; i < N - 1; ++i) {
            short_[i] = _sign(pks[i], PokerSettlementHashLib.hashRoundStateTransition(rst));
        }
        vm.expectRevert(PokerHandSettlerErrors.ArrayLengthMismatch.selector);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, short_);

        for (uint256 i = 0; i < N; ++i) {
            assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[i]), balBefore[i]);
            assertEq(IPokerHandSettler(settlerProxy).lockedOf(players[i]), BUY_IN);
        }
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), opBefore);
    }

    /// S5.4: Early force-timeout reverts; boundary (exactly readyTime) succeeds.
    function test_S5_earlyForceTimeout_reverts_boundarySucceeds() public {
        HandInit memory init = _assertN();
        HandOutcome memory o = _royalWinnerAt(init, 0);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(pks[0], PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRoundN(init);
        bytes[] memory lrSigs = _signLastRoundN(init, rst, pks);

        uint256 readyTime = assertTime + TIMEOUT;

        // One second early.
        vm.warp(readyTime - 1);
        vm.expectRevert(
            abi.encodeWithSelector(PokerHandSettlerErrors.TimeoutNotElapsed.selector, readyTime - 1, readyTime)
        );
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        // Exactly at readyTime.
        vm.warp(readyTime);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);

        uint256 pot = N * BUY_IN;
        uint256 rake = _rakeOf(pot);
        uint256 net = pot - rake;
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[0]), 1_000e18 - BUY_IN + net);
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(players[0]), 0);
        _assertLedgerSum();
    }

    /// S5.5: Non-player caller cannot extract vault profit beyond rules (A11 multi-seat).
    function test_S5_nonPlayerCaller_noVaultProfit() public {
        HandInit memory init = _assertN();
        HandOutcome memory o = _royalWinnerAt(init, 0);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(pks[0], PokerSettlementHashLib.hashHandOutcome(o));
        RoundStateTransition memory rst = _lastRoundN(init);
        bytes[] memory lrSigs = _signLastRoundN(init, rst, pks);

        // Forged last-round sig from attacker must not pay attacker.
        bytes[] memory forgedLr = _signLastRoundN(init, rst, pks);
        forgedLr[0] = _sign(0xBADBAD, PokerSettlementHashLib.hashRoundStateTransition(rst));

        uint256 attackerBefore = IPokerHandSettler(settlerProxy).balanceOf(attacker);
        uint256[] memory balBefore = _balances();

        vm.warp(assertTime + TIMEOUT + 1);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, players[0]));
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, forgedLr);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(attacker), attackerBefore);
        for (uint256 i = 0; i < N; ++i) {
            assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[i]), balBefore[i]);
        }

        // Honest path still pays winner only; caller still zero.
        vm.prank(attacker);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(init, o, wsigs, rst, lrSigs);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(attacker), attackerBefore, "honest caller");
        _assertLedgerSum();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _assertN() internal returns (HandInit memory init) {
        init = _nPlayerInit(players);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, _signInitN(init, pks));
        assertTime = block.timestamp;
    }

    function _balances() internal view returns (uint256[] memory bal) {
        bal = new uint256[](N);
        for (uint256 i = 0; i < N; ++i) {
            bal[i] = IPokerHandSettler(settlerProxy).balanceOf(players[i]);
        }
    }

    function _assertLedgerSum() internal view {
        uint256 sum = IPokerHandSettler(settlerProxy).balanceOf(operator)
            + IPokerHandSettler(settlerProxy).balanceOf(attacker);
        for (uint256 i = 0; i < N; ++i) {
            sum += IPokerHandSettler(settlerProxy).balanceOf(players[i]);
        }
        // Also count default alice/bob fixtures if they hold residual (unfunded here = 0).
        sum += IPokerHandSettler(settlerProxy).balanceOf(alice);
        sum += IPokerHandSettler(settlerProxy).balanceOf(bob);
        assertEq(chip.balanceOf(settlerProxy), sum, "ledger != token");
    }

    function _sortedPlayers(uint256 n) internal returns (uint256[] memory outPks, address[] memory addrs) {
        outPks = new uint256[](n);
        addrs = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            outPks[i] = uint256(keccak256(abi.encodePacked("s5-player", i))) % (type(uint256).max / 2) + 1;
            addrs[i] = vm.addr(outPks[i]);
        }
        for (uint256 i = 0; i < n; ++i) {
            for (uint256 j = i + 1; j < n; ++j) {
                if (addrs[j] < addrs[i]) {
                    (addrs[i], addrs[j]) = (addrs[j], addrs[i]);
                    (outPks[i], outPks[j]) = (outPks[j], outPks[i]);
                }
            }
        }
        for (uint256 i = 1; i < n; ++i) {
            require(addrs[i] > addrs[i - 1], "duplicate");
        }
    }

    function _nPlayerInit(address[] memory seats) internal view returns (HandInit memory init) {
        uint256 n = seats.length;
        init.players = seats;
        init.buyIns = new uint256[](n);
        init.playerHandNonces = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            init.buyIns[i] = BUY_IN;
            init.playerHandNonces[i] = 1;
        }
        init.vault = settlerProxy;
        init.smallBlind = 1e18;
        init.bigBlind = 2e18;
        init.timeoutSeconds = TIMEOUT;
        init.otherConfig = bytes32(uint256(7));
    }

    function _signInitN(HandInit memory init, uint256[] memory seatPks) internal view returns (bytes[] memory sigs) {
        bytes32 sh = PokerSettlementHashLib.hashHandInit(init);
        sigs = new bytes[](seatPks.length);
        for (uint256 i = 0; i < seatPks.length; ++i) {
            sigs[i] = _sign(seatPks[i], sh);
        }
    }

    function _lastRoundN(HandInit memory init) internal pure returns (RoundStateTransition memory r) {
        r.handId = HandIdLib.handIdOf(init);
        r.roundNumber = 3;
        r.currentPot = init.players.length * BUY_IN;
        r.playerStacks = new uint256[](init.players.length);
        r.actionHash = keccak256("s5-actions");
    }

    function _signLastRoundN(HandInit memory init, RoundStateTransition memory rst, uint256[] memory seatPks)
        internal
        view
        returns (bytes[] memory sigs)
    {
        bytes32 sh = PokerSettlementHashLib.hashRoundStateTransition(rst);
        sigs = new bytes[](init.players.length);
        for (uint256 i = 0; i < seatPks.length; ++i) {
            sigs[i] = _sign(seatPks[i], sh);
        }
    }

    function _royalWinnerAt(HandInit memory init, uint256 winIdx) internal pure returns (HandOutcome memory o) {
        uint256 n = init.players.length;
        uint256 pot = n * BUY_IN;
        uint256 rake = (pot * 250) / 10_000;
        uint256 net = pot - rake;
        o.handId = HandIdLib.handIdOf(init);
        o.pot = pot;
        o.winners = new address[](1);
        o.winners[0] = init.players[winIdx];
        o.payouts = new uint256[](1);
        o.payouts[0] = net;
        o.finalStacks = new uint256[](n);
        o.finalStacks[winIdx] = net;
        o.finalStateHash = keccak256(abi.encodePacked("s5-final", n));
        o.holeCards = new uint8[2][](n);
        o.communityCards = [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)];
        for (uint256 i = 0; i < n; ++i) {
            if (i == winIdx) {
                o.holeCards[i] = [_c(11, 2), _c(10, 2)];
            } else {
                uint8 r = uint8(4 + (i % 6));
                o.holeCards[i] = [_c(r, 0), _c(r, 1)];
            }
        }
    }

    function _twoWinnerOutcome(
        HandInit memory init,
        uint256 w0,
        uint256 w1,
        uint256 stack0,
        uint256 stack1
    ) internal pure returns (HandOutcome memory o) {
        uint256 n = init.players.length;
        o.handId = HandIdLib.handIdOf(init);
        o.pot = n * BUY_IN;
        o.winners = new address[](2);
        o.winners[0] = init.players[w0];
        o.winners[1] = init.players[w1];
        o.payouts = new uint256[](2);
        o.payouts[0] = stack0;
        o.payouts[1] = stack1;
        o.finalStacks = new uint256[](n);
        o.finalStacks[w0] = stack0;
        o.finalStacks[w1] = stack1;
        o.finalStateHash = keccak256("s5-two-winners");
        o.holeCards = new uint8[2][](n);
        o.communityCards = [_c(14, 0), _c(14, 1), _c(14, 2), _c(14, 3), _c(13, 0)];
        for (uint256 i = 0; i < n; ++i) {
            o.holeCards[i] = [_c(uint8(2 + i), 0), _c(uint8(3 + i), 1)];
        }
    }
}
