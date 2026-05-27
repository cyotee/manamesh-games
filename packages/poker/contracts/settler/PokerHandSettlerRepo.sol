// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IBettingConfigOracle} from "../oracle/IBettingConfigOracle.sol";

// tag::PokerHandSettlerRepo[]
/**
 * @title PokerHandSettlerRepo - Diamond storage for the poker hand settler.
 * @notice Holds the per-token escrow ledger (balance + locked per player), the
 *         per-hand lifecycle records, and the immutable token/oracle references.
 * @dev Crane Repo convention: a `Storage` struct on a dedicated slot with dual
 *      `_layout` overloads. Business logic lives in the Target; this library is
 *      storage + initialization only.
 */
library PokerHandSettlerRepo {
    // tag::STORAGE_SLOT[]
    bytes32 internal constant STORAGE_SLOT = keccak256(abi.encode("manamesh.poker.hand-settler"));
    // end::STORAGE_SLOT[]

    /// @dev Hand lifecycle states.
    enum HandStatus {
        None,
        Active,
        Settled
    }

    /// @dev Per-hand record. `lastActivity` seeds the force-timeout window.
    struct HandRecord {
        HandStatus status;
        uint64 lastActivity;
    }

    // tag::Storage[]
    struct Storage {
        address token;
        IBettingConfigOracle oracle;
        bool verifierEnabled;
        mapping(address => uint256) balanceOf;
        mapping(address => uint256) lockedOf;
        mapping(bytes32 => HandRecord) hands;
    }
    // end::Storage[]

    // tag::_layout(bytes32)[]
    function _layout(bytes32 slot) internal pure returns (Storage storage layout) {
        assembly {
            layout.slot := slot
        }
    }
    // end::_layout(bytes32)[]

    // tag::_layout()[]
    function _layout() internal pure returns (Storage storage) {
        return _layout(STORAGE_SLOT);
    }
    // end::_layout()[]

    // tag::_initialize(Storage-address-IBettingConfigOracle-bool)[]
    /**
     * @dev Initializes the settler's immutable config.
     * @param layout Storage pointer.
     * @param token The ERC20 this settler escrows.
     * @param oracle The configuration oracle for rake/operator lookups.
     * @param verifierEnabled Whether settlement runs the on-chain hand verifier.
     */
    function _initialize(Storage storage layout, address token, IBettingConfigOracle oracle, bool verifierEnabled)
        internal
    {
        layout.token = token;
        layout.oracle = oracle;
        layout.verifierEnabled = verifierEnabled;
    }
    // end::_initialize(Storage-address-IBettingConfigOracle-bool)[]

    // tag::_initialize(address-IBettingConfigOracle-bool)[]
    function _initialize(address token, IBettingConfigOracle oracle, bool verifierEnabled) internal {
        _initialize(_layout(), token, oracle, verifierEnabled);
    }
    // end::_initialize(address-IBettingConfigOracle-bool)[]
}
// end::PokerHandSettlerRepo[]
