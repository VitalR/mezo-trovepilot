// // SPDX-License-Identifier: MIT
// pragma solidity 0.8.30;

// import "forge-std/Script.sol";
// import { MezoAddresses } from "./MezoAddresses.sol";
// import { RedemptionRouter } from "../src/RedemptionRouter.sol";
// import { LiquidationEngine } from "../src/LiquidationEngine.sol";

// contract TrovePilotDeployScript is Script {
//     // Cached env/config to reduce local vars in run()
//     address public ownerCached;
//     address public feeSinkCached;
//     uint16 public feeBpsCached;
//     bool public deployRegistryCached;

//     // Deployed addresses (for logging and manifest)
//     address public deployedRouter;
//     address public deployedEngine;

//     function run() external {
//         // ========== ENV ==========
//         // DEPLOYER_PRIVATE_KEY=0x...
//         // OWNER=0x... (optional, defaults to deployer)
//         // FEE_SINK=0x... (optional)
//         // FEE_BPS=0..1000
//         // DEPLOY_REGISTRY=true/false

//         uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
//         ownerCached = vm.envOr("OWNER", vm.addr(pk));
//         feeSinkCached = vm.envOr("FEE_SINK", address(0));
//         {
//             uint256 feeBpsU = vm.envOr("FEE_BPS", uint256(0));
//             require(feeBpsU <= 1000, "feeBps > 10%");
//             feeBpsCached = uint16(feeBpsU);
//         }
//         deployRegistryCached = vm.envOr("DEPLOY_REGISTRY", false);

//         vm.startBroadcast(pk);

//         // 1) RedemptionRouter (stateless)
//         deployedRouter = address(
//             new RedemptionRouter(MezoAddresses.TROVE_MANAGER, MezoAddresses.HINT_HELPERS,
// MezoAddresses.SORTED_TROVES) );

//         // 2) LiquidationEngine
//         deployedEngine =
//             address(new LiquidationEngine(MezoAddresses.TROVE_MANAGER, ownerCached, feeSinkCached, feeBpsCached));
//         LiquidationEngine(payable(deployedEngine)).setMusd(MezoAddresses.MUSD);

//         // 3) VaultManager (MVP) + YieldAggregator (stub)
//         deployedVault = address(new VaultManager(MezoAddresses.MUSD, deployedRouter, ownerCached));
//         deployedAggregator = address(new YieldAggregator(MezoAddresses.MUSD, ownerCached));
//         YieldAggregator(deployedAggregator).setNotifier(deployedVault, true);
//         VaultManager(deployedVault).setAggregator(deployedAggregator);

//         // 4) (Optional) KeeperRegistry
//         if (deployRegistryCached) {
//             deployedRegistry = address(new KeeperRegistry(ownerCached));
//             LiquidationEngine(payable(deployedEngine)).setKeeperRegistry(deployedRegistry);
//             KeeperRegistry(deployedRegistry).setAuthorizer(deployedEngine, true);
//             string memory csv = vm.envOr("AUTHORIZERS", string(""));
//             if (bytes(csv).length > 0) {
//                 string[] memory parts = vm.split(csv, ",");
//                 for (uint256 i = 0; i < parts.length; i++) {
//                     address a = vm.parseAddress(parts[i]);
//                     KeeperRegistry(deployedRegistry).setAuthorizer(a, true);
//                 }
//             }
//         }

//         vm.stopBroadcast();

//         // 5) JSON manifest for downstream tooling (deployments/<chainId>/mezo-<chainId>.json)
//         _writeManifest();

//         // 6) Log summary
//         console2.log("=== TrovePilot deployed on Mezo Testnet (31611) ===");
//         console2.log("Owner:", ownerCached);
//         console2.log("RedemptionRouter:", deployedRouter);
//         console2.log("LiquidationEngine:", deployedEngine);
//         console2.log("VaultManager:", deployedVault);
//         if (deployRegistryCached) console2.log("KeeperRegistry:", deployedRegistry);
//         console2.log("MUSD:", MezoAddresses.MUSD);
//     }

//     function _writeManifest() internal {
//         string memory root = "mezo";
//         vm.serializeAddress(root, "RedemptionRouter", deployedRouter);
//         vm.serializeAddress(root, "LiquidationEngine", deployedEngine);
//         vm.serializeAddress(root, "VaultManager", deployedVault);
//         vm.serializeAddress(root, "YieldAggregator", deployedAggregator);
//         if (deployRegistryCached) vm.serializeAddress(root, "KeeperRegistry", deployedRegistry);
//         string memory out = vm.serializeAddress(root, "MUSD", MezoAddresses.MUSD);

//         string memory proj = vm.projectRoot();
//         string memory dir = string.concat(proj, "/deployments/", vm.toString(MezoAddresses.CHAIN_ID));
//         vm.createDir(dir, true);
//         string memory rolling = string.concat(dir, "/mezo-", vm.toString(MezoAddresses.CHAIN_ID), ".json");
//         string memory versioned = string.concat(
//             dir, "/mezo-", vm.toString(MezoAddresses.CHAIN_ID), "-", vm.toString(block.number), ".json"
//         );
//         vm.writeJson(out, rolling);
//         vm.writeJson(out, versioned);
//     }
// }
