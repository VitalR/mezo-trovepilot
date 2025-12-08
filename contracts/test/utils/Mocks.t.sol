// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {IHintHelpers} from "../../src/interfaces/IHintHelpers.sol";
import {ISortedTroves} from "../../src/interfaces/ISortedTroves.sol";

contract MockTroveManager is ITroveManager {
    bool public revertBatch;
    mapping(address => bool) public revertSingle;

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

    function setRevertBatch(bool v) external {
        revertBatch = v;
    }

    function setRevertSingle(address who, bool v) external {
        revertSingle[who] = v;
    }

    function liquidate(address _borrower) external override {
        if (revertSingle[_borrower]) revert("single revert");
        singleCalls++;
    }

    function batchLiquidate(address[] calldata _borrowers) external override {
        lastBatch = _borrowers;
        if (revertBatch) revert("batch revert");
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
        lastRedeem = RedeemCall({
            amount: _MUSDamount,
            first: _firstRedemptionHint,
            upper: _upperPartialRedemptionHint,
            lower: _lowerPartialRedemptionHint,
            nicr: _partialRedemptionHintNICR,
            maxIter: _maxIterations
        });
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
}

