// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

struct RoundStateTransition {
    bytes32 handId;
    uint8 roundNumber;
    uint256 currentPot;
    uint256[] playerStacks;
    bytes32 actionHash;
}

bytes32 constant ROUND_STATE_TRANSITION_TYPEHASH = keccak256(
    "RoundStateTransition(bytes32 handId,uint8 roundNumber,uint256 currentPot,uint256[] playerStacks,bytes32 actionHash)"
);
