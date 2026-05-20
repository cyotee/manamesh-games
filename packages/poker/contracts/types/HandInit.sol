// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Off-chain unanimously-signed payload that fully describes a hand.
///         handId = keccak256(abi.encode(HandInit fields)).
/// @dev players[] MUST be sorted ascending. buyIns[] and playerHandNonces[]
///      MUST be parallel to players[].
struct HandInit {
    address[] players;
    uint256[] buyIns;
    address vault;
    uint256 smallBlind;
    uint256 bigBlind;
    uint256 timeoutSeconds;
    bytes32 otherConfig;
    uint256[] playerHandNonces;
}

bytes32 constant HAND_INIT_TYPEHASH = keccak256(
    "HandInit(address[] players,uint256[] buyIns,address vault,uint256 smallBlind,uint256 bigBlind,uint256 timeoutSeconds,bytes32 otherConfig,uint256[] playerHandNonces)"
);
