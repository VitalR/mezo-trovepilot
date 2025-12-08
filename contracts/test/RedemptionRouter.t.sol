// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { Errors } from "../src/utils/Errors.sol";
import { MockTroveManager, MockHintHelpers, MockSortedTroves } from "./utils/Mocks.t.sol";

contract RedemptionRouterTest is Test {
    MockTroveManager tm;
    MockHintHelpers hints;
    MockSortedTroves sorted;
    RedemptionRouter router;

    function setUp() public {
        tm = new MockTroveManager();
        hints = new MockHintHelpers();
        sorted = new MockSortedTroves();
        router = new RedemptionRouter(address(tm), address(hints), address(sorted));
    }

    function test_redeem_quick_forwards_params() public {
        address caller = address(this);
        vm.expectEmit(true, true, false, true);
        emit RedemptionRouter.RedemptionExecuted(1, caller, 100 ether, 100 ether, 0, false);
        vm.prank(caller);
        router.redeemQuick(100 ether);

        MockTroveManager.RedeemCall memory rc = tm.getLastRedeem();
        assertEq(rc.amount, 100 ether);
        assertEq(rc.first, address(0));
        assertEq(rc.upper, address(0));
        assertEq(rc.lower, address(0));
        assertEq(rc.nicr, 0);
        assertEq(rc.maxIter, 0);
        assertEq(router.jobId(), 1);
    }

    function test_revert_redeem_hinted_on_truncated_mismatch() public {
        hints.setHints(address(11), 123, 50);
        sorted.setInsert(address(21), address(22));

        vm.expectRevert(abi.encodeWithSelector(Errors.TruncatedMismatch.selector, 50));
        router.redeemHinted(100, 2000, 10, address(5), address(6));
    }

    function test_redeem_hinted_success() public {
        hints.setHints(address(11), 123, 100);
        sorted.setInsert(address(21), address(22));

        vm.expectEmit(true, true, false, true);
        emit RedemptionRouter.RedemptionExecuted(1, address(this), 100, 100, 10, true);
        router.redeemHinted(100, 2000, 10, address(5), address(6));

        MockTroveManager.RedeemCall memory rc = tm.getLastRedeem();
        assertEq(rc.amount, 100);
        assertEq(rc.first, address(11));
        assertEq(rc.upper, address(21));
        assertEq(rc.lower, address(22));
        assertEq(rc.nicr, 123);
        assertEq(rc.maxIter, 10);
        assertEq(router.jobId(), 1);
    }
}
