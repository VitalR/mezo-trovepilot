// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { LiquidationBatcher } from "../src/LiquidationBatcher.sol";
import { KeeperRegistry } from "../src/KeeperRegistry.sol";
import { VaultManager } from "../src/VaultManager.sol";
import { YieldAggregator } from "../src/YieldAggregator.sol";

contract TrovePilotDeployScript is Script {
    // === Mezo Testnet (chain 31611) core addresses ===
    address constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant HINT_HELPERS = 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6;
    address constant SORTED_TROVES = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    function run() external {
        // ========== ENV ==========
        // DEPLOYER_PRIVATE_KEY=0x...
        // OWNER=0x... (optional, defaults to deployer)
        // FEE_SINK=0x... (optional)
        // FEE_BPS=0..1000
        // DEPLOY_REGISTRY=true/false

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envOr("OWNER", vm.addr(pk));
        address feeSink = vm.envOr("FEE_SINK", address(0));
        uint256 feeBpsU = vm.envOr("FEE_BPS", uint256(0));
        require(feeBpsU <= 1000, "feeBps > 10%");
        uint16 feeBps = uint16(feeBpsU);
        bool deployRegistry = vm.envOr("DEPLOY_REGISTRY", false);

        // Guard rails for external deps
        require(TROVE_MANAGER != address(0), "TROVE_MANAGER zero");
        require(MUSD != address(0), "MUSD zero");

        vm.startBroadcast(pk);

        // 1) RedemptionRouter (stateless)
        RedemptionRouter router = new RedemptionRouter(TROVE_MANAGER, HINT_HELPERS, SORTED_TROVES);

        // 2) LiquidationBatcher
        LiquidationBatcher batcher = new LiquidationBatcher(TROVE_MANAGER, owner, feeSink, feeBps);
        batcher.setMusd(MUSD);

        // 3) VaultManager (MVP) + YieldAggregator (stub)
        VaultManager vault = new VaultManager(MUSD, address(router), owner);
        YieldAggregator aggregator = new YieldAggregator(MUSD, owner);
        aggregator.setNotifier(address(vault), true);
        vault.setAggregator(address(aggregator));

        // 4) (Optional) KeeperRegistry
        KeeperRegistry registry;
        if (deployRegistry) {
            registry = new KeeperRegistry(owner);

            // Wire the batcher to the registry for scoring and payouts
            batcher.setKeeperRegistry(address(registry));
            // Authorize the batcher to bump keeper scores
            registry.setAuthorizer(address(batcher), true);
            string memory csv = vm.envOr("AUTHORIZERS", string(""));
            if (bytes(csv).length > 0) {
                string[] memory parts = vm.split(csv, ",");
                for (uint256 i = 0; i < parts.length; i++) {
                    address a = vm.parseAddress(parts[i]);
                    registry.setAuthorizer(a, true);
                }
            }
        }

        vm.stopBroadcast();

        // 5) JSON manifest for downstream tooling
        string memory root = "mezo";
        vm.serializeAddress(root, "RedemptionRouter", address(router));
        vm.serializeAddress(root, "LiquidationBatcher", address(batcher));
        vm.serializeAddress(root, "VaultManager", address(vault));
        vm.serializeAddress(root, "YieldAggregator", address(aggregator));
        if (deployRegistry) vm.serializeAddress(root, "KeeperRegistry", address(registry));
        string memory out = vm.serializeAddress(root, "MUSD", MUSD);
        vm.writeJson(out, "./deployments/mezo-31611.json");

        // 6) Log summary
        console2.log("=== TrovePilot deployed on Mezo Testnet (31611) ===");
        console2.log("Owner:", owner);
        console2.log("RedemptionRouter:", address(router));
        console2.log("LiquidationBatcher:", address(batcher));
        console2.log("VaultManager:", address(vault));
        if (deployRegistry) console2.log("KeeperRegistry:", address(registry));
        console2.log("MUSD:", MUSD);
    }
}
