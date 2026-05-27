// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";

import {ICreate3FactoryProxy} from "@crane/contracts/interfaces/proxies/ICreate3FactoryProxy.sol";
import {IDiamondPackageCallBackFactory} from "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import {InitDevService} from "@crane/contracts/InitDevService.sol";

import {PokerDeployLib} from "./PokerDeployLib.sol";

/// @notice Deploys a BettingConfigOracle diamond owned by the broadcaster. The
///         owner must call `setDefault(operator, rakeBps)` afterward to seed the
///         global default. Local/anvil: `initEnv` bootstraps the Crane factories;
///         on a chain where they already exist, fetch them instead.
contract DeployBettingConfigOracle is Script {
    function run() external returns (address oracle) {
        address deployer = msg.sender;
        (ICreate3FactoryProxy factory, IDiamondPackageCallBackFactory diamondFactory) =
            InitDevService.initEnv(deployer);
        vm.startBroadcast(deployer);
        oracle = PokerDeployLib.deployOracle(factory, diamondFactory, deployer, keccak256("manamesh.oracle.v1"));
        vm.stopBroadcast();
        console2.log("BettingConfigOracle:", oracle);
    }
}
