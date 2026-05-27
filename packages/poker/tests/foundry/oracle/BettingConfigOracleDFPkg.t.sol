// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {InitDevService} from "@crane/contracts/InitDevService.sol";
import {ICreate3FactoryProxy} from "@crane/contracts/interfaces/proxies/ICreate3FactoryProxy.sol";
import {IDiamondFactoryPackage} from "@crane/contracts/interfaces/IDiamondFactoryPackage.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IMultiStepOwnable} from "@crane/contracts/interfaces/IMultiStepOwnable.sol";
import {MultiStepOwnableFacet} from "@crane/contracts/access/ERC8023/MultiStepOwnableFacet.sol";
import {BetterEfficientHashLib} from "@crane/contracts/utils/BetterEfficientHashLib.sol";

import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {BettingConfigOracleErrors} from "../../../contracts/oracle/BettingConfigOracleErrors.sol";
import {BettingConfigOracleFacet} from "../../../contracts/oracle/BettingConfigOracleFacet.sol";
import {
    IBettingConfigOracleDFPkg,
    BettingConfigOracleDFPkg
} from "../../../contracts/oracle/BettingConfigOracleDFPkg.sol";

/// @notice End-to-end test: deploy the oracle as a Crane diamond via its DFPkg
///         and exercise the full API + ERC8023 ownership through the proxy.
contract BettingConfigOracleDFPkgTest is Test {
    using BetterEfficientHashLib for bytes;

    ICreate3FactoryProxy internal factory;
    IDiamondPackageCallBackFactory internal diamondFactory;

    IFacet internal oracleFacet;
    IFacet internal ownableFacet;

    IBettingConfigOracleDFPkg internal oraclePkg;
    address internal oracleProxy;

    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    address internal token = makeAddr("token");
    address internal defaultOp = makeAddr("defaultOp");
    address internal tokenOp = makeAddr("tokenOp");

    IBettingConfigOracleDFPkg.PkgArgs internal pkgArgs;

    function setUp() public {
        (factory, diamondFactory) = InitDevService.initEnv(address(this));

        oracleFacet = factory.deployFacet(
            type(BettingConfigOracleFacet).creationCode, abi.encode(type(BettingConfigOracleFacet).name)._hash()
        );
        ownableFacet = factory.deployFacet(
            type(MultiStepOwnableFacet).creationCode, abi.encode(type(MultiStepOwnableFacet).name)._hash()
        );

        oraclePkg = IBettingConfigOracleDFPkg(
            address(
                factory.deployPackageWithArgs(
                    type(BettingConfigOracleDFPkg).creationCode,
                    abi.encode(
                        IBettingConfigOracleDFPkg.PkgInit({
                            oracleFacet: oracleFacet,
                            ownableFacet: ownableFacet,
                            diamondFactory: diamondFactory
                        })
                    ),
                    abi.encode(type(BettingConfigOracleDFPkg).name)._hash()
                )
            )
        );

        pkgArgs = IBettingConfigOracleDFPkg.PkgArgs({owner: owner, optionalSalt: keccak256("oracle-1")});

        oracleProxy = diamondFactory.deploy(IDiamondFactoryPackage(address(oraclePkg)), abi.encode(pkgArgs));
    }

    function test_bootstrap_deploysProxyWithOwner() public view {
        assertTrue(oracleProxy != address(0), "oracle proxy should be deployed");
        assertEq(IMultiStepOwnable(oracleProxy).owner(), owner, "owner should be initialized");
    }

    function test_calcAddress_matchesDeployedProxy() public view {
        address predicted = diamondFactory.calcAddress(IDiamondFactoryPackage(address(oraclePkg)), abi.encode(pkgArgs));
        assertEq(predicted, oracleProxy, "predicted address must match deployed proxy");
    }

    function test_owner_setsDefaultThroughProxy() public {
        vm.prank(owner);
        IBettingConfigOracle(oracleProxy).setDefault(defaultOp, 250);

        (address op, uint256 rake) = IBettingConfigOracle(oracleProxy).defaultConfig();
        assertEq(op, defaultOp);
        assertEq(rake, 250);
    }

    function test_setDefault_revertsForNonOwnerThroughProxy() public {
        vm.expectRevert(abi.encodeWithSelector(IMultiStepOwnable.NotOwner.selector, stranger));
        vm.prank(stranger);
        IBettingConfigOracle(oracleProxy).setDefault(defaultOp, 250);
    }

    function test_tokenOverrideAndFallbackThroughProxy() public {
        vm.startPrank(owner);
        IBettingConfigOracle(oracleProxy).setDefault(defaultOp, 250);
        IBettingConfigOracle(oracleProxy).setTokenConfig(token, tokenOp, 100);
        vm.stopPrank();

        (address op, uint256 rake) = IBettingConfigOracle(oracleProxy).configOf(token);
        assertEq(op, tokenOp);
        assertEq(rake, 100);

        // A token with no override falls back to the default.
        (address dop, uint256 drake) = IBettingConfigOracle(oracleProxy).configOf(makeAddr("otherToken"));
        assertEq(dop, defaultOp);
        assertEq(drake, 250);
    }

    function test_setDefault_validationThroughProxy() public {
        vm.expectRevert(BettingConfigOracleErrors.ZeroOperator.selector);
        vm.prank(owner);
        IBettingConfigOracle(oracleProxy).setDefault(address(0), 250);
    }
}
