// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {HandInit} from "../types/HandInit.sol";
import {HandOutcome} from "../types/HandOutcome.sol";
import {RoundStateTransition} from "../types/RoundStateTransition.sol";
import {IBettingConfigOracle} from "../oracle/IBettingConfigOracle.sol";

// tag::IPokerHandSettler[]
/**
 * @title IPokerHandSettler - Trustless escrow + settlement engine for one ERC20.
 * @notice Players deposit a single ERC20 into a per-token settler, lock buy-ins
 *         by asserting a unanimously-signed hand, and settle to vault balances.
 * @dev `handId = keccak256(abi.encode(HandInit fields))`; every entry point that
 *      takes a `HandInit` recomputes it and reverts on mismatch (§11.8). Rake +
 *      operator are resolved live from the configuration oracle (§11.14).
 */
interface IPokerHandSettler {
    /// @notice Emitted when a player deposits into their vault balance.
    /// @custom:signature Deposited(address,uint256,uint256)
    event Deposited(address indexed player, uint256 amount, uint256 newBalance);

    /// @notice Emitted when a player withdraws unlocked balance.
    /// @custom:signature Withdrawn(address,uint256,uint256)
    event Withdrawn(address indexed player, uint256 amount, uint256 newBalance);

    /// @notice Emitted when a hand is asserted and its buy-ins locked.
    /// @custom:signature HandAsserted(bytes32,uint256,uint256)
    event HandAsserted(bytes32 indexed handId, uint256 pot, uint256 timestamp);

    /// @notice Emitted when a hand is settled.
    /// @custom:signature HandSettled(bytes32,uint256,uint256,address,bytes32)
    event HandSettled(bytes32 indexed handId, uint256 pot, uint256 rake, address operator, bytes32 finalStateHash);

    /// @notice Emitted when a hand is force-settled after timeout.
    /// @custom:signature ForceTimeoutSettled(bytes32,uint256,uint256,uint256,address)
    event ForceTimeoutSettled(bytes32 indexed handId, uint256 pot, uint256 rake, uint256 forfeited, address operator);

    /// @notice Emitted when a declared winner forfeits their share (no valid signature).
    /// @custom:signature PlayerForfeited(bytes32,address,uint256)
    event PlayerForfeited(bytes32 indexed handId, address indexed player, uint256 amount);

    /// @notice The ERC20 token this settler escrows.
    function token() external view returns (address);

    /// @notice The configuration oracle resolved for rake + operator at settlement.
    function oracle() external view returns (IBettingConfigOracle);

    /// @notice Total vault balance of `player` (locked + free).
    function balanceOf(address player) external view returns (uint256);

    /// @notice Amount of `player`'s balance currently locked across active hands.
    function lockedOf(address player) external view returns (uint256);

    /// @notice Deposits `amount` of the token into the caller's vault balance.
    function deposit(uint256 amount) external;

    /// @notice Withdraws `amount`; succeeds iff `amount <= balance - locked`.
    function withdraw(uint256 amount) external;

    /**
     * @notice Activates a hand: verifies all players signed `init`, recomputes
     *         the handId, and locks each player's buy-in.
     * @param init The unanimously-signed hand initialization.
     * @param signatures EIP-712 signatures parallel to `init.players`.
     */
    function assertHandMembership(HandInit calldata init, bytes[] calldata signatures) external;

    /**
     * @notice Settles an active hand to vault balances, taking oracle rake.
     * @param init The original hand initialization (handId recomputed from it).
     * @param outcome The showdown outcome; `outcome.handId` must match.
     * @param winnerSignatures EIP-712 signatures from every address in `outcome.winners`.
     */
    function settleHand(HandInit calldata init, HandOutcome calldata outcome, bytes[] calldata winnerSignatures)
        external;

    /**
     * @notice Force-settles a timed-out hand.
     * @dev Supports partial winner signatures; unsigned winners forfeit to the operator.
     *      lastRoundState is bound by handId (full signature verification on lastRoundState
     *      may be added in a future hardening pass).
     */
    function forceTimeoutSettlement(
        HandInit calldata init,
        HandOutcome calldata outcome,
        bytes[] calldata partialSignatures,
        RoundStateTransition calldata lastRoundState
    ) external;
}
// end::IPokerHandSettler[]
