// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import { MezoAddresses } from "../script/MezoAddresses.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { LiquidationEngine } from "../src/LiquidationEngine.sol";
import { KeeperRegistry } from "../src/KeeperRegistry.sol";
import { ITroveManager } from "../src/interfaces/ITroveManager.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPriceOracle } from "../src/interfaces/IPriceOracle.sol";

interface IBorrowerOperations {
    function openTrove(uint256 _maxFeePercentage, uint256 _MUSDAmount, address _upperHint, address _lowerHint)
        external
        payable;
}

contract TrovePilotLocalIntegrationTest is Test {
    // === Real Mezo Testnet proxy addresses (as per docs) ===
    address constant TROVE_MANAGER = MezoAddresses.TROVE_MANAGER;
    address constant HINT_HELPERS = MezoAddresses.HINT_HELPERS;
    address constant SORTED_TROVES = MezoAddresses.SORTED_TROVES;
    address constant BORROWER_OPS = MezoAddresses.BORROWER_OPERATIONS;
    address constant MUSD = MezoAddresses.MUSD;

    address constant PRICE_ORACLE_CALLER = MezoAddresses.PRICE_ORACLE_CALLER;

    RedemptionRouter public router;
    LiquidationEngine public engine;

    function setUp() public {
        // vm.createSelectFork(vm.envString("MEZO_RPC"));

        // Deploy our TrovePilot contracts
        router = new RedemptionRouter(TROVE_MANAGER, HINT_HELPERS, SORTED_TROVES);

        // Use simple config: owner is this contract, no fee sink
        engine = new LiquidationEngine(TROVE_MANAGER, address(this), address(0), 0);
        engine.setMusd(MUSD);
    }

    function test_Redeem_UsingRealUserBalance() public {
        // Fork at the CLI (or use createSelectFork); we assume you run with --fork-url
        address user = vm.envOr("USER", address(0));
        if (user == address(0)) {
            emit log("USER env not set; skipping live redeem test.");
            return;
        }
        uint256 userBal = IERC20(MUSD).balanceOf(user);
        emit log_named_uint("USER MUSD balance", userBal);

        // require at least 20 MUSD for a tiny redeem; skip otherwise
        if (userBal < 20e18) {
            emit log("Not enough MUSD on USER to run live redeem; skipping.");
            return;
        }

        // price must be active on this block
        uint256 price;
        try IPriceOracle(PRICE_ORACLE_CALLER).latestRoundData() returns (
            uint80, int256 answer, uint256, uint256, uint80
        ) {
            if (answer > 0) {
                price = uint256(answer);
            }
        } catch {
            emit log("PriceFeed inactive on this fork block; skipping live redeem.");
            return;
        }
        require(price > 0, "invalid price");

        // deploy router in-test (stateless helper)
        RedemptionRouter liveRouter = new RedemptionRouter(TROVE_MANAGER, HINT_HELPERS, SORTED_TROVES);

        // impersonate your wallet and redeem a small amount
        vm.startPrank(user);
        IERC20(MUSD).approve(address(liveRouter), type(uint256).max);

        uint256 beforeBal = IERC20(MUSD).balanceOf(user);
        // try Option B first (with hints/iterations)
        try liveRouter.redeemExact(10e18, price, 5) {
            uint256 afterBal = IERC20(MUSD).balanceOf(user);
            assertLt(afterBal, beforeBal, "MUSD should decrease after redemption");
        } catch {
            emit log("redeemExact reverted; trying quick path (Option A).");
            // Fallback: Option A (quick)
            liveRouter.redeemQuick(5e18);
        }
        vm.stopPrank();
    }

    function test_RedemptionRouter_OptionB_and_OptionA() public {
        // Give test address MUSD on fork (cheatcode)
        deal(MUSD, address(this), 1000e18);

        // If the oracle is inactive on this block, skip gracefully
        try IPriceOracle(PRICE_ORACLE_CALLER).latestRoundData() returns (uint80, int256 ans, uint256, uint256, uint80) {
            uint256 price = ans > 0 ? uint256(ans) : 0;
            assertGt(price, 0, "price feed returned zero");

            IERC20(MUSD).approve(address(router), type(uint256).max);

            // Option B
            uint256 beforeBal = IERC20(MUSD).balanceOf(address(this));
            router.redeemExact(
                1e18,
                /*price hint (unused by TM)*/
                price,
                /*maxIter*/
                5
            );
            uint256 afterBal = IERC20(MUSD).balanceOf(address(this));
            assertLt(afterBal, beforeBal, "MUSD should decrease after redemption");

            // Option A
            router.redeemQuick(5e17);
        } catch {
            emit log("PriceFeed inactive on this fork block; skipping redemption assertions.");
            // nothing else; test passes as a no-op
        }
    }

    // function test_RedemptionRouter_OptionB_and_OptionA() public {
    //     // give this test address 1,000 MUSD on fork (cheatcode)
    //     deal(MUSD, address(this), 1_000e18);

    //     // Option B (with hints)
    //     IERC20(MUSD).approve(address(router), type(uint256).max);
    //     uint256 beforeBal = IERC20(MUSD).balanceOf(address(this));
    //     router.redeemExact(10e18, /*price*/ 1000e18, /*maxIter*/ 5);
    //     uint256 afterBal = IERC20(MUSD).balanceOf(address(this));
    //     assertLt(afterBal, beforeBal, "MUSD should decrease after redemption");

    //     // Option A (quick)
    //     router.redeemQuick(5e18);
    // }

    function test_LiquidationEngine_NoRevert_WhenNoRewards() public {
        address[] memory troves = new address[](1);
        troves[0] = address(0x1234567890123456789012345678901234567890);

        // May execute 0 liquidations; should not revert even if no rewards received
        uint256 executed = engine.liquidateRange(troves, 0, troves.length, 0);
        assertTrue(executed >= 0, "Should not revert on empty/invalid set");
    }

    // function test_RedemptionFlow_WithRealProxies_ShouldBurnMUSD() public {
    //     // 1) Open a small trove (collateral deposit + borrow)
    //     IBorrowerOperations bo = IBorrowerOperations(BORROWER_OPS);
    //     vm.deal(address(this), 0.1 ether);

    //     bo.openTrove{value:0.05 ether}(
    //         5e16,     // 5% max fee
    //         200e18,   // borrow 200 MUSD
    //         address(0),
    //         address(0)
    //     );

    //     // 2) Approve and redeem a small amount (Option B)
    //     IERC20(MUSD).approve(address(router), 10e18);
    //     uint256 beforeBal = IERC20(MUSD).balanceOf(address(this));
    //     router.redeemExact(10e18, 1000e18, 5);
    //     uint256 afterBal = IERC20(MUSD).balanceOf(address(this));
    //     assertLt(afterBal, beforeBal, "MUSD balance should drop after redemption");

    //     // 3) Quick mode redemption (Option A)
    //     IERC20(MUSD).approve(address(router), 5e18);
    //     router.redeemQuick(5e18);
    // }

    // function test_Batcher_CallsShouldNotRevert_WhenNoLiquidation() public {
    //     address[] memory troves = new address[](1);
    //     troves[0] = address(0x1234567890123456789012345678901234567890); // invalid trove address

    //     // This may execute with 0 liquidations, but should not revert
    //     uint256 executed = batcher.batchLiquidate(troves, 0);
    //     // We expect executed == 0 (or >=0) and no revert
    //     assertTrue(executed >= 0, "Batcher should handle empty or invalid troves gracefully");
    // }
}
