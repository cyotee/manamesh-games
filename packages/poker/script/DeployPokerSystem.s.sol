// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";

import {ICreate3FactoryProxy} from "@crane/contracts/interfaces/proxies/ICreate3FactoryProxy.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {InitDevService} from "@crane/contracts/InitDevService.sol";

import {PokerDeployLib} from "./PokerDeployLib.sol";

/// @notice Composite deploy: one BettingConfigOracle + one PokerHandSettler per
///         token, all sharing the oracle. The oracle is owned by the broadcaster,
///         who must seed config via `setDefault` after deployment. `run()` reads
///         a single TOKEN from the environment.
contract DeployPokerSystem is Script {
    function run() external returns (address oracle, address[] memory settlers) {
        address deployer = msg.sender;
        (ICreate3FactoryProxy factory, IDiamondPackageCallBackFactory diamondFactory) =
            InitDevService.initEnv(deployer);
        address[] memory tokens = new address[](1);
        tokens[0] = vm.envAddress("TOKEN");
        vm.startBroadcast(deployer);
        (oracle, settlers) = PokerDeployLib.deploySystem(factory, diamondFactory, deployer, tokens);
        vm.stopBroadcast();
        console2.log("oracle:", oracle);
        for (uint256 i = 0; i < settlers.length; ++i) {
            console2.log("settler:", settlers[i]);
        }
    }
}
