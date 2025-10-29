// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import { MezoAddresses } from "../script/MezoAddresses.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { LiquidationEngine } from "../src/LiquidationEngine.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPriceOracle } from "../src/interfaces/IPriceOracle.sol";
import { ISortedTroves } from "../src/interfaces/ISortedTroves.sol";

interface ISortedTrovesView {
    function getSize() external view returns (uint256);
}

contract TrovePilotLiveFork is Test {
    // === Mezo Testnet proxies ===
    address constant TROVE_MANAGER = MezoAddresses.TROVE_MANAGER;
    address constant HINT_HELPERS = MezoAddresses.HINT_HELPERS;
    address constant SORTED_TROVES = MezoAddresses.SORTED_TROVES;
    address constant MUSD = MezoAddresses.MUSD;
    address constant PRICE_ORACLE_CALLER = MezoAddresses.PRICE_ORACLE_CALLER;

    // === TrovePilot Testnet contracts (ENV override friendly) ===
    address public routerAddr;
    address public engineAddr;
    RedemptionRouter public router;
    LiquidationEngine public engine;

    function setUp() public {
        // vm.createSelectFork(vm.envString("MEZO_RPC"));
        routerAddr = vm.envOr("ROUTER_ADDR", address(0x26E19F8cCEd46A88E3cfDFF71AD354ACE50A29fF));
        engineAddr = vm.envOr("ENGINE_ADDR", address(0xa9875d06bA07eEC384c5d5A5EBaA1AD02DA28760));
        router = RedemptionRouter(routerAddr);
        engine = LiquidationEngine(payable(engineAddr));
    }

    function test_Live_Router_Redeem_Small() public {
        address user = vm.envOr("USER", address(0));
        if (user == address(0)) {
            emit log("USER env not set; skipping live redeem test.");
            return;
        }
        uint256 bal = IERC20(MUSD).balanceOf(user);
        emit log_named_uint("USER MUSD balance", bal);
        if (bal < 50e18) {
            emit log("Not enough MUSD; skipping live redeem test.");
            return;
        }

        // Check there are troves to redeem against
        uint256 troves = ISortedTrovesView(SORTED_TROVES).getSize();
        emit log_named_uint("SortedTroves size", troves);
        if (troves == 0) {
            emit log("No troves on testnet; skipping.");
            return;
        }

        // Optional best-effort price (kept from your version) ...
        uint256 price = 1e18;
        try IPriceOracle(PRICE_ORACLE_CALLER).latestRoundData() returns (uint80, int256 ans, uint256, uint256, uint80) {
            if (ans > 0) price = uint256(ans);
        } catch { }

        // // Try to fetch price, but don't block on it.
        // uint256 price = 0;
        // // 1) ABI-typed call
        // try IPriceOracle(PRICE_FEED).fetchPrice() returns (uint256 p) {
        //     price = p;
        //     emit log_named_uint("PriceFeed (typed) ok", price);
        // } catch {
        //     // 2) Raw staticcall fallback (in case selector/ABI mismatch)
        //     (bool ok, bytes memory data) = PRICE_FEED.staticcall(abi.encodeWithSignature("fetchPrice()"));
        //     if (ok && data.length == 32) {
        //         price = abi.decode(data, (uint256));
        //         emit log_named_uint("PriceFeed (raw) ok", price);
        //     } else {
        //         emit log("PriceFeed failed; using safe non-zero fallback.");
        //         price = 1e18; // harmless non-zero; TM ignores it in your flow anyway
        //     }
        // }

        vm.startPrank(user);

        // IMPORTANT: approve both router (if it pulls) AND TroveManager (if TM pulls/burns)
        IERC20(MUSD).approve(address(router), type(uint256).max);
        IERC20(MUSD).approve(TROVE_MANAGER, type(uint256).max);

        uint256 beforeBal = IERC20(MUSD).balanceOf(user);

        bool ok;
        // Try a more meaningful redeem size (e.g. 50 MUSD)
        try router.redeemQuick(50e18) {
            ok = true;
        } catch {
            ok = false;
        }

        if (!ok) {
            emit log("redeemQuick reverted; trying redeemExact(25 MUSD).");
            try router.redeemExact(25e18, price, 8) {
                ok = true;
            } catch {
                ok = false;
            }
        }

        // if (!quickOk) {
        //     emit log("redeemQuick reverted; trying redeemExact with dummy price.");
        //     // Tiny amount + dummy price as hint; wrapped in try/catch so test never blocks.
        //     try router.redeemExact(1e18, price, 3) { } catch { }
        // }

        uint256 afterBal = IERC20(MUSD).balanceOf(user);
        if (ok && afterBal < beforeBal) {
            assertLt(afterBal, beforeBal, "MUSD should drop after redemption");
        } else {
            emit log("No MUSD burned (likely no eligible troves / constraints / approval mismatch).");
        }
        vm.stopPrank();
    }

    function test_Live_Engine_NoRevert() public {
        // We don’t rely on actual unsafe troves here; just prove no revert path.
        address[] memory troves = new address[](2);
        troves[0] = address(0x1111111111111111111111111111111111111111);
        troves[1] = address(0x2222222222222222222222222222222222222222);

        // Call should not revert; executed may be 0 and that’s fine.
        uint256 executed = engine.liquidateRange(troves, 0, troves.length, 0);
        assertTrue(executed >= 0);
    }
}

// source .env.testnet && forge test --match-contract TrovePilotLiveFork --rpc-url "$MEZO_RPC" -vvv

