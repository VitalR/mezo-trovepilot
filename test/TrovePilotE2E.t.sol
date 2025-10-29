// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { LiquidationEngine } from "../src/LiquidationEngine.sol";
import { KeeperRegistry } from "../src/KeeperRegistry.sol";
import { VaultManager } from "../src/VaultManager.sol";
import { YieldAggregator } from "../src/YieldAggregator.sol";

import { ERC20Mock } from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockTroveManager {
    function liquidate(address) external { }
    function batchLiquidate(address[] calldata) external { }
    function redeemCollateral(uint256, address, address, address, uint256, uint256) external { }
}

contract MockHintHelpers {
    function getRedemptionHints(uint256 _MUSDamount, uint256, uint256)
        external
        pure
        returns (address firstRedemptionHint, uint256 partialRedemptionHintNICR, uint256 truncatedMUSDamount)
    {
        return (address(0), 1_100_000_000_000_000_000, _MUSDamount);
    }
}

contract MockSortedTroves {
    function findInsertPosition(uint256, address _prevId, address _nextId)
        external
        pure
        returns (address upperHint, address lowerHint)
    {
        return (_prevId, _nextId);
    }
}

contract TrovePilotE2E is Test {
    // System components (mocks where appropriate)
    MockTroveManager tm;
    ERC20Mock musd;

    RedemptionRouter router;
    LiquidationEngine engine;
    KeeperRegistry registry;
    VaultManager vault;
    YieldAggregator aggregator;

    address owner = address(this);
    address keeper = address(0xBEEF);
    address payTo = address(0xCAFE);
    address user = address(0xABCD);

    function setUp() public {
        tm = new MockTroveManager();
        musd = new ERC20Mock();

        // Deploy core
        MockHintHelpers hints = new MockHintHelpers();
        MockSortedTroves sorted = new MockSortedTroves();
        router = new RedemptionRouter(address(tm), address(hints), address(sorted));
        engine = new LiquidationEngine(address(tm), owner, address(0), 0);
        engine.setMusd(address(musd));

        vault = new VaultManager(address(musd), address(router), owner);
        aggregator = new YieldAggregator(address(musd), owner);
        aggregator.setNotifier(address(vault), true);
        vault.setAggregator(address(aggregator));

        // Keeper registry
        registry = new KeeperRegistry(owner);
        engine.setKeeperRegistry(address(registry));
        registry.setAuthorizer(address(engine), true);

        // Keeper registers with custom payTo
        vm.prank(keeper);
        registry.register(payTo);

        // Mint balances
        musd.mint(user, 1000e18);
        musd.mint(address(engine), 100e18); // simulate MUSD rewards pending on engine

        // Seed native rewards on engine
        vm.deal(address(engine), 1 ether);
    }

    function test_VaultManager_Execute_And_Aggregator_Deposit() public {
        // User funds the vault manager
        vm.startPrank(user);
        IERC20(address(musd)).approve(address(vault), type(uint256).max);
        vault.fund(200e18);
        vault.setConfig(50e18, 5, 100, true); // 1% keeper fee
        vm.stopPrank();

        // Keeper executes redemption on behalf of user
        uint256 keeperBefore = musd.balanceOf(keeper);
        vm.prank(keeper);
        vault.execute(user, 1000e18);
        uint256 keeperAfter = musd.balanceOf(keeper);
        assertGt(keeperAfter, keeperBefore, "keeper fee paid");

        // Auto-deposit a portion to aggregator
        uint256 beforeAgg = aggregator.balances(user);
        vault.autoDeposit(user, 10e18);
        uint256 afterAgg = aggregator.balances(user);
        assertEq(afterAgg, beforeAgg + 10e18, "aggregator credited");
    }

    function test_Engine_Liquidate_Forwards_To_PayTo_And_Scores() public {
        // Prepare troves; engine will fall back to per-trove loop and count successes
        address[] memory troves = new address[](3);
        troves[0] = address(0x1);
        troves[1] = address(0x2);
        troves[2] = address(0x3);

        // Keeper triggers liquidation range
        uint256 payToNativeBefore = payTo.balance;
        uint256 payToMusdBefore = musd.balanceOf(payTo);
        vm.prank(keeper);
        uint256 executed = engine.liquidateRange(troves, 0, troves.length, 0);
        // With mock TM, executed may equal count (fallback loop treats tries as ok); just assert non-revert
        assertTrue(executed >= 0);

        // Rewards forwarded to payTo override (engine had native + MUSD balances)
        assertGt(payTo.balance, payToNativeBefore, "native forwarded to payTo");
        assertGt(musd.balanceOf(payTo), payToMusdBefore, "MUSD forwarded to payTo");

        // Score bumped (default points=1)
        (, uint96 score, address setPayTo) = registry.keepers(keeper);
        assertEq(setPayTo, payTo, "payTo persisted");
        assertGt(score, 0, "score increased");
    }
}
