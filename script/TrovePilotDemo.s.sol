// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { LiquidationBatcher } from "../src/LiquidationBatcher.sol";
import { KeeperRegistry } from "../src/KeeperRegistry.sol";
import { VaultManager } from "../src/VaultManager.sol";
import { YieldAggregator } from "../src/YieldAggregator.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

contract TrovePilotDemoScript is Script {
    // Mezo Testnet (31611)
    address constant TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address constant HINT_HELPERS = 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6;
    address constant SORTED_TROVES = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address constant MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address constant PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address user = vm.envOr("USER", vm.addr(pk)); // user wallet for funding/withdrawing

        // Load deployed addresses (from previous script) or allow override via env
        address routerAddr = vm.envOr("ROUTER_ADDR", address(0));
        address batcherAddr = vm.envOr("BATCHER_ADDR", address(0));
        address vaultAddr = vm.envOr("VAULT_ADDR", address(0));
        address aggregatorAddr = vm.envOr("AGGREGATOR_ADDR", address(0));

        vm.startBroadcast(pk);

        // If not provided, deploy minimal fresh instances
        RedemptionRouter router = routerAddr == address(0)
            ? new RedemptionRouter(TROVE_MANAGER, HINT_HELPERS, SORTED_TROVES)
            : RedemptionRouter(routerAddr);

        LiquidationBatcher batcher = batcherAddr == address(0)
            ? new LiquidationBatcher(TROVE_MANAGER, vm.addr(pk), address(0), 0)
            : LiquidationBatcher(payable(batcherAddr));
        if (batcherAddr == address(0)) {
            batcher.setMusd(MUSD);
        }

        VaultManager vault =
            vaultAddr == address(0) ? new VaultManager(MUSD, address(router), vm.addr(pk)) : VaultManager(vaultAddr);

        YieldAggregator aggregator =
            aggregatorAddr == address(0) ? new YieldAggregator(MUSD, vm.addr(pk)) : YieldAggregator(aggregatorAddr);
        if (aggregatorAddr == address(0)) {
            aggregator.setNotifier(address(vault), true);
            vault.setAggregator(address(aggregator));
        }

        // Configure user in VaultManager
        vault.setConfig({ musdPerRedeem: 5e18, maxIterations: 5, keeperFeeBps: 50, active: true });

        // Fund VaultManager with user's MUSD
        uint256 userBal = IERC20(MUSD).balanceOf(user);
        console2.log("USER MUSD:", userBal);
        if (userBal >= 20e18) {
            vm.startPrank(user);
            IERC20(MUSD).approve(address(vault), type(uint256).max);
            vault.fund(20e18);
            vm.stopPrank();
        } else {
            console2.log("Skip funding: not enough MUSD on USER (need 20e18)");
        }

        // Fetch price and execute one redemption via keeper (deployer acts as keeper)
        uint256 price;
        try IPriceFeed(PRICE_FEED).fetchPrice() returns (uint256 p) {
            price = p;
        }
            catch { }
        if (price == 0) {
            console2.log("PriceFeed inactive; skipping redemption execution");
        } else {
            vault.execute(user, price);
        }

        // Route a portion to YieldAggregator (auto deposit)
        vault.autoDeposit(user, 2e18);

        // User withdraws back from aggregator
        vm.startPrank(user);
        aggregator.withdraw(1e18);
        vm.stopPrank();

        vm.stopBroadcast();

        console2.log("Demo complete.");
        console2.log("Router:", address(router));
        console2.log("Batcher:", address(batcher));
        console2.log("VaultManager:", address(vault));
        console2.log("Aggregator:", address(aggregator));
    }
}

