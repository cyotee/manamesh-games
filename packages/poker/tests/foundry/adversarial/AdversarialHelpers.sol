// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {TestBase_PokerSystem} from "../base/TestBase_PokerSystem.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";

/**
 * @title AdversarialHelpers
 * @notice Shared scaffolding for multi-step settlement attack tests.
 * @dev Extends production diamond {TestBase_PokerSystem}. Attack cases snapshot
 *      vault balances before/after failed exploits and assert attacker non-profit
 *      plus token-vs-ledger conservation.
 */
abstract contract AdversarialHelpers is TestBase_PokerSystem {
    address internal attacker = makeAddr("attacker");

    struct BalanceSnap {
        uint256 alice;
        uint256 bob;
        uint256 operator;
        uint256 attacker;
        uint256 tokenTotal;
    }

    function _snap() internal view returns (BalanceSnap memory s) {
        s.alice = IPokerHandSettler(settlerProxy).balanceOf(alice);
        s.bob = IPokerHandSettler(settlerProxy).balanceOf(bob);
        s.operator = IPokerHandSettler(settlerProxy).balanceOf(operator);
        s.attacker = IPokerHandSettler(settlerProxy).balanceOf(attacker);
        s.tokenTotal = chip.balanceOf(settlerProxy);
    }

    /// @dev Sum of known vault accounts equals ERC20 balance of the settler.
    function _assertLedgerIntact(BalanceSnap memory after_) internal pure {
        assertEq(
            after_.alice + after_.bob + after_.operator + after_.attacker,
            after_.tokenTotal,
            "ledger != token"
        );
    }

    function _assertAttackerNoProfit(uint256 beforeBal, uint256 afterBal, string memory tag) internal pure {
        assertLe(afterBal, beforeBal, tag);
    }

    function _assertUnchanged(BalanceSnap memory before_, BalanceSnap memory after_) internal pure {
        assertEq(after_.alice, before_.alice, "alice bal changed");
        assertEq(after_.bob, before_.bob, "bob bal changed");
        assertEq(after_.operator, before_.operator, "operator bal changed");
        assertEq(after_.attacker, before_.attacker, "attacker bal changed");
        assertEq(after_.tokenTotal, before_.tokenTotal, "token total changed");
    }

    function _domainSepFor(address verifyingContract) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("PokerHandSettler")),
                keccak256(bytes("1")),
                block.chainid,
                verifyingContract
            )
        );
    }

    function _signWithDomain(uint256 pk, bytes32 domain, bytes32 structHash)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
