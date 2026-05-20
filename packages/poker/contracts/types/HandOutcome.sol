// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Off-chain signed payload at showdown. holeCards[][] is parallel to
///         HandInit.players[]; each inner has 2 cards encoded as (rank<<4)|suit.
struct HandOutcome {
    bytes32 handId;
    uint256 pot;
    address[] winners;
    uint256[] payouts;
    uint256[] finalStacks;
    bytes32 finalStateHash;
    uint8[2][] holeCards;
    uint8[5] communityCards;
}

bytes32 constant HAND_OUTCOME_TYPEHASH = keccak256(
    "HandOutcome(bytes32 handId,uint256 pot,address[] winners,uint256[] payouts,uint256[] finalStacks,bytes32 finalStateHash,uint8[2][] holeCards,uint8[5] communityCards)"
);
