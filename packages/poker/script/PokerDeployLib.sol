// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {ICreate3FactoryProxy} from "@crane/contracts/interfaces/proxies/ICreate3FactoryProxy.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {MultiStepOwnableFacet} from "@crane/contracts/access/ERC8023/MultiStepOwnableFacet.sol";
import {BetterEfficientHashLib} from "@crane/contracts/utils/BetterEfficientHashLib.sol";

import {IBettingConfigOracle} from "../contracts/oracle/IBettingConfigOracle.sol";
import {BettingConfigOracleFacet} from "../contracts/oracle/BettingConfigOracleFacet.sol";
import {IBettingConfigOracleDFPkg, BettingConfigOracleDFPkg} from "../contracts/oracle/BettingConfigOracleDFPkg.sol";
import {PokerHandSettlerFacet} from "../contracts/settler/PokerHandSettlerFacet.sol";
import {PokerVerifierFacet} from "../contracts/verifier/PokerVerifierFacet.sol";
import {IPokerHandSettlerDFPkg, PokerHandSettlerDFPkg} from "../contracts/settler/PokerHandSettlerDFPkg.sol";

/// @title PokerDeployLib - Shared deployment logic for the poker contracts.
/// @notice Internal functions so the Create3Factory calls inline into (and run
///         as) the caller — the broadcasting EOA in a `forge script` run, or the
///         operator context in tests. Used by the Deploy* scripts and the
///         deployment smoke test.
/// @dev The Deploy* `run()` wrappers `initEnv`-bootstrap the Crane factories for
///      local use and broadcast from the deployer EOA (which must be the factory
///      operator). On a chain where the Crane factories already exist, fetch them
///      instead of `initEnv` and broadcast from the operator. The deployment
///      logic here is verified end-to-end by
///      `tests/foundry/integration/PokerSystemDeploy.t.sol` (an in-EVM anvil-
///      equivalent smoke test) and `PokerHandSettler_E2E.t.sol`.
library PokerDeployLib {
    using BetterEfficientHashLib for bytes;

    /// @notice Deploys a BettingConfigOracle diamond owned by `owner`.
    /// @dev The owner must seed config via `setDefault` afterward (ERC8023
    ///      ownership is two-step, so it cannot be folded into deployment).
    function deployOracle(
        ICreate3FactoryProxy factory,
        IDiamondPackageCallBackFactory diamondFactory,
        address owner,
        bytes32 salt
    ) internal returns (address oracle) {
        IFacet oracleFacet = factory.deployFacet(
            type(BettingConfigOracleFacet).creationCode, abi.encode(type(BettingConfigOracleFacet).name)._hash()
        );
        IFacet ownableFacet = factory.deployFacet(
            type(MultiStepOwnableFacet).creationCode, abi.encode(type(MultiStepOwnableFacet).name)._hash()
        );
        IBettingConfigOracleDFPkg pkg = IBettingConfigOracleDFPkg(
            address(
                factory.deployPackageWithArgs(
                    type(BettingConfigOracleDFPkg).creationCode,
                    abi.encode(
                        IBettingConfigOracleDFPkg.PkgInit({
                            oracleFacet: oracleFacet,
                            ownableFacet: ownableFacet,
                            diamondFactory: diamondFactory
                        })
                    ),
                    abi.encode(type(BettingConfigOracleDFPkg).name)._hash()
                )
            )
        );
        oracle = pkg.deployOracle(owner, salt);
    }

    /// @notice Deploys the shared settler facets + DFPkg once. The returned
    ///         package mints one settler proxy per `deploySettler` call. Facets
    ///         are deployed via CREATE3 (one address per type) so this must be
    ///         called only once per chain.
    function deploySettlerPackage(ICreate3FactoryProxy factory, IDiamondPackageCallBackFactory diamondFactory)
        internal
        returns (IPokerHandSettlerDFPkg pkg)
    {
        IFacet settlerFacet = factory.deployFacet(
            type(PokerHandSettlerFacet).creationCode, abi.encode(type(PokerHandSettlerFacet).name)._hash()
        );
        IFacet verifierFacet = factory.deployFacet(
            type(PokerVerifierFacet).creationCode, abi.encode(type(PokerVerifierFacet).name)._hash()
        );
        pkg = IPokerHandSettlerDFPkg(
            address(
                factory.deployPackageWithArgs(
                    type(PokerHandSettlerDFPkg).creationCode,
                    abi.encode(
                        IPokerHandSettlerDFPkg.PkgInit({
                            settlerFacet: settlerFacet,
                            verifierFacet: verifierFacet,
                            diamondFactory: diamondFactory
                        })
                    ),
                    abi.encode(type(PokerHandSettlerDFPkg).name)._hash()
                )
            )
        );
    }

    /// @notice Deploys the settler package + a single per-token settler proxy.
    function deploySettler(
        ICreate3FactoryProxy factory,
        IDiamondPackageCallBackFactory diamondFactory,
        address token,
        IBettingConfigOracle oracle,
        bytes32 salt
    ) internal returns (address settler) {
        settler = deploySettlerPackage(factory, diamondFactory).deploySettler(token, oracle, salt);
    }

    /// @notice Deploys one oracle + one settler per token, all sharing the oracle
    ///         and the single settler package (one proxy per token).
    function deploySystem(
        ICreate3FactoryProxy factory,
        IDiamondPackageCallBackFactory diamondFactory,
        address owner,
        address[] memory tokens
    ) internal returns (address oracle, address[] memory settlers) {
        oracle = deployOracle(factory, diamondFactory, owner, keccak256("manamesh.oracle.v1"));
        IPokerHandSettlerDFPkg pkg = deploySettlerPackage(factory, diamondFactory);
        settlers = new address[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            settlers[i] = pkg.deploySettler(
                tokens[i], IBettingConfigOracle(oracle), keccak256(abi.encode("manamesh.settler.v1", tokens[i]))
            );
        }
    }
}
