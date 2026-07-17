// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {HandInit} from "../types/HandInit.sol";
import {HandOutcome} from "../types/HandOutcome.sol";
import {RoundStateTransition} from "../types/RoundStateTransition.sol";
import {HandIdLib} from "../lib/HandIdLib.sol";
import {SignatureLib} from "../lib/SignatureLib.sol";
import {PokerSettlementHashLib} from "../lib/PokerSettlementHashLib.sol";
import {IBettingConfigOracle} from "../oracle/IBettingConfigOracle.sol";
import {IPokerVerifierFacet} from "../verifier/IPokerVerifierFacet.sol";
import {IPokerHandSettler} from "./IPokerHandSettler.sol";
import {PokerHandSettlerErrors} from "./PokerHandSettlerErrors.sol";
import {PokerHandSettlerRepo} from "./PokerHandSettlerRepo.sol";

// tag::PokerHandSettlerTarget[]
/**
 * @title PokerHandSettlerTarget - Escrow + settlement logic for one ERC20.
 * @notice Implements deposit/withdraw, hand assertion (buy-in locking), and
 *         normal settlement. Force-timeout settlement and the on-chain verifier
 *         are implemented (verifier is optional via repo flag).
 * @dev Holds no storage of its own; all state lives in {PokerHandSettlerRepo}.
 *      Deployed standalone only for unit tests — composed into a diamond via its
 *      Facet in production.
 */
