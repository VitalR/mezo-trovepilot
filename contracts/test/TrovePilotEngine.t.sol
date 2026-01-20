// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { TrovePilotEngine } from "../src/TrovePilotEngine.sol";
import { Errors } from "../src/utils/Errors.sol";
import { MockTroveManager, MockERC20 } from "./utils/Mocks.t.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract ReenterOnReceive {
    TrovePilotEngine public engine;
    address public borrower;

    bool public attempted;
    bool public failed;

    constructor(TrovePilotEngine _engine, address _borrower) {
        engine = _engine;
        borrower = _borrower;
    }

    receive() external payable {
        attempted = true;
        try engine.liquidateSingle(borrower, address(this)) returns (
            uint256
        ) {
        // Should be unreachable due to ReentrancyGuard.
        }
        catch {
            failed = true;
        }
    }
}

contract RejectEth {
    receive() external payable {
        revert("reject");
    }
}

contract TrovePilotEngineTest is Test {
    MockTroveManager tm;
    TrovePilotEngine engine;
    MockERC20 musdToken;

    address caller = address(0xCA11E);
    address recipient = address(0xBEEF);

    function setUp() public {
        musdToken = new MockERC20();
        tm = new MockTroveManager();
        engine = new TrovePilotEngine(address(tm), address(musdToken), address(this));
    }

    function test_constructor_sets_addresses() public view {
        assertEq(address(engine.TROVE_MANAGER()), address(tm));
        assertEq(address(engine.MUSD()), address(musdToken));
        assertEq(engine.owner(), address(this));
    }

    function test_constructor_reverts_on_zero_trove_manager() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        new TrovePilotEngine(address(0), address(musdToken), address(this));
    }

    function test_constructor_reverts_on_zero_owner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new TrovePilotEngine(address(tm), address(musdToken), address(0));
    }

    function test_liquidateSingle_reverts_on_zero_borrower_or_recipient() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        engine.liquidateSingle(address(0), recipient);

        vm.expectRevert(Errors.ZeroAddress.selector);
        engine.liquidateSingle(address(1), address(0));
    }

    function test_liquidateSingle_bubbles_core_revert() public {
        tm.setRevertSingle(address(1), true);
        vm.expectRevert();
        vm.prank(caller);
        engine.liquidateSingle(address(1), recipient);
    }

    function test_liquidateSingle_forwards_deltas_and_emits() public {
        tm.setRewardNative(1 ether);
        tm.setRewardMUSD(address(musdToken), 200 ether);
        vm.deal(address(tm), 1 ether);

        vm.expectEmit(true, true, true, true);
        emit TrovePilotEngine.LiquidationExecuted(1, caller, recipient, 1, 1, 1 ether, 200 ether);

        vm.prank(caller);
        uint256 succeeded = engine.liquidateSingle(address(1), recipient);

        assertEq(succeeded, 1);
        assertEq(engine.jobId(), 1);
        assertEq(address(recipient).balance, 1 ether);
        assertEq(musdToken.balanceOf(recipient), 200 ether);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_liquidateSingle_reverts_if_recipient_rejects_native() public {
        RejectEth reject = new RejectEth();
        tm.setRewardNative(1 wei);
        vm.deal(address(tm), 1 wei);

        vm.prank(caller);
        vm.expectRevert(Errors.NativeTransferFailed.selector);
        engine.liquidateSingle(address(1), address(reject));
    }

    function test_liquidateBatch_forwards_deltas_and_emits() public {
        address[] memory borrowers = new address[](2);
        borrowers[0] = address(1);
        borrowers[1] = address(2);

        tm.setRewardNative(3 ether);
        tm.setRewardMUSD(address(musdToken), 50 ether);
        vm.deal(address(tm), 3 ether);

        vm.expectEmit(true, true, true, true);
        emit TrovePilotEngine.LiquidationExecuted(1, caller, recipient, 2, 2, 3 ether, 50 ether);

        vm.prank(caller);
        uint256 succeeded = engine.liquidateBatch(borrowers, recipient);

        assertEq(succeeded, 2);
        assertEq(engine.jobId(), 1);
        assertEq(tm.lastBatchLength(), 2);
        assertEq(address(recipient).balance, 3 ether);
        assertEq(musdToken.balanceOf(recipient), 50 ether);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_liquidateBatch_reverts_on_zero_recipient_or_empty_borrowers() public {
        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.expectRevert(Errors.ZeroAddress.selector);
        engine.liquidateBatch(borrowers, address(0));

        address[] memory empty = new address[](0);
        vm.expectRevert(Errors.EmptyArray.selector);
        engine.liquidateBatch(empty, recipient);
    }

    function test_liquidateBatch_bubbles_core_revert() public {
        tm.setRevertBatch(true);
        address[] memory borrowers = new address[](1);
        borrowers[0] = address(1);

        vm.expectRevert();
        vm.prank(caller);
        engine.liquidateBatch(borrowers, recipient);
    }

    function test_redeemHintedTo_custody_refund_forward_and_emits() public {
        uint256 musdAmount = 100 ether;
        uint256 refund = 40 ether;
        uint256 collateralOut = 2 ether;

        // Ensure caller has MUSD and has approved the engine for atomic custody.
        musdToken.mint(caller, musdAmount);
        vm.prank(caller);
        musdToken.approve(address(engine), musdAmount);

        // Configure mock redemption behavior:
        // - burns musdAmount - refund
        // - sends native collateralOut to engine
        tm.setRedeemBehavior(address(musdToken), collateralOut, refund);
        vm.deal(address(tm), collateralOut);

        uint256 supplyBefore = musdToken.totalSupply();

        vm.expectEmit(true, true, true, true);
        emit TrovePilotEngine.RedemptionExecuted(
            1, caller, recipient, musdAmount, musdAmount - refund, refund, collateralOut, 10, true
        );

        vm.prank(caller);
        engine.redeemHintedTo(musdAmount, recipient, address(11), address(21), address(22), 123, 10);

        assertEq(engine.jobId(), 1);
        assertEq(address(recipient).balance, collateralOut);
        assertEq(musdToken.balanceOf(recipient), refund);
        assertEq(musdToken.balanceOf(address(engine)), 0);
        assertEq(musdToken.balanceOf(caller), 0);
        assertEq(musdToken.totalSupply(), supplyBefore - (musdAmount - refund));
    }

    function test_redeemHintedTo_reverts_on_zero_amount_or_recipient() public {
        vm.expectRevert(Errors.ZeroAmount.selector);
        engine.redeemHintedTo(0, recipient, address(0), address(0), address(0), 0, 0);

        vm.expectRevert(Errors.ZeroAddress.selector);
        engine.redeemHintedTo(1, address(0), address(0), address(0), address(0), 0, 0);
    }

    function test_redeemHintedTo_bubbles_core_revert() public {
        uint256 musdAmount = 10 ether;
        musdToken.mint(caller, musdAmount);
        vm.prank(caller);
        musdToken.approve(address(engine), musdAmount);

        tm.setRedeemBehavior(address(musdToken), 0, 0);
        tm.setRevertRedeem(true);

        vm.expectRevert();
        vm.prank(caller);
        engine.redeemHintedTo(musdAmount, recipient, address(11), address(21), address(22), 123, 10);
    }

    function test_redeemHintedTo_reverts_if_recipient_rejects_native() public {
        RejectEth reject = new RejectEth();
        uint256 musdAmount = 10 ether;
        musdToken.mint(caller, musdAmount);
        vm.prank(caller);
        musdToken.approve(address(engine), musdAmount);

        tm.setRedeemBehavior(address(musdToken), 1 wei, 0);
        vm.deal(address(tm), 1 wei);

        vm.expectRevert(Errors.NativeTransferFailed.selector);
        vm.prank(caller);
        engine.redeemHintedTo(musdAmount, address(reject), address(11), address(21), address(22), 123, 10);
    }

    function test_redeemHintedTo_reverts_on_invalid_refund_amount() public {
        uint256 musdAmount = 10 ether;
        musdToken.mint(caller, musdAmount);
        vm.prank(caller);
        musdToken.approve(address(engine), musdAmount);

        // Burn all requested amount, then mint extra MUSD to the engine so the post-call MUSD delta exceeds musdAmount.
        // This should trigger Errors.InvalidRefundAmount() defensive invariant.
        tm.setRedeemBehavior(address(musdToken), 0, 0);
        tm.setRedeemExtraMint(musdAmount + 1);

        vm.expectRevert(Errors.InvalidRefundAmount.selector);
        vm.prank(caller);
        engine.redeemHintedTo(musdAmount, recipient, address(11), address(21), address(22), 123, 10);
    }

    function test_redeemHintedTo_only_refunds_musd_delta() public {
        uint256 musdAmount = 100 ether;
        uint256 refund = 40 ether;

        musdToken.mint(caller, musdAmount);
        vm.prank(caller);
        musdToken.approve(address(engine), musdAmount);

        tm.setRedeemBehavior(address(musdToken), 0, refund);

        vm.prank(caller);
        engine.redeemHintedTo(musdAmount, recipient, address(11), address(21), address(22), 123, 10);

        assertEq(address(recipient).balance, 0);
        assertEq(musdToken.balanceOf(recipient), refund);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_redeemHintedTo_only_forwards_native_delta() public {
        uint256 musdAmount = 100 ether;
        uint256 collateralOut = 2 ether;

        musdToken.mint(caller, musdAmount);
        vm.prank(caller);
        musdToken.approve(address(engine), musdAmount);

        tm.setRedeemBehavior(address(musdToken), collateralOut, 0);
        vm.deal(address(tm), collateralOut);

        vm.prank(caller);
        engine.redeemHintedTo(musdAmount, recipient, address(11), address(21), address(22), 123, 10);

        assertEq(address(recipient).balance, collateralOut);
        assertEq(musdToken.balanceOf(recipient), 0);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_redeemHintedTo_burns_all_and_forwards_no_deltas() public {
        uint256 musdAmount = 100 ether;

        musdToken.mint(caller, musdAmount);
        vm.prank(caller);
        musdToken.approve(address(engine), musdAmount);

        // burn all, send no native, refund 0
        tm.setRedeemBehavior(address(musdToken), 0, 0);

        vm.prank(caller);
        engine.redeemHintedTo(musdAmount, recipient, address(11), address(21), address(22), 123, 10);

        assertEq(address(recipient).balance, 0);
        assertEq(musdToken.balanceOf(recipient), 0);
        assertEq(musdToken.balanceOf(address(engine)), 0);
    }

    function test_reentrancy_recipient_attempt_is_blocked_by_guard() public {
        tm.setRewardNative(1 wei);
        vm.deal(address(tm), 1 wei);

        ReenterOnReceive reenter = new ReenterOnReceive(engine, address(1));

        vm.prank(caller);
        engine.liquidateSingle(address(1), address(reenter));

        assertTrue(reenter.attempted());
        assertTrue(reenter.failed());
        assertEq(engine.jobId(), 1);
    }

    function test_sweep_owner_only_native_and_erc20() public {
        vm.deal(address(engine), 1 ether);
        musdToken.mint(address(engine), 5 ether);

        // Transfer ownership to recipient using 2-step.
        engine.transferOwnership(recipient);
        vm.prank(recipient);
        engine.acceptOwnership();

        vm.prank(recipient);
        engine.sweep(address(0), recipient);
        assertEq(address(recipient).balance, 1 ether);

        vm.prank(recipient);
        engine.sweep(address(musdToken), recipient);
        assertEq(musdToken.balanceOf(recipient), 5 ether);
    }

    function test_sweep_reverts_for_non_owner() public {
        vm.prank(caller);
        vm.expectRevert();
        engine.sweep(address(0), caller);
    }

    function test_sweep_reverts_on_zero_recipient() public {
        vm.expectRevert(Errors.ZeroAddress.selector);
        engine.sweep(address(0), address(0));
    }

    function test_sweep_noop_zero_balances() public {
        // Owner calls sweep on empty balances; should not revert.
        engine.sweep(address(0), recipient);
        engine.sweep(address(musdToken), recipient);
    }

    function test_sweep_native_reverts_if_recipient_rejects() public {
        RejectEth reject = new RejectEth();
        vm.deal(address(engine), 1 wei);

        vm.expectRevert(Errors.NativeTransferFailed.selector);
        engine.sweep(address(0), address(reject));
    }
}
