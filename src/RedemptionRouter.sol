// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ITroveManager } from "./interfaces/ITroveManager.sol";
import { IHintHelpers } from "./interfaces/IHintHelpers.sol";
import { ISortedTroves } from "./interfaces/ISortedTroves.sol";

/// @title TrovePilot: RedemptionRouter
/// @notice Composable wrapper around `TroveManager.redeemCollateral`, providing on-chain hint computation
///         and simplified “quick mode” for smaller redemptions.
/// @dev
/// ## Background — “Option A / Option B” Redemption Patterns
/// In Mezo’s official docs, `redeemCollateral` supports two call styles:
///
/// **Option A – Quick & Simple (higher gas):**
///   ```solidity
///   redeemCollateral(
///       musdAmount,
///       address(0),         // no first hint
///       msg.sender,         // upperPartialRedemptionHint
///       msg.sender,         // lowerPartialRedemptionHint
///       1.10e18,            // _partialRedemptionHintNICR (110% = MCR)
///       0                   // _maxIterations = 0 (skip traversal)
///   );
///   ```
///   → Easier to call, but the TroveManager searches troves on-chain (more gas).
///
/// **Option B – With Hints (optimized gas):**
///   ```solidity
///   (address firstHint, uint256 nicr,) = HintHelpers.getRedemptionHints(amount, price, maxIter);
///   (address upper, address lower) = SortedTroves.findInsertPosition(nicr, prev, next);
///   redeemCollateral(amount, firstHint, upper, lower, nicr, maxIter);
///   ```
///   → Cheaper gas, as hints are pre-computed off-chain or via helper contracts.
///
/// This router exposes both:
///   - `redeemExact()`  → Option B (optimized, uses hints)
///   - `redeemQuick()`  → Option A (simple, no hints)
contract RedemptionRouter {
    // =============================================================
    //                      EVENTS & ERRORS
    // =============================================================

    /// @notice Emitted after a redemption.
    /// @param caller     The initiator of redemption.
    /// @param musdBurned Amount of MUSD provided.
    /// @param maxIter    Max iterations used in this call.
    event Redeemed(address indexed caller, uint256 musdBurned, uint256 maxIter);

    /// @dev Thrown when a provided address is zero.
    error ZeroAddress();
    /// @dev Thrown when zero amount is provided for redemption.
    error ZeroAmount();

    // =============================================================
    //                         IMMUTABLES
    // =============================================================

    ITroveManager public immutable tm;
    IHintHelpers public immutable hints;
    ISortedTroves public immutable sorted;

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /// @param _tm TroveManager proxy address.
    /// @param _hints HintHelpers address.
    /// @param _sorted SortedTroves address.
    constructor(address _tm, address _hints, address _sorted) {
        require(_tm != address(0) && _hints != address(0) && _sorted != address(0), ZeroAddress());
        tm = ITroveManager(_tm);
        hints = IHintHelpers(_hints);
        sorted = ISortedTroves(_sorted);
    }

    // =============================================================
    //                         REDEMPTIONS
    // =============================================================

    /// @notice Redeem an exact amount of MUSD using computed hints and bounded iterations.
    /// @dev
    /// 1. Uses `HintHelpers.getRedemptionHints` to compute `(firstHint, NICR)`.
    /// 2. Uses `SortedTroves.findInsertPosition` to compute `(upperHint, lowerHint)`.
    /// 3. Calls `TroveManager.redeemCollateral` with bounded `_maxIterations`.
    /// @param _musdAmount Exact MUSD amount to redeem (must be > 0).
    /// @param _price      System price used by TroveManager (keep consistent with protocol).
    /// @param _maxIter    Upper bound for trove traversal during redemption.
    function redeemExact(uint256 _musdAmount, uint256 _price, uint256 _maxIter) external {
        require(_musdAmount > 0, ZeroAmount());

        (address firstHint, uint256 nicr,) = hints.getRedemptionHints(_musdAmount, _price, _maxIter);

        // In absence of better guesses, use (msg.sender, msg.sender) as seeds; SortedTroves will adjust
        (address upper, address lower) = sorted.findInsertPosition(nicr, msg.sender, msg.sender);

        tm.redeemCollateral(_musdAmount, firstHint, upper, lower, nicr, _maxIter);
        emit Redeemed(msg.sender, _musdAmount, _maxIter);
    }

    /// @notice **Option A – Quick & Simple redemption (no hints).**
    /// @dev
    /// - Passes zero address as first hint and self as upper/lower hints.
    /// - `_partialRedemptionHintNICR` hard-coded to 1.10e18 (≈ MCR = 110%).
    /// - `_maxIterations = 0` lets TroveManager handle traversal internally (higher gas).
    /// @param _musdAmount MUSD to redeem (must be > 0).
    function redeemQuick(uint256 _musdAmount) external {
        require(_musdAmount > 0, ZeroAmount());
        tm.redeemCollateral(
            _musdAmount,
            address(0), // firstRedemptionHint (none)
            msg.sender, // upperPartialRedemptionHint
            msg.sender, // lowerPartialRedemptionHint
            1_100_000_000_000_000_000, // ≈ 110% NICR (MCR)
            0 // maxIterations = 0 (skip traversal)
        );
        emit Redeemed(msg.sender, _musdAmount, 0);
    }
}
