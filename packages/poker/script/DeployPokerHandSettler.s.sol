// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";

import {ICreate3FactoryProxy} from "@crane/contracts/interfaces/proxies/ICreate3FactoryProxy.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {InitDevService} from "@crane/contracts/InitDevService.sol";

import {IBettingConfigOracle} from "../contracts/oracle/IBettingConfigOracle.sol";
import {PokerDeployLib} from "./PokerDeployLib.sol";

/// @notice Deploys a per-token PokerHandSettler diamond bound to an existing
///         oracle. Reads TOKEN and ORACLE from the environment.
contract DeployPokerHandSettler is Script {
    function run() external returns (address settler) {
        address deployer = msg.sender;
        (ICreate3FactoryProxy factory, IDiamondPackageCallBackFactory diamondFactory) =
            InitDevService.initEnv(deployer);
        address token = vm.envAddress("TOKEN");
        address oracle = vm.envAddress("ORACLE");
        vm.startBroadcast(deployer);
        settler = PokerDeployLib.deploySettler(
            factory, diamondFactory, token, IBettingConfigOracle(oracle), keccak256("manamesh.settler.v1")
        );
        vm.stopBroadcast();
        console2.log("PokerHandSettler:", settler);
    }
}
