// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Test.sol";
import { LiquidationEngine } from "../src/LiquidationEngine.sol";
import { KeeperRegistry } from "../src/KeeperRegistry.sol";
import { ITroveManager } from "../src/interfaces/ITroveManager.sol";

contract MockTroveManager is ITroveManager {
    function liquidate(address) external { }
    function batchLiquidate(address[] calldata) external { }
    function redeemCollateral(uint256, address, address, address, uint256, uint256) external { }
}

contract MockERC20 {
    string public name = "Mock";
    string public symbol = "MOCK";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        allowance[from][msg.sender] = a - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        uint256 b = balanceOf[from];
        require(b >= amount, "balance");
        balanceOf[from] = b - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract LiquidationEngineRegistryTest is Test {
    MockTroveManager tm;
    LiquidationEngine engine;
    KeeperRegistry registry;
    MockERC20 musd;

    address keeper = address(0xBEEF);
    address payTo = address(0xCAFE);

    function setUp() public {
        tm = new MockTroveManager();
        engine = new LiquidationEngine(address(tm), address(this), address(0), 0);
        registry = new KeeperRegistry(address(this));
        musd = new MockERC20();

        engine.setKeeperRegistry(address(registry));
        registry.setAuthorizer(address(engine), true);
        engine.setMusd(address(musd));
        engine.setPointsPerLiquidation(5);

        // Keeper registers with payTo override
        vm.prank(keeper);
        registry.register(payTo);

        // Fund the batcher with native and MUSD to forward
        vm.deal(address(engine), 1 ether);
        musd.mint(address(engine), 100e18);
    }

    function test_Batch_ForwardsRewards_ToPayTo_And_BumpsScore() public {
        address[] memory troves = new address[](2);
        troves[0] = address(0x1);
        troves[1] = address(0x2);

        uint256 payToNativeBefore = payTo.balance;
        uint256 payToMusdBefore = musd.balanceOf(payTo);

        // keeper triggers batch
        vm.prank(keeper);
        uint256 executed = engine.liquidateRange(troves, 0, troves.length, 0);
        assertEq(executed, 2, "should count all as executed in mock");

        // Rewards forwarded
        assertGt(payTo.balance, payToNativeBefore, "native forwarded to payTo");
        assertGt(musd.balanceOf(payTo), payToMusdBefore, "MUSD forwarded to payTo");

        // Score bumped: 2 liq * 5 points
        (bool listed, uint96 score, address _payTo) = registry.keepers(keeper);
        assertTrue(listed, "keeper listed");
        assertEq(_payTo, payTo, "payTo set");
        assertEq(score, 10, "score bumped");
    }

    function test_GetRecentJobs_ReturnsLatestWindow() public {
        address[] memory troves = new address[](2);
        troves[0] = address(0x1);
        troves[1] = address(0x2);

        vm.prank(keeper);
        engine.liquidateRange(troves, 0, troves.length, 0);

        vm.prank(keeper);
        engine.liquidateRange(troves, 0, troves.length, 0);

        LiquidationEngine.JobSummary[] memory recent = engine.getRecentJobs(1);
        assertEq(recent.length, 1, "one recent job");
        assertEq(recent[0].attempted, 2, "attempted count");
        assertGt(recent[0].timestamp, 0, "has timestamp");
    }
}

