// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IDiamond} from "@crane/contracts/interfaces/IDiamond.sol";
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IMultiStepOwnable} from "@crane/contracts/interfaces/IMultiStepOwnable.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {IDiamondFactoryPackage} from "@crane/contracts/interfaces/IDiamondFactoryPackage.sol";
import {MultiStepOwnableRepo} from "@crane/contracts/access/ERC8023/MultiStepOwnableRepo.sol";

import {IBettingConfigOracle} from "./IBettingConfigOracle.sol";

// tag::IBettingConfigOracleDFPkg[]
/**
 * @title IBettingConfigOracleDFPkg - Deploy interface for the oracle package.
 */
interface IBettingConfigOracleDFPkg {
    /**
     * @dev Facet + factory references baked into the package at deploy time.
     * @param oracleFacet The {BettingConfigOracleFacet}.
     * @param ownableFacet The ERC8023 {MultiStepOwnableFacet}.
     * @param diamondFactory The diamond factory used to instantiate proxies.
     */
    struct PkgInit {
        IFacet oracleFacet;
        IFacet ownableFacet;
        IDiamondPackageCallBackFactory diamondFactory;
    }

    /**
     * @dev Per-instance arguments.
     * @param owner The ERC8023 owner that may mutate oracle config.
     * @param optionalSalt Extra salt entropy so multiple oracles can coexist.
     */
    struct PkgArgs {
        address owner;
        bytes32 optionalSalt;
    }

    /**
     * @notice Deploys a new BettingConfigOracle diamond.
     * @param owner The ERC8023 owner of the new oracle.
     * @param optionalSalt Extra salt entropy.
     * @return oracleAddress The deployed oracle proxy address.
     */
    function deployOracle(address owner, bytes32 optionalSalt) external returns (address oracleAddress);
}
// end::IBettingConfigOracleDFPkg[]

// tag::BettingConfigOracleDFPkg[]
/**
 * @title BettingConfigOracleDFPkg - Diamond Factory Package for the betting config oracle.
 * @notice Bundles the oracle facet and the ERC8023 ownership facet into a single
 *         deployable diamond, initializing the owner on deployment.
 * @dev Mirrors the Crane DFPkg convention (see ERC20PermitMintBurnLockedOwnableDFPkg).
 */
contract BettingConfigOracleDFPkg is IDiamondFactoryPackage, IBettingConfigOracleDFPkg {
    /// @dev Two-step ownership buffer applied to new oracle diamonds.
    uint256 internal constant OWNERSHIP_BUFFER = 1 days;

    IFacet internal immutable ORACLE_FACET;
    IFacet internal immutable OWNABLE_FACET;
    IDiamondPackageCallBackFactory internal immutable DIAMOND_FACTORY;

    constructor(PkgInit memory pkgInit) {
        ORACLE_FACET = pkgInit.oracleFacet;
        OWNABLE_FACET = pkgInit.ownableFacet;
        DIAMOND_FACTORY = pkgInit.diamondFactory;
    }

    // tag::deployOracle(address-bytes32)[]
    /// @inheritdoc IBettingConfigOracleDFPkg
    function deployOracle(address owner, bytes32 optionalSalt) external returns (address oracleAddress) {
        return address(
            DIAMOND_FACTORY.deploy(this, abi.encode(PkgArgs({owner: owner, optionalSalt: optionalSalt})))
        );
    }
    // end::deployOracle(address-bytes32)[]

    function packageName() public pure returns (string memory name_) {
        return type(BettingConfigOracleDFPkg).name;
    }

    function packageMetadata()
        public
        view
        returns (string memory name_, bytes4[] memory interfaces, address[] memory facets)
    {
        name_ = packageName();
        interfaces = facetInterfaces();
        facets = facetAddresses();
    }

    function facetAddresses() public view returns (address[] memory facetAddresses_) {
        facetAddresses_ = new address[](2);
        facetAddresses_[0] = address(ORACLE_FACET);
        facetAddresses_[1] = address(OWNABLE_FACET);
    }

    function facetInterfaces() public pure override(IDiamondFactoryPackage) returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](2);
        interfaces[0] = type(IBettingConfigOracle).interfaceId;
        interfaces[1] = type(IMultiStepOwnable).interfaceId;
    }

    function facetCuts() public view returns (IDiamond.FacetCut[] memory facetCuts_) {
        facetCuts_ = new IDiamond.FacetCut[](2);
        facetCuts_[0] = IDiamond.FacetCut({
            facetAddress: address(ORACLE_FACET),
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: ORACLE_FACET.facetFuncs()
        });
        facetCuts_[1] = IDiamond.FacetCut({
            facetAddress: address(OWNABLE_FACET),
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: OWNABLE_FACET.facetFuncs()
        });
    }

    function diamondConfig() public view returns (IDiamondFactoryPackage.DiamondConfig memory config) {
        config = IDiamondFactoryPackage.DiamondConfig({facetCuts: facetCuts(), interfaces: facetInterfaces()});
    }

    function calcSalt(bytes memory pkgArgs) public pure returns (bytes32 salt) {
        salt = keccak256(abi.encode(pkgArgs));
    }

    function processArgs(bytes memory pkgArgs) public pure returns (bytes memory processedPkgArgs) {
        processedPkgArgs = pkgArgs;
    }

    function updatePkg(address, bytes memory) public pure returns (bool) {
        return true;
    }

    /// @dev Initializes the new proxy's ERC8023 ownership.
    function initAccount(bytes memory initArgs) public {
        PkgArgs memory pkgArgs = abi.decode(initArgs, (PkgArgs));
        MultiStepOwnableRepo._initialize(pkgArgs.owner, OWNERSHIP_BUFFER);
    }

    function postDeploy(address) public pure returns (bool) {
        return true;
    }
}
// end::BettingConfigOracleDFPkg[]
