// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IMultiStepOwnable} from "@crane/contracts/interfaces/IMultiStepOwnable.sol";
import {MultiStepOwnableRepo} from "@crane/contracts/access/ERC8023/MultiStepOwnableRepo.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {BettingConfigOracleErrors} from "../../../contracts/oracle/BettingConfigOracleErrors.sol";
import {BettingConfigOracleTarget} from "../../../contracts/oracle/BettingConfigOracleTarget.sol";

/// @notice Test harness exposing an owner bootstrap so the Target can be unit
///         tested via direct instantiation (in production the DFPkg initializes
///         the owner). Keeps the production Target free of test-only hooks.
contract BettingConfigOracleTargetHarness is BettingConfigOracleTarget {
    function initOwner(address initialOwner) external {
        MultiStepOwnableRepo._initialize(initialOwner, 0);
    }
}

/// @notice Direct-instantiation unit tests for the oracle Target. The diamond
///         (DFPkg) integration path is covered separately once the package +
///         facet exist.
contract BettingConfigOracleTargetTest is Test {
    BettingConfigOracleTargetHarness internal oracle;

    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    address internal token = makeAddr("token");
    address internal defaultOp = makeAddr("defaultOp");
    address internal tokenOp = makeAddr("tokenOp");

    function setUp() public {
        oracle = new BettingConfigOracleTargetHarness();
        oracle.initOwner(owner);
    }

    // ----------------------------- setDefault ------------------------------

    function test_setDefault_ownerSetsAndReads() public {
        vm.expectEmit(true, true, true, true);
        emit IBettingConfigOracle.DefaultUpdated(defaultOp, 250);
        vm.prank(owner);
        oracle.setDefault(defaultOp, 250);

        (address op, uint256 rake) = oracle.defaultConfig();
        assertEq(op, defaultOp);
        assertEq(rake, 250);
    }

    function test_setDefault_revertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiStepOwnable.NotOwner.selector, stranger));
        vm.prank(stranger);
        oracle.setDefault(defaultOp, 250);
    }

    function test_setDefault_revertsOnZeroOperator() public {
        vm.expectRevert(BettingConfigOracleErrors.ZeroOperator.selector);
        vm.prank(owner);
        oracle.setDefault(address(0), 250);
    }

    function test_setDefault_revertsWhenRakeAtOrAboveMax() public {
        vm.expectRevert(abi.encodeWithSelector(BettingConfigOracleErrors.RakeTooHigh.selector, uint256(10_000)));
        vm.prank(owner);
        oracle.setDefault(defaultOp, 10_000);
    }

    // ------------------------------ configOf --------------------------------

    function test_configOf_fallsBackToDefaultWhenNoOverride() public {
        vm.prank(owner);
        oracle.setDefault(defaultOp, 250);

        (address op, uint256 rake) = oracle.configOf(token);
        assertEq(op, defaultOp);
        assertEq(rake, 250);
    }

    function test_configOf_returnsOverrideWhenSet() public {
        vm.startPrank(owner);
        oracle.setDefault(defaultOp, 250);
        oracle.setTokenConfig(token, tokenOp, 100);
        vm.stopPrank();

        (address op, uint256 rake) = oracle.configOf(token);
        assertEq(op, tokenOp);
        assertEq(rake, 100);
    }

    // ---------------------------- setTokenConfig ----------------------------

    function test_setTokenConfig_revertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiStepOwnable.NotOwner.selector, stranger));
        vm.prank(stranger);
        oracle.setTokenConfig(token, tokenOp, 100);
    }

    function test_setTokenConfig_zeroOperatorClearsOverride() public {
        vm.startPrank(owner);
        oracle.setDefault(defaultOp, 250);
        oracle.setTokenConfig(token, tokenOp, 100);
        // Clearing the override (operator == 0) restores the default lookup.
        oracle.setTokenConfig(token, address(0), 0);
        vm.stopPrank();

        (address op, uint256 rake) = oracle.configOf(token);
        assertEq(op, defaultOp);
        assertEq(rake, 250);
    }

    function test_setTokenConfig_revertsWhenRakeAtOrAboveMax() public {
        vm.expectRevert(abi.encodeWithSelector(BettingConfigOracleErrors.RakeTooHigh.selector, uint256(10_001)));
        vm.prank(owner);
        oracle.setTokenConfig(token, tokenOp, 10_001);
    }

    function test_setTokenConfig_emitsConfigUpdated() public {
        vm.expectEmit(true, true, true, true);
        emit IBettingConfigOracle.ConfigUpdated(token, tokenOp, 100);
        vm.prank(owner);
        oracle.setTokenConfig(token, tokenOp, 100);
    }
}
