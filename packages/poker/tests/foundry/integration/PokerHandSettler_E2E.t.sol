// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";

import {InitDevService} from "@crane/contracts/InitDevService.sol";
import {ICreate3FactoryProxy} from "@crane/contracts/interfaces/proxies/ICreate3FactoryProxy.sol";
import {IDiamondFactoryPackage} from "@crane/contracts/interfaces/IDiamondFactoryPackage.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {MultiStepOwnableFacet} from "@crane/contracts/access/ERC8023/MultiStepOwnableFacet.sol";
import {BetterEfficientHashLib} from "@crane/contracts/utils/BetterEfficientHashLib.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {RoundStateTransition} from "../../../contracts/types/RoundStateTransition.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";

import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {BettingConfigOracleFacet} from "../../../contracts/oracle/BettingConfigOracleFacet.sol";
import {
    IBettingConfigOracleDFPkg,
    BettingConfigOracleDFPkg
} from "../../../contracts/oracle/BettingConfigOracleDFPkg.sol";

import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerFacet} from "../../../contracts/settler/PokerHandSettlerFacet.sol";
import {
    IPokerHandSettlerDFPkg,
    PokerHandSettlerDFPkg
} from "../../../contracts/settler/PokerHandSettlerDFPkg.sol";
import {IPokerVerifierFacet} from "../../../contracts/verifier/IPokerVerifierFacet.sol";
import {PokerVerifierFacet} from "../../../contracts/verifier/PokerVerifierFacet.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";