contract PokerHandSettlerTarget is IPokerHandSettler {
    using SafeERC20 for IERC20;

    uint256 internal constant MAX_BPS = 10_000;

    // ------------------------------- views ---------------------------------

    /// @inheritdoc IPokerHandSettler
    function token() external view returns (address) {
        return PokerHandSettlerRepo._layout().token;
    }

    /// @inheritdoc IPokerHandSettler
    function oracle() external view returns (IBettingConfigOracle) {
        return PokerHandSettlerRepo._layout().oracle;
    }

    /// @inheritdoc IPokerHandSettler
    function balanceOf(address player) external view returns (uint256) {
        return PokerHandSettlerRepo._layout().balanceOf[player];
    }

    /// @inheritdoc IPokerHandSettler
    function lockedOf(address player) external view returns (uint256) {
        return PokerHandSettlerRepo._layout().lockedOf[player];
    }

    // ---------------------------- deposit/withdraw --------------------------

    /// @inheritdoc IPokerHandSettler
    function deposit(uint256 amount) external {
        if (amount == 0) revert PokerHandSettlerErrors.ZeroAmount();
        PokerHandSettlerRepo.Storage storage s = PokerHandSettlerRepo._layout();
        IERC20(s.token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 newBalance = s.balanceOf[msg.sender] + amount;
        s.balanceOf[msg.sender] = newBalance;
        emit Deposited(msg.sender, amount, newBalance);
    }

    /// @inheritdoc IPokerHandSettler
    function withdraw(uint256 amount) external {
        if (amount == 0) revert PokerHandSettlerErrors.ZeroAmount();
        PokerHandSettlerRepo.Storage storage s = PokerHandSettlerRepo._layout();
        uint256 free = s.balanceOf[msg.sender] - s.lockedOf[msg.sender];
        if (amount > free) revert PokerHandSettlerErrors.InsufficientUnlockedBalance(free, amount);
        uint256 newBalance = s.balanceOf[msg.sender] - amount;
        s.balanceOf[msg.sender] = newBalance;
        emit Withdrawn(msg.sender, amount, newBalance);
        IERC20(s.token).safeTransfer(msg.sender, amount);
    }

    // --------------------------- assert membership --------------------------

    /// @inheritdoc IPokerHandSettler
    function assertHandMembership(HandInit calldata init, bytes[] calldata signatures) external {
        uint256 n = init.players.length;
        _validateHandInitShape(init, n);
        if (signatures.length != n) revert PokerHandSettlerErrors.ArrayLengthMismatch();

        bytes32 handId = HandIdLib.handIdOf(init);
        PokerHandSettlerRepo.Storage storage s = PokerHandSettlerRepo._layout();
        if (s.hands[handId].status != PokerHandSettlerRepo.HandStatus.None) {
            revert PokerHandSettlerErrors.HandAlreadyAsserted(handId);
        }

        // Unanimous off-chain consent: every player must have signed the init.
        SignatureLib.requireSignedByAll(
            PokerSettlementHashLib.domainSeparator(), PokerSettlementHashLib.hashHandInit(init), init.players, signatures
        );

        uint256 pot;
        for (uint256 i = 0; i < n; ++i) {
            address player = init.players[i];
            uint256 buyIn = init.buyIns[i];
            if (buyIn == 0) revert PokerHandSettlerErrors.ZeroAmount();
            uint256 free = s.balanceOf[player] - s.lockedOf[player];
            if (buyIn > free) revert PokerHandSettlerErrors.InsufficientUnlockedBalance(free, buyIn);
            s.lockedOf[player] += buyIn;
            pot += buyIn;
        }

        s.hands[handId] = PokerHandSettlerRepo.HandRecord({
            status: PokerHandSettlerRepo.HandStatus.Active,
            lastActivity: uint64(block.timestamp)
        });
        emit HandAsserted(handId, pot, block.timestamp);
    }

    // ------------------------------- settle ---------------------------------

    /// @inheritdoc IPokerHandSettler
    function settleHand(HandInit calldata init, HandOutcome calldata outcome, bytes[] calldata winnerSignatures)
        external
    {
        uint256 n = init.players.length;
        if (outcome.finalStacks.length != n) revert PokerHandSettlerErrors.ArrayLengthMismatch();
        if (outcome.winners.length != outcome.payouts.length) revert PokerHandSettlerErrors.ArrayLengthMismatch();

        bytes32 handId = HandIdLib.handIdOf(init);
        PokerHandSettlerRepo.Storage storage s = PokerHandSettlerRepo._layout();
        if (s.hands[handId].status != PokerHandSettlerRepo.HandStatus.Active) {
            revert PokerHandSettlerErrors.HandNotActive(handId);
        }
        if (outcome.handId != handId) revert PokerHandSettlerErrors.HandIdMismatch(handId, outcome.handId);

        // Every declared winner must have signed the outcome (§11.9).
        SignatureLib.requireSignedByAll(
            PokerSettlementHashLib.domainSeparator(),
            PokerSettlementHashLib.hashHandOutcome(outcome),
            outcome.winners,
            winnerSignatures
        );

        // Level-1 on-chain verification of the declared winners (§11.11). Routed
        // through the diamond to the PokerVerifierFacet; skipped when disabled.
        if (s.verifierEnabled) {
            IPokerVerifierFacet(address(this)).verifyOutcome(init.players, outcome);
        }

        // Pot is the sum of the (already-locked) buy-ins.
        uint256 pot;
        for (uint256 i = 0; i < n; ++i) {
            pot += init.buyIns[i];
        }

        (address operator, uint256 rakeBps) = s.oracle.configOf(s.token);
        uint256 rake = (pot * rakeBps) / MAX_BPS;

        // Conservation: returned stacks + rake must equal the pot.
        uint256 stackSum;
        for (uint256 i = 0; i < n; ++i) {
            stackSum += outcome.finalStacks[i];
        }
        if (stackSum + rake != pot) revert PokerHandSettlerErrors.ConservationViolation(pot - rake, stackSum);

        // finalStacks-direct reconciliation: unlock + remove each buy-in, then
        // credit the final stack back to each player's balance.
        for (uint256 i = 0; i < n; ++i) {
            address player = init.players[i];
            uint256 buyIn = init.buyIns[i];
            s.lockedOf[player] -= buyIn;
            s.balanceOf[player] = s.balanceOf[player] - buyIn + outcome.finalStacks[i];
        }
        if (rake > 0) {
            s.balanceOf[operator] += rake;
        }

        s.hands[handId].status = PokerHandSettlerRepo.HandStatus.Settled;
        emit HandSettled(handId, pot, rake, operator, outcome.finalStateHash);
    }

    // --------------------------- force timeout ------------------------------

    /// @inheritdoc IPokerHandSettler
    /// @dev Same finalStacks-direct accounting as {settleHand}, but the verifier
    ///      is skipped (§11.11) and any declared winner without a valid signature
    ///      forfeits their entire share to the operator (§11.10). `lastRoundState`
    ///      must be signed by all players (§11.9) and is bound by handId.
    function forceTimeoutSettlement(
        HandInit calldata init,
        HandOutcome calldata outcome,
        bytes[] calldata partialSignatures,
        RoundStateTransition calldata lastRoundState,
        bytes[] calldata lastRoundSignatures
    ) external {
        _validateForceTimeoutArgs(init, outcome, partialSignatures);
        if (lastRoundSignatures.length != init.players.length) {
            revert PokerHandSettlerErrors.ArrayLengthMismatch();
        }

        bytes32 handId = HandIdLib.handIdOf(init);
        PokerHandSettlerRepo.Storage storage s = PokerHandSettlerRepo._layout();
        _requireForceTimeoutReady(s, init, outcome, lastRoundState, handId);

        // §11.9: lastRoundState is the on-chain pot proof; all original players signed it in-play.
        SignatureLib.requireSignedByAll(
            PokerSettlementHashLib.domainSeparator(),
            PokerSettlementHashLib.hashRoundStateTransition(lastRoundState),
            init.players,
            lastRoundSignatures
        );

        (uint256 pot, uint256 rake, address operator) = _potRakeWithConservation(s, init, outcome);
        uint256 forfeited = _distributeForceTimeout(s, init, outcome, partialSignatures, handId);

        if (rake + forfeited > 0) {
            s.balanceOf[operator] += rake + forfeited;
        }

        s.hands[handId].status = PokerHandSettlerRepo.HandStatus.Settled;
        emit ForceTimeoutSettled(handId, pot, rake, forfeited, operator);
    }

    /// @dev Validates HandInit structural constraints from PRD §11.4 / §11.8.
    function _validateHandInitShape(HandInit calldata init, uint256 n) private view {
        if (n < PokerHandSettlerRepo.MIN_PLAYERS || n > PokerHandSettlerRepo.MAX_PLAYERS) {
            revert PokerHandSettlerErrors.InvalidPlayerCount(n);
        }
        if (init.buyIns.length != n || init.playerHandNonces.length != n) {
            revert PokerHandSettlerErrors.ArrayLengthMismatch();
        }
        if (init.vault != address(this)) {
            revert PokerHandSettlerErrors.InvalidVault(address(this), init.vault);
        }
        // Strictly ascending address order (§11.8) — also rejects zero / duplicates.
        for (uint256 i = 1; i < n; ++i) {
            if (init.players[i] <= init.players[i - 1]) {
                revert PokerHandSettlerErrors.PlayersNotSorted();
            }
        }
        if (init.players[0] == address(0)) revert PokerHandSettlerErrors.PlayersNotSorted();
    }

    /// @dev Length-consistency checks for the force-timeout arrays.
    function _validateForceTimeoutArgs(
        HandInit calldata init,
        HandOutcome calldata outcome,
        bytes[] calldata partialSignatures
    ) private pure {
        if (outcome.finalStacks.length != init.players.length) revert PokerHandSettlerErrors.ArrayLengthMismatch();
        if (outcome.winners.length != outcome.payouts.length || partialSignatures.length != outcome.winners.length) {
            revert PokerHandSettlerErrors.ArrayLengthMismatch();
        }
    }

    /// @dev Status / handId binding / timeout-window checks.
    function _requireForceTimeoutReady(
        PokerHandSettlerRepo.Storage storage s,
        HandInit calldata init,
        HandOutcome calldata outcome,
        RoundStateTransition calldata lastRoundState,
        bytes32 handId
    ) private view {
        PokerHandSettlerRepo.HandRecord memory rec = s.hands[handId];
        if (rec.status != PokerHandSettlerRepo.HandStatus.Active) {
            revert PokerHandSettlerErrors.HandNotActive(handId);
        }
        if (outcome.handId != handId) revert PokerHandSettlerErrors.HandIdMismatch(handId, outcome.handId);
        if (lastRoundState.handId != handId) {
            revert PokerHandSettlerErrors.HandIdMismatch(handId, lastRoundState.handId);
        }
        uint256 readyTime = uint256(rec.lastActivity) + init.timeoutSeconds;
        if (block.timestamp < readyTime) {
            revert PokerHandSettlerErrors.TimeoutNotElapsed(block.timestamp, readyTime);
        }
    }

    /// @dev Computes the pot + oracle rake + operator and enforces conservation.
    function _potRakeWithConservation(
        PokerHandSettlerRepo.Storage storage s,
        HandInit calldata init,
        HandOutcome calldata outcome
    ) private view returns (uint256 pot, uint256 rake, address operator) {
        uint256 n = init.players.length;
        for (uint256 i = 0; i < n; ++i) {
            pot += init.buyIns[i];
        }
        uint256 rakeBps;
        (operator, rakeBps) = s.oracle.configOf(s.token);
        rake = (pot * rakeBps) / MAX_BPS;

        uint256 stackSum;
        for (uint256 i = 0; i < n; ++i) {
            stackSum += outcome.finalStacks[i];
        }
        if (stackSum + rake != pot) revert PokerHandSettlerErrors.ConservationViolation(pot - rake, stackSum);
    }

    /// @dev Unlocks + removes each buy-in, then credits each player's final stack
    ///      unless they are a declared winner lacking a valid signature (forfeit).
    /// @return forfeited The total amount redirected to the operator.
    function _distributeForceTimeout(
        PokerHandSettlerRepo.Storage storage s,
        HandInit calldata init,
        HandOutcome calldata outcome,
        bytes[] calldata partialSignatures,
        bytes32 handId
    ) private returns (uint256 forfeited) {
        bytes32 domain = PokerSettlementHashLib.domainSeparator();
        bytes32 outcomeHash = PokerSettlementHashLib.hashHandOutcome(outcome);
        for (uint256 i = 0; i < init.players.length; ++i) {
            address player = init.players[i];
            s.lockedOf[player] -= init.buyIns[i];
            s.balanceOf[player] -= init.buyIns[i];
            uint256 stack = outcome.finalStacks[i];
            if (stack == 0) continue;
            if (_isUnsignedWinner(outcome, partialSignatures, domain, outcomeHash, player)) {
                forfeited += stack;
                emit PlayerForfeited(handId, player, stack);
            } else {
                s.balanceOf[player] += stack;
            }
        }
    }

    /// @dev True iff `player` is a declared winner whose signature is missing or
    ///      does not recover to them.
    function _isUnsignedWinner(
        HandOutcome calldata outcome,
        bytes[] calldata partialSignatures,
        bytes32 domain,
        bytes32 outcomeHash,
        address player
    ) private pure returns (bool) {
        for (uint256 j = 0; j < outcome.winners.length; ++j) {
            if (outcome.winners[j] == player) {
                bytes calldata sig = partialSignatures[j];
                if (sig.length != 65) return true;
                return SignatureLib.recoverEIP712(domain, outcomeHash, sig) != player;
            }
        }
        return false;
    }
}
// end::PokerHandSettlerTarget[]
