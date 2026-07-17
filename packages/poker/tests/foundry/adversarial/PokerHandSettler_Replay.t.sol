// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {AdversarialHelpers} from "./AdversarialHelpers.sol";
import {CraneTest} from "@crane/contracts/test/CraneTest.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {SignatureLib} from "../../../contracts/lib/SignatureLib.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "../../../contracts/settler/PokerHandSettlerErrors.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";
import {PokerDeployLib} from "../../../script/PokerDeployLib.sol";

/**
 * @title PokerHandSettler_ReplayTest
 * @notice Signature / handId / domain replay attacks (A4).
 * @dev Dual-settler setup is done in setUp so both proxies share one package deploy.
 */
contract PokerHandSettler_ReplayTest is AdversarialHelpers {
    ERC20Mock internal chipB;
    address internal settlerB;

    function setUp() public override {
        // Crane bootstrap + dual-token production diamonds (one package, two settlers).
        CraneTest.setUp();

        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        assertTrue(bob < alice, "fixture order");

        chip = new ERC20Mock("Chip", "CHIP");
        chipB = new ERC20Mock("ChipB", "CHIPB");
        address[] memory tokens = new address[](2);
        tokens[0] = address(chip);
        tokens[1] = address(chipB);

        address[] memory settlers;
        (oracleProxy, settlers) = PokerDeployLib.deploySystem(create3Factory, diamondFactory, address(this), tokens);
        settlerProxy = settlers[0];
        settlerB = settlers[1];

        IBettingConfigOracle(oracleProxy).setDefault(operator, RAKE_BPS);
        _fundDefault();
    }

    /// A4a: Reuse HandInit signatures after mutating nonces (hash changes).
    function test_A4a_handInitSigReplayOnMutatedInit_reverts() public {
        HandInit memory init = _twoPlayerInit();
        bytes[] memory sigs = _signInit(init);

        init.playerHandNonces[0] = 99;
        init.playerHandNonces[1] = 99;

        BalanceSnap memory before_ = _snap();
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, bob));
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);

        _assertUnchanged(before_, _snap());
    }

    /// A4b: Outcome from hand H1 cannot settle hand H2.
    function test_A4b_handOutcomeReplayAcrossHands_reverts() public {
        HandInit memory h1 = _assertTwoPlayerHand();
        HandOutcome memory o1 = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o1));
        IPokerHandSettler(settlerProxy).settleHand(h1, o1, wsigs);

        HandInit memory h2 = _twoPlayerInit();
        h2.playerHandNonces[0] = 2;
        h2.playerHandNonces[1] = 2;
        IPokerHandSettler(settlerProxy).assertHandMembership(h2, _signInit(h2));

        BalanceSnap memory before_ = _snap();
        vm.expectRevert(
            abi.encodeWithSelector(
                PokerHandSettlerErrors.HandIdMismatch.selector, HandIdLib.handIdOf(h2), o1.handId
            )
        );
        IPokerHandSettler(settlerProxy).settleHand(h2, o1, wsigs);

        BalanceSnap memory after_ = _snap();
        assertEq(after_.alice, before_.alice);
        assertEq(after_.bob, before_.bob);
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(alice), BUY_IN);
    }

    /// A4c: Signatures for settler A rejected by settler B (domain verifyingContract).
    function test_A4c_crossSettlerSignatureRejected() public {
        // Fund settler B vaults.
        chipB.mint(bob, 1_000e18);
        chipB.mint(alice, 1_000e18);
        vm.startPrank(bob);
        chipB.approve(settlerB, type(uint256).max);
        IPokerHandSettler(settlerB).deposit(1_000e18);
        vm.stopPrank();
        vm.startPrank(alice);
        chipB.approve(settlerB, type(uint256).max);
        IPokerHandSettler(settlerB).deposit(1_000e18);
        vm.stopPrank();

        HandInit memory initB;
        initB.players = new address[](2);
        initB.players[0] = bob;
        initB.players[1] = alice;
        initB.buyIns = new uint256[](2);
        initB.buyIns[0] = BUY_IN;
        initB.buyIns[1] = BUY_IN;
        initB.vault = settlerB;
        initB.smallBlind = 1e18;
        initB.bigBlind = 2e18;
        initB.timeoutSeconds = TIMEOUT;
        initB.otherConfig = bytes32(uint256(7));
        initB.playerHandNonces = new uint256[](2);
        initB.playerHandNonces[0] = 1;
        initB.playerHandNonces[1] = 1;

        // Sign under settler A's domain (wrong verifyingContract for B).
        bytes32 domainA = _domainSepFor(settlerProxy);
        bytes32 sh = PokerSettlementHashLib.hashHandInit(initB);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signWithDomain(bobPk, domainA, sh);
        sigs[1] = _signWithDomain(alicePk, domainA, sh);

        uint256 bobBefore = IPokerHandSettler(settlerB).balanceOf(bob);
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, bob));
        IPokerHandSettler(settlerB).assertHandMembership(initB, sigs);
        assertEq(IPokerHandSettler(settlerB).balanceOf(bob), bobBefore);
        assertEq(IPokerHandSettler(settlerB).lockedOf(bob), 0);
    }

    /// A4d: Cannot re-assert the same hand after settlement (status not None).
    function test_A4d_reassertAfterSettle_reverts() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        BalanceSnap memory before_ = _snap();
        bytes32 handId = HandIdLib.handIdOf(init);
        vm.expectRevert(abi.encodeWithSelector(PokerHandSettlerErrors.HandAlreadyAsserted.selector, handId));
        IPokerHandSettler(settlerProxy).assertHandMembership(init, _signInit(init));

        _assertUnchanged(before_, _snap());
    }

    /// A4e: HandInit signatures bound to chainId A rejected after `vm.chainId` change.
    function test_A4e_chainIdDomainReplay_assert_reverts() public {
        HandInit memory init = _twoPlayerInit();
        bytes[] memory sigs = _signInit(init); // domain uses current block.chainid

        BalanceSnap memory before_ = _snap();
        uint256 original = block.chainid;
        vm.chainId(original + 999);

        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, bob));
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);

        // Restore for snap helpers that read domain-independent state.
        vm.chainId(original);
        _assertUnchanged(before_, _snap());
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(bob), 0);
    }

    /// A4e: HandOutcome signed under original chainId rejected after chainId changes.
    function test_A4e_chainIdDomainReplay_settle_reverts() public {
        HandInit memory init = _assertTwoPlayerHand();
        HandOutcome memory o = _royalOutcomeAliceWins(0, 195e18);
        bytes[] memory wsigs = new bytes[](1);
        wsigs[0] = _sign(alicePk, PokerSettlementHashLib.hashHandOutcome(o));

        BalanceSnap memory before_ = _snap();
        uint256 original = block.chainid;
        vm.chainId(original + 1);

        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, alice));
        IPokerHandSettler(settlerProxy).settleHand(init, o, wsigs);

        vm.chainId(original);
        BalanceSnap memory after_ = _snap();
        assertEq(after_.alice, before_.alice);
        assertEq(after_.bob, before_.bob);
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(alice), BUY_IN);
        assertEq(IPokerHandSettler(settlerProxy).lockedOf(bob), BUY_IN);
    }

    /// A4e: Explicit forged domain with wrong chainId (via `_signWithDomain`) rejected.
    function test_A4e_signWithWrongChainIdDomain_reverts() public {
        HandInit memory init = _twoPlayerInit();
        bytes32 wrongDomain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("PokerHandSettler")),
                keccak256(bytes("1")),
                block.chainid + 42,
                settlerProxy
            )
        );
        bytes32 sh = PokerSettlementHashLib.hashHandInit(init);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _signWithDomain(bobPk, wrongDomain, sh);
        sigs[1] = _signWithDomain(alicePk, wrongDomain, sh);

        BalanceSnap memory before_ = _snap();
        vm.expectRevert(abi.encodeWithSelector(SignatureLib.InvalidSignature.selector, 0, bob));
        IPokerHandSettler(settlerProxy).assertHandMembership(init, sigs);
        _assertUnchanged(before_, _snap());
    }
}
