// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ITroveManager } from "./interfaces/ITroveManager.sol";
import { IHintHelpers } from "./interfaces/IHintHelpers.sol";
import { ISortedTroves } from "./interfaces/ISortedTroves.sol";

import { Errors } from "./utils/Errors.sol";

/// @title TrovePilot RedemptionRouter
/// @notice Minimal, permissionless wrapper around `TroveManager.redeemCollateral` exposing quick and hinted flows.
/// @dev Stateless. All strategy (price/slippage/iterations) is off-chain. Spec reference: docs/CONTRACTS_V2.md.
contract RedemptionRouter {
    /// @notice Emitted after a redemption completes.
    /// @param jobId      Monotonic identifier for off-chain indexing.
    /// @param caller     Address that initiated the redemption.
    /// @param musdBurned Amount of MUSD requested/redeemed.
    /// @param truncated  Truncated amount returned by HintHelpers.
    /// @param maxIter    Max iterations used.
    /// @param hinted     True if redemption used hints.
    event RedemptionExecuted(
        uint256 indexed jobId,
        address indexed caller,
        uint256 musdBurned,
        uint256 truncated,
        uint256 maxIter,
        bool hinted
    );

    /// @notice TroveManager proxy used to perform redemptions.
    ITroveManager public immutable tm;
    /// @notice HintHelpers contract used to compute redemption hints.
    IHintHelpers public immutable hints;
    /// @notice SortedTroves contract used to compute insert positions.
    ISortedTroves public immutable sorted;
    /// @notice Monotonic identifier for off-chain indexing.
    uint256 public jobId;

    /// @param _tm TroveManager proxy address.
    /// @param _hints HintHelpers address.
    /// @param _sorted SortedTroves address.
    constructor(address _tm, address _hints, address _sorted) {
        if (_tm == address(0) || _hints == address(0) || _sorted == address(0)) revert Errors.ZeroAddress();
        tm = ITroveManager(_tm);
        hints = IHintHelpers(_hints);
        sorted = ISortedTroves(_sorted);
    }

    /// @notice Quick redemption without hints (higher gas).
    /// @dev Matches Mezo Option A (no hints). All hints/NICR/iterations set to zero.
    /// @param _musdAmount Amount of MUSD to redeem; must be > 0.
    function redeemQuick(uint256 _musdAmount) external {
        if (_musdAmount == 0) revert Errors.ZeroAmount();
        tm.redeemCollateral(_musdAmount, address(0), address(0), address(0), 0, 0);
        emit RedemptionExecuted(++jobId, msg.sender, _musdAmount, _musdAmount, 0, false);
    }

    /// @notice Hint-assisted redemption with strict truncated match.
    /// @dev Matches Mezo Option B (with hints). Reverts unless `musdAmount == truncatedAmount` to enforce exactness.
    /// @param _musdAmount Requested MUSD to redeem; must be > 0 and equal to truncated from HintHelpers.
    /// @param _price Price input for HintHelpers (must match TroveManager pricing source).
    /// @param _maxIter Max trove iterations for hinting and redemption traversal.
    /// @param _upperSeed Seed upper hint candidate for SortedTroves.
    /// @param _lowerSeed Seed lower hint candidate for SortedTroves.
    function redeemHinted(uint256 _musdAmount, uint256 _price, uint256 _maxIter, address _upperSeed, address _lowerSeed)
        external
    {
        if (_musdAmount == 0) revert Errors.ZeroAmount();
        (address first, uint256 nicr, uint256 truncated) = hints.getRedemptionHints(_musdAmount, _price, _maxIter);
        if (_musdAmount != truncated) revert Errors.TruncatedMismatch(truncated);

        (address upper, address lower) = sorted.findInsertPosition(nicr, _upperSeed, _lowerSeed);
        tm.redeemCollateral(_musdAmount, first, upper, lower, nicr, _maxIter);
        emit RedemptionExecuted(++jobId, msg.sender, _musdAmount, truncated, _maxIter, true);
    }
}
