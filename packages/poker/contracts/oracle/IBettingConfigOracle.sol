// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

// tag::IBettingConfigOracle[]
/**
 * @title IBettingConfigOracle - Per-token rake configuration oracle interface.
 * @notice Exposes per-ERC20 rake settings consumed by poker settler diamonds.
 * @dev Lookup semantics: if a per-token entry is set (operator != address(0))
 *      it overrides the default; otherwise callers see the global default.
 */
interface IBettingConfigOracle {
    /**
     * @dev Per-token rake configuration entry.
     * @param operator Address that receives the rake for this token.
     * @param rakeBps Rake taken at settlement expressed in basis points.
     */
    struct Entry {
        address operator;
        uint256 rakeBps;
    }

    // tag::ConfigUpdated(address,address,uint256)[]
    /**
     * @notice Emitted when a per-token configuration entry is written.
     * @param token The ERC20 token whose configuration changed (zero on default writes via setDefault).
     * @param operator The operator now associated with the token.
     * @param rakeBps The rake (in basis points) now associated with the token.
     * @custom:signature ConfigUpdated(address,address,uint256)
     */
    event ConfigUpdated(address indexed token, address operator, uint256 rakeBps);
    // end::ConfigUpdated(address,address,uint256)[]

    // tag::DefaultUpdated(address,uint256)[]
    /**
     * @notice Emitted when the global default configuration is updated.
     * @param operator The operator that becomes the new default.
     * @param rakeBps The default rake (in basis points).
     * @custom:signature DefaultUpdated(address,uint256)
     */
    event DefaultUpdated(address operator, uint256 rakeBps);
    // end::DefaultUpdated(address,uint256)[]

    // tag::configOf(address)[]
    /**
     * @notice Returns the effective `(operator, rakeBps)` for `token`.
     * @dev Returns the token-specific entry when its operator is non-zero, else the default entry.
     * @param token The ERC20 token to look up.
     * @return operator The operator address that should receive the rake.
     * @return rakeBps The rake (in basis points) to apply at settlement.
     * @custom:signature configOf(address)
     */
    function configOf(address token) external view returns (address operator, uint256 rakeBps);
    // end::configOf(address)[]

    // tag::setTokenConfig(address,address,uint256)[]
    /**
     * @notice Sets the per-token rake configuration for `token`.
     * @dev Owner-only. Setting `operator` to address(0) clears the override and reverts to the default.
     * @param token The ERC20 token whose configuration is being set.
     * @param operator The operator that should receive the rake (zero clears the override).
     * @param rakeBps The rake (in basis points) to apply when the override is active.
     * @custom:signature setTokenConfig(address,address,uint256)
     */
    function setTokenConfig(address token, address operator, uint256 rakeBps) external;
    // end::setTokenConfig(address,address,uint256)[]

    // tag::setDefault(address,uint256)[]
    /**
     * @notice Sets the global default rake configuration.
     * @dev Owner-only. Operator must be non-zero and rakeBps must be strictly below 10_000.
     * @param operator The operator that should receive the rake when no override is set.
     * @param rakeBps The default rake (in basis points) applied when no override is set.
     * @custom:signature setDefault(address,uint256)
     */
    function setDefault(address operator, uint256 rakeBps) external;
    // end::setDefault(address,uint256)[]

    // tag::defaultConfig()[]
    /**
     * @notice Returns the global default `(operator, rakeBps)` configuration.
     * @return operator The default operator that receives the rake when no override is set.
     * @return rakeBps The default rake (in basis points) applied when no override is set.
     * @custom:signature defaultConfig()
     */
    function defaultConfig() external view returns (address operator, uint256 rakeBps);
    // end::defaultConfig()[]
}
// end::IBettingConfigOracle[]
