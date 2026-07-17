// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {TestBase_IFacet} from "@crane/contracts/factories/diamondPkg/TestBase_IFacet.sol";
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";

import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {BettingConfigOracleFacet} from "../../../contracts/oracle/BettingConfigOracleFacet.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerFacet} from "../../../contracts/settler/PokerHandSettlerFacet.sol";
import {IPokerVerifierFacet} from "../../../contracts/verifier/IPokerVerifierFacet.sol";
import {PokerVerifierFacet} from "../../../contracts/verifier/PokerVerifierFacet.sol";

/**
 * @title PokerHandSettlerFacet_IFacetTest
 * @notice LR-7 IFacet declaration tests for {PokerHandSettlerFacet} via Behavior_IFacet.
 */
contract PokerHandSettlerFacet_IFacetTest is TestBase_IFacet {
    PokerHandSettlerFacet internal facet;

    function setUp() public override {
        facet = new PokerHandSettlerFacet();
        TestBase_IFacet.setUp();
    }

    function facetTestInstance() public view override returns (IFacet) {
        return IFacet(address(facet));
    }

    function controlFacetName() public pure override returns (string memory) {
        return "PokerHandSettlerFacet";
    }

    function controlFacetInterfaces() public pure override returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](1);
        interfaces[0] = type(IPokerHandSettler).interfaceId;
    }

    function controlFacetFuncs() public pure override returns (bytes4[] memory funcs) {
        funcs = new bytes4[](9);
        funcs[0] = IPokerHandSettler.token.selector;
        funcs[1] = IPokerHandSettler.oracle.selector;
        funcs[2] = IPokerHandSettler.balanceOf.selector;
        funcs[3] = IPokerHandSettler.lockedOf.selector;
        funcs[4] = IPokerHandSettler.deposit.selector;
        funcs[5] = IPokerHandSettler.withdraw.selector;
        funcs[6] = IPokerHandSettler.assertHandMembership.selector;
        funcs[7] = IPokerHandSettler.settleHand.selector;
        funcs[8] = IPokerHandSettler.forceTimeoutSettlement.selector;
    }
}

/**
 * @title BettingConfigOracleFacet_IFacetTest
 * @notice LR-7 IFacet declaration tests for {BettingConfigOracleFacet}.
 */
contract BettingConfigOracleFacet_IFacetTest is TestBase_IFacet {
    BettingConfigOracleFacet internal facet;

    function setUp() public override {
        facet = new BettingConfigOracleFacet();
        TestBase_IFacet.setUp();
    }

    function facetTestInstance() public view override returns (IFacet) {
        return IFacet(address(facet));
    }

    function controlFacetName() public pure override returns (string memory) {
        return "BettingConfigOracleFacet";
    }

    function controlFacetInterfaces() public pure override returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](1);
        interfaces[0] = type(IBettingConfigOracle).interfaceId;
    }

    function controlFacetFuncs() public pure override returns (bytes4[] memory funcs) {
        funcs = new bytes4[](4);
        funcs[0] = IBettingConfigOracle.configOf.selector;
        funcs[1] = IBettingConfigOracle.defaultConfig.selector;
        funcs[2] = IBettingConfigOracle.setTokenConfig.selector;
        funcs[3] = IBettingConfigOracle.setDefault.selector;
    }
}

/**
 * @title PokerVerifierFacet_IFacetTest
 * @notice LR-7 IFacet declaration tests for {PokerVerifierFacet}.
 */
contract PokerVerifierFacet_IFacetTest is TestBase_IFacet {
    PokerVerifierFacet internal facet;

    function setUp() public override {
        facet = new PokerVerifierFacet();
        TestBase_IFacet.setUp();
    }

    function facetTestInstance() public view override returns (IFacet) {
        return IFacet(address(facet));
    }

    function controlFacetName() public pure override returns (string memory) {
        return "PokerVerifierFacet";
    }

    function controlFacetInterfaces() public pure override returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](1);
        interfaces[0] = type(IPokerVerifierFacet).interfaceId;
    }

    function controlFacetFuncs() public pure override returns (bytes4[] memory funcs) {
        funcs = new bytes4[](1);
        funcs[0] = IPokerVerifierFacet.verifyOutcome.selector;
    }
}