/// @notice Full-system E2E: real oracle diamond + real settler diamond, through
///         the Crane factories. Exercises deposit→assert→settle→withdraw, the
///         force-timeout flow, and verifier rejection of a wrong winner.
contract PokerHandSettlerE2ETest is Test {
    using BetterEfficientHashLib for bytes;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    ICreate3FactoryProxy internal factory;
    IDiamondPackageCallBackFactory internal diamondFactory;

    ERC20Mock internal chip;
    address internal oracleProxy;
    address internal settlerProxy;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    address internal alice;
    address internal bob;
    address internal operator = makeAddr("operator");

    uint256 internal constant BUY_IN = 100e18;
    uint256 internal constant TIMEOUT = 300;
    uint256 internal startTime;

    function setUp() public {
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        chip = new ERC20Mock("Chip", "CHIP");

        (factory, diamondFactory) = InitDevService.initEnv(address(this));

        oracleProxy = _deployOracle();
        IBettingConfigOracle(oracleProxy).setDefault(operator, 250); // owner == this

        settlerProxy = _deploySettler();

        _fund(alice);
        _fund(bob);
        startTime = block.timestamp;
    }

    function _deployOracle() internal returns (address) {
        IFacet oracleFacet = factory.deployFacet(
            type(BettingConfigOracleFacet).creationCode, abi.encode(type(BettingConfigOracleFacet).name)._hash()
        );
        IFacet ownableFacet = factory.deployFacet(
            type(MultiStepOwnableFacet).creationCode, abi.encode(type(MultiStepOwnableFacet).name)._hash()
        );
        IBettingConfigOracleDFPkg pkg = IBettingConfigOracleDFPkg(
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
        return pkg.deployOracle(address(this), keccak256("oracle"));
    }

    function _deploySettler() internal returns (address) {
        IFacet settlerFacet = factory.deployFacet(
            type(PokerHandSettlerFacet).creationCode, abi.encode(type(PokerHandSettlerFacet).name)._hash()
        );
        IFacet verifierFacet = factory.deployFacet(
            type(PokerVerifierFacet).creationCode, abi.encode(type(PokerVerifierFacet).name)._hash()
        );
        IPokerHandSettlerDFPkg pkg = IPokerHandSettlerDFPkg(
            address(
                factory.deployPackageWithArgs(
                    type(PokerHandSettlerDFPkg).creationCode,
                    abi.encode(
                        IPokerHandSettlerDFPkg.PkgInit({
                            settlerFacet: settlerFacet,
                            verifierFacet: verifierFacet,
                            diamondFactory: diamondFactory
                        })
                    ),
                    abi.encode(type(PokerHandSettlerDFPkg).name)._hash()
                )
            )
        );
        return pkg.deploySettler(address(chip), IBettingConfigOracle(oracleProxy), keccak256("settler"));
    }

    function _fund(address who) internal {
        chip.mint(who, 1_000e18);
        vm.startPrank(who);
        chip.approve(settlerProxy, type(uint256).max);
        IPokerHandSettler(settlerProxy).deposit(1_000e18);
        vm.stopPrank();
    }

    function _init() internal view returns (HandInit memory init) {
        // Sorted ascending: bob < alice by address for fixture keys.
        init.players = new address[](2);
        init.players[0] = bob;
        init.players[1] = alice;
        init.buyIns = new uint256[](2);
        init.buyIns[0] = BUY_IN;
        init.buyIns[1] = BUY_IN;
        init.vault = settlerProxy;
        init.smallBlind = 1e18;
        init.bigBlind = 2e18;
        init.timeoutSeconds = TIMEOUT;
        init.otherConfig = bytes32(uint256(7));
        init.playerHandNonces = new uint256[](2);
        init.playerHandNonces[0] = 1;
        init.playerHandNonces[1] = 1;
    }

    function _domainSep() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("PokerHandSettler")), keccak256(bytes("1")), block.chainid, settlerProxy
            )
        );
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSep(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _c(uint8 rank, uint8 suit) internal pure returns (uint8) {
        return uint8((rank << 4) | suit);
    }

    function _assertHand() internal {
        HandInit memory init = _init();
        bytes32 sh = PokerSettlementHashLib.hashHandInit(init);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(bobPk, sh);
        sigs[1] = _sign(alicePk, sh);
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
    }

    /// @dev Board A-K-Q hearts + 2c 3d; alice (index 1) holds J-T hearts (royal flush).
    ///      finalStacks parallel to sorted players [bob, alice].
    function _royalOutcome(address[] memory winners, uint256 bobStack, uint256 aliceStack)
        internal
        view
        returns (HandOutcome memory o)
    {
        o.handId = HandIdLib.handIdOf(_init());
        o.pot = 2 * BUY_IN;
        o.winners = winners;
        o.payouts = new uint256[](winners.length);
        o.finalStacks = new uint256[](2);
        o.finalStacks[0] = bobStack;
        o.finalStacks[1] = aliceStack;
        o.finalStateHash = keccak256("final");
        o.holeCards = new uint8[2][](2);
        o.holeCards[0] = [_c(2, 3), _c(7, 1)];
        o.holeCards[1] = [_c(11, 2), _c(10, 2)];
        o.communityCards = [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)];
    }

    function test_E2E_depositAssertSettleWithdraw() public {
        _assertHand();
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(alice), BUY_IN);

        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _royalOutcome(winners, 0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        IPokerHandSettler(settlerProxy).settleHand(_init(), o, wsigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 1_095e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(bob), 900e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), 5e18);

        // alice withdraws to her wallet
        vm.prank(alice);
        IPokerHandSettler(settlerProxy).withdraw(1_095e18);
        assertEq(chip.balanceOf(alice), 1_095e18);
    }

    function test_E2E_verifierRejectsWrongWinner() public {
        _assertHand();
        // Declare bob the winner (he signs), but alice actually holds the royal.
        address[] memory winners = new address[](1);
        winners[0] = bob;
        HandOutcome memory o = _royalOutcome(winners, 195e18, 0);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(bobPk, PokerSettlementHashLib.hashHandOutcome(o));

        vm.expectRevert(IPokerVerifierFacet.WinnerMismatch.selector);
        IPokerHandSettler(settlerProxy).settleHand(_init(), o, wsigs);
    }

    function test_E2E_forceTimeoutFlow() public {
        _assertHand();
        vm.warp(startTime + TIMEOUT + 1);

        address[] memory winners = new address[](1);
        winners[0] = alice;
        HandOutcome memory o = _royalOutcome(winners, 0, 195e18);
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        RoundStateTransition memory rst;
        rst.handId = HandIdLib.handIdOf(_init());
        rst.roundNumber = 3;
        rst.currentPot = 2 * BUY_IN;
        rst.playerStacks = new uint256[](2);
        rst.actionHash = keccak256("actions");

        bytes[] memory lrSigs = new bytes[](2);
        bytes32 lrHash = PokerSettlementHashLib.hashRoundStateTransition(rst);
        lrSigs[0] = _sign(bobPk, lrHash);
        lrSigs[1] = _sign(alicePk, lrHash);

        // Anyone can submit after timeout; bob submits.
        vm.prank(bob);
        IPokerHandSettler(settlerProxy).forceTimeoutSettlement(_init(), o, sigs, rst, lrSigs);

        assertEq(IPokerHandSettler(settlerProxy).balanceOf(alice), 1_095e18);
        assertEq(IPokerHandSettler(settlerProxy).balanceOf(operator), 5e18);
    }
}
