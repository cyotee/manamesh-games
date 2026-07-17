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
    // tag::DEFAULT_SLOT[]
    /// @dev ERC1967-style diamond storage slot (Crane LR-6): `keccak256(abi.encode(name)) - 1`.
    bytes32 internal constant DEFAULT_SLOT =
        bytes32(uint256(keccak256(abi.encode("manamesh.poker.hand-settler"))) - 1);
    /// @dev Legacy alias kept for call-site readability.
    bytes32 internal constant STORAGE_SLOT = DEFAULT_SLOT;
    // end::DEFAULT_SLOT[]

    uint256 internal constant MIN_PLAYERS = 2;
    uint256 internal constant MAX_PLAYERS = 9;

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

    // tag::_layoutStruct(bytes32)[]
    function _layoutStruct(bytes32 slot) internal pure returns (Storage storage layoutStruct) {
        assembly {
            layoutStruct.slot := slot
        }
    }
    // end::_layoutStruct(bytes32)[]

    // tag::_layoutStruct()[]
    function _layoutStruct() internal pure returns (Storage storage) {
        return _layoutStruct(DEFAULT_SLOT);
    }
    // end::_layoutStruct()[]

    // tag::_layout(bytes32)[]
    /// @dev Alias for {_layoutStruct(bytes32)} (historical call-site name).
    function _layout(bytes32 slot) internal pure returns (Storage storage layout) {
        return _layoutStruct(slot);
    }
    // end::_layout(bytes32)[]

    // tag::_layout()[]
    function _layout() internal pure returns (Storage storage) {
        return _layoutStruct();
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
