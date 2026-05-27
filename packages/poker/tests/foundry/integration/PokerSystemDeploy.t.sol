// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {InitDevService} from "@crane/contracts/InitDevService.sol";
import {ICreate3FactoryProxy} from "@crane/contracts/interfaces/proxies/ICreate3FactoryProxy.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";

import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";
import {PokerDeployLib} from "../../../script/PokerDeployLib.sol";

/// @notice Anvil-style smoke test for the composite deployment logic: this test
///         contract is the factory operator (via initEnv) and calls the deploy
///         library directly, so the factory calls inline into operator context —
///         mirroring a `forge script` broadcast from the deployer EOA.
contract PokerSystemDeployTest is Test {
    ICreate3FactoryProxy internal factory;
    IDiamondPackageCallBackFactory internal diamondFactory;
    address internal operator = makeAddr("operator");

    function setUp() public {
        (factory, diamondFactory) = InitDevService.initEnv(address(this));
    }

    function test_deploySystem_wiresAndOperates() public {
        ERC20Mock token = new ERC20Mock("Chip", "CHIP");
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);

        (address oracle, address[] memory settlers) =
            PokerDeployLib.deploySystem(factory, diamondFactory, address(this), tokens);

        // Owner (this contract) seeds the oracle default.
        IBettingConfigOracle(oracle).setDefault(operator, 250);

        address settler = settlers[0];
        assertEq(IPokerHandSettler(settler).token(), address(token), "settler token");
        assertEq(address(IPokerHandSettler(settler).oracle()), oracle, "settler oracle ref");

        (address op, uint256 rakeBps) = IBettingConfigOracle(oracle).configOf(address(token));
        assertEq(op, operator, "operator");
        assertEq(rakeBps, 250, "rakeBps");

        // The settler diamond is operable end-to-end (a deposit credits balance).
        token.mint(address(this), 100e18);
        token.approve(settler, 100e18);
        IPokerHandSettler(settler).deposit(100e18);
        assertEq(IPokerHandSettler(settler).balanceOf(address(this)), 100e18, "deposit credited");
    }

    function test_deploySystem_multipleTokensShareOracle() public {
        ERC20Mock tokenA = new ERC20Mock("A", "A");
        ERC20Mock tokenB = new ERC20Mock("B", "B");
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);

        (address oracle, address[] memory settlers) =
            PokerDeployLib.deploySystem(factory, diamondFactory, address(this), tokens);

        assertEq(settlers.length, 2, "two settlers");
        assertEq(IPokerHandSettler(settlers[0]).token(), address(tokenA));
        assertEq(IPokerHandSettler(settlers[1]).token(), address(tokenB));
        assertEq(address(IPokerHandSettler(settlers[0]).oracle()), oracle);
        assertEq(address(IPokerHandSettler(settlers[1]).oracle()), oracle);
        assertTrue(settlers[0] != settlers[1], "distinct settlers");
    }
}
