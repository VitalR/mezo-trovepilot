// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import { ITroveManager } from "../../src/interfaces/ITroveManager.sol";
import { IHintHelpers } from "../../src/interfaces/IHintHelpers.sol";
import { ISortedTroves } from "../../src/interfaces/ISortedTroves.sol";

contract MockTroveManager is ITroveManager {
    bool public revertBatch;
    mapping(address => bool) public revertSingle;
    bool public revertRedeem;
    uint256 public rewardNative;
    uint256 public rewardMUSD;
    MockERC20 public musdToken;
    uint256 public redeemNativeOut;
    uint256 public redeemRefund;
    bool public redeemConfigured;
    uint256 public redeemExtraMint;

    address[] public lastBatch;
    uint256 public singleCalls;

    struct RedeemCall {
        uint256 amount;
        address first;
        address upper;
        address lower;
        uint256 nicr;
        uint256 maxIter;
    }

    RedeemCall public lastRedeem;

    function setRewardNative(uint256 value) external {
        rewardNative = value;
    }

    function setRewardMUSD(address token, uint256 value) external {
        musdToken = MockERC20(token);
        rewardMUSD = value;
    }

    function setRedeemBehavior(address token, uint256 nativeOut, uint256 refund) external {
        musdToken = MockERC20(token);
        redeemNativeOut = nativeOut;
        redeemRefund = refund;
        redeemConfigured = true;
        redeemExtraMint = 0;
    }

    function setRedeemExtraMint(uint256 amount) external {
        redeemExtraMint = amount;
    }

    function setRevertBatch(bool v) external {
        revertBatch = v;
    }

    function setRevertSingle(address who, bool v) external {
        revertSingle[who] = v;
    }

    function setRevertRedeem(bool v) external {
        revertRedeem = v;
    }

    function liquidate(address _borrower) external override {
        if (revertSingle[_borrower]) revert("single revert");
        singleCalls++;
        if (rewardNative != 0) {
            (bool ok,) = payable(msg.sender).call{ value: rewardNative }("");
            require(ok, "reward fail");
        }
        if (rewardMUSD != 0) {
            musdToken.mint(msg.sender, rewardMUSD);
        }
    }

    function batchLiquidateTroves(address[] calldata _borrowers) external override {
        lastBatch = _borrowers;
        if (revertBatch) revert("batch revert");
        if (rewardNative != 0) {
            (bool ok,) = payable(msg.sender).call{ value: rewardNative }("");
            require(ok, "reward fail");
        }
        if (rewardMUSD != 0) {
            musdToken.mint(msg.sender, rewardMUSD);
        }
    }

    function lastBatchLength() external view returns (uint256) {
        return lastBatch.length;
    }

    function redeemCollateral(
        uint256 _MUSDamount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint256 _partialRedemptionHintNICR,
        uint256 _maxIterations
    ) external override {
        if (revertRedeem) revert("redeem revert");
        lastRedeem = RedeemCall({
            amount: _MUSDamount,
            first: _firstRedemptionHint,
            upper: _upperPartialRedemptionHint,
            lower: _lowerPartialRedemptionHint,
            nicr: _partialRedemptionHintNICR,
            maxIter: _maxIterations
        });

        // Simulate Mezo redemption behavior only when explicitly configured by the test.
        // Default behavior is "record only" to keep unrelated tests deterministic.
        if (!redeemConfigured) return;

        require(address(musdToken) != address(0), "musdToken unset");
        require(redeemRefund <= _MUSDamount, "bad refund");

        // - burns some portion of MUSD from msg.sender (the wrapper)
        // - sends native collateral to msg.sender
        // - leaves any unused MUSD in msg.sender for the wrapper to refund
        uint256 burnAmount = _MUSDamount - redeemRefund;
        if (burnAmount != 0) musdToken.burn(msg.sender, burnAmount);
        if (redeemNativeOut != 0) {
            (bool ok,) = payable(msg.sender).call{ value: redeemNativeOut }("");
            require(ok, "redeem native fail");
        }
        if (redeemExtraMint != 0) {
            musdToken.mint(msg.sender, redeemExtraMint);
        }
    }

    function getLastRedeem() external view returns (RedeemCall memory) {
        return lastRedeem;
    }
}

contract MockHintHelpers is IHintHelpers {
    address public first;
    uint256 public nicr;
    uint256 public truncated;

    function setHints(address _first, uint256 _nicr, uint256 _truncated) external {
        first = _first;
        nicr = _nicr;
        truncated = _truncated;
    }

    function getRedemptionHints(uint256, uint256, uint256) external view override returns (address, uint256, uint256) {
        return (first, nicr, truncated);
    }
}

contract MockSortedTroves is ISortedTroves {
    address public upper;
    address public lower;

    function setInsert(address _upper, address _lower) external {
        upper = _upper;
        lower = _lower;
    }

    function findInsertPosition(uint256, address, address) external view override returns (address, address) {
        return (upper, lower);
    }
}

contract MockERC20 is ERC20("Mock", "MCK") {
    constructor() {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

