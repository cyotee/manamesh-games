// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";
import {BettingConfigOracleErrors} from "./BettingConfigOracleErrors.sol";

// tag::BettingConfigOracleRepo[]
/**
 * @title BettingConfigOracleRepo - Diamond storage for per-token rake config.
 * @notice Holds the global default `(operator, rakeBps)` plus per-token
 *         overrides, and the read/write helpers used by the Target/Facet.
 * @dev Follows the Crane Repo convention: a `Storage` struct bound to a
 *      dedicated slot via dual `_layout` overloads, with every helper offered
 *      in both a slot-parameterized and a default-slot form.
 */
library BettingConfigOracleRepo {
    // tag::DEFAULT_SLOT[]
    /**
     * @dev ERC1967-style diamond storage slot (Crane LR-6).
     */
    bytes32 internal constant DEFAULT_SLOT =
        bytes32(uint256(keccak256(abi.encode("manamesh.oracle.betting-config"))) - 1);
    /// @dev Legacy alias.
    bytes32 internal constant STORAGE_SLOT = DEFAULT_SLOT;
    // end::DEFAULT_SLOT[]

    /**
     * @dev Basis-point denominator; a rake must be strictly below this.
     */
    uint256 internal constant MAX_BPS = 10_000;

    // tag::Storage[]
    /**
     * @dev Storage layout: the global default entry and per-token overrides.
     * @param defaultEntry Applied when a token has no override.
     * @param tokenEntries Per-token overrides; an entry with a zero operator is
     *        treated as "no override" by {_configOf}.
     */
    struct Storage {
        IBettingConfigOracle.Entry defaultEntry;
        mapping(address => IBettingConfigOracle.Entry) tokenEntries;
    }
    // end::Storage[]

    // tag::_layout(bytes32)[]
    /**
     * @dev Slot-parameterized layout binding.
     * @param slot Storage slot to bind to the Repo's Storage struct.
     * @return layout The bound Storage struct.
     */
    function _layout(bytes32 slot) internal pure returns (Storage storage layout) {
        assembly {
            layout.slot := slot
        }
    }
    // end::_layout(bytes32)[]

    // tag::_layout()[]
    /**
     * @dev Default layout binding to the standard STORAGE_SLOT.
     * @return layout The bound Storage struct.
     */
    function _layout() internal pure returns (Storage storage) {
        return _layout(STORAGE_SLOT);
    }
    // end::_layout()[]

    // tag::_configOf(Storage-address)[]
    /**
     * @dev Resolves the effective config for `token`: the token override when
     *      its operator is non-zero, otherwise the global default.
     */
    function _configOf(Storage storage layout, address token)
        internal
        view
        returns (address operator, uint256 rakeBps)
    {
        IBettingConfigOracle.Entry storage entry = layout.tokenEntries[token];
        if (entry.operator != address(0)) {
            return (entry.operator, entry.rakeBps);
        }
        return (layout.defaultEntry.operator, layout.defaultEntry.rakeBps);
    }
    // end::_configOf(Storage-address)[]

    // tag::_configOf(address)[]
    /**
     * @dev Default-slot {_configOf}.
     */
    function _configOf(address token) internal view returns (address operator, uint256 rakeBps) {
        return _configOf(_layout(), token);
    }
    // end::_configOf(address)[]

    // tag::_defaultConfig(Storage)[]
    /**
     * @dev Returns the global default `(operator, rakeBps)`.
     */
    function _defaultConfig(Storage storage layout) internal view returns (address operator, uint256 rakeBps) {
        return (layout.defaultEntry.operator, layout.defaultEntry.rakeBps);
    }
    // end::_defaultConfig(Storage)[]

    // tag::_defaultConfig()[]
    /**
     * @dev Default-slot {_defaultConfig}.
     */
    function _defaultConfig() internal view returns (address operator, uint256 rakeBps) {
        return _defaultConfig(_layout());
    }
    // end::_defaultConfig()[]

    // tag::_setTokenConfig(Storage-address-address-uint256)[]
    /**
     * @dev Writes (or clears) a per-token override.
     *      A non-zero operator with `rakeBps >= MAX_BPS` reverts {RakeTooHigh}.
     *      A zero operator clears the override; `rakeBps` is forced to zero so a
     *      stale rake never lingers behind a cleared operator.
     */
    function _setTokenConfig(Storage storage layout, address token, address operator, uint256 rakeBps) internal {
        if (operator != address(0) && rakeBps >= MAX_BPS) {
            revert BettingConfigOracleErrors.RakeTooHigh(rakeBps);
        }
        uint256 storedRake = operator == address(0) ? 0 : rakeBps;
        layout.tokenEntries[token] = IBettingConfigOracle.Entry({operator: operator, rakeBps: storedRake});
        emit IBettingConfigOracle.ConfigUpdated(token, operator, storedRake);
    }
    // end::_setTokenConfig(Storage-address-address-uint256)[]

    // tag::_setTokenConfig(address-address-uint256)[]
    /**
     * @dev Default-slot {_setTokenConfig}.
     */
    function _setTokenConfig(address token, address operator, uint256 rakeBps) internal {
        _setTokenConfig(_layout(), token, operator, rakeBps);
    }
    // end::_setTokenConfig(address-address-uint256)[]

    // tag::_setDefault(Storage-address-uint256)[]
    /**
     * @dev Writes the global default. Operator must be non-zero ({ZeroOperator})
     *      and `rakeBps` must be strictly below `MAX_BPS` ({RakeTooHigh}).
     */
    function _setDefault(Storage storage layout, address operator, uint256 rakeBps) internal {
        if (operator == address(0)) {
            revert BettingConfigOracleErrors.ZeroOperator();
        }
        if (rakeBps >= MAX_BPS) {
            revert BettingConfigOracleErrors.RakeTooHigh(rakeBps);
        }
        layout.defaultEntry = IBettingConfigOracle.Entry({operator: operator, rakeBps: rakeBps});
        emit IBettingConfigOracle.DefaultUpdated(operator, rakeBps);
    }
    // end::_setDefault(Storage-address-uint256)[]

    // tag::_setDefault(address-uint256)[]
    /**
     * @dev Default-slot {_setDefault}.
     */
    function _setDefault(address operator, uint256 rakeBps) internal {
        _setDefault(_layout(), operator, rakeBps);
    }
    // end::_setDefault(address-uint256)[]
}
// end::BettingConfigOracleRepo[]
