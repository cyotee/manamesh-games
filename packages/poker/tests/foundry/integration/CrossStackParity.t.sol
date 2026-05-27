// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandOutcome} from "../../../contracts/types/HandOutcome.sol";
import {SignatureLib} from "../../../contracts/lib/SignatureLib.sol";
import {PokerSettlementHashLib} from "../../../contracts/lib/PokerSettlementHashLib.sol";

/// @notice Proves the Solidity EIP-712 hashing matches viem's. The signatures
///         below are produced by `src/_parityVectors.test.ts` (fixed private key
///         + domain) and must recover the known signer on-chain. A mismatch
///         means {PokerSettlementHashLib} diverges from standard EIP-712.
contract CrossStackParityTest is Test {
    // anvil account #1, signer of the baked vectors
    address internal constant SIGNER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant VERIFYING = address(uint160(0xdead));

    bytes internal constant HAND_INIT_SIG =
        hex"a49a8872ac726abc18594fd3b8de9b76d77c17c81f7c659a32e8dbe9322e42272a4a7659b2d8d77a22128cd8180273738e7ec2217153567d10b89c4bdb99cd1c1b";
    bytes internal constant HAND_OUTCOME_SIG =
        hex"e52dac640e100fc9467597e2f293d0a4d672e7305956e8ebdd300377b98d515b01d2eefa318029b5f2c1c6a2ac553f9fbaaf6d1fe205ab32c2620bae471742801c";

    function setUp() public {
        vm.chainId(31337);
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("PokerHandSettler")),
                keccak256(bytes("1")),
                block.chainid,
                VERIFYING
            )
        );
    }

    function _canonicalInit() internal pure returns (HandInit memory h) {
        h.players = new address[](2);
        h.players[0] = address(uint160(0xaaa));
        h.players[1] = address(uint160(0xbbb));
        h.buyIns = new uint256[](2);
        h.buyIns[0] = 100;
        h.buyIns[1] = 100;
        h.vault = address(uint160(0xccc));
        h.smallBlind = 1;
        h.bigBlind = 2;
        h.timeoutSeconds = 300;
        h.otherConfig = bytes32(uint256(42));
        h.playerHandNonces = new uint256[](2);
        h.playerHandNonces[0] = 1;
        h.playerHandNonces[1] = 1;
    }

    function _canonicalOutcome() internal pure returns (HandOutcome memory o) {
        o.handId = bytes32(uint256(1));
        o.pot = 200;
        o.winners = new address[](1);
        o.winners[0] = address(uint160(0xaaa));
        o.payouts = new uint256[](1);
        o.payouts[0] = 195;
        o.finalStacks = new uint256[](2);
        o.finalStacks[0] = 195;
        o.finalStacks[1] = 0;
        o.finalStateHash = bytes32(uint256(2));
        o.holeCards = new uint8[2][](2);
        o.holeCards[0] = [uint8(0xe2), uint8(0xd2)];
        o.holeCards[1] = [uint8(0x23), uint8(0x73)];
        o.communityCards = [uint8(0xc2), uint8(0xb2), uint8(0xa2), uint8(0x20), uint8(0x31)];
    }

    function test_handInit_viemSignatureRecoversOnChain() public view {
        address recovered = SignatureLib.recoverEIP712(
            _domainSeparator(), PokerSettlementHashLib.hashHandInit(_canonicalInit()), HAND_INIT_SIG
        );
        assertEq(recovered, SIGNER, "HandInit EIP-712 hashing diverges from viem");
    }

    function test_handOutcome_viemSignatureRecoversOnChain() public view {
        address recovered = SignatureLib.recoverEIP712(
            _domainSeparator(), PokerSettlementHashLib.hashHandOutcome(_canonicalOutcome()), HAND_OUTCOME_SIG
        );
        assertEq(recovered, SIGNER, "HandOutcome EIP-712 hashing diverges from viem");
    }
}
