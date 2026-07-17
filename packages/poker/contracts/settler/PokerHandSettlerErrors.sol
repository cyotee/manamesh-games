// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

// tag::PokerHandSettlerErrors[]
/**
 * @title PokerHandSettlerErrors - Custom errors for the poker hand settler.
 */
library PokerHandSettlerErrors {
    /// @notice Withdrawal/lock would exceed the player's unlocked balance.
    /// @custom:signature InsufficientUnlockedBalance(uint256,uint256)
    error InsufficientUnlockedBalance(uint256 available, uint256 requested);

    /// @notice A zero amount was supplied where a positive amount is required.
    /// @custom:signature ZeroAmount()
    error ZeroAmount();

    /// @notice The recomputed handId did not match the supplied/outcome handId.
    /// @custom:signature HandIdMismatch(bytes32,bytes32)
    error HandIdMismatch(bytes32 expected, bytes32 supplied);

    /// @notice The hand has already been asserted (cannot re-assert).
    /// @custom:signature HandAlreadyAsserted(bytes32)
    error HandAlreadyAsserted(bytes32 handId);

    /// @notice The hand is not in the Active state required for this action.
    /// @custom:signature HandNotActive(bytes32)
    error HandNotActive(bytes32 handId);

    /// @notice Parallel arrays had mismatched lengths.
    /// @custom:signature ArrayLengthMismatch()
    error ArrayLengthMismatch();

    /// @notice An address expected to be a hand participant was not found.
    /// @custom:signature NotAParticipant(address)
    error NotAParticipant(address account);

    /// @notice Settlement payouts did not conserve the pot (sum != pot - rake).
    /// @custom:signature ConservationViolation(uint256,uint256)
    error ConservationViolation(uint256 expectedNet, uint256 actualNet);

    /// @notice Force-timeout attempted before the hand's timeout window elapsed.
    /// @custom:signature TimeoutNotElapsed(uint256,uint256)
    error TimeoutNotElapsed(uint256 currentTime, uint256 readyTime);

    /// @notice A function reserved for a later implementation phase was called.
    /// @custom:signature NotImplemented()
    error NotImplemented();

    /// @notice Player count is outside the allowed range `[MIN_PLAYERS, MAX_PLAYERS]`.
    /// @custom:signature InvalidPlayerCount(uint256)
    error InvalidPlayerCount(uint256 count);

    /// @notice `HandInit.players` is not strictly sorted ascending by address (§11.8).
    /// @custom:signature PlayersNotSorted()
    error PlayersNotSorted();

    /// @notice `HandInit.vault` does not match this settler instance.
    /// @custom:signature InvalidVault(address,address)
    error InvalidVault(address expected, address supplied);
}
// end::PokerHandSettlerErrors[]
