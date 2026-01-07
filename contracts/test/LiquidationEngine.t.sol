// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { LiquidationEngine } from "../src/LiquidationEngine.sol";
import { Errors } from "../src/utils/Errors.sol";
import { MockTroveManager, MockERC20 } from "./utils/Mocks.t.sol";

contract LiquidationEngineTest is Test {
    MockTroveManager tm;
    LiquidationEngine engine;
    MockERC20 musdToken;

    address keeper = address(0xBEEF);

    function setUp() public {
        musdToken = new MockERC20();
        tm = new MockTroveManager();
        engine = new LiquidationEngine(address(tm), address(musdToken));
    }

    function test_deploy_sets_trove_manager() public view {
        assertEq(address(engine.TROVE_MANAGER()), address(tm));
    }

    function test_deploy_sets_musd_token() public view {
        assertEq(address(engine.MUSD()), address(musdToken));
    }

    function test_deploy_reverts_zero_trove_manager() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new LiquidationEngine(address(0), address(musdToken));
    }

    function test_deploy_reverts_zero_musd() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new LiquidationEngine(address(tm), address(0));
    }

    function test_liquidation_batch_success() public {
        address[] memory borrowers = new address[](2);
        borrowers[0] = address(1);
        borrowers[1] = address(2);

        vm.expectEmit(true, true, false, true);
        emit LiquidationEngine.LiquidationExecuted(1, keeper, keeper, 2, 2, 0, 0);
        vm.prank(keeper);
        uint256 succeeded = engine.liquidateBatch(borrowers, keeper);

        assertEq(succeeded, 2);
        assertEq(engine.jobId(), 1);
        assertEq(tm.lastBatchLength(), 2);
    }

    function test_liquidation_single_success() public {
        address borrower = address(1);
        vm.expectEmit(true, true, false, true);
        emit LiquidationEngine.LiquidationExecuted(1, keeper, keeper, 1, 1, 0, 0);
        vm.prank(keeper);
        uint256 succeeded = engine.liquidateSingle(borrower, keeper);
        assertEq(succeeded, 1);
        assertEq(engine.jobId(), 1);
        assertEq(tm.singleCalls(), 1);
    }

    function test_liquidation_batch_reverts_when_trove_manager_batch_reverts() public {
        tm.setRevertBatch(true);
        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.expectRevert();
        vm.prank(keeper);
        engine.liquidateBatch(borrowers, keeper);
    }

    function test_liquidation_rewards_forwarded_to_keeper_batch() public {
        tm.setRewardNative(1 ether);
        vm.deal(address(tm), 1 ether);

        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.prank(keeper);
        engine.liquidateBatch(borrowers, keeper);

        assertEq(address(keeper).balance, 1 ether);
    }

    function test_liquidation_musd_rewards_forwarded_to_keeper_single() public {
        tm.setRewardMUSD(address(musdToken), 200 ether);

        vm.prank(keeper);
        engine.liquidateSingle(address(1), keeper);

        assertEq(musdToken.balanceOf(keeper), 200 ether);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_liquidation_musd_rewards_forwarded_to_keeper_batch() public {
        tm.setRewardMUSD(address(musdToken), 200 ether);

        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.prank(keeper);
        engine.liquidateBatch(borrowers, keeper);

        assertEq(musdToken.balanceOf(keeper), 200 ether);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_revert_on_empty_borrowers() public {
        address[] memory borrowers = new address[](0);
        vm.expectRevert();
        engine.liquidateBatch(borrowers, keeper);
    }

    function test_revert_on_zero_recipient_single() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        vm.prank(keeper);
        engine.liquidateSingle(address(1), address(0));
    }

    function test_revert_on_zero_recipient_batch() public {
        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);
        vm.expectRevert(Errors.ZeroAddress.selector);
        vm.prank(keeper);
        engine.liquidateBatch(borrowers, address(0));
    }

    function test_sweep_native_and_token_only_owner() public {
        // Native
        vm.deal(address(engine), 1 ether);
        engine.transferOwnership(keeper);
        engine.transferOwnership(keeper);
        vm.prank(keeper);
        engine.acceptOwnership();
        vm.prank(keeper);
        engine.sweep(address(0), keeper);
        assertEq(address(keeper).balance, 1 ether);

        // Token
        musdToken.mint(address(engine), 5 ether);
        vm.prank(keeper);
        engine.sweep(address(musdToken), keeper);
        assertEq(musdToken.balanceOf(keeper), 5 ether);
    }

    function test_sweep_revert_zero_recipient() public {
        vm.expectRevert();
        engine.sweep(address(0), address(0));
    }

    function test_sweep_noop_zero_balances() public {
        // Owner calls sweep on empty balances; should not revert.
        engine.sweep(address(0), address(this));
        engine.sweep(address(musdToken), address(this));
    }

    function tests_sweep_reverts_not_owner() public {
        vm.prank(keeper);
        vm.expectRevert();
        engine.sweep(address(0), address(this));
    }
}
