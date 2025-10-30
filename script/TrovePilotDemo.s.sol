// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { MezoAddresses } from "./MezoAddresses.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { LiquidationEngine } from "../src/LiquidationEngine.sol";
import { KeeperRegistry } from "../src/KeeperRegistry.sol";
import { VaultManager } from "../src/VaultManager.sol";
import { YieldAggregator } from "../src/YieldAggregator.sol";
import { IPriceOracle } from "../src/interfaces/IPriceOracle.sol";

contract TrovePilotDemoScript is Script {
    address public routerAddr;
    address public engineAddr;
    address public vaultAddr;
    address public aggregatorAddr;
    address public registryAddr;
    address public keeper;
    address public user;

    uint256 public pk;
    uint256 public musdPerRedeem;
    uint256 public maxIterations;
    uint256 public keeperFeeBpsRaw;
    uint16 public keeperFeeBps;

    function run() external {
        pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        keeper = vm.addr(pk);
        user = vm.envOr("USER", keeper);

        // Resolve contract addresses (env overrides -> deployments JSON -> revert)
        string memory defaultPath = string.concat(
            vm.projectRoot(),
            "/deployments/",
            vm.toString(MezoAddresses.CHAIN_ID),
            "/mezo-",
            vm.toString(MezoAddresses.CHAIN_ID),
            ".json"
        );
        string memory deploymentsPath = vm.envOr("DEPLOYMENT_JSON", defaultPath);
        string memory json;
        bool jsonLoaded;
        try vm.readFile(deploymentsPath) returns (string memory file) {
            json = file;
            jsonLoaded = true;
        } catch { }

        routerAddr = _resolveAddr("ROUTER_ADDR", jsonLoaded, json, ".RedemptionRouter");
        engineAddr = _resolveAddr("ENGINE_ADDR", jsonLoaded, json, ".LiquidationEngine");
        vaultAddr = _resolveAddr("VAULT_ADDR", jsonLoaded, json, ".VaultManager");
        aggregatorAddr = _resolveAddr("AGGREGATOR_ADDR", jsonLoaded, json, ".YieldAggregator");
        registryAddr = _resolveAddr("REGISTRY_ADDR", jsonLoaded, json, ".KeeperRegistry");

        musdPerRedeem = vm.envOr("DEMO_REDEEM_AMOUNT", uint256(10e18));
        maxIterations = vm.envOr("DEMO_MAX_ITER", uint256(5));
        keeperFeeBpsRaw = vm.envOr("DEMO_KEEPER_FEE_BPS", uint256(100));
        require(keeperFeeBpsRaw <= type(uint16).max, "keeper fee bps overflow");
        keeperFeeBps = uint16(keeperFeeBpsRaw);

        (bool oracleActive, uint256 priceHint) = _resolveOracleAndPrice();

        vm.startBroadcast(pk);

        RedemptionRouter router = RedemptionRouter(routerAddr);
        LiquidationEngine engine = LiquidationEngine(payable(engineAddr));
        VaultManager vault = VaultManager(vaultAddr);
        YieldAggregator aggregator = YieldAggregator(aggregatorAddr);

        require(address(router) != address(0), "router addr missing");
        require(address(engine) != address(0), "engine addr missing");
        require(address(vault) != address(0), "vault addr missing");
        require(address(aggregator) != address(0), "aggregator addr missing");

        if (registryAddr != address(0)) {
            address payTo = vm.envOr("KEEPER_PAYTO", keeper);
            KeeperRegistry registry = KeeperRegistry(registryAddr);
            try registry.keepers(keeper) returns (
                bool listed,
                uint96, /*score*/
                address /*payToExisting*/
            ) {
                if (!listed) {
                    try registry.register(payTo) { } catch { }
                }
            } catch {
                try registry.register(payTo) { } catch { }
            }
        }

        bool userIsKeeper = (user == keeper);
        if (userIsKeeper) {
            _runVaultFlows(user, vault, aggregator, musdPerRedeem, maxIterations, keeperFeeBps, priceHint, oracleActive);
            _runKeeperRewardsDemo(engine, registryAddr, keeper);
        } else {
            console2.log("USER differs from keeper; skipping funding/execution flows.");
            console2.log("Set USER to keeper or extend script with USER_PRIVATE_KEY to enable full demo.");
        }

        vm.stopBroadcast();

        _logSummary(routerAddr, engineAddr, vaultAddr, aggregatorAddr, registryAddr);
    }

    function _runVaultFlows(
        address vaultUser,
        VaultManager vault,
        YieldAggregator aggregator,
        uint256 redeemAmount,
        uint256 maxIterationsHint,
        uint16 keeperFeeBpsSetting,
        uint256 priceHint,
        bool oracleActive
    ) internal {
        {
            uint256 bal = IERC20(MezoAddresses.MUSD).balanceOf(vaultUser);
        console2.log("USER MUSD:", bal);
        if (bal >= 20e18) {
            IERC20(MezoAddresses.MUSD).approve(address(vault), type(uint256).max);
                try vault.fund(20e18) { }
                catch {
                    console2.log("Fund failed (inspect allowances/owner)");
                }
        } else {
            console2.log("Skip funding: not enough MUSD on USER (need 20e18)");
            }
        }

        {
            (uint256 currentRedeem, uint256 currentIterations, uint16 currentFee, bool active) =
                vault.configs(vaultUser);
            bool needsConfig = !active || currentRedeem != redeemAmount || currentIterations != maxIterationsHint
                || currentFee != keeperFeeBpsSetting;

            if (needsConfig) {
                try vault.setConfig(redeemAmount, maxIterationsHint, keeperFeeBpsSetting, true) {
                    console2.log("Vault config updated");
                } catch {
                    console2.log("Config update failed; ensure USER has control");
                }
            } else {
                console2.log("Vault config already active");
            }
        }

        uint256 price = priceHint;
        if (price == 0 || !oracleActive) {
            console2.log("PriceFeed inactive and no PRICE_OVERRIDE provided; skipping redemption execution");
        } else {
            try vault.execute(vaultUser, price) {
                console2.log("Vault execute succeeded");
            } catch {
                console2.log("Vault execute failed (check config/balances)");
            }
        }

        {
            uint256 remaining = vault.balances(vaultUser);
            if (remaining >= 2e18) {
                try vault.autoDeposit(vaultUser, 2e18) {
                    console2.log("autoDeposit succeeded");
                } catch {
                    console2.log("autoDeposit failed");
                }
            } else {
                console2.log("Skip autoDeposit: insufficient vault balance");
            }
        }

        {
            uint256 aggBal = aggregator.balances(vaultUser);
            if (aggBal >= 1e18) {
                try aggregator.withdraw(1e18) {
                    console2.log("Aggregator withdraw succeeded");
                } catch {
                    console2.log("Aggregator withdraw failed");
                }
            } else {
                console2.log("Skip withdraw: insufficient aggregator balance");
            }
        }
    }

    function _resolveOracleAndPrice() internal returns (bool oracleActive, uint256 price) {
        // First, try protocol's own fetchPrice (what TM uses) via raw RPC
        (bool okProxy, uint256 pxProxy) = _fetchPriceProxyViaRpc();
        if (okProxy && pxProxy > 0) {
            oracleActive = true;
            price = vm.envOr("PRICE_OVERRIDE", pxProxy);
            console2.log("PriceFeed active (proxy)", pxProxy);
            if (price != pxProxy) console2.log("PRICE_OVERRIDE applied", price);
            return (oracleActive, price);
        }

        // Fallback: query precompile directly
        (bool ok, uint80 roundId, int256 ans, uint256 updatedAt) = _fetchOracleViaRpc();
        if (ok && ans > 0) {
            // Precompile has data, but proxy fetchPrice is still reverting; treat as inactive for redemption safety
            oracleActive = false;
            price = vm.envOr("PRICE_OVERRIDE", uint256(ans));
            console2.log("Oracle price (precompile)", uint256(ans));
            console2.log("Oracle round", uint256(roundId));
            console2.log("Oracle updatedAt", updatedAt);
            if (price != uint256(ans)) console2.log("PRICE_OVERRIDE applied", price);
        } else {
            oracleActive = false;
            price = vm.envOr("PRICE_OVERRIDE", uint256(0));
            console2.log("Oracle inactive; PRICE_OVERRIDE", price);
        }
    }

    function _fetchOracleViaRpc() internal returns (bool ok, uint80 roundId, int256 answer, uint256 updatedAt) {
        bytes memory callData = abi.encodeWithSignature("latestRoundData()");
        string memory params = string.concat(
            "[{\"to\":\"",
            vm.toString(MezoAddresses.PRICE_ORACLE_CALLER),
            "\",\"data\":\"",
            vm.toString(callData),
            "\"},\"latest\"]"
        );

        bytes memory raw = vm.rpc("eth_call", params);
        if (raw.length == 0) return (false, 0, 0, 0);

        (roundId, answer,, updatedAt,) = abi.decode(raw, (uint80, int256, uint256, uint256, uint80));
        ok = true;
    }

    function _fetchPriceProxyViaRpc() internal returns (bool ok, uint256 price) {
        bytes memory callData = abi.encodeWithSignature("fetchPrice()");
        string memory params = string.concat(
            "[{\"to\":\"",
            vm.toString(MezoAddresses.PRICE_FEED),
            "\",\"data\":\"",
            vm.toString(callData),
            "\"},\"latest\"]"
        );
        bytes memory raw;
        try vm.rpc("eth_call", params) returns (bytes memory data) {
            raw = data;
        } catch {
            return (false, 0);
        }
        if (raw.length == 0) return (false, 0);
        price = abi.decode(raw, (uint256));
        ok = price > 0;
    }

    function _runKeeperRewardsDemo(LiquidationEngine engine, address registryAddress, address keeperAddr) internal {
        uint256 demoAmount = vm.envOr("DEMO_ENGINE_FUND", uint256(1e18));
        if (demoAmount == 0) return;

        // Resolve payout first (may differ from keeper)
        address payout = keeperAddr;
        if (registryAddress != address(0)) {
            try KeeperRegistry(registryAddress).keepers(keeperAddr) returns (bool, uint96, address payTo) {
                if (payTo != address(0)) payout = payTo;
            } catch { }
        }

        // Pre-fund engine with MUSD from the demo wallet so _forwardRewards has something to route
        uint256 userBal = IERC20(MezoAddresses.MUSD).balanceOf(keeperAddr);
        if (userBal < demoAmount) {
            console2.log("Skip keeper demo: insufficient USER MUSD for engine fund");
            return;
        }

        uint256 engineBefore = IERC20(MezoAddresses.MUSD).balanceOf(address(engine));
        uint256 keeperBefore = IERC20(MezoAddresses.MUSD).balanceOf(payout);

        IERC20(MezoAddresses.MUSD).transfer(address(engine), demoAmount);

        // Baseline for payout delta: if payout == keeper, use post-transfer balance; else pre-transfer
        uint256 keeperBaseline = IERC20(MezoAddresses.MUSD).balanceOf(payout);
        if (payout != keeperAddr) keeperBaseline = keeperBefore;

        // Build a tiny trove slice; executed may be 0 but rewards still forward
        address[] memory troves = new address[](2);
        troves[0] = address(0x1111111111111111111111111111111111111111);
        troves[1] = address(0x2222222222222222222222222222222222222222);

        try engine.liquidateRange(troves, 0, troves.length, 0) returns (uint256 executed) {
            executed; // quiet lint
        } catch { }

        uint256 engineAfter = IERC20(MezoAddresses.MUSD).balanceOf(address(engine));
        uint256 keeperAfter = IERC20(MezoAddresses.MUSD).balanceOf(payout);
        if (keeperAfter > keeperBaseline) {
            console2.log("Keeper payout MUSD delta:", keeperAfter - keeperBaseline);
        } else {
            console2.log("Keeper payout not observed (check registry/payTo and fee settings)");
        }
        if (engineAfter < engineBefore + demoAmount) {
            console2.log("Engine forwarded MUSD:", (engineBefore + demoAmount) - engineAfter);
        }
    }

    function _resolveAddr(string memory envKey, bool hasJson, string memory json, string memory jsonKey)
        internal
        view
        returns (address)
    {
        address addr = vm.envOr(envKey, address(0));
        if (addr != address(0) || !hasJson) return addr;
        try vm.parseJsonAddress(json, jsonKey) returns (address parsed) {
            return parsed;
        } catch {
            return address(0);
        }
    }

    function _logSummary(address router, address engine, address vault, address aggregator, address registry)
        internal
        pure
    {
        console2.log("Demo complete.");
        console2.log("Router:", router);
        console2.log("Engine:", engine);
        console2.log("VaultManager:", vault);
        console2.log("Aggregator:", aggregator);
        console2.log("KeeperRegistry:", registry);
    }
}

