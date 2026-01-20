// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title ITroveManager (Mezo)
/// @notice Minimal interface needed by TrovePilot v2 wrappers.
interface ITroveManager {
    /// @notice Liquidate a single trove.
    function liquidate(address _borrower) external;

    /// @notice Batch liquidate provided troves.
    function batchLiquidateTroves(address[] calldata _borrowers) external;

    /// @notice Redeem MUSD for collateral using optional hints.
    function redeemCollateral(
        uint256 _MUSDamount,
        address _firstRedemptionHint,
        address _upperPartialRedemptionHint,
        address _lowerPartialRedemptionHint,
        uint256 _partialRedemptionHintNICR,
        uint256 _maxIterations
    ) external;
}
