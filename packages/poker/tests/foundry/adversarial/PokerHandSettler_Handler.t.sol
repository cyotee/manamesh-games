// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {AdversarialHelpers} from "./AdversarialHelpers.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";

/**
 * @title PokerSettlerHandler
 * @notice Fuzz wrapper around deposit/withdraw on a real diamond settler.
 */
contract PokerSettlerHandler is Test {
    IPokerHandSettler public settler;
    ERC20Mock public token;
    address[] public actors;
    mapping(address => bool) public isActor;

    constructor(IPokerHandSettler settler_, ERC20Mock token_, address[] memory actors_) {
        settler = settler_;
        token = token_;
        for (uint256 i = 0; i < actors_.length; ++i) {
            actors.push(actors_[i]);
            isActor[actors_[i]] = true;
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    function deposit(uint256 actorSeed, uint256 amount) external {
        address who = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 50e18);
        token.mint(who, amount);
        vm.startPrank(who);
        token.approve(address(settler), amount);
        settler.deposit(amount);
        vm.stopPrank();
    }

    function withdraw(uint256 actorSeed, uint256 amount) external {
        address who = actors[actorSeed % actors.length];
        uint256 bal = settler.balanceOf(who);
        uint256 locked = settler.lockedOf(who);
        uint256 free = bal - locked;
        if (free == 0) return;
        amount = bound(amount, 1, free);
        vm.prank(who);
        settler.withdraw(amount);
    }
}

/**
 * @title PokerHandSettler_InvariantTest
 * @notice A14: vault conservation under deposit/withdraw fuzz.
 */
contract PokerHandSettler_InvariantTest is AdversarialHelpers {
    PokerSettlerHandler internal handler;

    function setUp() public override {
        super.setUp();

        address[] memory actors = new address[](3);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = attacker;

        // Seed balances so withdraw has something to do.
        _fund(alice, 500e18);
        _fund(bob, 500e18);
        _fund(attacker, 500e18);

        handler = new PokerSettlerHandler(IPokerHandSettler(settlerProxy), chip, actors);
        targetContract(address(handler));
    }

    function invariant_tokenBalanceEqualsSumVaultBalances() public view {
        uint256 n = handler.actorCount();
        uint256 sum;
        for (uint256 i = 0; i < n; ++i) {
            sum += IPokerHandSettler(settlerProxy).balanceOf(handler.actorAt(i));
        }
        sum += IPokerHandSettler(settlerProxy).balanceOf(operator);
        assertEq(sum, chip.balanceOf(settlerProxy), "sum vault != token balance");
    }

    function invariant_lockedNeverExceedsBalance() public view {
        uint256 n = handler.actorCount();
        for (uint256 i = 0; i < n; ++i) {
            address who = handler.actorAt(i);
            assertLe(
                IPokerHandSettler(settlerProxy).lockedOf(who),
                IPokerHandSettler(settlerProxy).balanceOf(who),
                "locked > balance"
            );
        }
    }
}
