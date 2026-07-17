// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {CraneTest} from "@crane/contracts/test/CraneTest.sol";
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";

import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {RoundStateTransition} from "../../../contracts/types/RoundStateTransition.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";
import {IBettingConfigOracle} from "../../../contracts/oracle/IBettingConfigOracle.sol";
import {IPokerHandSettler} from "../../../contracts/settler/IPokerHandSettler.sol";
import {ERC20Mock} from "../../../contracts/settler/_test/ERC20Mock.sol";
import {PokerDeployLib} from "../../../script/PokerDeployLib.sol";

/**
 * @title TestBase_PokerSystem
 * @notice Crane-aligned production-first setup for poker settler tests.
 * @dev Inherits {CraneTest} so Create3 + DiamondPackage factories are fully
 *      initialized (LR-7). Deploys the real oracle + settler diamonds via
 *      {PokerDeployLib} — the same path as production scripts. Prefer this
 *      base over bare `new Target()` harnesses for integration coverage.
 */
abstract contract TestBase_PokerSystem is CraneTest {
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    ERC20Mock internal chip;
    address internal oracleProxy;
    address internal settlerProxy;
    address internal operator = makeAddr("operator");

    uint256 internal constant BUY_IN = 100e18;
    uint256 internal constant TIMEOUT = 300;
    uint256 internal constant RAKE_BPS = 250; // 2.5%

    /// @dev Deterministic test keys. Address order: bob < alice (strictly ascending).
    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    address internal alice;
    address internal bob;

    function setUp() public virtual override {
        CraneTest.setUp();

        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        // Enforce documented sort invariant so HandInit tests stay stable.
        assertTrue(bob < alice, "fixture assumes bob < alice by address");

        chip = new ERC20Mock("Chip", "CHIP");
        address[] memory tokens = new address[](1);
        tokens[0] = address(chip);

        address[] memory settlers;
        (oracleProxy, settlers) = PokerDeployLib.deploySystem(create3Factory, diamondFactory, address(this), tokens);
        settlerProxy = settlers[0];

        IBettingConfigOracle(oracleProxy).setDefault(operator, RAKE_BPS);
    }

    function _fund(address who, uint256 amount) internal {
        chip.mint(who, amount);
        vm.startPrank(who);
        chip.approve(settlerProxy, type(uint256).max);
        IPokerHandSettler(settlerProxy).deposit(amount);
        vm.stopPrank();
    }

    function _fundDefault() internal {
        _fund(alice, 1_000e18);
        _fund(bob, 1_000e18);
    }

    /// @dev Two-player HandInit with players strictly ascending: [bob, alice].
    function _twoPlayerInit() internal view returns (HandInit memory init) {
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
                DOMAIN_TYPEHASH,
                keccak256(bytes("PokerHandSettler")),
                keccak256(bytes("1")),
                block.chainid,
                settlerProxy
            )
        );
    }

    function _sign(uint256 pk, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSep(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signInit(HandInit memory init) internal view returns (bytes[] memory sigs) {
        bytes32 sh = PokerSettlementHashLib.hashHandInit(init);
        sigs = new bytes[](2);
        // Parallel to sorted players [bob, alice].
        sigs[0] = _sign(bobPk, sh);
        sigs[1] = _sign(alicePk, sh);
    }

    function _assertTwoPlayerHand() internal returns (HandInit memory init) {
        init = _twoPlayerInit();
        IPokerHandSettler(settlerProxy).assertHandMembership(init, _signInit(init));
    }

    function _c(uint8 rank, uint8 suit) internal pure returns (uint8) {
        return uint8((rank << 4) | suit);
    }

    /// @dev Alice (index 1) holds a royal flush; bob (index 0) holds junk.
    function _royalOutcomeAliceWins(uint256 bobStack, uint256 aliceStack)
        internal
        view
        returns (HandOutcome memory o)
    {
        HandInit memory init = _twoPlayerInit();
        o.handId = HandIdLib.handIdOf(init);
        o.pot = 2 * BUY_IN;
        o.winners = new address[](1);
        o.winners[0] = alice;
        o.payouts = new uint256[](1);
        o.payouts[0] = aliceStack;
        o.finalStacks = new uint256[](2);
        o.finalStacks[0] = bobStack;
        o.finalStacks[1] = aliceStack;
        o.finalStateHash = keccak256("final");
        o.holeCards = new uint8[2][](2);
        o.holeCards[0] = [_c(2, 3), _c(7, 1)]; // bob
        o.holeCards[1] = [_c(11, 2), _c(10, 2)]; // alice JT hearts
        o.communityCards = [_c(14, 2), _c(13, 2), _c(12, 2), _c(2, 0), _c(3, 1)];
    }

    function _lastRound(HandInit memory init) internal pure returns (RoundStateTransition memory r) {
        r.handId = HandIdLib.handIdOf(init);
        r.roundNumber = 3;
        r.currentPot = 2 * BUY_IN;
        r.playerStacks = new uint256[](2);
        r.actionHash = keccak256("actions");
    }

    function _signLastRound(HandInit memory init, RoundStateTransition memory rst)
        internal
        view
        returns (bytes[] memory sigs)
    {
        bytes32 sh = PokerSettlementHashLib.hashRoundStateTransition(rst);
        sigs = new bytes[](init.players.length);
        sigs[0] = _sign(bobPk, sh);
        sigs[1] = _sign(alicePk, sh);
    }

    function _rakeOf(uint256 pot) internal pure returns (uint256) {
        return (pot * RAKE_BPS) / 10_000;
    }
}
