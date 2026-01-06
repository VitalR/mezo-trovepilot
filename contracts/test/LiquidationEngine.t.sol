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
        emit LiquidationEngine.LiquidationExecuted(1, keeper, 2, 2, false, 0, 0);
        vm.prank(keeper);
        uint256 succeeded = engine.liquidateRange(borrowers, false);

        assertEq(succeeded, 2);
        assertEq(engine.jobId(), 1);
        assertEq(tm.lastBatchLength(), 2);
    }

    function test_liquidation_batch_reverts_then_fallback_succeeds_all() public {
        tm.setRevertBatch(true);
        address[] memory borrowers = new address[](3);
        borrowers[0] = address(1);
        borrowers[1] = address(2);
        borrowers[2] = address(3);

        vm.prank(keeper);
        uint256 succeeded = engine.liquidateRange(borrowers, true);

        assertEq(succeeded, 3);
        assertEq(tm.singleCalls(), 3);
        assertEq(engine.jobId(), 1);
    }

    function test_liquidation_rewards_forwarded_to_keeper_batch() public {
        tm.setRewardNative(1 ether);
        vm.deal(address(tm), 1 ether);

        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.prank(keeper);
        engine.liquidateRange(borrowers, false);

        assertEq(address(keeper).balance, 1 ether);
    }

    function test_liquidation_musd_rewards_forwarded_to_keeper_batch() public {
        tm.setRewardMUSD(address(musdToken), 200 ether);

        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.prank(keeper);
        engine.liquidateRange(borrowers, false);

        assertEq(musdToken.balanceOf(keeper), 200 ether);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_liquidation_rewards_forwarded_to_keeper_fallback() public {
        tm.setRewardNative(0.5 ether);
        tm.setRevertBatch(true);
        vm.deal(address(tm), 1 ether);

        address[] memory borrowers = new address[](2);
        borrowers[0] = address(1);
        borrowers[1] = address(2);

        vm.prank(keeper);
        engine.liquidateRange(borrowers, true);

        // Two single liquidations each pay 0.5 ether to engine; engine forwards 1 ether to keeper.
        assertEq(address(keeper).balance, 1 ether);
    }

    function test_liquidation_musd_rewards_forwarded_to_keeper_fallback() public {
        tm.setRewardMUSD(address(musdToken), 200 ether);
        tm.setRevertBatch(true);

        address[] memory borrowers = new address[](2);
        borrowers[0] = address(1);
        borrowers[1] = address(2);

        vm.prank(keeper);
        engine.liquidateRange(borrowers, true);

        // Two single liquidations each credit 200 MUSD to engine; engine forwards total to keeper.
        assertEq(musdToken.balanceOf(keeper), 400 ether);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_liquidation_fallback_flag_when_batch_succeeds() public {
        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.prank(keeper);
        uint256 succeeded = engine.liquidateRange(borrowers, true);

        assertEq(succeeded, 1);
        assertEq(engine.jobId(), 1);
        assertEq(tm.singleCalls(), 0);
    }

    function test_liquidation_fallback_partial_success() public {
        tm.setRevertBatch(true);
        tm.setRevertSingle(address(2), true);
        address[] memory borrowers = new address[](2);
        borrowers[0] = address(1);
        borrowers[1] = address(2);

        vm.prank(keeper);
        uint256 succeeded = engine.liquidateRange(borrowers, true);

        assertEq(tm.singleCalls(), 1);
        assertEq(succeeded, 1);
        assertEq(engine.jobId(), 1);
    }

    function test_revert_liquidation_batch_when_no_fallback() public {
        tm.setRevertBatch(true);
        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.expectRevert();
        vm.prank(keeper);
        engine.liquidateRange(borrowers, false);
    }

    function test_revert_on_empty_borrowers() public {
        address[] memory borrowers = new address[](0);
        vm.expectRevert();
        engine.liquidateRange(borrowers, false);
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
