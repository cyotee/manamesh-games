// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {IDiamond} from "@crane/contracts/interfaces/IDiamond.sol";
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {IDiamondFactoryPackage} from "@crane/contracts/interfaces/IDiamondFactoryPackage.sol";

import {IBettingConfigOracle} from "../oracle/IBettingConfigOracle.sol";
import {IPokerHandSettler} from "./IPokerHandSettler.sol";
import {IPokerVerifierFacet} from "../verifier/IPokerVerifierFacet.sol";
import {PokerHandSettlerRepo} from "./PokerHandSettlerRepo.sol";

// tag::IPokerHandSettlerDFPkg[]
/**
 * @title IPokerHandSettlerDFPkg - Deploy interface for the settler package.
 */
interface IPokerHandSettlerDFPkg {
    /**
     * @dev Facet + factory references baked into the package at deploy time.
     * @param settlerFacet The {PokerHandSettlerFacet}.
     * @param verifierFacet The {PokerVerifierFacet} (settleHand routes to it).
     * @param diamondFactory The diamond factory used to instantiate proxies.
     */
    struct PkgInit {
        IFacet settlerFacet;
        IFacet verifierFacet;
        IDiamondPackageCallBackFactory diamondFactory;
    }

    /**
     * @dev Per-instance arguments.
     * @param token The single ERC20 this settler escrows.
     * @param oracle The configuration oracle resolved for rake/operator.
     * @param optionalSalt Extra salt entropy so multiple settlers can coexist.
     */
    struct PkgArgs {
        address token;
        IBettingConfigOracle oracle;
        bytes32 optionalSalt;
    }

    /**
     * @notice Deploys a new per-token PokerHandSettler diamond.
     * @param token The ERC20 to escrow.
     * @param oracle The configuration oracle.
     * @param optionalSalt Extra salt entropy.
     * @return settlerAddress The deployed settler proxy address.
     */
    function deploySettler(address token, IBettingConfigOracle oracle, bytes32 optionalSalt)
        external
        returns (address settlerAddress);
}
// end::IPokerHandSettlerDFPkg[]

// tag::PokerHandSettlerDFPkg[]
/**
 * @title PokerHandSettlerDFPkg - Diamond Factory Package for one settler.
 * @notice Bundles the settler facet and the verifier facet into a per-token
 *         settler diamond, wiring the token + oracle and enabling the verifier
 *         on deployment.
 */
contract PokerHandSettlerDFPkg is IDiamondFactoryPackage, IPokerHandSettlerDFPkg {
    IFacet internal immutable SETTLER_FACET;
    IFacet internal immutable VERIFIER_FACET;
    IDiamondPackageCallBackFactory internal immutable DIAMOND_FACTORY;

    constructor(PkgInit memory pkgInit) {
        SETTLER_FACET = pkgInit.settlerFacet;
        VERIFIER_FACET = pkgInit.verifierFacet;
        DIAMOND_FACTORY = pkgInit.diamondFactory;
    }

    // tag::deploySettler(address-IBettingConfigOracle-bytes32)[]
    /// @inheritdoc IPokerHandSettlerDFPkg
    function deploySettler(address token, IBettingConfigOracle oracle, bytes32 optionalSalt)
        external
        returns (address settlerAddress)
    {
        return address(
            DIAMOND_FACTORY.deploy(
                this, abi.encode(PkgArgs({token: token, oracle: oracle, optionalSalt: optionalSalt}))
            )
        );
    }
    // end::deploySettler(address-IBettingConfigOracle-bytes32)[]

    function packageName() public pure returns (string memory name_) {
        return type(PokerHandSettlerDFPkg).name;
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
        facetAddresses_[0] = address(SETTLER_FACET);
        facetAddresses_[1] = address(VERIFIER_FACET);
    }

    function facetInterfaces() public pure override(IDiamondFactoryPackage) returns (bytes4[] memory interfaces) {
        interfaces = new bytes4[](2);
        interfaces[0] = type(IPokerHandSettler).interfaceId;
        interfaces[1] = type(IPokerVerifierFacet).interfaceId;
    }

    function facetCuts() public view returns (IDiamond.FacetCut[] memory facetCuts_) {
        facetCuts_ = new IDiamond.FacetCut[](2);
        facetCuts_[0] = IDiamond.FacetCut({
            facetAddress: address(SETTLER_FACET),
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: SETTLER_FACET.facetFuncs()
        });
        facetCuts_[1] = IDiamond.FacetCut({
            facetAddress: address(VERIFIER_FACET),
            action: IDiamond.FacetCutAction.Add,
            functionSelectors: VERIFIER_FACET.facetFuncs()
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

    /// @dev Wires token + oracle and enables the on-chain verifier.
    function initAccount(bytes memory initArgs) public {
        PkgArgs memory pkgArgs = abi.decode(initArgs, (PkgArgs));
        PokerHandSettlerRepo._initialize(pkgArgs.token, pkgArgs.oracle, true);
    }

    function postDeploy(address) public pure returns (bool) {
        return true;
    }
}
// end::PokerHandSettlerDFPkg[]
