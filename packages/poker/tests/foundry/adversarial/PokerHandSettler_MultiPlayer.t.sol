// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {AdversarialHelpers} from "./AdversarialHelpers.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerRepo} from "../../../contracts/settler/PokerHandSettlerRepo.sol";

/**
 * @title PokerHandSettler_MultiPlayerTest
 * @notice Assert + settle for N ∈ {3,5,9} (MAX_PLAYERS) on the production diamond.
 * @dev Verifier stays enabled (DFPkg default). Winner holds a royal flush; other seats
 *      get junk hole cards so Level-1 verification passes.
 */
contract PokerHandSettler_MultiPlayerTest is AdversarialHelpers {
    function setUp() public override {
        super.setUp();
    }

    function test_multiPlayer_assertAndSettle_N3() public {
        _runTable(3);
    }

    function test_multiPlayer_assertAndSettle_N5() public {
        _runTable(5);
    }

    function test_multiPlayer_assertAndSettle_N9() public {
        _runTable(9);
        assertEq(uint256(PokerHandSettlerRepo.MAX_PLAYERS), 9, "MAX_PLAYERS drift");
    }

    function _runTable(uint256 n) internal {
        (uint256[] memory pks, address[] memory players) = _sortedPlayers(n);
        for (uint256 i = 0; i < n; ++i) {
            _fund(players[i], 1_000e18);
        }

        HandInit memory init = _nPlayerInit(players);
        bytes[] memory initSigs = _signInitN(init, pks);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, initSigs);

        for (uint256 i = 0; i < n; ++i) {
            assertEq(IPokerHandSettler(settlerProxy).lockedOf(players[i]), BUY_IN);
        }

        uint256 pot = n * BUY_IN;
        uint256 rake = _rakeOf(pot);
        uint256 net = pot - rake;
        // Winner = index 0 (lowest address) with royal-flush hole cards.
        HandOutcome memory o = _royalWinnerAt(init, 0, net);

        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(pks[0], PokerSettlementHashLib.hashHandOutcome(o));

        uint256[] memory balBefore = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            balBefore[i] = IPokerHandSettler(settlerProxy).balanceOf(players[i]);
        }
        uint256 opBefore = IPokerHandSettler(settlerProxy).balanceOf(operator);

        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        for (uint256 i = 0; i < n; ++i) {
            assertEq(IPokerHandSettler(settlerProxy).lockedOf(players[i]), 0, "lock residual");
            uint256 expected = balBefore[i] - BUY_IN + (i == 0 ? net : 0);
            assertEq(IPokerHandSettler(settlerProxy).balanceOf(players[i]), expected, "stack recon");
        }
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), opBefore + rake, "rake");

        uint256 sum;
        for (uint256 i = 0; i < n; ++i) {
            sum += IPokerHandSettler(settlerProxy).balanceOf(players[i]);
        }
        sum += IPokerHandSettler(settlerProxy).balanceOf(operator);
        assertEq(chip.balanceOf(settlerProxy), sum, "ledger != token");
    }

    function _sortedPlayers(uint256 n) internal returns (uint256[] memory pks, address[] memory addrs) {
        pks = new uint256[](n);
        addrs = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            // Deterministic non-zero secp256k1 scalars.
            pks[i] = uint256(keccak256(abi.encodePacked("mp-player", i))) % (type(uint256).max / 2) + 1;
            addrs[i] = vm.addr(pks[i]);
        }
        // Sort ascending by address; keep pks parallel.
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

    function _nPlayerInit(address[] memory players) internal view returns (HandInit memory init) {
        uint256 n = players.length;
        init.players = players;
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

    function _signInitN(HandInit memory init, uint256[] memory pks) internal view returns (bytes[] memory sigs) {
        bytes32 sh = PokerSettlementHashLib.hashHandInit(init);
        sigs = new bytes[](pks.length);
        for (uint256 i = 0; i < pks.length; ++i) {
            sigs[i] = _sign(pks[i], sh);
        }
    }

    /// @dev Winner at `winIdx` holds JT of hearts; community AKQ hearts → royal flush.
    ///      Other seats get pocket pairs of mid ranks (lose to royal).
    function _royalWinnerAt(HandInit memory init, uint256 winIdx, uint256 winnerStack)
        internal
        pure
        returns (HandOutcome memory o)
    {
        uint256 n = init.players.length;
        o.handId = HandIdLib.handIdOf(init);
        o.pot = n * BUY_IN;
        o.winners = new address[](1);
        o.winners[0] = init.players[winIdx];
        o.payouts = new uint256[](1);
        o.payouts[0] = winnerStack;
        o.finalStacks = new uint256[](n);
        o.finalStacks[winIdx] = winnerStack;
        o.finalStateHash = keccak256(abi.encodePacked("final", n));
        o.holeCards = new uint8[2][](n);
        // Community: A♥ K♥ Q♥ 2♣ 3♦
        o.communityCards = [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)];
        for (uint256 i = 0; i < n; ++i) {
            if (i == winIdx) {
                o.holeCards[i] = [_c(11, 2), _c(10, 2)]; // J♥ T♥
            } else {
                // Pocket pair ranks 4–9 (always lose to royal flush).
                uint8 r = uint8(4 + (i % 6));
                o.holeCards[i] = [_c(r, 0), _c(r, 1)];
            }
        }
    }
}
