// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {HandInit, HAND_INIT_TYPEHASH} from "../types/HandInit.sol";
import {HandOutcome, HAND_OUTCOME_TYPEHASH} from "../types/HandOutcome.sol";

// tag::PokerSettlementHashLib[]
/**
 * @title PokerSettlementHashLib - EIP-712 domain + struct hashing for the settler.
 * @notice Builds the settler's domain separator and the EIP-712 struct hashes
 *         for HandInit / HandOutcome so signatures can be recovered on-chain.
 * @dev The domain uses `address(this)` of the calling (proxy) context as the
 *      verifyingContract, matching the off-chain viem domain
 *      `{ name: 'PokerHandSettler', version: '1', chainId, verifyingContract }`.
 * @dev NOTE: the HandOutcome nested-array encoding here is the canonical
 *      reference for the TS signer (Phase 7) and is reconciled for cross-stack
 *      parity in Phase 8.
 */
library PokerSettlementHashLib {
    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant DOMAIN_NAME = keccak256(bytes("PokerHandSettler"));
    bytes32 private constant DOMAIN_VERSION = keccak256(bytes("1"));

    // tag::domainSeparator()[]
    /// @dev Domain separator bound to the calling contract (the diamond proxy).
    function domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, DOMAIN_NAME, DOMAIN_VERSION, block.chainid, address(this))
        );
    }
    // end::domainSeparator()[]

    // tag::hashHandInit(HandInit)[]
    /// @dev EIP-712 struct hash of a HandInit. Dynamic atomic arrays are hashed
    ///      as keccak256 of their tightly-packed 32-byte-word encodings.
    function hashHandInit(HandInit memory init) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                HAND_INIT_TYPEHASH,
                keccak256(abi.encodePacked(init.players)),
                keccak256(abi.encodePacked(init.buyIns)),
                init.vault,
                init.smallBlind,
                init.bigBlind,
                init.timeoutSeconds,
                init.otherConfig,
                keccak256(abi.encodePacked(init.playerHandNonces))
            )
        );
    }
    // end::hashHandInit(HandInit)[]

    // tag::hashHandOutcome(HandOutcome)[]
    /// @dev EIP-712 struct hash of a HandOutcome.
    function hashHandOutcome(HandOutcome memory outcome) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                HAND_OUTCOME_TYPEHASH,
                outcome.handId,
                outcome.pot,
                keccak256(abi.encodePacked(outcome.winners)),
                keccak256(abi.encodePacked(outcome.payouts)),
                keccak256(abi.encodePacked(outcome.finalStacks)),
                outcome.finalStateHash,
                _hashHoleCards(outcome.holeCards),
                _hashCommunityCards(outcome.communityCards)
            )
        );
    }
    // end::hashHandOutcome(HandOutcome)[]

    /// @dev Hash of `uint8[2][]`: keccak of the concatenation of each inner
    ///      pair's hash (each inner element widened to a 32-byte word).
    function _hashHoleCards(uint8[2][] memory holeCards) private pure returns (bytes32) {
        bytes32[] memory innerHashes = new bytes32[](holeCards.length);
        for (uint256 i = 0; i < holeCards.length; ++i) {
            innerHashes[i] = keccak256(abi.encode(uint256(holeCards[i][0]), uint256(holeCards[i][1])));
        }
        return keccak256(abi.encodePacked(innerHashes));
    }

    /// @dev Hash of `uint8[5]`: keccak of the five elements as 32-byte words.
    function _hashCommunityCards(uint8[5] memory communityCards) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                uint256(communityCards[0]),
                uint256(communityCards[1]),
                uint256(communityCards[2]),
                uint256(communityCards[3]),
                uint256(communityCards[4])
            )
        );
    }
}
// end::PokerSettlementHashLib[]
